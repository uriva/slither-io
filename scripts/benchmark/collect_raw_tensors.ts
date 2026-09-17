import { GameEngine } from '../../src/game/engine';
import { ObservationExtractor } from './observation';
import { AggressiveHunterPolicy } from './policies';
import { ARENA_RADIUS, INITIAL_SNAKE_LENGTH, SKINS, BOT_NAMES } from '../../src/game/constants';
import * as fs from 'fs';

export function collectRawTensors(sampleTarget: number = 80000, outputPath: string = 'scripts/benchmark/raw_dataset.bin') {
  console.log(`🎮 Collecting ${sampleTarget} raw 32-float observation tensors + continuous action targets...`);

  const engine = new GameEngine();
  engine.autoReplenishBots = false;
  engine.snakes = [];

  const hunter = new AggressiveHunterPolicy();
  const botCount = 40;

  // Float32Array: 32 inputs + 2 outputs (steeringDelta, boost) = 34 floats per sample
  const data = new Float32Array(sampleTarget * 34);
  let sampleCount = 0;

  for (let i = 0; i < botCount; i++) {
    const r = Math.sqrt(Math.random()) * (ARENA_RADIUS - 2000);
    const theta = Math.random() * Math.PI * 2;
    const bot = engine.createSnake(
      `bot-${i}`,
      BOT_NAMES[i % BOT_NAMES.length] + i,
      false,
      SKINS[i % SKINS.length],
      Math.cos(theta) * r,
      Math.sin(theta) * r,
      INITIAL_SNAKE_LENGTH + Math.floor(Math.random() * 40)
    );
    engine.snakes.push(bot);
  }

  let tick = 0;
  while (sampleCount < sampleTarget) {
    tick++;
    engine.update(16.67);

    while (engine.snakes.length < botCount) {
      const idx = engine.snakes.length;
      const r = Math.sqrt(Math.random()) * (ARENA_RADIUS - 1500);
      const theta = Math.random() * Math.PI * 2;
      const bot = engine.createSnake(
        `bot-respawn-${tick}-${idx}`,
        BOT_NAMES[idx % BOT_NAMES.length] + idx,
        false,
        SKINS[idx % SKINS.length],
        Math.cos(theta) * r,
        Math.sin(theta) * r,
        INITIAL_SNAKE_LENGTH + Math.floor(Math.random() * 30)
      );
      engine.snakes.push(bot);
    }

    for (let s = 0; s < engine.snakes.length; s++) {
      if (sampleCount >= sampleTarget) break;
      const bot = engine.snakes[s];
      if (bot.isDead) continue;

      const obs = ObservationExtractor.extract(
        bot,
        engine.snakes,
        (engine as any).bodyGrid,
        (engine as any).foodGrid
      );
      const vec = ObservationExtractor.toNormalizedVector(obs);

      const prevAngle = bot.angle;
      hunter.update(bot, engine.snakes, (engine as any).bodyGrid, (engine as any).foodGrid);
      const chosenAngle = bot.targetAngle;
      const chosenBoost = bot.isBoosting;

      let angleDelta = chosenAngle - prevAngle;
      while (angleDelta < -Math.PI) angleDelta += Math.PI * 2;
      while (angleDelta > Math.PI) angleDelta -= Math.PI * 2;

      // Copy 32 features
      const offset = sampleCount * 34;
      for (let i = 0; i < 32; i++) {
        data[offset + i] = vec[i];
      }
      // Copy 2 targets: normalized steering delta [-1..1] and boost [0..1]
      data[offset + 32] = Math.max(-1.0, Math.min(1.0, angleDelta / Math.PI));
      data[offset + 33] = chosenBoost ? 1.0 : 0.0;

      sampleCount++;
    }
  }

  const buffer = Buffer.from(data.buffer);
  fs.writeFileSync(outputPath, buffer);
  console.log(`✅ Saved ${sampleCount} raw tensor transitions (${(buffer.length / (1024 * 1024)).toFixed(1)} MB) to ${outputPath}`);
}

collectRawTensors();
