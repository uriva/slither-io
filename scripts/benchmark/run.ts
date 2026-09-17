import { HeadToHeadTournament, MatchResult } from './tournament';
import {
  DeterministicBaselinePolicy,
  AggressiveHunterPolicy,
  FastNeuralPolicy,
  TrainedRawTensorPolicy,
  TrainedPunisherNeuralPolicy,
  PatientPunisherPolicy,
  HierarchicalLatencyPolicy,
  LatencyModelPolicy,
} from './policies';

function printMatchSummary(title: string, result: MatchResult) {
  const { statsA, statsB, headToHeadKillsA, headToHeadKillsB } = result;

  console.log('\n' + '='.repeat(78));
  console.log(`🏆 MATCH: ${title}`);
  console.log('='.repeat(78));
  console.log(`⏱️  Simulation: ${result.ticks} ticks across ${result.rounds} rounds in ${(result.elapsedWallClockMs / 1000).toFixed(2)}s (${result.simulatedTicksPerSec} ticks/sec)`);

  const avgLifespanA = statsA.deaths > 0 ? (statsA.totalTicksAlive / statsA.deaths).toFixed(0) : 'N/A';
  const avgLifespanB = statsB.deaths > 0 ? (statsB.totalTicksAlive / statsB.deaths).toFixed(0) : 'N/A';

  const avgLatencyA = statsA.decisionCount > 0 ? (statsA.totalDecisionTimeMicrosec / statsA.decisionCount).toFixed(2) : '0';
  const avgLatencyB = statsB.decisionCount > 0 ? (statsB.totalDecisionTimeMicrosec / statsB.decisionCount).toFixed(2) : '0';

  const kdA = statsA.deaths > 0 ? (statsA.kills / statsA.deaths).toFixed(2) : statsA.kills.toString();
  const kdB = statsB.deaths > 0 ? (statsB.kills / statsB.deaths).toFixed(2) : statsB.kills.toString();

  const totalH2H = headToHeadKillsA + headToHeadKillsB;
  const h2hWinRateA = totalH2H > 0 ? ((headToHeadKillsA / totalH2H) * 100).toFixed(1) : '50.0';
  const h2hWinRateB = totalH2H > 0 ? ((headToHeadKillsB / totalH2H) * 100).toFixed(1) : '50.0';

  console.log('\n📊 HEAD-TO-HEAD COMBAT METRICS:');
  console.log(`  Team A: [${result.policyA.id}] (${result.policyA.name})`);
  console.log(`  Team B: [${result.policyB.id}] (${result.policyB.name})`);
  console.log('-'.repeat(78));
  console.log(`  Metric                             | Team A (${result.policyA.id.slice(0, 10)}) | Team B (${result.policyB.id.slice(0, 10)})`);
  console.log('-'.repeat(78));
  console.log(`  Direct Head-to-Head Kills          | ${headToHeadKillsA.toString().padEnd(16)} | ${headToHeadKillsB.toString().padEnd(16)}`);
  console.log(`  Head-to-Head Win Rate              | ${(h2hWinRateA + '%').padEnd(16)} | ${(h2hWinRateB + '%').padEnd(16)}`);
  console.log(`  Total Kills (All causes)           | ${statsA.kills.toString().padEnd(16)} | ${statsB.kills.toString().padEnd(16)}`);
  console.log(`  Total Deaths                       | ${statsA.deaths.toString().padEnd(16)} | ${statsB.deaths.toString().padEnd(16)}`);
  console.log(`    - Snake Body Collisions          | ${statsA.bodyDeaths.toString().padEnd(16)} | ${statsB.bodyDeaths.toString().padEnd(16)}`);
  console.log(`    - Arena Boundary Deaths          | ${statsA.wallDeaths.toString().padEnd(16)} | ${statsB.wallDeaths.toString().padEnd(16)}`);
  console.log(`  Kill/Death Ratio (K/D)             | ${kdA.padEnd(16)} | ${kdB.padEnd(16)}`);
  console.log(`  Average Lifespan (ticks)           | ${avgLifespanA.padEnd(16)} | ${avgLifespanB.padEnd(16)}`);
  console.log(`  Peak Mass Achieved                 | ${Math.floor(statsA.peakScore).toString().padEnd(16)} | ${Math.floor(statsB.peakScore).toString().padEnd(16)}`);
  console.log(`  Top 5 Leaderboard Presence         | ${(result.leaderboardOccupancyA.toFixed(1) + '%').padEnd(16)} | ${(result.leaderboardOccupancyB.toFixed(1) + '%').padEnd(16)}`);
  console.log(`  Decision Compute Time (avg)        | ${(avgLatencyA + ' µs').padEnd(16)} | ${(avgLatencyB + ' µs').padEnd(16)}`);
  console.log('-'.repeat(78));

  const winner = headToHeadKillsB > headToHeadKillsA
    ? `🎉 CANDIDATE [${result.policyB.id}] OUTPERFORMS BASELINE by +${(Number(h2hWinRateB) - Number(h2hWinRateA)).toFixed(1)}% win rate!`
    : headToHeadKillsA > headToHeadKillsB
    ? `🛡️  BASELINE [${result.policyA.id}] DEFENDS DOMINANCE by +${(Number(h2hWinRateA) - Number(h2hWinRateB)).toFixed(1)}% win rate!`
    : '🤝 TIE MATCH';
  console.log(`👉 VERDICT: ${winner}\n`);
}

