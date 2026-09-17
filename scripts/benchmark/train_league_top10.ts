import { GameEngine } from '../../src/game/engine';
import { Snake, Orb } from '../../src/game/types';
import { ObservationExtractor } from './observation';
import { DeterministicBaselinePolicy } from './policies';
import { ARENA_RADIUS, INITIAL_SNAKE_LENGTH, SKINS, BOT_NAMES, MIN_BOOST_MASS } from '../../src/game/constants';
import * as fs from 'fs';
import * as path from 'path';

export interface NetWeights {
  w1: number[][]; // 64 x 32
  b1: number[];   // 64
  w2: number[][]; // 32 x 64
  b2: number[];   // 32
  w3: number[][]; // 2 x 32
  b3: number[];   // 2
}

export type ArchetypeId =
  | 'punisher'
  | 'interceptor'
  | 'vacuum'
  | 'wall_hugger'
  | 'baiter'
  | 'coiler'
  | 'conservative_giant'
  | 'flanker'
  | 'prey_stalker'
  | 'opportunist';

export interface ArchetypeConfig {
  id: ArchetypeId;
  name: string;
  description: string;
  targetSkinIndex: number;
  safetyMarginMultiplier: number;
  boostAggression: number;
  evaluateFitness: (stats: CandidateStats) => number;
}

export interface CandidateStats {
  kills: number;
  deaths: number;
  wallDeaths: number;
  peakScore: number;
  endScore: number;
  ticksAlive: number;
  preyEaten: number;
  perimeterTicks: number;
  flankKills: number;
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

function forwardPass(x: Float32Array, w: NetWeights): { steerDelta: number; boostLogit: number } {
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
    boostLogit: boostOut,
  };
}

const WHISKER_ANGLES = [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 1.9, -1.9, 2.4, -2.4];
const ARENA_BARRIER_DIST = ARENA_RADIUS - 60;
const ARENA_BARRIER_SQ = ARENA_BARRIER_DIST * ARENA_BARRIER_DIST;
const ARENA_DANGER_DIST = ARENA_RADIUS - 400;
const ARENA_DANGER_SQ = ARENA_DANGER_DIST * ARENA_DANGER_DIST;
const PERIMETER_DIST_SQ = (ARENA_RADIUS - 1200) * (ARENA_RADIUS - 1200);

export const ARCHETYPES: ArchetypeConfig[] = [
  {
    id: 'punisher',
    name: 'The Patient Punisher',
    description: 'Maintains wide buffers, waits for attackers to overcommit, and deploys lethal counter-traps',
    targetSkinIndex: 4,
    safetyMarginMultiplier: 1.25,
    boostAggression: 0.5,
    evaluateFitness: (s) => s.kills * 1200 + s.ticksAlive * 0.8 + s.peakScore * 1.0 - s.deaths * 1000,
  },
  {
    id: 'interceptor',
    name: 'The Apex Interceptor',
    description: 'Calculates dynamic intercept triangles and aggressively cuts off vulnerable targets',
    targetSkinIndex: 1,
    safetyMarginMultiplier: 1.0,
    boostAggression: 0.8,
    evaluateFitness: (s) => s.kills * 1500 + s.peakScore * 1.5 - s.deaths * 500,
  },
  {
    id: 'vacuum',
    name: 'The Death-Drop Vacuum',
    description: 'Prioritizes high-mass food clusters and death drops to maximize rapid body growth',
    targetSkinIndex: 6,
    safetyMarginMultiplier: 1.1,
    boostAggression: 0.6,
    evaluateFitness: (s) => s.peakScore * 3.5 + s.kills * 600 - s.deaths * 600,
  },
  {
    id: 'wall_hugger',
    name: 'The Perimeter Wall-Hugger',
    description: 'Patrols the outer boundary safe zone away from chaotic center brawls',
    targetSkinIndex: 0,
    safetyMarginMultiplier: 1.3,
    boostAggression: 0.3,
    evaluateFitness: (s) => s.perimeterTicks * 3.0 + s.peakScore * 1.2 + s.kills * 600 - s.wallDeaths * 2500 - s.deaths * 400,
  },
  {
    id: 'baiter',
    name: 'The Baiter',
    description: 'Feigns cruising speed to lure enemies, then boosts and swings body segments across their path',
    targetSkinIndex: 3,
    safetyMarginMultiplier: 1.05,
    boostAggression: 0.7,
    evaluateFitness: (s) => s.kills * 1400 + s.peakScore * 1.2 - s.deaths * 700,
  },
  {
    id: 'coiler',
    name: 'The Tight Coiler',
    description: 'Excels at encircling smaller opponents to entrap them inside its body circumference',
    targetSkinIndex: 2,
    safetyMarginMultiplier: 1.15,
    boostAggression: 0.65,
    evaluateFitness: (s) => s.kills * 1300 + s.peakScore * 1.8 - s.deaths * 600,
  },
  {
    id: 'conservative_giant',
    name: 'The Conservative Giant',
    description: 'Prioritizes extreme longevity, mass retention, and low-risk defensive steering',
    targetSkinIndex: 5,
    safetyMarginMultiplier: 1.35,
    boostAggression: 0.25,
    evaluateFitness: (s) => s.ticksAlive * 3.0 + s.endScore * 2.5 - s.deaths * 1800,
  },
  {
    id: 'flanker',
    name: 'The Flanker',
    description: 'Approaches targets from perpendicular blind angles for surprise cut-offs',
    targetSkinIndex: 7,
    safetyMarginMultiplier: 1.05,
    boostAggression: 0.75,
    evaluateFitness: (s) => s.flankKills * 1800 + s.kills * 800 + s.peakScore * 1.0 - s.deaths * 500,
  },
  {
    id: 'prey_stalker',
    name: 'The Prey Stalker',
    description: 'Relentlessly tracks and consumes erratic wandering fireflies for instant mass boosts',
    targetSkinIndex: 4,
    safetyMarginMultiplier: 1.1,
    boostAggression: 0.7,
    evaluateFitness: (s) => s.preyEaten * 1200 + s.peakScore * 1.5 + s.kills * 500 - s.deaths * 400,
  },
  {
    id: 'opportunist',
    name: 'The Opportunist',
    description: 'Follows in the wake of larger snakes, harvesting their left-over boost food and dropped mass',
    targetSkinIndex: 0,
    safetyMarginMultiplier: 1.2,
    boostAggression: 0.4,
    evaluateFitness: (s) => s.peakScore * 2.5 + s.ticksAlive * 1.2 + s.kills * 700 - s.deaths * 500,
  },
];

