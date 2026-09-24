import { Snake, Orb, Point } from './types';
import { ARENA_RADIUS, MIN_BOOST_MASS } from './constants';
import { SpatialGrid, GridItem } from './spatialGrid';

interface BodySegmentItem extends GridItem {
  snakeId?: string;
  segmentIndex?: number;
  ownerSnake?: Snake;
}

const ARENA_BARRIER_DIST = ARENA_RADIUS - 60;
const ARENA_BARRIER_SQ = ARENA_BARRIER_DIST * ARENA_BARRIER_DIST;
const ARENA_DANGER_DIST = ARENA_RADIUS - 400;
const ARENA_DANGER_SQ = ARENA_DANGER_DIST * ARENA_DANGER_DIST;
const WHISKER_ANGLES = [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 1.9, -1.9, 2.4, -2.4];

export const BOT_ARCHETYPES = [
  'punisher',
  'interceptor',
  'vacuum',
  'wall_hugger',
  'baiter',
  'coiler',
  'conservative_giant',
  'flanker',
  'prey_stalker',
  'opportunist',
] as const;

export type BotArchetype = typeof BOT_ARCHETYPES[number];

export class BotAIController {
  private static foodQueryList: (Orb & GridItem)[] = [];
  private static bodyQueryBuffer: BodySegmentItem[] = [];

  public static getRandomArchetype(): BotArchetype {
    return BOT_ARCHETYPES[Math.floor(Math.random() * BOT_ARCHETYPES.length)];
  }

  public static updateBot(
    bot: Snake,
    allSnakes: Snake[],
    bodyGrid: SpatialGrid<BodySegmentItem>,
    foodGrid: SpatialGrid<Orb & GridItem>
  ): void {
    if (bot.isDead) return;

    bot.aiTimer = (bot.aiTimer || 0) + 1;

    const headX = bot.head.x;
    const headY = bot.head.y;
    const canBoost = bot.score > MIN_BOOST_MASS + 6;
    const archetype = bot.aiArchetype || 'punisher';

    // 1. Check Arena Boundary Threat
    const distFromCenterSq = headX * headX + headY * headY;
    if (distFromCenterSq > ARENA_DANGER_SQ) {
      bot.targetAngle = Math.atan2(-headY, -headX);
      bot.isBoosting = canBoost && distFromCenterSq > (ARENA_RADIUS - 200) * (ARENA_RADIUS - 200);
      bot.aiTarget = null;
      return;
    }

    // 2. Clear waypoint when reached or passed to prevent tight orbit twirling!
    if (bot.aiTarget) {
      const tDx = bot.aiTarget.x - headX;
      const tDy = bot.aiTarget.y - headY;
      const distSq = tDx * tDx + tDy * tDy;
      const reachDist = bot.radius * 1.5 + 24;
      // If target is within reach OR target is behind the snake within 80px, clear it
      const dotForward = Math.cos(bot.angle) * tDx + Math.sin(bot.angle) * tDy;
      if (distSq <= reachDist * reachDist || (dotForward < 0 && distSq < 80 * 80)) {
        bot.aiTarget = null;
      }
    }

    // 3. Collision Avoidance Reflex
    // Immediate danger triggers instant reflex; general path clearance evaluates at 30Hz
    const isReflexTick = bot.aiTimer % 2 === 0;
    const safetyMargin = archetype === 'punisher' || archetype === 'conservative_giant' ? 4.8 : 4.1;
    const lookAheadDist = bot.radius * (bot.isBoosting ? safetyMargin * 1.25 : safetyMargin);

    // Check if any obstacle (body segments OR nearby snakes' heads) is in front of us
    let hasNearbyThreat = bodyGrid.hasObstacle(headX, headY, lookAheadDist + 45, bot.id);
    if (!hasNearbyThreat) {
      for (let j = 0; j < allSnakes.length; j++) {
        const s = allSnakes[j];
        if (s.id === bot.id || s.isDead) continue;
        const dx = s.head.x - headX;
        const dy = s.head.y - headY;
        const headDangerDist = lookAheadDist + s.radius + 35;
        if (dx * dx + dy * dy < headDangerDist * headDangerDist) {
          hasNearbyThreat = true;
          break;
        }
      }
    }

    if (hasNearbyThreat) {
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

          if (rx * rx + ry * ry >= ARENA_BARRIER_SQ || bodyGrid.hasObstacle(rx, ry, bot.radius * 1.35, bot.id)) {
            clear = false;
            if (step === 1) urgentDanger = true;
            break;
          }

          // Actively avoid other snakes' heads and necks (never ram or suicide into opponent faces!)
          for (let j = 0; j < allSnakes.length; j++) {
            const s = allSnakes[j];
            if (s.id === bot.id || s.isDead) continue;
            const dhx = rx - s.head.x;
            const dhy = ry - s.head.y;
            const safeHeadDist = bot.radius + s.radius + 28;
            if (dhx * dhx + dhy * dhy <= safeHeadDist * safeHeadDist) {
              clear = false;
              if (step === 1) urgentDanger = true;
              break;
            }
          }
          if (!clear) break;
          stepsCleared = step;
        }

        if (clear && bestClearAngle === null) bestClearAngle = rayAngle;
        if (stepsCleared > maxClearSteps) {
          maxClearSteps = stepsCleared;
          bestClearanceAngle = rayAngle;
        }
      }

