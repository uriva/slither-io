import { Snake, Orb, Point } from './types';
import { ARENA_RADIUS, MIN_BOOST_MASS } from './constants';
import { SpatialGrid, GridItem } from './spatialGrid';

interface BodySegmentItem extends GridItem {
  snakeId: string;
  segmentIndex: number;
}

export class BotAIController {
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

    // 1. Check Arena Boundary Threat
    const distFromCenter = Math.hypot(headX, headY);
    if (distFromCenter > ARENA_RADIUS - 400) {
      const toCenterAngle = Math.atan2(-headY, -headX);
      bot.targetAngle = toCenterAngle;
      bot.isBoosting = canBoost && distFromCenter > ARENA_RADIUS - 200;
      return;
    }

    // 2. Proactive Collision Avoidance (Forward "Whiskers" Raycast)
    const lookAheadDist = bot.radius * (bot.isBoosting ? 5.2 : 3.8);
    const anglesToCheck = [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4];
    let bestClearAngle: number | null = null;
    let urgentDanger = false;

    for (const offset of anglesToCheck) {
      const rayAngle = bot.angle + offset;
      let clear = true;

      for (let step = 1; step <= 3; step++) {
        const checkDist = (lookAheadDist * step) / 3;
        const rx = headX + Math.cos(rayAngle) * checkDist;
        const ry = headY + Math.sin(rayAngle) * checkDist;

        if (Math.hypot(rx, ry) >= ARENA_RADIUS - 60) {
          clear = false;
          break;
        }

        const candidates = bodyGrid.query(rx, ry, bot.radius * 1.3);
        const dangerHit = candidates.some((c) => c.snakeId !== bot.id);
        if (dangerHit) {
          clear = false;
          if (step === 1) urgentDanger = true;
          break;
        }
      }

      if (clear && bestClearAngle === null) {
        bestClearAngle = rayAngle;
      }
    }

    // If danger detected, turn to clear path and release boost to turn tightly
    if (urgentDanger || (bestClearAngle !== null && Math.abs(bestClearAngle - bot.angle) > 0.4)) {
      bot.targetAngle = bestClearAngle !== null ? bestClearAngle : bot.angle + Math.PI * 0.75;
      bot.isBoosting = false;
      return;
    }

    // 3. Tactical Behavior & Boost Decision (every 12 frames)
    if (bot.aiTimer % 12 === 0 || !bot.aiTarget) {
      let chosenTarget: Point | null = null;
      let wantBoost = false;

      // Find nearest opponent
      let closestOpponent: Snake | null = null;
      let closestDist = 900;

      for (const s of allSnakes) {
        if (s.id === bot.id || s.isDead) continue;
        const d = Math.hypot(s.head.x - headX, s.head.y - headY);
        if (d < closestDist) {
          closestDist = d;
          closestOpponent = s;
        }
      }

      // Interception / Cut-Off Attack:
      // If competitor is nearby and bot has good mass, boost across their trajectory!
      if (closestOpponent && closestDist < 380 && canBoost) {
        const oppAngle = closestOpponent.angle;
        // Lead the target by 80px
        const leadX = closestOpponent.head.x + Math.cos(oppAngle) * 90;
        const leadY = closestOpponent.head.y + Math.sin(oppAngle) * 90;

        chosenTarget = { x: leadX, y: leadY };
        // 65% chance to boost when attempting to cut someone off!
        wantBoost = Math.random() < 0.65;
      } else {
        // Scavenge / Food Hunting:
        const queryRange = 450;
        const nearbyFood = foodGrid.query(headX, headY, queryRange);

        if (nearbyFood.length > 0) {
          let bestOrb: Orb | null = null;
          let bestScore = -1;

          for (const orb of nearbyFood) {
            const d = Math.hypot(orb.x - headX, orb.y - headY);
            // High value pellets (kill drops or prey) get huge priority
            const score = (orb.value * 60) / (d + 20);
            if (score > bestScore) {
              bestScore = score;
              bestOrb = orb;
            }
          }

          if (bestOrb) {
            chosenTarget = { x: bestOrb.x, y: bestOrb.y };
            // Boost when racing for big orbs (value >= 3) or fireflies
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
      // Turn off boost if mass depleted
      if (!canBoost) {
        bot.isBoosting = false;
      }
    }
  }
}
