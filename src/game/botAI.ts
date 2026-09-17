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
      return;
    }

    // 2. Collision Avoidance Reflex
    // Immediate danger triggers instant reflex; general path clearance evaluates at 30Hz
    const isReflexTick = bot.aiTimer % 2 === 0;
    const safetyMargin = archetype === 'punisher' || archetype === 'conservative_giant' ? 4.8 : 4.1;
    const lookAheadDist = bot.radius * (bot.isBoosting ? safetyMargin * 1.25 : safetyMargin);

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

          if (rx * rx + ry * ry >= ARENA_BARRIER_SQ || bodyGrid.hasObstacle(rx, ry, bot.radius * 1.35, bot.id)) {
            clear = false;
            if (step === 1) urgentDanger = true;
            break;
          }

          // Actively avoid other snakes' heads (never ram or suicide into opponent faces!)
          for (let j = 0; j < allSnakes.length; j++) {
            const s = allSnakes[j];
            if (s.id === bot.id || s.isDead) continue;
            const dhx = rx - s.head.x;
            const dhy = ry - s.head.y;
            const safeHeadDist = bot.radius + s.radius + 18;
            if (dhx * dhx + dhy * dhy <= safeHeadDist * safeHeadDist) {
              if (s.score >= bot.score - 5) {
                clear = false;
                if (step === 1) urgentDanger = true;
                break;
              }
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
        return;
      }
    }

    // 3. Fast Tactical Waypoint Pursuit & Interception
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

        // If opponent is bigger, equal, or dangerous: DO NOT SUICIDE! Maintain safe perimeter!
        if (massDelta < 15 && oppDist < 350) {
          const fleeAngle = Math.atan2(headY - nearestOpponent.head.y, headX - nearestOpponent.head.x);
          chosenTarget = {
            x: headX + Math.cos(fleeAngle) * 400,
            y: headY + Math.sin(fleeAngle) * 400,
          };
          wantBoost = canBoost && oppDist < 180; // Panic boost to escape if pressed
        } else if (massDelta >= 15 && oppDist < 350) {
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
        foodGrid.queryInto(headX, headY, 500, BotAIController.foodQueryList);

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
