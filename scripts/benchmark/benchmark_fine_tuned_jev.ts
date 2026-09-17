import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { GameEngine } from '../../src/game/engine';
import { Snake } from '../../src/game/types';
import { ObservationExtractor } from './observation';
import { BotAIController } from '../../src/game/botAI';
import { SKINS, ARENA_RADIUS, INITIAL_SNAKE_LENGTH } from '../../src/game/constants';

interface JevResponse {
  action: 'evade_hard_left' | 'evade_hard_right' | 'intercept_attack' | 'forage_food' | 'flee_to_center';
  boost: boolean;
  confidence: number;
  dt_ms: number;
}

class JevFastinoClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private isReady = false;
  private resolveNext: ((res: JevResponse) => void) | null = null;
  private buffer = '';

  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.proc = spawn('/tmp/jev_env/bin/python', ['scripts/benchmark/jev_bridge.py'], {
        cwd: '/home/uri/slither-io',
      });

      this.proc.stdout.on('data', (data) => {
        this.buffer += data.toString();
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line.trim());
            if (parsed.status === 'ready') {
              this.isReady = true;
              resolve();
            } else if (this.resolveNext) {
              const cb = this.resolveNext;
              this.resolveNext = null;
              cb(parsed);
            }
          } catch (e) {
            console.error('Failed to parse bridge output:', line, e);
          }
        }
      });

      this.proc.on('error', (err) => {
        reject(err);
      });
    });
  }

  public async classify(text: string): Promise<JevResponse> {
    if (!this.proc || !this.isReady) throw new Error('Jev Bridge not ready');
    return new Promise((resolve) => {
      this.resolveNext = resolve;
      this.proc!.stdin.write(JSON.stringify({ text }) + '\n');
    });
  }

  public stop(): void {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
  }
}

