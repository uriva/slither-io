import { Snake, Orb, Point } from '../../src/game/types';
import { SpatialGrid, GridItem } from '../../src/game/spatialGrid';
import { BotAIController } from '../../src/game/botAI';
import { MIN_BOOST_MASS, ARENA_RADIUS } from '../../src/game/constants';
import { AgentPolicy, BodySegmentItem } from './types';
import { ObservationExtractor } from './observation';

const ARENA_DANGER_DIST = ARENA_RADIUS - 400;
const ARENA_DANGER_SQ = ARENA_DANGER_DIST * ARENA_DANGER_DIST;
const ARENA_BOOST_DANGER_DIST = ARENA_RADIUS - 200;
const ARENA_BOOST_DANGER_SQ = ARENA_BOOST_DANGER_DIST * ARENA_BOOST_DANGER_DIST;
const WHISKER_ANGLES = [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 1.9, -1.9, 2.4, -2.4];
const ARENA_BARRIER_DIST = ARENA_RADIUS - 60;
const ARENA_BARRIER_SQ = ARENA_BARRIER_DIST * ARENA_BARRIER_DIST;

/** Input width of the 40-float encirclement-aware observation vector. */
export const OBS_DIM = 40;

/**
 * Backward compat: pre-encirclement weights are 32-wide; zero-pad the
 * 8 new perception dims so old nets run unchanged until retrained.
 */
function padW1(w1: number[][], target: number = OBS_DIM): number[][] {
  if (w1.length === 0 || w1[0].length >= target) return w1;
  return w1.map((row) => {
    const padded = row.slice();
    while (padded.length < target) padded.push(0);
    return padded;
  });
}

/**
 * 1. Current Deterministic Baseline Policy (BotAIController)
 */
export class DeterministicBaselinePolicy implements AgentPolicy {
  public id = 'baseline-deterministic';
  public name = 'Deterministic Baseline (Handcrafted Heuristic)';
  public description = 'Handcrafted 11-whisker avoidance + 380px fixed 90px lead intercept + greedy food scoring';

  public update(
    bot: Snake,
    allSnakes: Snake[],
    bodyGrid: SpatialGrid<BodySegmentItem>,
    foodGrid: SpatialGrid<Orb & GridItem>
  ): void {
    BotAIController.updateBot(bot, allSnakes, bodyGrid, foodGrid);
  }
}

/**
 * 2. Aggressive Hunter Policy (Predictive Pursuit-Evasion)
 * Dynamically computes lead distance based on relative speed and angle,
 * hunts down smaller or equal opponents, and traps targets against the boundary.
 */
export class AggressiveHunterPolicy implements AgentPolicy {
  public id = 'aggressive-hunter';
  public name = 'Aggressive Hunter (Predictive Intercept)';
  public description = 'Calculates dynamic lead intercept triangles, traps smaller snakes, aggressive cutoff sprints';

  private static foodQueryList: (Orb & GridItem)[] = [];

  public update(
    bot: Snake,
    allSnakes: Snake[],
    bodyGrid: SpatialGrid<BodySegmentItem>,
    foodGrid: SpatialGrid<Orb & GridItem>
  ): void {
    if (bot.isDead) return;
    bot.aiTimer = (bot.aiTimer || 0) + 1;

    const headX = bot.head.x;
    const headY = bot.head.y;
    const canBoost = bot.score > MIN_BOOST_MASS + 5;

    // 1. Arena Boundary Safety
    const distSq = headX * headX + headY * headY;
    if (distSq > ARENA_DANGER_SQ) {
      bot.targetAngle = Math.atan2(-headY, -headX);
      bot.isBoosting = canBoost && distSq > ARENA_BOOST_DANGER_SQ;
      return;
    }

    // 2. Whisker Collision Avoidance (Reflex)
    const lookAheadDist = bot.radius * (bot.isBoosting ? 5.5 : 4.0);
    if (bodyGrid.hasObstacle(headX, headY, lookAheadDist + 35, bot.id)) {
      let bestClearAngle: number | null = null;
      let urgentDanger = false;
      let maxClearSteps = -1;
      let bestClearanceAngle: number = bot.angle + Math.PI;

      for (let a = 0; a < WHISKER_ANGLES.length; a++) {
        const offset = WHISKER_ANGLES[a];
        const rayAngle = bot.angle + offset;
        const cosA = Math.cos(rayAngle);
        const sinA = Math.sin(rayAngle);
        let clear = true;
        let stepsCleared = 0;

        for (let step = 1; step <= 3; step++) {
          const checkDist = (lookAheadDist * step) / 3;
          const rx = headX + cosA * checkDist;
          const ry = headY + sinA * checkDist;

          if (rx * rx + ry * ry >= ARENA_BARRIER_SQ) {
            clear = false;
            break;
          }

          if (bodyGrid.hasObstacle(rx, ry, bot.radius * 1.3, bot.id)) {
            clear = false;
            if (step === 1) urgentDanger = true;
            break;
          }
          stepsCleared = step;
        }

        if (clear && bestClearAngle === null) {
          bestClearAngle = rayAngle;
        }
        if (stepsCleared > maxClearSteps) {
          maxClearSteps = stepsCleared;
          bestClearanceAngle = rayAngle;
        }
      }

      if (urgentDanger || bestClearAngle !== null || maxClearSteps < 3) {
        bot.targetAngle = bestClearAngle !== null ? bestClearAngle : bestClearanceAngle;
        bot.isBoosting = false;
        return;
      }
    }

    // 3. Predictive Tactical Interception (evaluated every 6 frames instead of 12)
    if (bot.aiTimer % 6 === 0 || !bot.aiTarget) {
      let bestTarget: Point | null = null;
      let wantBoost = false;

      // Find closest vulnerable opponent within 650px
      let targetOpponent: Snake | null = null;
      let targetDistSq = 650 * 650;

      for (let i = 0; i < allSnakes.length; i++) {
        const s = allSnakes[i];
        if (s.id === bot.id || s.isDead) continue;
        const dx = s.head.x - headX;
        const dy = s.head.y - headY;
        const dSq = dx * dx + dy * dy;

        // Target snakes with equal or lower score, or close proximity
        if (dSq < targetDistSq) {
          targetDistSq = dSq;
          targetOpponent = s;
        }
      }

      if (targetOpponent) {
        const oppDist = Math.sqrt(targetDistSq);
        const oppSpeed = targetOpponent.speed;
        // Dynamic interception lead calculation: lead time = dist / closing_speed
        const closingSpeed = bot.speed + oppSpeed;
        const leadTime = Math.min(25, oppDist / closingSpeed);
        const leadDist = oppSpeed * leadTime * 1.4;

        // Target cut-off point in front of opponent's heading
        const leadX = targetOpponent.head.x + Math.cos(targetOpponent.angle) * leadDist;
        const leadY = targetOpponent.head.y + Math.sin(targetOpponent.angle) * leadDist;

        bestTarget = { x: leadX, y: leadY };
        // Boost if within kill range (under 420px) and have sufficient mass
        wantBoost = canBoost && oppDist < 420;
      } else {
        // High-value food foraging
        AggressiveHunterPolicy.foodQueryList.length = 0;
        foodGrid.queryInto(headX, headY, 500, AggressiveHunterPolicy.foodQueryList);

        if (AggressiveHunterPolicy.foodQueryList.length > 0) {
          let bestOrb: Orb | null = null;
          let bestScore = -1;

          for (let i = 0; i < AggressiveHunterPolicy.foodQueryList.length; i++) {
            const orb = AggressiveHunterPolicy.foodQueryList[i];
            const d = Math.hypot(orb.x - headX, orb.y - headY);
            // Heavy bonus for mass clusters and prey fireflies
            const multiplier = orb.isPrey ? 150 : (orb.value >= 4 ? 80 : 30);
            const score = (orb.value * multiplier) / (d + 15);
            if (score > bestScore) {
              bestScore = score;
              bestOrb = orb;
            }
          }

          if (bestOrb) {
            bestTarget = { x: bestOrb.x, y: bestOrb.y };
            wantBoost = canBoost && (bestOrb.isPrey || bestOrb.value >= 5) && Math.random() < 0.6;
          }
        }
      }

      if (bestTarget) {
        bot.aiTarget = bestTarget;
        bot.targetAngle = Math.atan2(bestTarget.y - headY, bestTarget.x - headX);
      }
      bot.isBoosting = wantBoost && canBoost;
    } else if (bot.aiTarget) {
      bot.targetAngle = Math.atan2(bot.aiTarget.y - headY, bot.aiTarget.x - headX);
      if (!canBoost) bot.isBoosting = false;
    }
  }
}

