import { Snake, Orb, Point } from '../../src/game/types';
import { SpatialGrid, GridItem } from '../../src/game/spatialGrid';

export interface BodySegmentItem extends GridItem {
  snakeId?: string;
  segmentIndex?: number;
  ownerSnake?: Snake;
}

export interface Action {
  targetAngle: number;
  isBoosting: boolean;
}

export interface Observation {
  // Self state
  headX: number;
  headY: number;
  angle: number;
  speed: number;
  score: number;
  radius: number;
  distToBoundary: number;
  angleToCenter: number;
  // Short-term memory: wrapped angle delta since last extract, normalized [-1..1]
  turnRate: number;

  // 11 whiskers clearance ratios [0..1]
  whiskerClearances: number[];

  // Nearest opponents (up to 3)
  opponents: Array<{
    dist: number;
    relAngle: number;
    massDelta: number;
    headingDiff: number;
  }>;

  // Nearest food orbs (up to 3)
  food: Array<{
    dist: number;
    relAngle: number;
    value: number;
  }>;

  // Nearest own-body segment (loop-closure awareness for emergent encirclement)
  ownBody: {
    dist: number;
    relAngle: number;
  };
}

export interface AgentPolicy {
  id: string;
  name: string;
  description: string;
  update(
    bot: Snake,
    allSnakes: Snake[],
    bodyGrid: SpatialGrid<BodySegmentItem>,
    foodGrid: SpatialGrid<Orb & GridItem>,
    dtScale?: number
  ): void;
}

export interface PolicyStats {
  policyId: string;
  name: string;
  totalSpawns: number;
  kills: number;
  deaths: number;
  wallDeaths: number;
  bodyDeaths: number;
  headToHeadKills: Record<string, number>; // policyId -> kills against that policy
  headToHeadDeaths: Record<string, number>; // policyId -> deaths caused by that policy
  totalTicksAlive: number;
  totalMassGained: number;
  peakScore: number;
  decisionCount: number;
  totalDecisionTimeMicrosec: number;
}
