import { Snake, Orb } from './types';
import { SpatialGrid, GridItem } from './spatialGrid';
import { ARENA_RADIUS, MIN_BOOST_MASS, BOOST_TURN_SPEED } from './constants';
import weightsData from './neuralWeights.json';

interface BodySegmentItem extends GridItem {
  snakeId?: string;
  segmentIndex?: number;
  ownerSnake?: Snake;
}

export interface NeuralArchetype {
  id: string;
  name: string;
  description: string;
  skinIndex: number;
  safetyMultiplier: number;
  boostAggression: number;
  w1: Float32Array[];
  b1: Float32Array;
  w2: Float32Array[];
  b2: Float32Array;
  w3: Float32Array[];
  b3: Float32Array;
}

const WHISKER_ANGLES = [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 1.9, -1.9, 2.4, -2.4];
const ARENA_BARRIER_DIST = ARENA_RADIUS - 60;
const ARENA_BARRIER_SQ = ARENA_BARRIER_DIST * ARENA_BARRIER_DIST;
const ARENA_DANGER_DIST = ARENA_RADIUS - 400;
const ARENA_DANGER_SQ = ARENA_DANGER_DIST * ARENA_DANGER_DIST;

export class NeuralBotController {
  private static archetypes: Map<string, NeuralArchetype> = new Map();
  private static archetypeList: NeuralArchetype[] = [];
  private static foodQueryBuffer: (Orb & GridItem)[] = [];
  private static tempVec = new Float32Array(40);
  private static tempH1 = new Float32Array(64);
  private static tempH2 = new Float32Array(32);
  private static isInitialized = false;
  private static lastAngleById: Map<string, { angle: number; timer: number }> = new Map();

  public static init(): void {
    if (this.isInitialized) return;

    for (const [id, raw] of Object.entries(weightsData)) {
      const w = raw.weights;

      // Backward compat: pre-encirclement weights are 32-wide; zero-pad the
      // 8 new perception dims (turn-rate, headings, own-body) so old nets
      // run unchanged until retrained.
      const padRow = (row: number[]): Float32Array => {
        if (row.length >= 40) return new Float32Array(row);
        const padded = new Float32Array(40);
        padded.set(row);
        return padded;
      };

      const w1 = w.w1.map(padRow);
      const b1 = new Float32Array(w.b1);
      const w2 = w.w2.map((row: number[]) => new Float32Array(row));
      const b2 = new Float32Array(w.b2);
      const w3 = w.w3.map((row: number[]) => new Float32Array(row));
      const b3 = new Float32Array(w.b3);

      const arch: NeuralArchetype = {
        id,
        name: raw.name,
        description: raw.description,
        skinIndex: raw.skinIndex,
        safetyMultiplier: raw.safetyMultiplier,
        boostAggression: raw.boostAggression,
        w1,
        b1,
        w2,
        b2,
        w3,
        b3,
      };

      this.archetypes.set(id, arch);
      this.archetypeList.push(arch);
    }

    this.isInitialized = true;
  }

  public static getRandomArchetype(): NeuralArchetype {
    this.init();
    const idx = Math.floor(Math.random() * this.archetypeList.length);
    return this.archetypeList[idx];
  }

  public static getArchetype(id: string): NeuralArchetype | undefined {
    this.init();
    return this.archetypes.get(id);
  }

  public static getAllArchetypes(): NeuralArchetype[] {
    this.init();
    return this.archetypeList;
  }