      // If in immediate collision path, react instantly; otherwise smooth at 30Hz
      if (urgentDanger || (isReflexTick && (bestClearAngle !== null || maxClearSteps < 3))) {
        bot.targetAngle = bestClearAngle !== null ? bestClearAngle : bestClearanceAngle;
        bot.isBoosting = false;
        bot.aiTarget = null;
        return;
      }
    }

    // 3. Enclosure Radar: Detect if enemy body is coiling/wrapping around us (360° horizon check)
    // Evaluates every 8 frames to detect traps before the loop seals shut
    if (bot.aiTimer % 8 === 0) {
      BotAIController.bodyQueryBuffer.length = 0;
      bodyGrid.queryInto(headX, headY, 340, BotAIController.bodyQueryBuffer);

      if (BotAIController.bodyQueryBuffer.length >= 8) {
        const sectors = [0, 0, 0, 0, 0, 0, 0, 0];
        let foreignSegs = 0;

        for (let i = 0; i < BotAIController.bodyQueryBuffer.length; i++) {
          const seg = BotAIController.bodyQueryBuffer[i];
          if (seg.snakeId === bot.id) continue;
          foreignSegs++;
          const ang = Math.atan2(seg.y - headY, seg.x - headX);
          const normAng = ang + Math.PI;
          const sIdx = Math.min(7, Math.floor(normAng / (Math.PI / 4)));
          sectors[sIdx]++;
        }

        if (foreignSegs >= 8) {
          let occupied = 0;
          let maxDensity = 0;
          let minDensity = Infinity;
          let bestEscapeSector = -1;

          for (let i = 0; i < 8; i++) {
            if (sectors[i] > 0) occupied++;
            if (sectors[i] > maxDensity) maxDensity = sectors[i];
            if (sectors[i] < minDensity) {
              minDensity = sectors[i];
              bestEscapeSector = i;
            }
          }

          // If 5 or more of the 8 horizon sectors are blocked, we are inside an enclosure!
          if (occupied >= 5 && bestEscapeSector !== -1 && maxDensity >= 4) {
            const escapeAngle = -Math.PI + (bestEscapeSector + 0.5) * (Math.PI / 4);

            if (minDensity <= 2 || minDensity < maxDensity * 0.35) {
              // Open gap detected! Breakout sprint before the loop seals!
              bot.targetAngle = escapeAngle;
              bot.isBoosting = canBoost;
              bot.aiTarget = null;
              return;
            } else {
              // Loop completely sealed: tight protective orbit in the center to survive
              bot.targetAngle = bot.angle + 0.18;
              bot.isBoosting = false;
              bot.aiTarget = null;
              return;
            }
          }
        }
      }
    }

    // 4. Fast Tactical Waypoint Pursuit & Interception
    // Crisp tactical reaction (6-9 frames ~100ms-150ms)
    const decisionInterval = archetype === 'interceptor' || archetype === 'flanker' ? 6 : 9;
    if (bot.aiTimer % decisionInterval === 0 || !bot.aiTarget) {
      let chosenTarget: Point | null = null;
      let wantBoost = false;

      // Find nearest opponent
      let nearestOpponent: Snake | null = null;
      let nearestDistSq = (archetype === 'interceptor' ? 600 : 450) ** 2;

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

      const oppDist = nearestOpponent ? Math.sqrt(nearestDistSq) : Infinity;

      if (nearestOpponent) {
        const massDelta = bot.score - nearestOpponent.score;

        // If opponent is bigger, equal, or close: peel away laterally! Never ram head-first!
        if (massDelta < 20 && oppDist < 360) {
          const angleToOpp = Math.atan2(nearestOpponent.head.y - headY, nearestOpponent.head.x - headX);
          let relAngle = angleToOpp - bot.angle;
          while (relAngle < -Math.PI) relAngle += Math.PI * 2;
          while (relAngle > Math.PI) relAngle -= Math.PI * 2;
          // Peel laterally (perpendicular / tangential escape) away from opponent
          const peelSign = relAngle >= 0 ? -1 : 1;
          const escapeAngle = bot.angle + peelSign * 1.75;
          chosenTarget = {
            x: headX + Math.cos(escapeAngle) * 450,
            y: headY + Math.sin(escapeAngle) * 450,
          };
          wantBoost = canBoost && oppDist < 200;
        } else if (massDelta >= 25 && oppDist < 320 && bot.score > 160) {
          // Offensive Enclosure: Wrap around smaller opponent in an inward spiral
          const angleToOpp = Math.atan2(nearestOpponent.head.y - headY, nearestOpponent.head.x - headX);
          const orbitAngle = angleToOpp + Math.PI / 2 + 0.28;
          chosenTarget = {
            x: nearestOpponent.head.x + Math.cos(orbitAngle) * 160,
            y: nearestOpponent.head.y + Math.sin(orbitAngle) * 160,
          };
          wantBoost = canBoost && oppDist > 160;
        } else if (massDelta >= 20 && oppDist < 350) {
          // Clear mass advantage: cautious cut-off from safe distance
          const oppAngle = nearestOpponent.angle;
          const leadDist = Math.min(130, oppDist * 0.45);
          const leadX = nearestOpponent.head.x + Math.cos(oppAngle) * leadDist;
          const leadY = nearestOpponent.head.y + Math.sin(oppAngle) * leadDist;
          chosenTarget = { x: leadX, y: leadY };
          wantBoost = canBoost && oppDist < 200;
        }
      } else if (archetype === 'wall_hugger') {
        // Patrol perimeter ring away from crowded center
        const targetRadius = ARENA_RADIUS - 800;
        const currentRadius = Math.hypot(headX, headY);
        if (Math.abs(currentRadius - targetRadius) > 300) {
          const angleToCenter = Math.atan2(-headY, -headX);
          const targetAngle = currentRadius > targetRadius ? angleToCenter : angleToCenter + Math.PI;
          chosenTarget = { x: headX + Math.cos(targetAngle) * 300, y: headY + Math.sin(targetAngle) * 300 };
        }
      }

      // Default: Food foraging
      if (!chosenTarget) {
        BotAIController.foodQueryList.length = 0;
        foodGrid.queryInto(headX, headY, 550, BotAIController.foodQueryList);

        if (BotAIController.foodQueryList.length > 0) {
          let bestOrb: Orb | null = null;
          let bestScore = -1;

          for (let i = 0; i < BotAIController.foodQueryList.length; i++) {
            const orb = BotAIController.foodQueryList[i];
            const d = Math.hypot(orb.x - headX, orb.y - headY);

            let multiplier = 50;
            if (orb.isPrey) multiplier = (archetype === 'prey_stalker' ? 250 : 150);
            else if (orb.value >= 4) multiplier = (archetype === 'vacuum' ? 180 : 100);

            const score = (orb.value * multiplier) / (d + 20);
            if (score > bestScore) {
              bestScore = score;
              bestOrb = orb;
            }
          }

          if (bestOrb) {
            chosenTarget = { x: bestOrb.x, y: bestOrb.y };
            wantBoost = canBoost && (bestOrb.isPrey || bestOrb.value >= 6) && Math.random() < 0.45;
          }
        }
      }

      // Active arena migration / cruising: wander forward with gentle smooth sway
      if (!chosenTarget) {
        const hash = bot.id.charCodeAt(0) || 1;
        const wanderNoise = Math.sin(bot.aiTimer * 0.04 + hash) * 0.35;
        const cruiseAngle = bot.angle + wanderNoise;
        const cruiseDist = 500 + Math.random() * 200;
        chosenTarget = {
          x: headX + Math.cos(cruiseAngle) * cruiseDist,
          y: headY + Math.sin(cruiseAngle) * cruiseDist,
        };
        wantBoost = false;
      }

      bot.aiTarget = chosenTarget;
      bot.targetAngle = Math.atan2(chosenTarget.y - headY, chosenTarget.x - headX);
      bot.isBoosting = wantBoost && canBoost;
    } else if (bot.aiTarget) {
      bot.targetAngle = Math.atan2(bot.aiTarget.y - headY, bot.aiTarget.x - headX);
      if (!canBoost) bot.isBoosting = false;
    }
  }
}