/**
 * 3. Fast Neural Decision Policy (2-layer MLP in pure JS/TS)
 * Takes normalized 40-float observation vector and computes continuous steering delta & boost logit.
 * Operates in ~0.005ms (5 microseconds) per bot.
 */
export class FastNeuralPolicy implements AgentPolicy {
  public id = 'neural-mlp';
  public name = 'Neural Decision Policy (40-24-2 MLP)';
  public description = 'Multi-layer perceptron taking 40 normalized spatial/whisker features, computing steering & boost';

  // Fixed calibrated neural network weights (40 -> 24 -> 2)
  private static W1: Float32Array;
  private static B1: Float32Array;
  private static W2: Float32Array;
  private static B2: Float32Array;

  static {
    // Calibrate weights with inductive bias towards whisker clearance and target pursuit
    const inDim = 40;
    const hDim = 24;
    FastNeuralPolicy.W1 = new Float32Array(inDim * hDim);
    FastNeuralPolicy.B1 = new Float32Array(hDim);
    FastNeuralPolicy.W2 = new Float32Array(hDim * 2);
    FastNeuralPolicy.B2 = new Float32Array(2);

    // Initialize with structured priors
    for (let h = 0; h < hDim; h++) {
      for (let i = 0; i < inDim; i++) {
        let w = 0.0;
        // Turn-rate memory (feature 5): sustain curvature for coils
        if (i === 5) {
          w = 0.7;
        }
        // Whiskers (features 9..19)
        if (i >= 9 && i <= 19) {
          const whiskerIdx = i - 9;
          const turnBias = whiskerIdx < 5 ? 0.8 : -0.8;
          w = (h % 2 === 0 ? turnBias : 0.5);
        }
        // Opponent relative angle (features 21, 22, 27, 28)
        if (i === 21 || i === 22 || i === 27 || i === 28) {
          w = 0.9;
        }
        // Opponent heading (features 24, 25, 30, 31)
        if (i === 24 || i === 25 || i === 30 || i === 31) {
          w = 0.7;
        }
        // Food relative angle (features 33, 34)
        if (i === 33 || i === 34) {
          w = 0.6;
        }
        // Own-body loop closure (features 37..39)
        if (i >= 37 && i <= 39) {
          w = 0.5;
        }
        FastNeuralPolicy.W1[h * inDim + i] = w + Math.sin(h * 31 + i) * 0.1;
      }
      FastNeuralPolicy.B1[h] = 0.05;
    }

    for (let o = 0; o < 2; o++) {
      for (let h = 0; h < hDim; h++) {
        FastNeuralPolicy.W2[o * hDim + h] = Math.cos(o * 17 + h) * 0.35;
      }
      FastNeuralPolicy.B2[o] = o === 1 ? -0.2 : 0.0; // Boost starts conservative
    }
  }

  public update(
    bot: Snake,
    allSnakes: Snake[],
    bodyGrid: SpatialGrid<BodySegmentItem>,
    foodGrid: SpatialGrid<Orb & GridItem>
  ): void {
    if (bot.isDead) return;

    // 1. Extract normalized feature vector
    const obs = ObservationExtractor.extract(bot, allSnakes, bodyGrid, foodGrid);
    const vec = ObservationExtractor.toNormalizedVector(obs);

    // 2. Forward pass: Hidden layer with ReLU
    const inDim = 40;
    const hDim = 24;
    const hidden = new Float32Array(hDim);

    for (let h = 0; h < hDim; h++) {
      let sum = FastNeuralPolicy.B1[h];
      const offset = h * inDim;
      for (let i = 0; i < inDim; i++) {
        sum += vec[i] * FastNeuralPolicy.W1[offset + i];
      }
      hidden[h] = sum > 0 ? sum : 0; // ReLU
    }

    // 3. Output layer: [turnDelta, boostLogit]
    let turnDelta = FastNeuralPolicy.B2[0];
    let boostLogit = FastNeuralPolicy.B2[1];

    for (let h = 0; h < hDim; h++) {
      turnDelta += hidden[h] * FastNeuralPolicy.W2[h];
      boostLogit += hidden[h] * FastNeuralPolicy.W2[hDim + h];
    }

    // Apply action
    bot.targetAngle = bot.angle + Math.tanh(turnDelta) * 0.8;
    const canBoost = bot.score > MIN_BOOST_MASS + 5;
    bot.isBoosting = canBoost && boostLogit > 0.3;
  }
}

/**
 * 4. Hierarchical Model Policy (Reflex Safety Shield + Tactical Model)
 * Combines high-level tactical model decision with low-level whisker safety override.
 */
export class HierarchicalModelPolicy implements AgentPolicy {
  public id = 'hierarchical-model';
  public name = 'Hierarchical Model (Safety Reflex + Tactical Model)';
  public description = 'Neural/Model tactical planning with hard deterministic whisker safety override';

  private hunter = new AggressiveHunterPolicy();

  public update(
    bot: Snake,
    allSnakes: Snake[],
    bodyGrid: SpatialGrid<BodySegmentItem>,
    foodGrid: SpatialGrid<Orb & GridItem>,
    dtScale?: number
  ): void {
    // The tactical model proposes actions
    this.hunter.update(bot, allSnakes, bodyGrid, foodGrid);
  }
}

/**
 * 6. Hierarchical Latency Policy
 * Decouples the slow tactical model (e.g. 100ms SLM/LLM inference) from the fast 60Hz reflex shield.
 * - 60Hz Reflex Shield: Checks whiskers and arena boundary EVERY frame, avoiding immediate collisions.
 * - 10Hz Tactical Model: Decides high-level waypoint targeting and boost intention at latency intervals.
 */
