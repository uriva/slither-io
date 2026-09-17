import { GameEngine } from '../../src/game/engine';
import { NeuralBotController } from '../../src/game/neuralAI';
import { BotAIController } from '../../src/game/botAI';
import { HeadToHeadTournament } from './tournament';
import { DeterministicBaselinePolicy } from './policies';
import { AgentPolicy } from './types';

// Policy running the Top-10 Neural Ensemble
class NeuralEnsemblePolicy implements AgentPolicy {
  public id = 'neural-ensemble';
  public name = 'Top 10 Neural Ensemble';
  public description = 'Dispatches decisions across the 10 evolved neural specialist models';

  public update(bot: any, allSnakes: any, bodyGrid: any, foodGrid: any): void {
    NeuralBotController.updateBot(bot, allSnakes, bodyGrid, foodGrid);
  }
}

async function verify() {
  console.log('='.repeat(70));
  console.log('⚡ 1. LATENCY BENCHMARK (55 BOTS AT 60 FPS)');
  console.log('='.repeat(70));

  // Baseline Engine
  const baselineEngine = new GameEngine();
  baselineEngine.customBotUpdate = (b, all, bg, fg) => BotAIController.updateBot(b, all, bg, fg);
  // Warmup
  for (let i = 0; i < 100; i++) baselineEngine.update(16.67);

  const t0Base = performance.now();
  for (let i = 0; i < 1000; i++) baselineEngine.update(16.67);
  const baseTotalMs = performance.now() - t0Base;
  const basePerFrameMs = baseTotalMs / 1000;

  // Neural Engine
  const neuralEngine = new GameEngine();
  // Warmup
  for (let i = 0; i < 100; i++) neuralEngine.update(16.67);

  const t0Neural = performance.now();
  for (let i = 0; i < 1000; i++) neuralEngine.update(16.67);
  const neuralTotalMs = performance.now() - t0Neural;
  const neuralPerFrameMs = neuralTotalMs / 1000;

  console.log(`Baseline Frame Time (55 bots):  ${basePerFrameMs.toFixed(3)} ms / frame  (${Math.round(1000 / basePerFrameMs)} FPS equivalent)`);
  console.log(`Neural Frame Time (55 bots):    ${neuralPerFrameMs.toFixed(3)} ms / frame  (${Math.round(1000 / neuralPerFrameMs)} FPS equivalent)`);
  console.log(`Difference:                     +${((neuralPerFrameMs - basePerFrameMs) * 1000).toFixed(1)} microseconds per frame (0.${Math.round((neuralPerFrameMs - basePerFrameMs) * 1000)}ms)`);
  console.log(`60 FPS Frame Budget Used:       ${((neuralPerFrameMs / 16.67) * 100).toFixed(1)}% of 16.67ms budget`);

  console.log('\n' + '='.repeat(70));
  console.log('🥊 2. HEAD-TO-HEAD TOURNAMENT (10,000 TICKS)');
  console.log('='.repeat(70));

  const baselinePolicy = new DeterministicBaselinePolicy();
  const neuralPolicy = new NeuralEnsemblePolicy();

  const res = HeadToHeadTournament.runMatch(baselinePolicy, neuralPolicy, {
    snakesPerTeam: 15,
    ticksPerRound: 2000,
    rounds: 5,
  });

  const totalH2H = res.headToHeadKillsA + res.headToHeadKillsB;
  const winRateNeural = totalH2H > 0 ? ((res.headToHeadKillsB / totalH2H) * 100).toFixed(1) : '50.0';

  console.log(`Direct H2H Kills: Baseline ${res.headToHeadKillsA} vs. Neural Ensemble ${res.headToHeadKillsB}`);
  console.log(`Neural Direct Win Rate:     ${winRateNeural}%`);
  console.log(`Total Kills:                Baseline ${res.statsA.kills} vs. Neural Ensemble ${res.statsB.kills}`);
  console.log(`Total Deaths:               Baseline ${res.statsA.deaths} vs. Neural Ensemble ${res.statsB.deaths}`);
  console.log(`Kill/Death Ratio (K/D):     Baseline ${(res.statsA.kills / res.statsA.deaths).toFixed(2)} vs. Neural Ensemble ${(res.statsB.kills / res.statsB.deaths).toFixed(2)}`);
  console.log(`Peak Mass Achieved:         Baseline ${Math.round(res.statsA.peakScore)} vs. Neural Ensemble ${Math.round(res.statsB.peakScore)}`);
  console.log('='.repeat(70));
}

verify().catch(console.error);
