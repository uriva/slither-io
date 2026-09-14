import { Snake, Orb, Point } from './types';
import { ARENA_RADIUS, MIN_BOOST_MASS } from './constants';
import { SpatialGrid, GridItem } from './spatialGrid';

interface BodySegmentItem extends GridItem {
  snakeId?: string;
  segmentIndex?: number;
}

const ARENA_BARRIER_DIST = ARENA_RADIUS - 60;
const ARENA_BARRIER_SQ = ARENA_BARRIER_DIST * ARENA_BARRIER_DIST;
const ARENA_DANGER_DIST = ARENA_RADIUS - 400;
const ARENA_DANGER_SQ = ARENA_DANGER_DIST * ARENA_DANGER_DIST;
const ARENA_BOOST_DANGER_DIST = ARENA_RADIUS - 200;
const ARENA_BOOST_DANGER_SQ = ARENA_BOOST_DANGER_DIST * ARENA_BOOST_DANGER_DIST;

const WHISKER_ANGLES = [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 1.9, -1.9, 2.4, -2.4];

export class BotAIController {
  // Reusable query list to completely eliminate array allocations during food searches
  private static foodQueryList: (Orb & GridItem)[] = [];

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
    const canBoost = bot.score > MIN_BOOST_MASS + 8;

    // 1. Check Arena Boundary Threat (squared distance = zero Math.hypot)
    const distFromCenterSq = headX * headX + headY * headY;
    if (distFromCenterSq > ARENA_DANGER_SQ) {
      const toCenterAngle = Math.atan2(-headY, -headX);
      bot.targetAngle = toCenterAngle;
      bot.isBoosting = canBoost && distFromCenterSq > ARENA_BOOST_DANGER_SQ;
      return;
    }

    // 2. Proactive Collision Avoidance (Forward "Whiskers" Raycast)
    const lookAheadDist = bot.radius * (bot.isBoosting ? 5.2 : 3.8);

    // Broadphase check: If no foreign segments anywhere within lookahead range, skip all whisker raycasts!
    if (bodyGrid.hasObstacle(headX, headY, lookAheadDist + 30, bot.id)) {
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

          // Zero-allocation early-exit spatial check
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

      // If danger detected, steer to the clear path or the angle with maximum room, and release boost
      if (urgentDanger || bestClearAngle !== null || maxClearSteps < 3) {
        bot.targetAngle = bestClearAngle !== null ? bestClearAngle : bestClearanceAngle;
        bot.isBoosting = false;
        return;
      }
    }

    // 3. Tactical Behavior & Boost Decision (every 12 frames)
    if (bot.aiTimer % 12 === 0 || !bot.aiTarget) {
      let chosenTarget: Point | null = null;
      let wantBoost = false;

      // Find nearest opponent with fast squared distance (no Math.hypot)
      let closestOpponent: Snake | null = null;
      let closestDistSq = 900 * 900;

      for (let i = 0; i < allSnakes.length; i++) {
        const s = allSnakes[i];
        if (s.id === bot.id || s.isDead) continue;
        const dx = s.head.x - headX;
        const dy = s.head.y - headY;
        const dSq = dx * dx + dy * dy;
        if (dSq < closestDistSq) {
          closestDistSq = dSq;
          closestOpponent = s;
        }
      }

      // Interception / Cut-Off Attack:
      // If competitor is nearby and bot has good mass, boost across their trajectory!
      if (closestOpponent && closestDistSq < 380 * 380 && canBoost) {
        const oppAngle = closestOpponent.angle;
        // Lead the target by 90px
        const leadX = closestOpponent.head.x + Math.cos(oppAngle) * 90;
        const leadY = closestOpponent.head.y + Math.sin(oppAngle) * 90;

        chosenTarget = { x: leadX, y: leadY };
        wantBoost = Math.random() < 0.65;
      } else {
        // Scavenge / Food Hunting: Zero allocation reusable list
        const queryRange = 450;
        BotAIController.foodQueryList.length = 0;
        foodGrid.queryInto(headX, headY, queryRange, BotAIController.foodQueryList);

        const foodCount = BotAIController.foodQueryList.length;
        if (foodCount > 0) {
          let bestOrb: Orb | null = null;
          let bestScore = -1;

          for (let i = 0; i < foodCount; i++) {
            const orb = BotAIController.foodQueryList[i];
            const odx = orb.x - headX;
            const ody = orb.y - headY;
            const odSq = odx * odx + ody * ody;

            // Only sqrt for scoring the candidates
            const d = Math.sqrt(odSq);
            const score = (orb.value * 60) / (d + 20);
            if (score > bestScore) {
              bestScore = score;
              bestOrb = orb;
            }
          }

          if (bestOrb) {
            chosenTarget = { x: bestOrb.x, y: bestOrb.y };
            if ((bestOrb.value >= 3 || bestOrb.isPrey) && canBoost) {
              wantBoost = Math.random() < 0.55;
            }
          }
        }
      }

      // Occasional cruise sprint when wandering in open space
      if (!chosenTarget) {
        if (Math.random() < 0.08) {
          const wanderAngle = bot.angle + (Math.random() - 0.5) * 1.5;
          chosenTarget = {
            x: headX + Math.cos(wanderAngle) * 350,
            y: headY + Math.sin(wanderAngle) * 350,
          };
          wantBoost = canBoost && Math.random() < 0.25;
        }
      }

      if (chosenTarget) {
        bot.aiTarget = chosenTarget;
        bot.targetAngle = Math.atan2(chosenTarget.y - headY, chosenTarget.x - headX);
      }

      bot.isBoosting = wantBoost && canBoost;
    } else if (bot.aiTarget) {
      bot.targetAngle = Math.atan2(bot.aiTarget.y - headY, bot.aiTarget.x - headX);
      if (!canBoost) {
        bot.isBoosting = false;
      }
    }
  }
}