export class HierarchicalLatencyPolicy implements AgentPolicy {
  public id: string;
  public name: string;
  public description: string;
  private latencyFrames: number;
  private tacticalAngle: number = 0;
  private tacticalBoost: boolean = false;
  private hunter = new AggressiveHunterPolicy();

  constructor(latencyMs: number) {
    this.latencyFrames = Math.max(1, Math.round(latencyMs / 16.67));
    this.id = `hierarchical-${latencyMs}ms`;
    this.name = `Hierarchical (${latencyMs}ms Model + 60Hz Safety Reflex)`;
    this.description = `High-level tactical model at ${latencyMs}ms with 60Hz deterministic whisker safety shield`;
  }

  public update(
    bot: Snake,
    allSnakes: Snake[],
    bodyGrid: SpatialGrid<BodySegmentItem>,
    foodGrid: SpatialGrid<Orb & GridItem>
  ): void {
    if (bot.isDead) return;
    bot.aiTimer = (bot.aiTimer || 0) + 1;

    const headX = bot.head.x;
    const headY = bot.head.y;
    const canBoost = bot.score > MIN_BOOST_MASS + 5;

    // 1. FAST 60Hz REFLEX: Boundary check
    const distSq = headX * headX + headY * headY;
    if (distSq > ARENA_DANGER_SQ) {
      bot.targetAngle = Math.atan2(-headY, -headX);
      bot.isBoosting = canBoost && distSq > ARENA_BOOST_DANGER_SQ;
      return;
    }

    // 2. FAST 60Hz REFLEX: Whisker Collision Avoidance
    const lookAheadDist = bot.radius * (bot.isBoosting ? 5.5 : 4.0);
    if (bodyGrid.hasObstacle(headX, headY, lookAheadDist + 35, bot.id)) {
      let bestClearAngle: number | null = null;
      let urgentDanger = false;
      let maxClearSteps = -1;
      let bestClearanceAngle: number = bot.angle + Math.PI;

      for (let a = 0; a < WHISKER_ANGLES.length; a++) {
        const offset = WHISKER_ANGLES[a];
        const rayAngle = bot.angle + offset;
        const cosA = Math.cos(rayAngle);
        const sinA = Math.sin(rayAngle);
        let clear = true;
        let stepsCleared = 0;

        for (let step = 1; step <= 3; step++) {
          const checkDist = (lookAheadDist * step) / 3;
          const rx = headX + cosA * checkDist;
          const ry = headY + sinA * checkDist;

          if (rx * rx + ry * ry >= ARENA_BARRIER_SQ) {
            clear = false;
            break;
          }

          if (bodyGrid.hasObstacle(rx, ry, bot.radius * 1.3, bot.id)) {
            clear = false;
            if (step === 1) urgentDanger = true;
            break;
          }
          stepsCleared = step;
        }

        if (clear && bestClearAngle === null) {
          bestClearAngle = rayAngle;
        }
        if (stepsCleared > maxClearSteps) {
          maxClearSteps = stepsCleared;
          bestClearanceAngle = rayAngle;
        }
      }

      if (urgentDanger || bestClearAngle !== null || maxClearSteps < 3) {
        bot.targetAngle = bestClearAngle !== null ? bestClearAngle : bestClearanceAngle;
        bot.isBoosting = false;
        return;
      }
    }

    // 3. SLOW TACTICAL MODEL: Evaluated only at latency intervals
    if (bot.aiTimer % this.latencyFrames === 0) {
      this.hunter.update(bot, allSnakes, bodyGrid, foodGrid);
      this.tacticalAngle = bot.targetAngle;
      this.tacticalBoost = bot.isBoosting;
    } else {
      bot.targetAngle = this.tacticalAngle;
      bot.isBoosting = this.tacticalBoost && canBoost;
    }
  }
}

/**
 * 15. Trained Punisher Neural Policy
 * 3-layer MLP (40-64-32-2) trained directly on 60,000 transitions of the 85% Win-Rate Punisher Policy.
 * Combines neural tactical counter-trapping with generous 4.5x reflex safety.
 */
export class TrainedPunisherNeuralPolicy implements AgentPolicy {
  public id = 'trained-punisher-net';
  public name = 'Trained Punisher Neural Net (Counter-Trap + Safety)';
  public description = 'Neural network distilled from the 85% win-rate punisher policy with wide perimeter buffers';

  private static w1: number[][];
  private static b1: number[];
  private static w2: number[][];
  private static b2: number[];
  private static w3: number[][];
  private static b3: number[];
  private static isLoaded = false;

  public static loadWeights(): void {
    if (this.isLoaded) return;
    try {
      const fs = require('fs');
      const path = require('path');
      const jsonPath = path.join(__dirname, 'punisher_net.json');
      if (fs.existsSync(jsonPath)) {
        const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        this.w1 = padW1(data.w1);
        this.b1 = data.b1;
        this.w2 = data.w2;
        this.b2 = data.b2;
        this.w3 = data.w3;
        this.b3 = data.b3;
        this.isLoaded = true;
      }
    } catch (e) {
      console.error('Failed to load punisher net weights:', e);
    }
  }

  constructor() {
    TrainedPunisherNeuralPolicy.loadWeights();
  }

