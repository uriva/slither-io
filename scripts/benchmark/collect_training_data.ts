import { GameEngine } from '../../src/game/engine';
import { ObservationExtractor } from './observation';
import { AggressiveHunterPolicy } from './policies';
import { ARENA_RADIUS, INITIAL_SNAKE_LENGTH, SKINS, BOT_NAMES } from '../../src/game/constants';
import * as fs from 'fs';

interface TrainingSample {
  text: string;
  action: string;
  boost: string;
}

export function generateBalancedDataset(sampleTarget: number = 10000, outputPath: string = 'scripts/benchmark/dataset.jsonl') {
  console.log(`🎮 Generating balanced Slither dataset of ${sampleTarget} samples across 5 core action classes...`);

  const engine = new GameEngine();
  engine.autoReplenishBots = false;
  engine.snakes = [];

  const hunter = new AggressiveHunterPolicy();
  const botCount = 40;

  const targetPerClass = Math.floor(sampleTarget / 5);
  const actionCounts: Record<string, number> = {
    evade_hard_left: 0,
    evade_hard_right: 0,
    intercept_attack: 0,
    forage_food: 0,
    flee_to_center: 0,
  };

  const samples: TrainingSample[] = [];
  const fileStream = fs.createWriteStream(outputPath, { flags: 'w' });

  let tick = 0;
  while (samples.length < sampleTarget && tick < 8000) {
    tick++;
    engine.update(16.67);

    // Replenish snakes - some near boundary, some in dense clusters for combat/evasion
    while (engine.snakes.length < botCount) {
      const idx = engine.snakes.length;
      let bx = 0;
      let by = 0;

      // Spawn some near wall to train boundary escape
      if (actionCounts.flee_to_center < targetPerClass && Math.random() < 0.4) {
        const wallDist = ARENA_RADIUS - (150 + Math.random() * 400);
        const theta = Math.random() * Math.PI * 2;
        bx = Math.cos(theta) * wallDist;
        by = Math.sin(theta) * wallDist;
      } else {
        // Normal distribution towards center for dense dogfights
        const r = Math.sqrt(Math.random()) * (ARENA_RADIUS - 2000);
        const theta = Math.random() * Math.PI * 2;
        bx = Math.cos(theta) * r;
        by = Math.sin(theta) * r;
      }

      const bot = engine.createSnake(
        `bot-respawn-${tick}-${idx}`,
        BOT_NAMES[idx % BOT_NAMES.length] + idx,
        false,
        SKINS[idx % SKINS.length],
        bx,
        by,
        INITIAL_SNAKE_LENGTH + Math.floor(Math.random() * 50)
      );
      engine.snakes.push(bot);
    }

    for (let s = 0; s < engine.snakes.length; s++) {
      if (samples.length >= sampleTarget) break;
      const bot = engine.snakes[s];
      if (bot.isDead) continue;

      const obs = ObservationExtractor.extract(
        bot,
        engine.snakes,
        (engine as any).bodyGrid,
        (engine as any).foodGrid
      );

      const prevAngle = bot.angle;
      hunter.update(bot, engine.snakes, (engine as any).bodyGrid, (engine as any).foodGrid);
      const chosenAngle = bot.targetAngle;
      const chosenBoost = bot.isBoosting;

      let angleDelta = chosenAngle - prevAngle;
      while (angleDelta < -Math.PI) angleDelta += Math.PI * 2;
      while (angleDelta > Math.PI) angleDelta -= Math.PI * 2;

      let actionLabel = 'forage_food';
      if (obs.distToBoundary < 700) {
        actionLabel = 'flee_to_center';
      } else {
        const leftMinClear = Math.min(...obs.whiskerClearances.slice(1, 6));
        const rightMinClear = Math.min(...obs.whiskerClearances.slice(6));
        const frontClear = obs.whiskerClearances[0];

        if (frontClear < 0.65 || leftMinClear < 0.55 || rightMinClear < 0.55) {
          if (leftMinClear > rightMinClear) actionLabel = 'evade_hard_left';
          else actionLabel = 'evade_hard_right';
        } else if (obs.opponents.length > 0 && obs.opponents[0].dist < 550) {
          actionLabel = 'intercept_attack';
        } else {
          actionLabel = 'forage_food';
        }
      }

      // Check class balance limit
      if ((actionCounts[actionLabel] || 0) >= targetPerClass) {
        continue;
      }

      actionCounts[actionLabel] = (actionCounts[actionLabel] || 0) + 1;

      const leftClear = (obs.whiskerClearances.slice(1, 6).reduce((a, b) => a + b, 0) / 5).toFixed(2);
      const rightClear = (obs.whiskerClearances.slice(6).reduce((a, b) => a + b, 0) / 5).toFixed(2);
      const frontClear = obs.whiskerClearances[0].toFixed(2);

      let oppText = 'No opponents nearby.';
      if (obs.opponents.length > 0) {
        const o = obs.opponents[0];
        oppText = `Opponent at ${Math.round(o.dist)}px, angle ${(o.relAngle * 57.3).toFixed(0)}deg, mass diff ${Math.round(o.massDelta)}.`;
      }

      let foodText = 'No food nearby.';
      if (obs.food.length > 0) {
        const f = obs.food[0];
        foodText = `Food cluster at ${Math.round(f.dist)}px, angle ${(f.relAngle * 57.3).toFixed(0)}deg.`;
      }

      const boundaryText = obs.distToBoundary < 1000
        ? `Arena wall dangerously close: ${Math.round(obs.distToBoundary)}px.`
        : `Arena wall distant: ${Math.round(obs.distToBoundary)}px.`;

      const text = `Situation: ${boundaryText} Whiskers(front: ${frontClear}, left: ${leftClear}, right: ${rightClear}). ${oppText} ${foodText}`;

      const sample: TrainingSample = {
        text,
        action: actionLabel,
        boost: chosenBoost ? 'boost' : 'cruise',
      };

      samples.push(sample);
      fileStream.write(JSON.stringify(sample) + '\n');
    }
  }

  fileStream.end();
  console.log(`✅ Balanced dataset created with ${samples.length} samples:`);
  console.log('📊 Action distribution:', actionCounts);
}

generateBalancedDataset();
