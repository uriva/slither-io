import { Snake, Orb } from '../../src/game/types';
import { SpatialGrid, GridItem } from '../../src/game/spatialGrid';
import { ARENA_RADIUS, MAX_RADIUS, BOOST_SPEED, BOOST_TURN_SPEED } from '../../src/game/constants';
import { Observation, BodySegmentItem } from './types';

const WHISKER_ANGLES = [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 1.9, -1.9, 2.4, -2.4];
const ARENA_BARRIER_DIST = ARENA_RADIUS - 60;
const ARENA_BARRIER_SQ = ARENA_BARRIER_DIST * ARENA_BARRIER_DIST;

export class ObservationExtractor {
  private static foodQueryBuffer: (Orb & GridItem)[] = [];
  private static lastAngleById: Map<string, { angle: number; timer: number }> = new Map();

  /** Clear per-snake turn memory. Call at the start of each training episode. */
  public static resetMemory(): void {
    ObservationExtractor.lastAngleById.clear();
  }

  /**
   * Extracts structured observation object
   */
  public static extract(
    bot: Snake,
    allSnakes: Snake[],
    bodyGrid: SpatialGrid<BodySegmentItem>,
    foodGrid: SpatialGrid<Orb & GridItem>
  ): Observation {
    const headX = bot.head.x;
    const headY = bot.head.y;
    const distFromCenter = Math.hypot(headX, headY);
    const distToBoundary = Math.max(0, ARENA_RADIUS - distFromCenter);
    const angleToCenter = Math.atan2(-headY, -headX);

    // 1. Compute 11-whisker clearances (0.0 = obstacle at head, 1.0 = completely clear)
    const lookAheadDist = bot.radius * (bot.isBoosting ? 5.2 : 3.8);
    const whiskerClearances = new Array<number>(WHISKER_ANGLES.length);

    for (let a = 0; a < WHISKER_ANGLES.length; a++) {
      const rayAngle = bot.angle + WHISKER_ANGLES[a];
      const cosA = Math.cos(rayAngle);
      const sinA = Math.sin(rayAngle);
      let clearance = 1.0;

      for (let step = 1; step <= 3; step++) {
        const checkDist = (lookAheadDist * step) / 3;
        const rx = headX + cosA * checkDist;
        const ry = headY + sinA * checkDist;

        if (rx * rx + ry * ry >= ARENA_BARRIER_SQ) {
          clearance = (step - 1) / 3;
          break;
        }

        if (bodyGrid.hasObstacle(rx, ry, bot.radius * 1.3, bot.id)) {
          clearance = (step - 1) / 3;
          break;
        }
      }
      whiskerClearances[a] = clearance;
    }

    // 2. Nearest opponents (up to 3)
    const opponents: Observation['opponents'] = [];
    const oppCandidates: Array<{ snake: Snake; distSq: number }> = [];

    for (let i = 0; i < allSnakes.length; i++) {
      const s = allSnakes[i];
      if (s.id === bot.id || s.isDead) continue;
      const dx = s.head.x - headX;
      const dy = s.head.y - headY;
      const distSq = dx * dx + dy * dy;
      if (distSq < 1200 * 1200) {
        oppCandidates.push({ snake: s, distSq });
      }
    }

    oppCandidates.sort((a, b) => a.distSq - b.distSq);
    const maxOpp = Math.min(3, oppCandidates.length);
    for (let i = 0; i < maxOpp; i++) {
      const opp = oppCandidates[i].snake;
      const dist = Math.sqrt(oppCandidates[i].distSq);
      const absAngle = Math.atan2(opp.head.y - headY, opp.head.x - headX);
      let relAngle = absAngle - bot.angle;
      while (relAngle < -Math.PI) relAngle += Math.PI * 2;
      while (relAngle > Math.PI) relAngle -= Math.PI * 2;

      let headingDiff = opp.angle - bot.angle;
      while (headingDiff < -Math.PI) headingDiff += Math.PI * 2;
      while (headingDiff > Math.PI) headingDiff -= Math.PI * 2;

      opponents.push({
        dist,
        relAngle,
        massDelta: bot.score - opp.score,
        headingDiff,
      });
    }

    // 3. Nearest food (up to 3)
    const food: Observation['food'] = [];
    ObservationExtractor.foodQueryBuffer.length = 0;
    foodGrid.queryInto(headX, headY, 500, ObservationExtractor.foodQueryBuffer);

    if (ObservationExtractor.foodQueryBuffer.length > 0) {
      ObservationExtractor.foodQueryBuffer.sort((a, b) => {
        const da = (a.x - headX) * (a.x - headX) + (a.y - headY) * (a.y - headY);
        const db = (b.x - headX) * (b.x - headX) + (b.y - headY) * (b.y - headY);
        return da - db;
      });
      const maxFood = Math.min(3, ObservationExtractor.foodQueryBuffer.length);
      for (let i = 0; i < maxFood; i++) {
        const f = ObservationExtractor.foodQueryBuffer[i];
        const dist = Math.hypot(f.x - headX, f.y - headY);
        const absAngle = Math.atan2(f.y - headY, f.x - headX);
        let relAngle = absAngle - bot.angle;
        while (relAngle < -Math.PI) relAngle += Math.PI * 2;
        while (relAngle > Math.PI) relAngle -= Math.PI * 2;

        food.push({
          dist,
          relAngle,
          value: f.value,
        });
      }
    }

    // 4. Short-term turn memory: fraction of max turn authority used per frame.
    // Normalized by frames elapsed (via aiTimer) so gate=1 and gate=14 training
    // see the same scale — a cadence-invariant curvature signal for coils.
    // Falls back to frames=1 when the caller doesn't tick aiTimer per frame.
    const last = ObservationExtractor.lastAngleById.get(bot.id);
    let turnRate = 0;
    if (last !== undefined) {
      const curTimer = typeof bot.aiTimer === 'number' ? bot.aiTimer : last.timer + 1;
      const frames = Math.max(1, curTimer - last.timer);
      let d = bot.angle - last.angle;
      while (d < -Math.PI) d += Math.PI * 2;
      while (d > Math.PI) d -= Math.PI * 2;
      turnRate = Math.max(-1.0, Math.min(1.0, d / frames / BOOST_TURN_SPEED));
      ObservationExtractor.lastAngleById.set(bot.id, { angle: bot.angle, timer: curTimer });
    } else {
      const curTimer = typeof bot.aiTimer === 'number' ? bot.aiTimer : 0;
      ObservationExtractor.lastAngleById.set(bot.id, { angle: bot.angle, timer: curTimer });
    }
    if (ObservationExtractor.lastAngleById.size > 500) ObservationExtractor.lastAngleById.clear();
    if (bot.isDead) ObservationExtractor.lastAngleById.delete(bot.id);

    // 5. Nearest own-body segment (loop-closure awareness).
    // Whiskers exclude own id, so without this the net can never perceive
    // an encirclement loop forming — a prerequisite for emergent circling.
    let ownDist = 2000;
    let ownRelAngle = 0;
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
        const absA = Math.atan2(by - headY, bx - headX);
        let rel = absA - bot.angle;
        while (rel < -Math.PI) rel += Math.PI * 2;
        while (rel > Math.PI) rel -= Math.PI * 2;
        ownRelAngle = rel;
      }
    }
    const ownBody = { dist: ownDist, relAngle: ownRelAngle };

    return {
      headX,
      headY,
      angle: bot.angle,
      speed: bot.speed,
      score: bot.score,
      radius: bot.radius,
      distToBoundary,
      angleToCenter,
      turnRate,
      whiskerClearances,
      opponents,
      food,
      ownBody,
    };
  }

  /**
   * Vectorizes the observation into a normalized 40-float array for direct neural net inference
   */
  public static toNormalizedVector(obs: Observation): Float32Array {
    const vec = new Float32Array(40);
    let idx = 0;

    // Self kinematics (6 features, incl. turn-rate memory)
    vec[idx++] = Math.cos(obs.angle);
    vec[idx++] = Math.sin(obs.angle);
    vec[idx++] = obs.speed / BOOST_SPEED;
    vec[idx++] = Math.min(1.0, obs.score / 1000);
    vec[idx++] = obs.radius / MAX_RADIUS;
    vec[idx++] = Math.max(-1.0, Math.min(1.0, obs.turnRate));

    // Boundary (3 features)
    vec[idx++] = Math.min(1.0, obs.distToBoundary / ARENA_RADIUS);
    vec[idx++] = Math.cos(obs.angleToCenter);
    vec[idx++] = Math.sin(obs.angleToCenter);

    // 11 whiskers (11 features)
    for (let i = 0; i < 11; i++) {
      vec[idx++] = obs.whiskerClearances[i] ?? 1.0;
    }

    // Opponent 1 (6 features, incl. heading for intercept/trap geometry)
    if (obs.opponents.length > 0) {
      const opp = obs.opponents[0];
      vec[idx++] = Math.min(1.0, opp.dist / 1000);
      vec[idx++] = Math.cos(opp.relAngle);
      vec[idx++] = Math.sin(opp.relAngle);
      vec[idx++] = Math.max(-1.0, Math.min(1.0, opp.massDelta / 300));
      vec[idx++] = Math.cos(opp.headingDiff);
      vec[idx++] = Math.sin(opp.headingDiff);
    } else {
      vec[idx++] = 1.0;
      vec[idx++] = 0.0;
      vec[idx++] = 0.0;
      vec[idx++] = 0.0;
      vec[idx++] = 1.0;
      vec[idx++] = 0.0;
    }

    // Opponent 2 (6 features)
    if (obs.opponents.length > 1) {
      const opp = obs.opponents[1];
      vec[idx++] = Math.min(1.0, opp.dist / 1000);
      vec[idx++] = Math.cos(opp.relAngle);
      vec[idx++] = Math.sin(opp.relAngle);
      vec[idx++] = Math.max(-1.0, Math.min(1.0, opp.massDelta / 300));
      vec[idx++] = Math.cos(opp.headingDiff);
      vec[idx++] = Math.sin(opp.headingDiff);
    } else {
      vec[idx++] = 1.0;
      vec[idx++] = 0.0;
      vec[idx++] = 0.0;
      vec[idx++] = 0.0;
      vec[idx++] = 1.0;
      vec[idx++] = 0.0;
    }

    // Food 1 (3 features)
    if (obs.food.length > 0) {
      const f = obs.food[0];
      vec[idx++] = Math.min(1.0, f.dist / 500);
      vec[idx++] = Math.cos(f.relAngle);
      vec[idx++] = Math.sin(f.relAngle);
    } else {
      vec[idx++] = 1.0;
      vec[idx++] = 0.0;
      vec[idx++] = 0.0;
    }

    // Food 2 (2 features)
    if (obs.food.length > 1) {
      const f = obs.food[1];
      vec[idx++] = Math.min(1.0, f.dist / 500);
      vec[idx++] = Math.cos(f.relAngle);
    } else {
      vec[idx++] = 1.0;
      vec[idx++] = 0.0;
    }

    // Own-body loop closure (3 features): nearest own segment dist + bearing.
    // Lets the net perceive an encirclement loop forming around a victim.
    vec[idx++] = Math.min(1.0, obs.ownBody.dist / 2000);
    vec[idx++] = Math.cos(obs.ownBody.relAngle);
    vec[idx++] = Math.sin(obs.ownBody.relAngle);

    return vec;
  }
}
