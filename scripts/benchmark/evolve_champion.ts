import { GameEngine } from '../../src/game/engine';
import { Snake } from '../../src/game/types';
import { ObservationExtractor } from './observation';
import { DeterministicBaselinePolicy } from './policies';
import { ARENA_RADIUS, INITIAL_SNAKE_LENGTH, SKINS, BOT_NAMES, MIN_BOOST_MASS } from '../../src/game/constants';
import * as fs from 'fs';
import * as path from 'path';

interface NetWeights {
  w1: number[][]; // 64 x 32
  b1: number[];   // 64
  w2: number[][]; // 32 x 64
  b2: number[];   // 32
  w3: number[][]; // 2 x 32
  b3: number[];   // 2
}

function cloneWeights(w: NetWeights): NetWeights {
  return JSON.parse(JSON.stringify(w));
}

function mutateWeights(w: NetWeights, sigma: number): NetWeights {
  const mutated = cloneWeights(w);
  for (let i = 0; i < 64; i++) {
    mutated.b1[i] += (Math.random() - 0.5) * 2 * sigma;
    for (let j = 0; j < 32; j++) {
      mutated.w1[i][j] += (Math.random() - 0.5) * 2 * sigma;
    }
  }
  for (let i = 0; i < 32; i++) {
    mutated.b2[i] += (Math.random() - 0.5) * 2 * sigma;
    for (let j = 0; j < 64; j++) {
      mutated.w2[i][j] += (Math.random() - 0.5) * 2 * sigma;
    }
  }
  for (let i = 0; i < 2; i++) {
    mutated.b3[i] += (Math.random() - 0.5) * 2 * sigma;
    for (let j = 0; j < 32; j++) {
      mutated.w3[i][j] += (Math.random() - 0.5) * 2 * sigma;
    }
  }
  return mutated;
}

function forwardPass(x: Float32Array, w: NetWeights): { steerDelta: number; shouldBoost: boolean } {
  // Layer 1: 32 -> 64
  const h1 = new Float32Array(64);
  for (let i = 0; i < 64; i++) {
    let sum = w.b1[i];
    const wRow = w.w1[i];
    for (let j = 0; j < 32; j++) {
      sum += x[j] * wRow[j];
    }
    h1[i] = sum > 0 ? sum : 0;
  }

  // Layer 2: 64 -> 32
  const h2 = new Float32Array(32);
  for (let i = 0; i < 32; i++) {
    let sum = w.b2[i];
    const wRow = w.w2[i];
    for (let j = 0; j < 64; j++) {
      sum += h1[j] * wRow[j];
    }
    h2[i] = sum > 0 ? sum : 0;
  }

  // Output: 32 -> 2
  let steerOut = w.b3[0];
  let boostOut = w.b3[1];
  const wRow0 = w.w3[0];
  const wRow1 = w.w3[1];
  for (let j = 0; j < 32; j++) {
    steerOut += h2[j] * wRow0[j];
    boostOut += h2[j] * wRow1[j];
  }

  const steerDelta = Math.max(-1.0, Math.min(1.0, steerOut)) * Math.PI;
  return {
    steerDelta,
    shouldBoost: boostOut > 0.5,
  };
}

const WHISKER_ANGLES = [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 1.9, -1.9, 2.4, -2.4];
const ARENA_BARRIER_DIST = ARENA_RADIUS - 60;
const ARENA_BARRIER_SQ = ARENA_BARRIER_DIST * ARENA_BARRIER_DIST;
const ARENA_DANGER_DIST = ARENA_RADIUS - 400;
const ARENA_DANGER_SQ = ARENA_DANGER_DIST * ARENA_DANGER_DIST;

