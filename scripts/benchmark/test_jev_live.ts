import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { GameEngine } from '../../src/game/engine';
import { Snake } from '../../src/game/types';
import { ObservationExtractor } from './observation';
import { BotAIController } from '../../src/game/botAI';
import { SKINS, ARENA_RADIUS, INITIAL_SNAKE_LENGTH } from '../../src/game/constants';

class JevFastinoClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private isReady = false;
  private resolveNext: ((res: any) => void) | null = null;
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

      this.proc.stderr.on('data', (data) => {
        // Ignored warning logs from PyTorch/transformers
      });

      this.proc.on('error', (err) => {
        reject(err);
      });
    });
  }

  public async classify(text: string, schema: Record<string, any>): Promise<any> {
    if (!this.proc || !this.isReady) throw new Error('Jev Bridge not ready');
    return new Promise((resolve) => {
      this.resolveNext = resolve;
      this.proc!.stdin.write(JSON.stringify({ text, schema }) + '\n');
    });
  }

  public stop(): void {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
  }
}

async function runLiveJevTest() {
  console.log('🤖 INITIALIZING REAL JEV MODEL (fastino/gliner2.5-small-v1)...');
  const jev = new JevFastinoClient();
  const startLoad = performance.now();
  await jev.start();
  console.log(`✅ Jev (GLiNER 2.5 Small, 74M params) loaded in ${((performance.now() - startLoad) / 1000).toFixed(1)}s!`);

  const engine = new GameEngine();
  engine.autoReplenishBots = false;
  engine.snakes = [];

  // Spawn 14 Baseline Deterministic Bots
  const baselineCount = 14;
  for (let i = 0; i < baselineCount; i++) {
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

  // Spawn 1 Jev Champion Bot
  const jevSnake = engine.createSnake(
    'jev-champion',
    '⚡ [Jev Fastino-GLiNER 2.5]',
    false,
    SKINS[4], // Synthwave skin
    0,
    0,
    INITIAL_SNAKE_LENGTH
  );
  jevSnake.policyId = 'jev';
  engine.snakes.push(jevSnake);

  console.log('\n⚔️  STARTING MATCH: 1 Jev Bot vs. 14 Deterministic Bots for 600 ticks (~10 seconds in-game)...');

  let jevDecisionsCount = 0;
  let totalJevInferenceMs = 0;
  let currentTacticalIntent = 'scavenge_food';
  let currentTacticalBoost = false;

  const decisionHistory: Array<{ tick: number; intent: string; boost: boolean; score: number; latencyMs: number }> = [];

  for (let tick = 0; tick < 600; tick++) {
    // 1. If Jev bot is alive, run Jev tactical model every 18 ticks (~300ms)
    if (!jevSnake.isDead && tick % 18 === 0) {
      const obs = ObservationExtractor.extract(
        jevSnake,
        engine.snakes,
        (engine as any).bodyGrid,
        (engine as any).foodGrid
      );

      // Construct concise natural language state representation
      const enemyDesc = obs.opponents.length > 0
        ? `Nearest enemy at ${Math.round(obs.opponents[0].dist)}px, angle ${(obs.opponents[0].relAngle * 57.3).toFixed(0)}deg, mass delta ${Math.round(obs.opponents[0].massDelta)}.`
        : 'No opponents nearby.';
      const foodDesc = obs.food.length > 0
        ? `Food cluster at ${Math.round(obs.food[0].dist)}px.`
        : 'No food nearby.';
      const boundaryDesc = `Distance to wall: ${Math.round(obs.distToBoundary)}px.`;

      const text = `Slither snake state: ${boundaryDesc} ${enemyDesc} ${foodDesc}`;
      const schema = {
        tactical_intent: [
          'attack_and_intercept',
          'scavenge_food',
          'flee_to_center',
          'cautious_cruise',
        ],
        boost_action: ['boost_sprint', 'conserve_energy'],
      };

      const resp = await jev.classify(text, schema);
      const res = resp.result || {};
      const latency = resp.dt_ms || 0;

      currentTacticalIntent = res.tactical_intent || 'scavenge_food';
      currentTacticalBoost = res.boost_action === 'boost_sprint';

      jevDecisionsCount++;
      totalJevInferenceMs += latency;

      decisionHistory.push({
        tick,
        intent: currentTacticalIntent,
        boost: currentTacticalBoost,
        score: Math.round(jevSnake.score),
        latencyMs: Math.round(latency),
      });
    }

    // 2. Custom bot update loop
    engine.customBotUpdate = (bot, allSnakes, bodyGrid, foodGrid) => {
      if (bot.id === 'jev-champion') {
        // Jev bot execution:
        // Strategic target determined by Jev's chosen tactical_intent
        if (currentTacticalIntent === 'attack_and_intercept') {
          // Hunter tracking
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
        } else if (currentTacticalIntent === 'flee_to_center') {
          bot.targetAngle = Math.atan2(-bot.head.y, -bot.head.x);
        } else {
          // Scavenge / Food
          BotAIController.updateBot(bot, allSnakes, bodyGrid, foodGrid);
        }

        bot.isBoosting = currentTacticalBoost && bot.score > 24;

        // Emergency low-level whisker reflex: never hit a body or wall!
        const lookAheadDist = bot.radius * 4.0;
        if (bodyGrid.hasObstacle(bot.head.x, bot.head.y, lookAheadDist + 30, bot.id)) {
          // Emergency reflex override
          bot.isBoosting = false;
        }
      } else {
        // All other bots run deterministic baseline
        BotAIController.updateBot(bot, allSnakes, bodyGrid, foodGrid);
      }
    };

    engine.update(16.67);

    if (jevSnake.isDead) {
      console.log(`💀 Jev died at tick ${tick} with score ${Math.round(jevSnake.score)}!`);
      break;
    }
  }

  jev.stop();

  console.log('\n' + '='.repeat(70));
  console.log('📊 REAL JEV MODEL INFERENCE LOG:');
  console.log('='.repeat(70));
  for (const log of decisionHistory.slice(0, 10)) {
    console.log(`  Tick ${log.tick.toString().padStart(4)} | Intent: ${log.intent.padEnd(20)} | Boost: ${log.boost ? 'YES' : 'NO '} | Score: ${log.score.toString().padEnd(4)} | Latency: ${log.latencyMs}ms`);
  }
  if (decisionHistory.length > 10) {
    console.log(`  ... (${decisionHistory.length - 10} more forward passes) ...`);
    const last = decisionHistory[decisionHistory.length - 1];
    console.log(`  Tick ${last.tick.toString().padStart(4)} | Intent: ${last.intent.padEnd(20)} | Boost: ${last.boost ? 'YES' : 'NO '} | Score: ${last.score.toString().padEnd(4)} | Latency: ${last.latencyMs}ms`);
  }

  const avgLatency = jevDecisionsCount > 0 ? (totalJevInferenceMs / jevDecisionsCount).toFixed(1) : '0';
  console.log('-'.repeat(70));
  console.log(`🎯 Jev Final Score: ${Math.round(jevSnake.score)}`);
  console.log(`🎯 Jev Alive Status: ${jevSnake.isDead ? 'ELIMINATED' : 'ALIVE'}`);
  console.log(`⚡ Jev Forward Passes: ${jevDecisionsCount}`);
  console.log(`⏱️  Average Single-Forward-Pass Latency: ${avgLatency}ms (on CPU)`);
  console.log('='.repeat(70));
}

runLiveJevTest().catch(console.error);
