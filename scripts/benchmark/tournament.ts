import { GameEngine } from '../../src/game/engine';
import { Snake } from '../../src/game/types';
import {
  ARENA_RADIUS,
  INITIAL_SNAKE_LENGTH,
  SKINS,
  BOT_NAMES,
} from '../../src/game/constants';
import { AgentPolicy, PolicyStats, BodySegmentItem } from './types';
import { SpatialGrid, GridItem } from '../../src/game/spatialGrid';
import { Orb } from '../../src/game/types';

export interface MatchResult {
  policyA: AgentPolicy;
  policyB: AgentPolicy;
  ticks: number;
  rounds: number;
  statsA: PolicyStats;
  statsB: PolicyStats;
  headToHeadKillsA: number; // A killed B
  headToHeadKillsB: number; // B killed A
  leaderboardOccupancyA: number; // % of top 5 slots held by A
  leaderboardOccupancyB: number; // % of top 5 slots held by B
  elapsedWallClockMs: number;
  simulatedTicksPerSec: number;
}

export class HeadToHeadTournament {
  public static runMatch(
    policyA: AgentPolicy,
    policyB: AgentPolicy,
    options: {
      snakesPerTeam?: number;
      ticksPerRound?: number;
      rounds?: number;
    } = {}
  ): MatchResult {
    const snakesPerTeam = options.snakesPerTeam ?? 15;
    const ticksPerRound = options.ticksPerRound ?? 3000;
    const rounds = options.rounds ?? 3;

    const statsA: PolicyStats = {
      policyId: policyA.id,
      name: policyA.name,
      totalSpawns: 0,
      kills: 0,
      deaths: 0,
      wallDeaths: 0,
      bodyDeaths: 0,
      headToHeadKills: { [policyB.id]: 0 },
      headToHeadDeaths: { [policyB.id]: 0 },
      totalTicksAlive: 0,
      totalMassGained: 0,
      peakScore: 0,
      decisionCount: 0,
      totalDecisionTimeMicrosec: 0,
    };

    const statsB: PolicyStats = {
      policyId: policyB.id,
      name: policyB.name,
      totalSpawns: 0,
      kills: 0,
      deaths: 0,
      wallDeaths: 0,
      bodyDeaths: 0,
      headToHeadKills: { [policyA.id]: 0 },
      headToHeadDeaths: { [policyA.id]: 0 },
      totalTicksAlive: 0,
      totalMassGained: 0,
      peakScore: 0,
      decisionCount: 0,
      totalDecisionTimeMicrosec: 0,
    };

    let topSlotsCountA = 0;
    let topSlotsCountB = 0;
    let totalTopChecks = 0;

    const wallClockStart = performance.now();
    let totalTicksSimulated = 0;

    for (let round = 0; round < rounds; round++) {
      const engine = new GameEngine();
      engine.autoReplenishBots = false; // Tournament controller manages spawns
      engine.snakes = []; // Clear default snakes

      const snakeSpawnTick = new Map<string, number>();

      // Track kills and deaths
      engine.onSnakeKilled = (victim: Snake, killer: Snake | null, reason: string) => {
        const victimPolicy = victim.policyId === policyA.id ? statsA : statsB;
        victimPolicy.deaths++;
        if (reason === 'Arena Barrier') {
          victimPolicy.wallDeaths++;
        } else {
          victimPolicy.bodyDeaths++;
        }

        const spawnTime = snakeSpawnTick.get(victim.id) ?? 0;
        victimPolicy.totalTicksAlive += Math.max(1, currentTick - spawnTime);

        if (killer) {
          const killerPolicy = killer.policyId === policyA.id ? statsA : statsB;
          killerPolicy.kills++;
          if (killer.policyId !== victim.policyId) {
            killerPolicy.headToHeadKills[victim.policyId ?? 'unknown'] =
              (killerPolicy.headToHeadKills[victim.policyId ?? 'unknown'] || 0) + 1;
            victimPolicy.headToHeadDeaths[killer.policyId ?? 'unknown'] =
              (victimPolicy.headToHeadDeaths[killer.policyId ?? 'unknown'] || 0) + 1;
          }
        }
      };

      // Custom bot controller dispatching to specific policies
      engine.customBotUpdate = (
        bot: Snake,
        allSnakes: Snake[],
        bodyGrid: SpatialGrid<BodySegmentItem>,
        foodGrid: SpatialGrid<Orb & GridItem>
      ) => {
        const isTeamA = bot.policyId === policyA.id;
        const targetPolicy = isTeamA ? policyA : policyB;
        const targetStats = isTeamA ? statsA : statsB;

        const t0 = performance.now();
        targetPolicy.update(bot, allSnakes, bodyGrid, foodGrid);
        const t1 = performance.now();

        targetStats.decisionCount++;
        targetStats.totalDecisionTimeMicrosec += (t1 - t0) * 1000;

        if (bot.score > targetStats.peakScore) {
          targetStats.peakScore = bot.score;
        }
      };

      let botIndex = 0;
      const spawnBot = (policy: AgentPolicy, stats: PolicyStats, tick: number) => {
        const name = `${policy.id === policyA.id ? '[A]' : '[B]'} ${BOT_NAMES[botIndex % BOT_NAMES.length]}${botIndex}`;
        const skin = SKINS[botIndex % SKINS.length];
        botIndex++;

        const r = Math.sqrt(Math.random()) * (ARENA_RADIUS - 1500);
        const theta = Math.random() * Math.PI * 2;
        const bx = Math.cos(theta) * r;
        const by = Math.sin(theta) * r;

        const snake = engine.createSnake(
          `bot-${policy.id}-${round}-${botIndex}`,
          name,
          false,
          skin,
          bx,
          by,
          INITIAL_SNAKE_LENGTH
        );
        snake.policyId = policy.id;
        stats.totalSpawns++;
        snakeSpawnTick.set(snake.id, tick);
        engine.snakes.push(snake);
      };

      // Initial team spawning
      for (let i = 0; i < snakesPerTeam; i++) {
        spawnBot(policyA, statsA, 0);
        spawnBot(policyB, statsB, 0);
      }

      let currentTick = 0;
      for (currentTick = 0; currentTick < ticksPerRound; currentTick++) {
        engine.update(16.67);

        // Maintain team sizes
        let countA = 0;
        let countB = 0;
        for (let i = 0; i < engine.snakes.length; i++) {
          const s = engine.snakes[i];
          if (s.isDead) continue;
          if (s.policyId === policyA.id) countA++;
          else if (s.policyId === policyB.id) countB++;
        }

        // Purge dead snakes
        for (let i = engine.snakes.length - 1; i >= 0; i--) {
          if (engine.snakes[i].isDead) {
            engine.snakes.splice(i, 1);
          }
        }

        // Respawn to maintain exact balance
        while (countA < snakesPerTeam) {
          spawnBot(policyA, statsA, currentTick);
          countA++;
        }
        while (countB < snakesPerTeam) {
          spawnBot(policyB, statsB, currentTick);
          countB++;
        }

        // Sample leaderboard occupancy every 25 ticks
        if (currentTick % 25 === 0 && engine.leaderboard.length > 0) {
          const top5 = engine.leaderboard.slice(0, 5);
          totalTopChecks += top5.length;
          for (let i = 0; i < top5.length; i++) {
            const entry = top5[i];
            const matchingSnake = engine.snakes.find((s) => s.id === entry.id);
            if (matchingSnake?.policyId === policyA.id) {
              topSlotsCountA++;
            } else if (matchingSnake?.policyId === policyB.id) {
              topSlotsCountB++;
            }
          }
        }
      }

      totalTicksSimulated += ticksPerRound;
    }

    const elapsedWallClockMs = performance.now() - wallClockStart;
    const simulatedTicksPerSec = Math.round((totalTicksSimulated * 1000) / elapsedWallClockMs);

    return {
      policyA,
      policyB,
      ticks: totalTicksSimulated,
      rounds,
      statsA,
      statsB,
      headToHeadKillsA: statsA.headToHeadKills[policyB.id] || 0,
      headToHeadKillsB: statsB.headToHeadKills[policyA.id] || 0,
      leaderboardOccupancyA: totalTopChecks > 0 ? (topSlotsCountA / totalTopChecks) * 100 : 0,
      leaderboardOccupancyB: totalTopChecks > 0 ? (topSlotsCountB / totalTopChecks) * 100 : 0,
      elapsedWallClockMs,
      simulatedTicksPerSec,
    };
  }
}