function evaluateCandidate(weights: NetWeights, ticks: number = 800): { fitness: number; kills: number; deaths: number; peakScore: number } {
  const engine = new GameEngine();
  engine.autoReplenishBots = false;
  engine.snakes = [];

  let candidateKills = 0;
  let candidateDeaths = 0;

  // Track kills
  engine.onSnakeKilled = (victim: Snake, killer: Snake | null) => {
    if (victim.id === 'candidate') {
      candidateDeaths++;
    }
    if (killer && killer.id === 'candidate') {
      candidateKills++;
    }
  };

  // Spawn 15 Baseline Bots
  for (let i = 0; i < 15; i++) {
    const r = Math.sqrt(Math.random()) * (ARENA_RADIUS - 2000);
    const theta = Math.random() * Math.PI * 2;
    const bot = engine.createSnake(
      `det-${i}`,
      `[Baseline] #${i}`,
      false,
      SKINS[i % SKINS.length],
      Math.cos(theta) * r,
      Math.sin(theta) * r,
      INITIAL_SNAKE_LENGTH
    );
    bot.policyId = 'deterministic';
    engine.snakes.push(bot);
  }

  // Spawn Candidate
  const candidate = engine.createSnake(
    'candidate',
    'Candidate',
    false,
    SKINS[4],
    0,
    0,
    INITIAL_SNAKE_LENGTH
  );
  candidate.policyId = 'candidate';
  engine.snakes.push(candidate);

  let peakScore = candidate.score;

  // Custom update
  engine.customBotUpdate = (bot, allSnakes, bodyGrid, foodGrid) => {
    if (bot.id === 'candidate') {
      const obs = ObservationExtractor.extract(bot, allSnakes, bodyGrid, foodGrid);
      const vec = ObservationExtractor.toNormalizedVector(obs);
      const action = forwardPass(vec, weights);

      // Neural target
      bot.targetAngle = bot.angle + action.steerDelta;
      while (bot.targetAngle < -Math.PI) bot.targetAngle += Math.PI * 2;
      while (bot.targetAngle > Math.PI) bot.targetAngle -= Math.PI * 2;
      const canBoost = bot.score > MIN_BOOST_MASS + 5;
      bot.isBoosting = canBoost && action.shouldBoost;

      // Reflex safety gate
      const headX = bot.head.x;
      const headY = bot.head.y;
      if (headX * headX + headY * headY > ARENA_DANGER_SQ) {
        bot.targetAngle = Math.atan2(-headY, -headX);
        return;
      }

      const lookAhead = bot.radius * (bot.isBoosting ? 5.0 : 3.5);
      if (bodyGrid.hasObstacle(headX, headY, lookAhead + 30, bot.id)) {
        let bestClear: number | null = null;
        let maxClear = -1;
        let bestAngle = bot.angle + Math.PI;

        for (let a = 0; a < WHISKER_ANGLES.length; a++) {
          const ray = bot.angle + WHISKER_ANGLES[a];
          const cosA = Math.cos(ray);
          const sinA = Math.sin(ray);
          let clear = true;
          let steps = 0;
          for (let step = 1; step <= 3; step++) {
            const rx = headX + cosA * (lookAhead * step) / 3;
            const ry = headY + sinA * (lookAhead * step) / 3;
            if (rx * rx + ry * ry >= ARENA_BARRIER_SQ || bodyGrid.hasObstacle(rx, ry, bot.radius * 1.3, bot.id)) {
              clear = false;
              break;
            }
            steps = step;
          }
          if (clear && bestClear === null) bestClear = ray;
          if (steps > maxClear) {
            maxClear = steps;
            bestAngle = ray;
          }
        }
        bot.targetAngle = bestClear !== null ? bestClear : bestAngle;
        bot.isBoosting = false;
      }
    } else {
      DeterministicBaselinePolicy.prototype.update.call(null, bot, allSnakes, bodyGrid, foodGrid);
    }
  };

  for (let t = 0; t < ticks; t++) {
    engine.update(16.67);
    if (candidate.score > peakScore) peakScore = candidate.score;

    // Purge dead snakes and maintain baseline count
    for (let i = engine.snakes.length - 1; i >= 0; i--) {
      if (engine.snakes[i].isDead && engine.snakes[i].id !== 'candidate') {
        engine.snakes.splice(i, 1);
      }
    }
    while (engine.snakes.length < 16) {
      const idx = engine.snakes.length;
      const r = Math.sqrt(Math.random()) * (ARENA_RADIUS - 2000);
      const theta = Math.random() * Math.PI * 2;
      const b = engine.createSnake(
        `det-respawn-${t}-${idx}`,
        `[Baseline] #${idx}`,
        false,
        SKINS[idx % SKINS.length],
        Math.cos(theta) * r,
        Math.sin(theta) * r,
        INITIAL_SNAKE_LENGTH
      );
      b.policyId = 'deterministic';
      engine.snakes.push(b);
    }

    if (candidate.isDead) break;
  }

  // Fitness formula: rewards kills against baseline, mass accumulation, survival
  const survivalBonus = candidate.isDead ? 0 : 250;
  const fitness = candidateKills * 800 + peakScore * 1.8 + survivalBonus - candidateDeaths * 600;

  return { fitness, kills: candidateKills, deaths: candidateDeaths, peakScore };
}