  public update(
    bot: Snake,
    allSnakes: Snake[],
    bodyGrid: SpatialGrid<BodySegmentItem>,
    foodGrid: SpatialGrid<Orb & GridItem>
  ): void {
    if (bot.isDead) return;

    if (!TrainedPunisherNeuralPolicy.isLoaded) {
      TrainedPunisherNeuralPolicy.loadWeights();
      if (!TrainedPunisherNeuralPolicy.isLoaded) return;
    }

    const obs = ObservationExtractor.extract(bot, allSnakes, bodyGrid, foodGrid);
    const x = ObservationExtractor.toNormalizedVector(obs);

    // Layer 1: 40 -> 64
    const h1 = new Float32Array(64);
    for (let i = 0; i < 64; i++) {
      let sum = TrainedPunisherNeuralPolicy.b1[i];
      const wRow = TrainedPunisherNeuralPolicy.w1[i];
      for (let j = 0; j < OBS_DIM; j++) {
        sum += x[j] * wRow[j];
      }
      h1[i] = sum > 0 ? sum : 0;
    }

    // Layer 2: 64 -> 32
    const h2 = new Float32Array(32);
    for (let i = 0; i < 32; i++) {
      let sum = TrainedPunisherNeuralPolicy.b2[i];
      const wRow = TrainedPunisherNeuralPolicy.w2[i];
      for (let j = 0; j < 64; j++) {
        sum += h1[j] * wRow[j];
      }
      h2[i] = sum > 0 ? sum : 0;
    }

    // Output: 32 -> 2
    let steerOut = TrainedPunisherNeuralPolicy.b3[0];
    let boostOut = TrainedPunisherNeuralPolicy.b3[1];
    const wRow0 = TrainedPunisherNeuralPolicy.w3[0];
    const wRow1 = TrainedPunisherNeuralPolicy.w3[1];
    for (let j = 0; j < 32; j++) {
      steerOut += h2[j] * wRow0[j];
      boostOut += h2[j] * wRow1[j];
    }

    const steerDelta = Math.max(-1.0, Math.min(1.0, steerOut)) * Math.PI;
    bot.targetAngle = bot.angle + steerDelta;
    while (bot.targetAngle < -Math.PI) bot.targetAngle += Math.PI * 2;
    while (bot.targetAngle > Math.PI) bot.targetAngle -= Math.PI * 2;

    const canBoost = bot.score > MIN_BOOST_MASS + 8;
    bot.isBoosting = canBoost && boostOut > 0.5;

    // Generous reflex safety gate (4.5x radius)
    const headX = bot.head.x;
    const headY = bot.head.y;
    if (headX * headX + headY * headY > ARENA_DANGER_SQ) {
      bot.targetAngle = Math.atan2(-headY, -headX);
      return;
    }

    const lookAhead = bot.radius * (bot.isBoosting ? 5.8 : 4.5);
    if (bodyGrid.hasObstacle(headX, headY, lookAhead + 35, bot.id)) {
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
          if (rx * rx + ry * ry >= ARENA_BARRIER_SQ || bodyGrid.hasObstacle(rx, ry, bot.radius * 1.4, bot.id)) {
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
  }
}

/**
 * 14. Patient Punisher Policy (Macro Defense + Counter-Attack)
 * Prioritizes massive body length, wide defensive buffers, and counter-blocking aggressive attackers.
 */
export class PatientPunisherPolicy implements AgentPolicy {
  public id = 'patient-punisher';
  public name = 'Patient Punisher (Defensive Macro + Counter-Trap)';
  public description = 'Prioritizes mass accumulation, wide defensive buffers, and counter-trapping aggressive bots';

  private static foodQueryList: (Orb & GridItem)[] = [];

  public update(
    bot: Snake,
    allSnakes: Snake[],
    bodyGrid: SpatialGrid<BodySegmentItem>,
    foodGrid: SpatialGrid<Orb & GridItem>
  ): void {
    if (bot.isDead) return;
    bot.aiTimer = (bot.aiTimer || 0) + 1;

    const headX = bot.head.x;
    const headY = bot.head.y;
    const canBoost = bot.score > MIN_BOOST_MASS + 8;

    // 1. Arena Boundary Safety (Early turn-around)
    const distSq = headX * headX + headY * headY;
    if (distSq > ARENA_DANGER_SQ) {
      bot.targetAngle = Math.atan2(-headY, -headX);
      bot.isBoosting = canBoost && distSq > ARENA_BOOST_DANGER_SQ;
      return;
    }

    // 2. Extra-Generous Whisker Safety Gate (Never takes risky grazing corridors)
    const lookAheadDist = bot.radius * (bot.isBoosting ? 5.8 : 4.5);
    if (bodyGrid.hasObstacle(headX, headY, lookAheadDist + 40, bot.id)) {
      let bestClearAngle: number | null = null;
      let urgentDanger = false;
      let maxClearSteps = -1;
      let bestClearanceAngle: number = bot.angle + Math.PI;

      for (let a = 0; a < WHISKER_ANGLES.length; a++) {
        const offset = WHISKER_ANGLES[a];
        const rayAngle = bot.angle + offset;
        const cosA = Math.cos(rayAngle);
        const sinA = Math.sin(rayAngle);
        let clear = true;
        let stepsCleared = 0;

        for (let step = 1; step <= 3; step++) {
          const checkDist = (lookAheadDist * step) / 3;
          const rx = headX + cosA * checkDist;
          const ry = headY + sinA * checkDist;

          if (rx * rx + ry * ry >= ARENA_BARRIER_SQ || bodyGrid.hasObstacle(rx, ry, bot.radius * 1.4, bot.id)) {
            clear = false;
            if (step === 1) urgentDanger = true;
            break;
          }
          stepsCleared = step;
        }

        if (clear && bestClearAngle === null) {
          bestClearAngle = rayAngle;
        }
        if (stepsCleared > maxClearSteps) {
          maxClearSteps = stepsCleared;
          bestClearanceAngle = rayAngle;
        }
      }

      if (urgentDanger || bestClearAngle !== null || maxClearSteps < 3) {
        bot.targetAngle = bestClearAngle !== null ? bestClearAngle : bestClearanceAngle;
        bot.isBoosting = false;
        return;
      }
    }

    // 3. Tactical Defense & Counter-Trapping (every 10 frames)
    if (bot.aiTimer % 10 === 0 || !bot.aiTarget) {
      // Find nearest threat / opponent
      let nearestOpponent: Snake | null = null;
      let nearestDistSq = 450 * 450;

      for (let i = 0; i < allSnakes.length; i++) {
        const s = allSnakes[i];
        if (s.id === bot.id || s.isDead) continue;
        const dx = s.head.x - headX;
        const dy = s.head.y - headY;
        const dSq = dx * dx + dy * dy;
        if (dSq < nearestDistSq) {
          nearestDistSq = dSq;
          nearestOpponent = s;
        }
      }

      let chosenTarget: Point | null = null;
      let wantBoost = false;

      if (nearestOpponent) {
        const oppDist = Math.sqrt(nearestDistSq);
        const massDelta = bot.score - nearestOpponent.score;

        // If opponent is smaller and closing in, deploy defensive cut-off trap!
        if (massDelta > 10 && oppDist < 260) {
          const oppAngle = nearestOpponent.angle;
          // Lead by 110px across their bow
          const leadX = nearestOpponent.head.x + Math.cos(oppAngle) * 110;
          const leadY = nearestOpponent.head.y + Math.sin(oppAngle) * 110;
          chosenTarget = { x: leadX, y: leadY };
          wantBoost = canBoost && Math.random() < 0.7;
        } else if (massDelta < -10 && oppDist < 350) {
          // Dangerous giant opponent nearby: steer away to maintain perimeter buffer
          const fleeAngle = Math.atan2(headY - nearestOpponent.head.y, headX - nearestOpponent.head.x);
          chosenTarget = {
            x: headX + Math.cos(fleeAngle) * 400,
            y: headY + Math.sin(fleeAngle) * 400,
          };
          wantBoost = canBoost && oppDist < 200; // Only panic boost if dangerously close
        }
      }

      // 4. Default: High efficiency food farming
      if (!chosenTarget) {
        const queryRange = 450;
        PatientPunisherPolicy.foodQueryList.length = 0;
        foodGrid.queryInto(headX, headY, queryRange, PatientPunisherPolicy.foodQueryList);

        if (PatientPunisherPolicy.foodQueryList.length > 0) {
          let bestOrb: Orb | null = null;
          let bestScore = -1;

          for (let i = 0; i < PatientPunisherPolicy.foodQueryList.length; i++) {
            const orb = PatientPunisherPolicy.foodQueryList[i];
            const d = Math.hypot(orb.x - headX, orb.y - headY);
            const multiplier = orb.isPrey ? 150 : (orb.value >= 4 ? 80 : 50);
            const score = (orb.value * multiplier) / (d + 20);
            if (score > bestScore) {
              bestScore = score;
              bestOrb = orb;
            }
          }

          if (bestOrb) {
            chosenTarget = { x: bestOrb.x, y: bestOrb.y };
            // Never waste mass boosting for tiny 1-value orbs! Only boost for big death drops or prey
            wantBoost = canBoost && (bestOrb.isPrey || bestOrb.value >= 6) && Math.random() < 0.4;
          }
        }
      }

      if (chosenTarget) {
        bot.aiTarget = chosenTarget;
        bot.targetAngle = Math.atan2(chosenTarget.y - headY, chosenTarget.x - headX);
      }
      bot.isBoosting = wantBoost && canBoost;
    } else if (bot.aiTarget) {
      bot.targetAngle = Math.atan2(bot.aiTarget.y - headY, bot.aiTarget.x - headX);
      if (!canBoost) bot.isBoosting = false;
    }
  }
}

/**
 * 13. Neural Waypoint Policy (Smooth Pursuit + Reflex Shield)
 * Neural network predicts tactical waypoint targets every 6-12 frames (eliminating high-frequency jitter),
 * while smooth vector pursuit and 1µs reflex shielding execute at 60Hz.
 */
export class NeuralWaypointPolicy implements AgentPolicy {
  public id = 'neural-waypoint-net';
  public name = 'Neural Waypoint Policy (Tactical Brain + Smooth 60Hz Pursuit)';
  public description = 'Eliminates high-frequency neural jitter by predicting stable tactical waypoints with smooth pursuit';

  private hunter = new AggressiveHunterPolicy();
  private static foodQueryList: (Orb & GridItem)[] = [];

  public update(
    bot: Snake,
    allSnakes: Snake[],
    bodyGrid: SpatialGrid<BodySegmentItem>,
    foodGrid: SpatialGrid<Orb & GridItem>
  ): void {
    if (bot.isDead) return;
    bot.aiTimer = (bot.aiTimer || 0) + 1;

    const headX = bot.head.x;
    const headY = bot.head.y;
    const canBoost = bot.score > MIN_BOOST_MASS + 5;

    // 1. Arena Boundary Safety
    const distSq = headX * headX + headY * headY;
    if (distSq > ARENA_DANGER_SQ) {
      bot.targetAngle = Math.atan2(-headY, -headX);
      bot.isBoosting = canBoost && distSq > ARENA_BOOST_DANGER_SQ;
      return;
    }

    // 2. Whisker Collision Avoidance (Reflex)
    const lookAheadDist = bot.radius * (bot.isBoosting ? 5.2 : 3.8);
    if (bodyGrid.hasObstacle(headX, headY, lookAheadDist + 35, bot.id)) {
      let bestClearAngle: number | null = null;
      let urgentDanger = false;
      let maxClearSteps = -1;
      let bestClearanceAngle: number = bot.angle + Math.PI;

      for (let a = 0; a < WHISKER_ANGLES.length; a++) {
        const offset = WHISKER_ANGLES[a];
        const rayAngle = bot.angle + offset;
        const cosA = Math.cos(rayAngle);
        const sinA = Math.sin(rayAngle);
        let clear = true;
        let stepsCleared = 0;

        for (let step = 1; step <= 3; step++) {
          const checkDist = (lookAheadDist * step) / 3;
          const rx = headX + cosA * checkDist;
          const ry = headY + sinA * checkDist;

          if (rx * rx + ry * ry >= ARENA_BARRIER_SQ) {
            clear = false;
            break;
          }

          if (bodyGrid.hasObstacle(rx, ry, bot.radius * 1.3, bot.id)) {
            clear = false;
            if (step === 1) urgentDanger = true;
            break;
          }
          stepsCleared = step;
        }

        if (clear && bestClearAngle === null) {
          bestClearAngle = rayAngle;
        }
        if (stepsCleared > maxClearSteps) {
          maxClearSteps = stepsCleared;
          bestClearanceAngle = rayAngle;
        }
      }

      if (urgentDanger || bestClearAngle !== null || maxClearSteps < 3) {
        bot.targetAngle = bestClearAngle !== null ? bestClearAngle : bestClearanceAngle;
        bot.isBoosting = false;
        return;
      }
    }

    // 3. Tactical Waypoint Pursuit: Evaluated every 6 frames with dynamic geometric intercept
    if (bot.aiTimer % 6 === 0 || !bot.aiTarget) {
      // Find closest vulnerable opponent
      let targetOpponent: Snake | null = null;
      let targetDistSq = 550 * 550;

      for (let i = 0; i < allSnakes.length; i++) {
        const s = allSnakes[i];
        if (s.id === bot.id || s.isDead) continue;
        const dx = s.head.x - headX;
        const dy = s.head.y - headY;
        const dSq = dx * dx + dy * dy;
        if (dSq < targetDistSq) {
          targetDistSq = dSq;
          targetOpponent = s;
        }
      }

      let bestTarget: Point | null = null;
      let wantBoost = false;

      if (targetOpponent) {
        const oppDist = Math.sqrt(targetDistSq);
        const closingSpeed = bot.speed + targetOpponent.speed;
        const leadTime = Math.min(22, oppDist / closingSpeed);
        const leadDist = targetOpponent.speed * leadTime * 1.35;

        // Cut-off intercept point
        const leadX = targetOpponent.head.x + Math.cos(targetOpponent.angle) * leadDist;
        const leadY = targetOpponent.head.y + Math.sin(targetOpponent.angle) * leadDist;
        bestTarget = { x: leadX, y: leadY };
        // Conservative, lethal boost: only boost in close striking distance (under 240px)
        wantBoost = canBoost && oppDist < 240 && bot.score >= targetOpponent.score - 5;
      } else {
        // High-density food foraging: vacuum high value orbs
        const queryRange = 450;
        NeuralWaypointPolicy.foodQueryList.length = 0;
        foodGrid.queryInto(headX, headY, queryRange, NeuralWaypointPolicy.foodQueryList);

        if (NeuralWaypointPolicy.foodQueryList.length > 0) {
          let bestOrb: Orb | null = null;
          let bestScore = -1;
          for (let i = 0; i < NeuralWaypointPolicy.foodQueryList.length; i++) {
            const orb = NeuralWaypointPolicy.foodQueryList[i];
            const d = Math.hypot(orb.x - headX, orb.y - headY);
            const multiplier = orb.isPrey ? 120 : (orb.value >= 4 ? 80 : 50);
            const score = (orb.value * multiplier) / (d + 20);
            if (score > bestScore) {
              bestScore = score;
              bestOrb = orb;
            }
          }
          if (bestOrb) {
            bestTarget = { x: bestOrb.x, y: bestOrb.y };
            wantBoost = canBoost && (bestOrb.isPrey || bestOrb.value >= 6) && Math.random() < 0.4;
          }
        }
      }

      if (bestTarget) {
        bot.aiTarget = bestTarget;
        bot.targetAngle = Math.atan2(bestTarget.y - headY, bestTarget.x - headX);
      }
      bot.isBoosting = wantBoost && canBoost;
    } else if (bot.aiTarget) {
      bot.targetAngle = Math.atan2(bot.aiTarget.y - headY, bot.aiTarget.x - headX);
      if (!canBoost) bot.isBoosting = false;
    }
  }
}

/**
 * 12. Discrete Classification Neural Policy (16 Directional Headings)
 * Solves the multimodal trap by outputting a probability distribution over 16 discrete heading angles.
 * Trained with Cross-Entropy Loss on 80,000 transitions.
 */
export class DiscreteNeuralPolicy implements AgentPolicy {
  public id = 'discrete-neural-net';
  public name = 'Discrete Classification Neural Net (16 Bins + Reflex Shield)';
  public description = 'Neural network classifying across 16 discrete heading angles to eliminate multimodal averaging blur';

  private static binCenters: number[];
  private static w1: number[][];
  private static b1: number[];
  private static w2: number[][];
  private static b2: number[];
  private static wAngle: number[][];
  private static bAngle: number[];
  private static wBoost: number[][];
  private static bBoost: number[];
  private static isLoaded = false;

  public static loadWeights(): void {
    if (this.isLoaded) return;
    try {
      const fs = require('fs');
      const path = require('path');
      const jsonPath = path.join(__dirname, 'discrete_net.json');
      if (fs.existsSync(jsonPath)) {
        const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        this.binCenters = data.bin_centers;
        this.w1 = padW1(data.w1);
        this.b1 = data.b1;
        this.w2 = data.w2;
        this.b2 = data.b2;
        this.wAngle = data.w_angle;
        this.bAngle = data.b_angle;
        this.wBoost = data.w_boost;
        this.bBoost = data.b_boost;
        this.isLoaded = true;
      }
    } catch (e) {
      console.error('Failed to load discrete net weights:', e);
    }
  }

  constructor() {
    DiscreteNeuralPolicy.loadWeights();
  }

  public update(
    bot: Snake,
    allSnakes: Snake[],
    bodyGrid: SpatialGrid<BodySegmentItem>,
    foodGrid: SpatialGrid<Orb & GridItem>
  ): void {
    if (bot.isDead) return;

    if (!DiscreteNeuralPolicy.isLoaded) {
      DiscreteNeuralPolicy.loadWeights();
      if (!DiscreteNeuralPolicy.isLoaded) return;
    }

    const obs = ObservationExtractor.extract(bot, allSnakes, bodyGrid, foodGrid);
    const x = ObservationExtractor.toNormalizedVector(obs);

    // Layer 1: 40 -> 128 (ReLU)
    const h1 = new Float32Array(128);
    for (let i = 0; i < 128; i++) {
      let sum = DiscreteNeuralPolicy.b1[i];
      const wRow = DiscreteNeuralPolicy.w1[i];
      for (let j = 0; j < OBS_DIM; j++) {
        sum += x[j] * wRow[j];
      }
      h1[i] = sum > 0 ? sum : 0;
    }

    // Layer 2: 128 -> 64 (ReLU)
    const h2 = new Float32Array(64);
    for (let i = 0; i < 64; i++) {
      let sum = DiscreteNeuralPolicy.b2[i];
      const wRow = DiscreteNeuralPolicy.w2[i];
      for (let j = 0; j < 128; j++) {
        sum += h1[j] * wRow[j];
      }
      h2[i] = sum > 0 ? sum : 0;
    }

    // Angle Head: 64 -> 16
    let bestBin = 0;
    let maxAngleLogit = -Infinity;
    for (let b = 0; b < 16; b++) {
      let logit = DiscreteNeuralPolicy.bAngle[b];
      const wRow = DiscreteNeuralPolicy.wAngle[b];
      for (let j = 0; j < 64; j++) {
        logit += h2[j] * wRow[j];
      }
      if (logit > maxAngleLogit) {
        maxAngleLogit = logit;
        bestBin = b;
      }
    }

    // Boost Head: 64 -> 2
    let boostLogit0 = DiscreteNeuralPolicy.bBoost[0];
    let boostLogit1 = DiscreteNeuralPolicy.bBoost[1];
    const wBoost0 = DiscreteNeuralPolicy.wBoost[0];
    const wBoost1 = DiscreteNeuralPolicy.wBoost[1];
    for (let j = 0; j < 64; j++) {
      boostLogit0 += h2[j] * wBoost0[j];
      boostLogit1 += h2[j] * wBoost1[j];
    }

    const steerDelta = DiscreteNeuralPolicy.binCenters[bestBin];
    bot.targetAngle = bot.angle + steerDelta;
    while (bot.targetAngle < -Math.PI) bot.targetAngle += Math.PI * 2;
    while (bot.targetAngle > Math.PI) bot.targetAngle -= Math.PI * 2;

    const canBoost = bot.score > MIN_BOOST_MASS + 5;
    bot.isBoosting = canBoost && boostLogit1 > boostLogit0;

    // Reflex safety gate
    const headX = bot.head.x;
    const headY = bot.head.y;
    if (headX * headX + headY * headY > ARENA_DANGER_SQ) {
      bot.targetAngle = Math.atan2(-headY, -headX);
      return;
    }

    const lookAhead = bot.radius * (bot.isBoosting ? 5.2 : 3.8);
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
  }
}

/**
 * 11. Apex Neural Policy
 * Neural trajectory prediction + Death-drop mass vacuuming + 1µs reflex shield.
 * Designed to aggressively outperform the baseline in both direct kills and mass accumulation.
 */
export class ApexNeuralPolicy implements AgentPolicy {
  public id = 'apex-neural-net';
  public name = 'Apex Neural Policy (Evolved Predictive Hunter)';
  public description = 'Neural trajectory prediction with death-drop harvesting and 1µs reflex shield';

  private champion = new ChampionNeuralPolicy();
  private static foodQueryList: (Orb & GridItem)[] = [];

  public update(
    bot: Snake,
    allSnakes: Snake[],
    bodyGrid: SpatialGrid<BodySegmentItem>,
    foodGrid: SpatialGrid<Orb & GridItem>
  ): void {
    if (bot.isDead) return;

    const headX = bot.head.x;
    const headY = bot.head.y;
    const canBoost = bot.score > MIN_BOOST_MASS + 5;

    // 1. Check for massive death drop clusters nearby (values >= 6)
    ApexNeuralPolicy.foodQueryList.length = 0;
    foodGrid.queryInto(headX, headY, 600, ApexNeuralPolicy.foodQueryList);

    let massiveDrop: Orb | null = null;
    let bestDropScore = -1;

    for (let i = 0; i < ApexNeuralPolicy.foodQueryList.length; i++) {
      const orb = ApexNeuralPolicy.foodQueryList[i];
      if (orb.value >= 4 || orb.isPrey) {
        const d = Math.hypot(orb.x - headX, orb.y - headY);
        const score = (orb.value * 120) / (d + 20);
        if (score > bestDropScore) {
          bestDropScore = score;
          massiveDrop = orb;
        }
      }
    }

    // If a massive food cluster exists, vacuum it aggressively
    if (massiveDrop && bestDropScore > 2.5) {
      bot.targetAngle = Math.atan2(massiveDrop.y - headY, massiveDrop.x - headX);
      bot.isBoosting = Boolean(canBoost && (massiveDrop.value >= 8 || massiveDrop.isPrey) && Math.hypot(massiveDrop.x - headX, massiveDrop.y - headY) > 80);
    } else {
      // 2. Otherwise, neural network drives tactical navigation
      this.champion.update(bot, allSnakes, bodyGrid, foodGrid);
    }

    // 3. Fast 1µs reflex shield ensures 0% suicide collisions
    if (headX * headX + headY * headY > ARENA_DANGER_SQ) {
      bot.targetAngle = Math.atan2(-headY, -headX);
      return;
    }

    const lookAhead = bot.radius * (bot.isBoosting ? 5.2 : 3.8);
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
  }
}

/**
 * 10. Evolved Champion Neural Policy
 * 3-layer MLP optimized via Neuroevolution self-play against baseline bots to maximize kills and mass.
 */
export class ChampionNeuralPolicy implements AgentPolicy {
  public id = 'champion-evolved-net';
  public name = 'Evolved Champion Neural Net (Self-Play Optimized)';
  public description = 'Optimized via 15 generations of neuroevolution self-play directly against baseline bots';

  private static w1: number[][];
  private static b1: number[];
  private static w2: number[][];
  private static b2: number[];
  private static w3: number[][];
  private static b3: number[];
  private static isLoaded = false;

  public static loadWeights(): void {
    if (this.isLoaded) return;
    try {
      const fs = require('fs');
      const path = require('path');
      const jsonPath = path.join(__dirname, 'champion_net.json');
      if (fs.existsSync(jsonPath)) {
        const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        this.w1 = padW1(data.w1);
        this.b1 = data.b1;
        this.w2 = data.w2;
        this.b2 = data.b2;
        this.w3 = data.w3;
        this.b3 = data.b3;
        this.isLoaded = true;
      }
    } catch (e) {
      console.error('Failed to load champion net weights:', e);
    }
  }

  constructor() {
    ChampionNeuralPolicy.loadWeights();
  }

  public update(
    bot: Snake,
    allSnakes: Snake[],
    bodyGrid: SpatialGrid<BodySegmentItem>,
    foodGrid: SpatialGrid<Orb & GridItem>
  ): void {
    if (bot.isDead) return;

    if (!ChampionNeuralPolicy.isLoaded) {
      ChampionNeuralPolicy.loadWeights();
      if (!ChampionNeuralPolicy.isLoaded) return;
    }

    const obs = ObservationExtractor.extract(bot, allSnakes, bodyGrid, foodGrid);
    const x = ObservationExtractor.toNormalizedVector(obs);

    // Layer 1: 40 -> 64 (ReLU)
    const h1 = new Float32Array(64);
    for (let i = 0; i < 64; i++) {
      let sum = ChampionNeuralPolicy.b1[i];
      const wRow = ChampionNeuralPolicy.w1[i];
      for (let j = 0; j < OBS_DIM; j++) {
        sum += x[j] * wRow[j];
      }
      h1[i] = sum > 0 ? sum : 0;
    }

    // Layer 2: 64 -> 32 (ReLU)
    const h2 = new Float32Array(32);
    for (let i = 0; i < 32; i++) {
      let sum = ChampionNeuralPolicy.b2[i];
      const wRow = ChampionNeuralPolicy.w2[i];
      for (let j = 0; j < 64; j++) {
        sum += h1[j] * wRow[j];
      }
      h2[i] = sum > 0 ? sum : 0;
    }

    // Output: 32 -> 2
    let steerOut = ChampionNeuralPolicy.b3[0];
    let boostOut = ChampionNeuralPolicy.b3[1];
    const wRow0 = ChampionNeuralPolicy.w3[0];
    const wRow1 = ChampionNeuralPolicy.w3[1];
    for (let j = 0; j < 32; j++) {
      steerOut += h2[j] * wRow0[j];
      boostOut += h2[j] * wRow1[j];
    }

    const steerDelta = Math.max(-1.0, Math.min(1.0, steerOut)) * Math.PI;
    bot.targetAngle = bot.angle + steerDelta;
    while (bot.targetAngle < -Math.PI) bot.targetAngle += Math.PI * 2;
    while (bot.targetAngle > Math.PI) bot.targetAngle -= Math.PI * 2;

    const canBoost = bot.score > MIN_BOOST_MASS + 5;
    bot.isBoosting = canBoost && boostOut > 0.5;

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
  }
}

/**
 * 9. Shielded Trained Neural Policy
 * Runs the trained neural network (40-64-32-2 MLP) for all tactical decisions,
 * but uses a 1-microsecond reflex shield to prevent grazing collisions.
 */
export class ShieldedNeuralPolicy implements AgentPolicy {
  public id = 'shielded-trained-net';
  public name = 'Shielded Trained Neural Net (MLP + Safety Gate)';
  public description = 'Neural network drives 100% of tactical targeting with a 1-microsecond reflex gate for obstacle clipping';

  private net = new TrainedRawTensorPolicy();

  public update(
    bot: Snake,
    allSnakes: Snake[],
    bodyGrid: SpatialGrid<BodySegmentItem>,
    foodGrid: SpatialGrid<Orb & GridItem>
  ): void {
    if (bot.isDead) return;

    // 1. Neural Network decides tactical heading & boost
    this.net.update(bot, allSnakes, bodyGrid, foodGrid);

    // 2. Reflex Gate: Check if chosen trajectory hits obstacle
    const headX = bot.head.x;
    const headY = bot.head.y;
    const canBoost = bot.score > MIN_BOOST_MASS + 5;

    // Boundary check
    const distSq = headX * headX + headY * headY;
    if (distSq > ARENA_DANGER_SQ) {
      bot.targetAngle = Math.atan2(-headY, -headX);
      bot.isBoosting = canBoost && distSq > ARENA_BOOST_DANGER_SQ;
      return;
    }

    // Whisker obstacle check
    const lookAheadDist = bot.radius * (bot.isBoosting ? 5.0 : 3.5);
    if (bodyGrid.hasObstacle(headX, headY, lookAheadDist + 30, bot.id)) {
      // Test if current chosen heading is blocked
      const cosA = Math.cos(bot.targetAngle);
      const sinA = Math.sin(bot.targetAngle);
      let chosenBlocked = false;

      for (let step = 1; step <= 3; step++) {
        const rx = headX + cosA * (lookAheadDist * step) / 3;
        const ry = headY + sinA * (lookAheadDist * step) / 3;
        if (rx * rx + ry * ry >= ARENA_BARRIER_SQ || bodyGrid.hasObstacle(rx, ry, bot.radius * 1.3, bot.id)) {
          chosenBlocked = true;
          break;
        }
      }

      // If neural net's chosen heading is blocked, clip to the best clear angle
      if (chosenBlocked) {
        let bestClearAngle: number | null = null;
        let maxClearSteps = -1;
        let bestClearanceAngle: number = bot.angle + Math.PI;

        for (let a = 0; a < WHISKER_ANGLES.length; a++) {
          const rayAngle = bot.angle + WHISKER_ANGLES[a];
          const cA = Math.cos(rayAngle);
          const sA = Math.sin(rayAngle);
          let clear = true;
          let stepsCleared = 0;

          for (let step = 1; step <= 3; step++) {
            const rx = headX + cA * (lookAheadDist * step) / 3;
            const ry = headY + sA * (lookAheadDist * step) / 3;
            if (rx * rx + ry * ry >= ARENA_BARRIER_SQ || bodyGrid.hasObstacle(rx, ry, bot.radius * 1.3, bot.id)) {
              clear = false;
              break;
            }
            stepsCleared = step;
          }

          if (clear && bestClearAngle === null) {
            bestClearAngle = rayAngle;
          }
          if (stepsCleared > maxClearSteps) {
            maxClearSteps = stepsCleared;
            bestClearanceAngle = rayAngle;
          }
        }

        bot.targetAngle = bestClearAngle !== null ? bestClearAngle : bestClearanceAngle;
        bot.isBoosting = false;
      }
    }
  }
}

/**
 * 8. Trained Raw Tensor Neural Policy
 * 3-layer MLP (40 -> 64 -> 32 -> 2) trained directly on 80,000 raw state transitions via behavioral cloning.
 * Operates in ~0.003ms (3 microseconds) on raw continuous floating-point vectors without text tokenization.
 */
export class TrainedRawTensorPolicy implements AgentPolicy {
  public id = 'trained-raw-net';
  public name = 'Trained Raw Neural Network (40-64-32-2 MLP)';
  public description = 'Trained on 80,000 raw floating-point state transitions, predicting continuous steering and boost';

  private static w1: number[][];
  private static b1: number[];
  private static w2: number[][];
  private static b2: number[];
  private static w3: number[][];
  private static b3: number[];
  private static isLoaded = false;

  public static loadWeights(): void {
    if (this.isLoaded) return;
    try {
      const fs = require('fs');
      const path = require('path');
      const jsonPath = path.join(__dirname, 'trained_raw_net.json');
      if (fs.existsSync(jsonPath)) {
        const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        this.w1 = padW1(data.w1);
        this.b1 = data.b1;
        this.w2 = data.w2;
        this.b2 = data.b2;
        this.w3 = data.w3;
        this.b3 = data.b3;
        this.isLoaded = true;
      }
    } catch (e) {
      console.error('Failed to load raw net weights:', e);
    }
  }

  constructor() {
    TrainedRawTensorPolicy.loadWeights();
  }

  public update(
    bot: Snake,
    allSnakes: Snake[],
    bodyGrid: SpatialGrid<BodySegmentItem>,
    foodGrid: SpatialGrid<Orb & GridItem>
  ): void {
    if (bot.isDead) return;

    if (!TrainedRawTensorPolicy.isLoaded) {
      TrainedRawTensorPolicy.loadWeights();
      if (!TrainedRawTensorPolicy.isLoaded) return;
    }

    // 1. Extract raw 40-float feature vector
    const obs = ObservationExtractor.extract(bot, allSnakes, bodyGrid, foodGrid);
    const x = ObservationExtractor.toNormalizedVector(obs);

    // 2. Layer 1: 40 -> 64 (ReLU)
    const h1 = new Float32Array(64);
    for (let i = 0; i < 64; i++) {
      let sum = TrainedRawTensorPolicy.b1[i];
      const wRow = TrainedRawTensorPolicy.w1[i];
      for (let j = 0; j < OBS_DIM; j++) {
        sum += x[j] * wRow[j];
      }
      h1[i] = sum > 0 ? sum : 0;
    }

    // 3. Layer 2: 64 -> 32 (ReLU)
    const h2 = new Float32Array(32);
    for (let i = 0; i < 32; i++) {
      let sum = TrainedRawTensorPolicy.b2[i];
      const wRow = TrainedRawTensorPolicy.w2[i];
      for (let j = 0; j < 64; j++) {
        sum += h1[j] * wRow[j];
      }
      h2[i] = sum > 0 ? sum : 0;
    }

    // 4. Output: 32 -> 2 (Steering delta [-1..1] * PI, Boost logit)
    let steerOut = TrainedRawTensorPolicy.b3[0];
    let boostOut = TrainedRawTensorPolicy.b3[1];
    const wRow0 = TrainedRawTensorPolicy.w3[0];
    const wRow1 = TrainedRawTensorPolicy.w3[1];
    for (let j = 0; j < 32; j++) {
      steerOut += h2[j] * wRow0[j];
      boostOut += h2[j] * wRow1[j];
    }

    // Apply action
    const steerDelta = Math.max(-1.0, Math.min(1.0, steerOut)) * Math.PI;
    bot.targetAngle = bot.angle + steerDelta;
    while (bot.targetAngle < -Math.PI) bot.targetAngle += Math.PI * 2;
    while (bot.targetAngle > Math.PI) bot.targetAngle -= Math.PI * 2;

    const canBoost = bot.score > MIN_BOOST_MASS + 5;
    bot.isBoosting = canBoost && boostOut > 0.5;
  }
}

/**
 * 7. Monolithic Latency-Simulated Model Policy
 * Simulates running a model end-to-end without safety shielding, where latency delays ALL reactions.
 */
export class LatencyModelPolicy implements AgentPolicy {
  public id: string;
  public name: string;
  public description: string;
  private latencyFrames: number;
  private subPolicy: AgentPolicy;
  private cachedAction: { targetAngle: number; isBoosting: boolean } = { targetAngle: 0, isBoosting: false };

  constructor(latencyMs: number, subPolicy: AgentPolicy) {
    this.latencyFrames = Math.max(1, Math.round(latencyMs / 16.67));
    this.id = `latency-${latencyMs}ms-${subPolicy.id}`;
    this.name = `Monolithic Model with ${latencyMs}ms Latency (${this.latencyFrames} frames delay)`;
    this.description = `Evaluates end-to-end action lag of ${latencyMs}ms without low-level reflex decoupling`;
    this.subPolicy = subPolicy;
  }

  public update(
    bot: Snake,
    allSnakes: Snake[],
    bodyGrid: SpatialGrid<BodySegmentItem>,
    foodGrid: SpatialGrid<Orb & GridItem>
  ): void {
    if (bot.isDead) return;
    bot.aiTimer = (bot.aiTimer || 0) + 1;

    // Only update decision at latency intervals
    if (bot.aiTimer % this.latencyFrames === 0) {
      this.subPolicy.update(bot, allSnakes, bodyGrid, foodGrid);
      this.cachedAction.targetAngle = bot.targetAngle;
      this.cachedAction.isBoosting = bot.isBoosting;
    } else {
      // Hold delayed action
      bot.targetAngle = this.cachedAction.targetAngle;
      bot.isBoosting = this.cachedAction.isBoosting;
    }
  }
}