  /**
   * Evaluates the neural specialist policy for a bot in ~3 microseconds
   */
  public static updateBot(
    bot: Snake,
    allSnakes: Snake[],
    bodyGrid: SpatialGrid<BodySegmentItem>,
    foodGrid: SpatialGrid<Orb & GridItem>
  ): void {
    if (bot.isDead) return;

    this.init();

    // Assign archetype if not already assigned
    if (!bot.aiArchetype) {
      const arch = this.getRandomArchetype();
      bot.aiArchetype = arch.id;
    }

    const arch = this.archetypes.get(bot.aiArchetype) || this.archetypeList[0];
    const headX = bot.head.x;
    const headY = bot.head.y;
    const canBoost = bot.score > MIN_BOOST_MASS + 5;

    bot.aiTimer = (bot.aiTimer || 0) + 1;

    // Human-like decision latency: updates tactical neural path every 14 frames (~240ms)
    if (bot.aiTimer % 14 === 0 || !bot.aiTarget) {
      // 1. Extract 32 normalized features directly into reusable buffer
      this.extractFeatures(bot, allSnakes, bodyGrid, foodGrid, this.tempVec);

      // 2. Forward Pass: 32 -> 64 -> 32 -> 2
      // Layer 1
      for (let i = 0; i < 64; i++) {
        let sum = arch.b1[i];
        const wRow = arch.w1[i];
        for (let j = 0; j < 40; j++) {
          sum += this.tempVec[j] * wRow[j];
        }
        this.tempH1[i] = sum > 0 ? sum : 0;
      }

      // Layer 2
      for (let i = 0; i < 32; i++) {
        let sum = arch.b2[i];
        const wRow = arch.w2[i];
        for (let j = 0; j < 64; j++) {
          sum += this.tempH1[j] * wRow[j];
        }
        this.tempH2[i] = sum > 0 ? sum : 0;
      }

      // Output: [steerDelta, boostLogit]
      let steerOut = arch.b3[0];
      let boostOut = arch.b3[1];
      const wRow0 = arch.w3[0];
      const wRow1 = arch.w3[1];
      for (let j = 0; j < 32; j++) {
        steerOut += this.tempH2[j] * wRow0[j];
        boostOut += this.tempH2[j] * wRow1[j];
      }

      const steerDelta = Math.max(-1.0, Math.min(1.0, steerOut)) * Math.PI;
      bot.targetAngle = bot.angle + steerDelta;
      while (bot.targetAngle < -Math.PI) bot.targetAngle += Math.PI * 2;
      while (bot.targetAngle > Math.PI) bot.targetAngle -= Math.PI * 2;

      bot.isBoosting = canBoost && boostOut > (1.0 - arch.boostAggression);
    }

    // 3. Human-like reflex window (checks obstacles every 6 frames ~100ms)
    const distSq = headX * headX + headY * headY;
    if (distSq > ARENA_DANGER_SQ) {
      bot.targetAngle = Math.atan2(-headY, -headX);
      return;
    }

    const lookAhead = bot.radius * (bot.isBoosting ? 5.2 : 3.8) * arch.safetyMultiplier;
    if (bot.aiTimer % 6 === 0 && bodyGrid.hasObstacle(headX, headY, lookAhead + 30, bot.id)) {
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

  private static extractFeatures(
    bot: Snake,
    allSnakes: Snake[],
    bodyGrid: SpatialGrid<BodySegmentItem>,
    foodGrid: SpatialGrid<Orb & GridItem>,
    outVec: Float32Array
  ): void {
    const headX = bot.head.x;
    const headY = bot.head.y;
    const distFromCenter = Math.hypot(headX, headY);
    const distToBoundary = Math.max(0, ARENA_RADIUS - distFromCenter);
    const angleToCenter = Math.atan2(-headY, -headX);

    let idx = 0;

    // Self kinematics (6 features, incl. turn-rate memory for coil persistence).
    // turnRate = fraction of max turn authority used per frame, so it is
    // independent of the 14-frame tactical cadence.
    let turnRate = 0;
    const last = this.lastAngleById.get(bot.id);
    if (last !== undefined) {
      const curTimer = typeof bot.aiTimer === 'number' ? bot.aiTimer : last.timer + 1;
      const frames = Math.max(1, curTimer - last.timer);
      let d = bot.angle - last.angle;
      while (d < -Math.PI) d += Math.PI * 2;
      while (d > Math.PI) d -= Math.PI * 2;
      turnRate = Math.max(-1.0, Math.min(1.0, d / frames / BOOST_TURN_SPEED));
      this.lastAngleById.set(bot.id, { angle: bot.angle, timer: curTimer });
    } else {
      const curTimer = typeof bot.aiTimer === 'number' ? bot.aiTimer : 0;
      this.lastAngleById.set(bot.id, { angle: bot.angle, timer: curTimer });
    }
    if (this.lastAngleById.size > 500) this.lastAngleById.clear();
    if (bot.isDead) this.lastAngleById.delete(bot.id);

    outVec[idx++] = Math.cos(bot.angle);
    outVec[idx++] = Math.sin(bot.angle);
    outVec[idx++] = bot.speed / 7.2;
    outVec[idx++] = Math.min(1.0, bot.score / 1000);
    outVec[idx++] = bot.radius / 42;
    outVec[idx++] = turnRate;

    // Boundary (3 features)
    outVec[idx++] = Math.min(1.0, distToBoundary / ARENA_RADIUS);
    outVec[idx++] = Math.cos(angleToCenter);
    outVec[idx++] = Math.sin(angleToCenter);

    // 11 whiskers (11 features)
    const lookAheadDist = bot.radius * (bot.isBoosting ? 5.2 : 3.8);
    for (let a = 0; a < WHISKER_ANGLES.length; a++) {
      const rayAngle = bot.angle + WHISKER_ANGLES[a];
      const cosA = Math.cos(rayAngle);
      const sinA = Math.sin(rayAngle);
      let clearance = 1.0;

      for (let step = 1; step <= 3; step++) {
        const checkDist = (lookAheadDist * step) / 3;
        const rx = headX + cosA * checkDist;
        const ry = headY + sinA * checkDist;

        if (rx * rx + ry * ry >= ARENA_BARRIER_SQ || bodyGrid.hasObstacle(rx, ry, bot.radius * 1.3, bot.id)) {
          clearance = (step - 1) / 3;
          break;
        }
      }
      outVec[idx++] = clearance;
    }

    // Opponents (top 2, 12 features incl. heading for trap geometry)
    let opp1DistSq = 1200 * 1200;
    let opp1: Snake | null = null;
    let opp1Heading = 0;
    let opp2DistSq = 1200 * 1200;
    let opp2: Snake | null = null;
    let opp2Heading = 0;

    for (let i = 0; i < allSnakes.length; i++) {
      const s = allSnakes[i];
      if (s.id === bot.id || s.isDead) continue;
      const dx = s.head.x - headX;
      const dy = s.head.y - headY;
      const dSq = dx * dx + dy * dy;
      if (dSq < opp1DistSq) {
        opp2DistSq = opp1DistSq;
        opp2 = opp1;
        opp2Heading = opp1Heading;
        opp1DistSq = dSq;
        opp1 = s;
        opp1Heading = s.angle;
      } else if (dSq < opp2DistSq) {
        opp2DistSq = dSq;
        opp2 = s;
        opp2Heading = s.angle;
      }
    }

    if (opp1) {
      const dist = Math.sqrt(opp1DistSq);
      const absAngle = Math.atan2(opp1.head.y - headY, opp1.head.x - headX);
      const relAngle = absAngle - bot.angle;
      let hd = opp1Heading - bot.angle;
      while (hd < -Math.PI) hd += Math.PI * 2;
      while (hd > Math.PI) hd -= Math.PI * 2;
      outVec[idx++] = Math.min(1.0, dist / 1000);
      outVec[idx++] = Math.cos(relAngle);
      outVec[idx++] = Math.sin(relAngle);
      outVec[idx++] = Math.max(-1.0, Math.min(1.0, (bot.score - opp1.score) / 300));
      outVec[idx++] = Math.cos(hd);
      outVec[idx++] = Math.sin(hd);
    } else {
      outVec[idx++] = 1.0;
      outVec[idx++] = 0.0;
      outVec[idx++] = 0.0;
      outVec[idx++] = 0.0;
      outVec[idx++] = 1.0;
      outVec[idx++] = 0.0;
    }

    if (opp2) {
      const dist = Math.sqrt(opp2DistSq);
      const absAngle = Math.atan2(opp2.head.y - headY, opp2.head.x - headX);
      const relAngle = absAngle - bot.angle;
      let hd = opp2Heading - bot.angle;
      while (hd < -Math.PI) hd += Math.PI * 2;
      while (hd > Math.PI) hd -= Math.PI * 2;
      outVec[idx++] = Math.min(1.0, dist / 1000);
      outVec[idx++] = Math.cos(relAngle);
      outVec[idx++] = Math.sin(relAngle);
      outVec[idx++] = Math.max(-1.0, Math.min(1.0, (bot.score - opp2.score) / 300));
      outVec[idx++] = Math.cos(hd);
      outVec[idx++] = Math.sin(hd);
    } else {
      outVec[idx++] = 1.0;
      outVec[idx++] = 0.0;
      outVec[idx++] = 0.0;
      outVec[idx++] = 0.0;
      outVec[idx++] = 1.0;
      outVec[idx++] = 0.0;
    }

    // Food (top 2, 5 features)
    this.foodQueryBuffer.length = 0;
    foodGrid.queryInto(headX, headY, 500, this.foodQueryBuffer);

    if (this.foodQueryBuffer.length > 0) {
      const f1 = this.foodQueryBuffer[0];
      const d1 = Math.hypot(f1.x - headX, f1.y - headY);
      const a1 = Math.atan2(f1.y - headY, f1.x - headX) - bot.angle;
      outVec[idx++] = Math.min(1.0, d1 / 500);
      outVec[idx++] = Math.cos(a1);
      outVec[idx++] = Math.sin(a1);

      if (this.foodQueryBuffer.length > 1) {
        const f2 = this.foodQueryBuffer[1];
        const d2 = Math.hypot(f2.x - headX, f2.y - headY);
        const a2 = Math.atan2(f2.y - headY, f2.x - headX) - bot.angle;
        outVec[idx++] = Math.min(1.0, d2 / 500);
        outVec[idx++] = Math.cos(a2);
      } else {
        outVec[idx++] = 1.0;
        outVec[idx++] = 0.0;
      }
    } else {
      outVec[idx++] = 1.0;
      outVec[idx++] = 0.0;
      outVec[idx++] = 0.0;
      outVec[idx++] = 1.0;
      outVec[idx++] = 0.0;
    }

    // Own-body loop closure (3 features)
    let ownDist = 2000;
    let ownRel = 0;
    const body = bot.body;
    if (body && body.length > 5) {
      let bestSq = Infinity;
      let bx = 0;
      let by = 0;
      for (let i = 4; i < body.length; i += 3) {
        const seg = body[i];
        const dx = seg.x - headX;
        const dy = seg.y - headY;
        const dSq = dx * dx + dy * dy;
        if (dSq < bestSq) {
          bestSq = dSq;
          bx = seg.x;
          by = seg.y;
        }
      }
      if (bestSq < Infinity) {
        ownDist = Math.sqrt(bestSq);
        ownRel = Math.atan2(by - headY, bx - headX) - bot.angle;
      }
    }
    outVec[idx++] = Math.min(1.0, ownDist / 2000);
    outVec[idx++] = Math.cos(ownRel);
    outVec[idx++] = Math.sin(ownRel);
  }
}