export function runEvolution() {
  console.log('🧬 INITIALIZING NEUROEVOLUTION: EVOLVING CHAMPION SLITHER NEURAL NET');
  console.log('Target: Outperform the handcrafted baseline deterministic algorithm via self-play!\n');

  const baseWeightsPath = path.join(__dirname, 'trained_raw_net.json');
  if (!fs.existsSync(baseWeightsPath)) {
    console.error('Base weights not found!');
    return;
  }

  const baseWeights: NetWeights = JSON.parse(fs.readFileSync(baseWeightsPath, 'utf8'));
  const populationSize = 20;
  const generations = 15;

  let population: NetWeights[] = [];
  // Seed with cloned base weights and small mutations
  population.push(cloneWeights(baseWeights));
  for (let i = 1; i < populationSize; i++) {
    population.push(mutateWeights(baseWeights, 0.04));
  }

  let bestEver = cloneWeights(baseWeights);
  let bestEverFitness = -Infinity;

  const tStart = performance.now();

  for (let gen = 1; gen <= generations; gen++) {
    const sigma = Math.max(0.015, 0.05 * (1 - gen / generations));
    const results: Array<{ weights: NetWeights; fitness: number; kills: number; deaths: number; peakScore: number }> = [];

    for (let i = 0; i < populationSize; i++) {
      const evalRes = evaluateCandidate(population[i], 650);
      results.push({ weights: population[i], ...evalRes });
    }

    results.sort((a, b) => b.fitness - a.fitness);
    const genBest = results[0];

    if (genBest.fitness > bestEverFitness) {
      bestEverFitness = genBest.fitness;
      bestEver = cloneWeights(genBest.weights);
    }

    console.log(`  Gen ${gen.toString().padStart(2)}/${generations} | Best Fitness: ${Math.round(genBest.fitness).toString().padStart(5)} | Kills: ${genBest.kills} | Peak Mass: ${Math.round(genBest.peakScore).toString().padStart(4)} | Alive: ${genBest.deaths === 0 ? 'YES' : 'NO '}`);

    // Elitism: Top 4 survive, breed next generation with mutation
    const elites = results.slice(0, 4);
    const nextGen: NetWeights[] = [];
    for (const e of elites) {
      nextGen.push(cloneWeights(e.weights));
    }
    while (nextGen.length < populationSize) {
      const parent = elites[Math.floor(Math.random() * elites.length)];
      nextGen.push(mutateWeights(parent.weights, sigma));
    }
    population = nextGen;
  }

  const elapsed = (performance.now() - tStart) / 1000;
  console.log(`\n🎉 EVOLUTION COMPLETE in ${elapsed.toFixed(1)}s! Best Fitness: ${Math.round(bestEverFitness)}`);

  // Save Champion Weights
  const championPath = path.join(__dirname, 'champion_net.json');
  fs.writeFileSync(championPath, JSON.stringify(bestEver));
  console.log(`💾 Saved Champion Neural Network weights to ${championPath}!`);
}

runEvolution();