function evaluateCandidateNiche(
  weights: NetWeights,
  archetype: ArchetypeConfig,
  ticks: number = 700
): CandidateStats {
  const engine = new GameEngine();
  engine.autoReplenishBots = false;
  engine.snakes = [];

  const stats: CandidateStats = {
    kills: 0,
    deaths: 0,
    wallDeaths: 0,
    peakScore: 0,
    endScore: 0,
    ticksAlive: 0,
    preyEaten: 0,
    perimeterTicks: 0,
    flankKills: 0,
  };

  // Track kills
  engine.onSnakeKilled = (victim: Snake, killer: Snake | null, reason: string) => {
    if (victim.id === 'candidate') {
      stats.deaths++;
      if (reason === 'Arena Barrier') stats.wallDeaths++;
    }
    if (killer && killer.id === 'candidate') {
      stats.kills++;
      const victimAngle = victim.angle;
      const attackAngle = killer.angle;
      let angleDiff = Math.abs(attackAngle - victimAngle);
      while (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
      if (angleDiff > 1.0 && angleDiff < 2.2) {
        stats.flankKills++; // Perpendicular flank angle
      }
    }
  };

  // Spawn 14 Baseline Bots
  for (let i = 0; i < 14; i++) {
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
    `Candidate-${archetype.id}`,
    false,
    SKINS[archetype.targetSkinIndex % SKINS.length],
    0,
    0,
    INITIAL_SNAKE_LENGTH
  );
  candidate.policyId = 'candidate';
  engine.snakes.push(candidate);

  stats.peakScore = candidate.score;

  engine.customBotUpdate = (bot, allSnakes, bodyGrid, foodGrid) => {
    if (bot.id === 'candidate') {
      const obs = ObservationExtractor.extract(bot, allSnakes, bodyGrid, foodGrid);
      const vec = ObservationExtractor.toNormalizedVector(obs);
      const action = forwardPass(vec, weights);

      // Neural target steering
      bot.targetAngle = bot.angle + action.steerDelta;
      while (bot.targetAngle < -Math.PI) bot.targetAngle += Math.PI * 2;
      while (bot.targetAngle > Math.PI) bot.targetAngle -= Math.PI * 2;

      const canBoost = bot.score > MIN_BOOST_MASS + 5;
      bot.isBoosting = canBoost && action.boostLogit > (1.0 - archetype.boostAggression);

      // Reflex Safety Gate with Archetype Multiplier
      const headX = bot.head.x;
      const headY = bot.head.y;
      if (headX * headX + headY * headY > ARENA_DANGER_SQ) {
        bot.targetAngle = Math.atan2(-headY, -headX);
        return;
      }

      const lookAhead = bot.radius * (bot.isBoosting ? 5.2 : 3.8) * archetype.safetyMarginMultiplier;
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
    if (!candidate.isDead) {
      stats.ticksAlive++;
      if (candidate.score > stats.peakScore) stats.peakScore = candidate.score;
      stats.endScore = candidate.score;

      const distSq = candidate.head.x * candidate.head.x + candidate.head.y * candidate.head.y;
      if (distSq > PERIMETER_DIST_SQ) {
        stats.perimeterTicks++;
      }
    }

    // Maintain baseline bot count
    for (let i = engine.snakes.length - 1; i >= 0; i--) {
      if (engine.snakes[i].isDead && engine.snakes[i].id !== 'candidate') {
        engine.snakes.splice(i, 1);
      }
    }
    while (engine.snakes.length < 15) {
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

  return stats;
}

export async function trainLeagueTop10() {
  console.log('='.repeat(78));
  console.log('🏆 INITIALIZING QUALITY-DIVERSITY LEAGUE TRAINING: TOP 10 SPECIALIST ARCHETYPES');
  console.log('='.repeat(78));
  console.log('Training 10 distinct neural network specialist models across behavioral niches...\n');

  const punisherPath = path.join(__dirname, 'punisher_net.json');
  const baseWeightsPath = path.join(__dirname, 'trained_raw_net.json');
  const seedPath = fs.existsSync(punisherPath) ? punisherPath : baseWeightsPath;

  const baseWeights: NetWeights = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const trainedSpecialists: Record<string, { config: ArchetypeConfig; weights: NetWeights; stats: CandidateStats }> = {};

  const tStart = performance.now();

  for (let aIdx = 0; aIdx < ARCHETYPES.length; aIdx++) {
    const archetype = ARCHETYPES[aIdx];
    console.log(`[${aIdx + 1}/10] 🧬 Evolving Niche: ${archetype.name.toUpperCase()}`);
    console.log(`     Target: ${archetype.description}`);

    const popSize = 12;
    const gens = 8;
    let pop: NetWeights[] = [cloneWeights(baseWeights)];
    for (let i = 1; i < popSize; i++) {
      pop.push(mutateWeights(baseWeights, 0.05));
    }

    let bestWeights = cloneWeights(baseWeights);
    let bestFitness = -Infinity;
    let bestStats: CandidateStats = {
      kills: 0,
      deaths: 0,
      wallDeaths: 0,
      peakScore: 0,
      endScore: 0,
      ticksAlive: 0,
      preyEaten: 0,
      perimeterTicks: 0,
      flankKills: 0,
    };

    for (let gen = 1; gen <= gens; gen++) {
      const sigma = Math.max(0.015, 0.05 * (1 - gen / gens));
      const evaluated = pop.map((w) => {
        const stats = evaluateCandidateNiche(w, archetype, 600);
        const fitness = archetype.evaluateFitness(stats);
        return { w, stats, fitness };
      });

      evaluated.sort((a, b) => b.fitness - a.fitness);
      if (evaluated[0].fitness > bestFitness) {
        bestFitness = evaluated[0].fitness;
        bestWeights = cloneWeights(evaluated[0].w);
        bestStats = evaluated[0].stats;
      }

      // Elitism & breeding
      const elites = evaluated.slice(0, 3);
      const nextPop: NetWeights[] = elites.map((e) => cloneWeights(e.w));
      while (nextPop.length < popSize) {
        const parent = elites[Math.floor(Math.random() * elites.length)];
        nextPop.push(mutateWeights(parent.w, sigma));
      }
      pop = nextPop;
    }

    trainedSpecialists[archetype.id] = {
      config: archetype,
      weights: bestWeights,
      stats: bestStats,
    };

    console.log(`     ✅ Best Fitness: ${Math.round(bestFitness)} | Kills: ${bestStats.kills} | Peak Mass: ${Math.round(bestStats.peakScore)} | Alive: ${bestStats.deaths === 0 ? 'YES' : 'NO'}\n`);
  }

  const elapsed = (performance.now() - tStart) / 1000;
  console.log('='.repeat(78));
  console.log(`🎉 ALL 10 ARCHETYPES TRAINED AND OPTIMIZED in ${elapsed.toFixed(1)}s!`);
  console.log('='.repeat(78));

  // Export to src/game/neuralWeights.json
  const exportPayload: Record<string, {
    name: string;
    description: string;
    skinIndex: number;
    safetyMultiplier: number;
    boostAggression: number;
    weights: NetWeights;
  }> = {};

  for (const [id, spec] of Object.entries(trainedSpecialists)) {
    exportPayload[id] = {
      name: spec.config.name,
      description: spec.config.description,
      skinIndex: spec.config.targetSkinIndex,
      safetyMultiplier: spec.config.safetyMarginMultiplier,
      boostAggression: spec.config.boostAggression,
      weights: spec.weights,
    };
  }

  const destPath = path.join(__dirname, '../../src/game/neuralWeights.json');
  fs.writeFileSync(destPath, JSON.stringify(exportPayload, null, 2));
  console.log(`💾 Exported Top 10 Neural Models to ${destPath}!`);
}

trainLeagueTop10().catch(console.error);