async function runAllBenchmarks() {
  console.log('🚀 INITIALIZING SLITHER.IO HEADLESS AI BENCHMARK SUITE');
  console.log('Testing whether learned / model policies outperform our deterministic baseline algorithm...\n');

  const baseline = new DeterministicBaselinePolicy();
  const punisherMacro = new PatientPunisherPolicy();
  const punisherNN = new TrainedPunisherNeuralPolicy();
  const hunter = new AggressiveHunterPolicy();
  const neuralMLP = new FastNeuralPolicy();
  const trainedRawNet = new TrainedRawTensorPolicy();
  const latency50ms = new LatencyModelPolicy(50, hunter);
  const latency150ms = new LatencyModelPolicy(150, hunter);
  const hierarchical100ms = new HierarchicalLatencyPolicy(100);

  // Match 0: Baseline vs Patient Punisher Policy (Macro Defense & Counter-Trap)
  console.log('▶ Running Match 0A: Baseline Deterministic vs. Patient Punisher Macro Strategy (2 rounds, 2000 ticks/round)...');
  const res0A = HeadToHeadTournament.runMatch(baseline, punisherMacro, {
    snakesPerTeam: 15,
    ticksPerRound: 2000,
    rounds: 2,
  });
  printMatchSummary('Baseline vs. Patient Punisher Macro Strategy', res0A);

  // Match 0B: Baseline vs Distilled Punisher Neural Network (32-64-32-2 MLP)
  console.log('▶ Running Match 0B: Baseline Deterministic vs. Distilled Punisher Neural Network (2 rounds, 2000 ticks/round)...');
  const res0B = HeadToHeadTournament.runMatch(baseline, punisherNN, {
    snakesPerTeam: 15,
    ticksPerRound: 2000,
    rounds: 2,
  });
  printMatchSummary('Baseline vs. Distilled Punisher Neural Network', res0B);
  console.log('▶ Running Match 1: Baseline Deterministic vs. Aggressive Predictive Hunter (2 rounds, 2000 ticks/round)...');
  const res1 = HeadToHeadTournament.runMatch(baseline, hunter, {
    snakesPerTeam: 15,
    ticksPerRound: 2000,
    rounds: 2,
  });
  printMatchSummary('Baseline vs. Aggressive Predictive Hunter', res1);

  // Match 2: Baseline vs Pure Fast Neural MLP Policy
  console.log('▶ Running Match 2: Baseline Deterministic vs. Pure Fast Neural MLP (2 rounds, 2000 ticks/round)...');
  const res2 = HeadToHeadTournament.runMatch(baseline, neuralMLP, {
    snakesPerTeam: 15,
    ticksPerRound: 2000,
    rounds: 2,
  });
  printMatchSummary('Baseline vs. Pure Fast Neural MLP Policy', res2);

  // Match 3: Baseline vs Monolithic Model with 50ms Latency
  console.log('▶ Running Match 3: Baseline Deterministic vs. Monolithic Model with 50ms Latency (2 rounds, 2000 ticks/round)...');
  const res3 = HeadToHeadTournament.runMatch(baseline, latency50ms, {
    snakesPerTeam: 15,
    ticksPerRound: 2000,
    rounds: 2,
  });
  printMatchSummary('Baseline vs. Monolithic Model with 50ms Decision Latency', res3);

  // Match 4: Baseline vs Monolithic Model with 150ms Latency
  console.log('▶ Running Match 4: Baseline Deterministic vs. Monolithic Model with 150ms Latency (2 rounds, 2000 ticks/round)...');
  const res4 = HeadToHeadTournament.runMatch(baseline, latency150ms, {
    snakesPerTeam: 15,
    ticksPerRound: 2000,
    rounds: 2,
  });
  printMatchSummary('Baseline vs. Monolithic Model with 150ms Decision Latency', res4);

  // Match 5: Baseline vs Hierarchical Model with 100ms Latency + 60Hz Reflex Shield
  console.log('▶ Running Match 5: Baseline Deterministic vs. Hierarchical Model (100ms Tactical + 60Hz Shield)...');
  const res5 = HeadToHeadTournament.runMatch(baseline, hierarchical100ms, {
    snakesPerTeam: 15,
    ticksPerRound: 2000,
    rounds: 2,
  });
  printMatchSummary('Baseline vs. Hierarchical Model (100ms Model + 60Hz Safety Shield)', res5);

  console.log('='.repeat(78));
  console.log('🎯 BENCHMARK COMPLETED SUCCESSFULLY');
  console.log('='.repeat(78));
}

runAllBenchmarks().catch(console.error);