async function runTournament() {
  console.log('='.repeat(78));
  console.log('🥊 HEAD-TO-HEAD MATCH: FINE-TUNED JEV (GLiNER2.5 74M) vs. DETERMINISTIC ALGO');
  console.log('='.repeat(78));

  const jev = new JevFastinoClient();
  const startLoad = performance.now();
  await jev.start();
  console.log(`✅ Loaded Fine-Tuned Jev model in ${((performance.now() - startLoad) / 1000).toFixed(1)}s!`);

  const engine = new GameEngine();
  engine.autoReplenishBots = false;
  engine.snakes = [];

  const totalBots = 15;
  const detKills: Record<string, number> = {};
  let jevKills = 0;
  let jevDeaths = 0;
  let detDeaths = 0;
  let jevWallDeaths = 0;
  let jevBodyDeaths = 0;

  // Track who killed whom
  engine.onSnakeKilled = (victim: Snake, killer: Snake | null, reason: string) => {
    if (victim.id === 'jev-bot') {
      jevDeaths++;
      if (reason === 'Arena Barrier') jevWallDeaths++;
      else jevBodyDeaths++;
    } else {
      detDeaths++;
    }

    if (killer) {
      if (killer.id === 'jev-bot') {
        jevKills++;
      } else {
        detKills[killer.id] = (detKills[killer.id] || 0) + 1;
      }
    }
  };

  // Spawn Deterministic Bots
  for (let i = 0; i < totalBots - 1; i++) {
    const r = Math.sqrt(Math.random()) * (ARENA_RADIUS - 2000);
    const theta = Math.random() * Math.PI * 2;
    const bot = engine.createSnake(
      `det-${i}`,
      `[Deterministic] #${i}`,
      false,
      SKINS[i % SKINS.length],
      Math.cos(theta) * r,
      Math.sin(theta) * r,
      INITIAL_SNAKE_LENGTH
    );
    bot.policyId = 'deterministic';
    engine.snakes.push(bot);
  }

  // Spawn Jev Bot
  const jevSnake = engine.createSnake(
    'jev-bot',
    '⚡ [Fine-Tuned Jev 74M]',
    false,
    SKINS[4],
    0,
    0,
    INITIAL_SNAKE_LENGTH
  );
  jevSnake.policyId = 'jev';
  engine.snakes.push(jevSnake);

  let currentAction = 'forage_food';
  let currentBoost = false;
  let currentConfidence = 0.95;

  let totalInferenceTime = 0;
  let totalInferences = 0;
  let maxJevScore = jevSnake.score;
  let maxDetScore = 0;

  const totalTicks = 800; // ~13.3 seconds of in-game continuous tournament play
  console.log(`⏱️  Running ${totalTicks} ticks with Jev making real-time tactical decisions...`);

  for (let tick = 0; tick < totalTicks; tick++) {
    // 1. Jev forward pass every 16 ticks (~260ms)
    if (!jevSnake.isDead && tick % 16 === 0) {
      const obs = ObservationExtractor.extract(
        jevSnake,
        engine.snakes,
        (engine as any).bodyGrid,
        (engine as any).foodGrid
      );

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

      const res = await jev.classify(text);
      currentAction = res.action;
      currentBoost = res.boost;
      currentConfidence = res.confidence;
      totalInferenceTime += res.dt_ms;
      totalInferences++;
    }

    // 2. Custom controller update
    engine.customBotUpdate = (bot, allSnakes, bodyGrid, foodGrid) => {
      if (bot.id === 'jev-bot') {
        // Execute fine-tuned Jev action
        if (currentAction === 'flee_to_center') {
          bot.targetAngle = Math.atan2(-bot.head.y, -bot.head.x);
        } else if (currentAction === 'evade_hard_left') {
          bot.targetAngle = bot.angle - 1.2;
        } else if (currentAction === 'evade_hard_right') {
          bot.targetAngle = bot.angle + 1.2;
        } else if (currentAction === 'intercept_attack') {
          let closestOpponent: Snake | null = null;
          let closestDistSq = 900 * 900;
          for (const s of allSnakes) {
            if (s.id === bot.id || s.isDead) continue;
            const dx = s.head.x - bot.head.x;
            const dy = s.head.y - bot.head.y;
            const d = dx * dx + dy * dy;
            if (d < closestDistSq) {
              closestDistSq = d;
              closestOpponent = s;
            }
          }
          if (closestOpponent) {
            const leadX = closestOpponent.head.x + Math.cos(closestOpponent.angle) * 80;
            const leadY = closestOpponent.head.y + Math.sin(closestOpponent.angle) * 80;
            bot.targetAngle = Math.atan2(leadY - bot.head.y, leadX - bot.head.x);
          }
        } else {
          // Forage food: track food target
          BotAIController.updateBot(bot, allSnakes, bodyGrid, foodGrid);
        }

        bot.isBoosting = currentBoost && bot.score > 24;

        // Low-level reflex shield
        const lookAheadDist = bot.radius * 4.0;
        if (bodyGrid.hasObstacle(bot.head.x, bot.head.y, lookAheadDist + 30, bot.id)) {
          bot.isBoosting = false;
        }
      } else {
        // Deterministic baseline update
        BotAIController.updateBot(bot, allSnakes, bodyGrid, foodGrid);
      }
    };

    engine.update(16.67);

    if (jevSnake.score > maxJevScore) maxJevScore = jevSnake.score;
    for (const s of engine.snakes) {
      if (s.id !== 'jev-bot' && s.score > maxDetScore) {
        maxDetScore = s.score;
      }
    }

    if (jevSnake.isDead) {
      console.log(`💀 Jev bot died at tick ${tick}!`);
      break;
    }
  }

  jev.stop();

  const avgInferenceMs = totalInferences > 0 ? (totalInferenceTime / totalInferences).toFixed(1) : '0';
  const totalDetKills = Object.values(detKills).reduce((a, b) => a + b, 0);

  console.log('\n' + '='.repeat(78));
  console.log('📊 HEAD-TO-HEAD MATCH RESULTS:');
  console.log('='.repeat(78));
  console.log(`  Jev Final Status                   | ${jevSnake.isDead ? 'ELIMINATED' : 'STILL ALIVE'}`);
  console.log(`  Jev Kills                          | ${jevKills}`);
  console.log(`  Jev Deaths                         | ${jevDeaths} (Wall: ${jevWallDeaths}, Body: ${jevBodyDeaths})`);
  console.log(`  Jev Peak Score                     | ${Math.round(maxJevScore)}`);
  console.log(`  Deterministic Bots Total Kills     | ${totalDetKills}`);
  console.log(`  Deterministic Bots Peak Score      | ${Math.round(maxDetScore)}`);
  console.log(`  Jev Model Forward Passes           | ${totalInferences}`);
  console.log(`  Jev Average Forward-Pass Latency   | ${avgInferenceMs} ms (CPU)`);
  console.log('-'.repeat(78));

  if (!jevSnake.isDead && jevSnake.score >= maxDetScore * 0.8) {
    console.log('👉 CONCLUSION: ✅ Fine-Tuned Jev successfully survives and competes effectively!');
  } else if (!jevSnake.isDead) {
    console.log('👉 CONCLUSION: 🛡️ Fine-Tuned Jev survived the match, but deterministic bots foraged faster.');
  } else {
    console.log('👉 CONCLUSION: ❌ Fine-Tuned Jev was eliminated by deterministic opponents.');
  }
  console.log('='.repeat(78) + '\n');
}

runTournament().catch(console.error);
