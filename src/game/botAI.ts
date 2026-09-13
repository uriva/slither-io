import { Snake, Orb, Point } from './types';
import { ARENA_RADIUS } from './constants';
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

    // 1. Check Arena Boundary Threat
    const distFromCenter = Math.hypot(headX, headY);
    if (distFromCenter > ARENA_RADIUS - 350) {
      // Steer sharply back toward arena center (0, 0)
      const toCenterAngle = Math.atan2(-headY, -headX);
      bot.targetAngle = toCenterAngle;
      bot.isBoosting = distFromCenter > ARENA_RADIUS - 150;
      return;
    }

    // 2. Proactive Collision Avoidance (Forward "Whiskers" Raycast)
    // We check three distances: close (urgent), medium (warning), far
    const lookAheadDist = bot.radius * (bot.isBoosting ? 5.5 : 4.0);
    const anglesToCheck = [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4];
    let bestClearAngle: number | null = null;
    let maxFreeDist = 0;

    let urgentDanger = false;

    for (const offset of anglesToCheck) {
      const rayAngle = bot.angle + offset;
      let clear = true;

      // Sample along ray
      for (let step = 1; step <= 3; step++) {
        const checkDist = (lookAheadDist * step) / 3;
        const rx = headX + Math.cos(rayAngle) * checkDist;
        const ry = headY + Math.sin(rayAngle) * checkDist;

        // Check if ray leaves arena
        if (Math.hypot(rx, ry) >= ARENA_RADIUS - 50) {
          clear = false;
          break;
        }

        // Check collision with other snake bodies
        const candidates = bodyGrid.query(rx, ry, bot.radius * 1.3);
        const dangerHit = candidates.some((c) => c.snakeId !== bot.id);
        if (dangerHit) {
          clear = false;
          if (step === 1) urgentDanger = true;
          break;
        }
      }

      if (clear) {
        if (bestClearAngle === null) {
          bestClearAngle = rayAngle;
        }
      } else {
        // Not completely clear
      }
    }

    // If danger detected, immediately turn to clear angle and avoid collision
    if (urgentDanger || bestClearAngle !== null && bestClearAngle !== bot.angle) {
      if (bestClearAngle !== null) {
        bot.targetAngle = bestClearAngle;
      } else {
        // Desperation turn
        bot.targetAngle = bot.angle + Math.PI * 0.75;
      }
      bot.isBoosting = false; // Slow down to turn sharper
      return;
    }

    // 3. Combat / Hunting / Opportunistic behavior (recalculated every ~15 frames)
    if (bot.aiTimer % 15 === 0 || !bot.aiTarget) {
      let chosenTarget: Point | null = null;
      let wantBoost = false;

      // Check nearby opponent snakes
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

      // If significantly bigger than nearby snake, attempt to cut them off!
      if (closestOpponent && bot.body.length > closestOpponent.body.length * 1.25 && closestDist < 450) {
        // Predict opponent head future position
        const predX = closestOpponent.head.x + Math.cos(closestOpponent.angle) * 70;
        const predY = closestOpponent.head.y + Math.sin(closestOpponent.angle) * 70;
        chosenTarget = { x: predX, y: predY };
        wantBoost = bot.body.length > 25 && closestDist < 250 && Math.random() < 0.6;
      } else {
        // Query nearby food cluster
        const queryRange = 400;
        const nearbyFood = foodGrid.query(headX, headY, queryRange);

        if (nearbyFood.length > 0) {
          // Find food with highest value or dense cluster
          let bestOrb: Orb | null = null;
          let bestScore = -1;

          for (const orb of nearbyFood) {
            const d = Math.hypot(orb.x - headX, orb.y - headY);
            const score = (orb.value * 50) / (d + 20);
            if (score > bestScore) {
              bestScore = score;
              bestOrb = orb;
            }
          }

          if (bestOrb) {
            chosenTarget = { x: bestOrb.x, y: bestOrb.y };
            // Boost if rushing for a big kill drop
            if (bestOrb.value >= 5 && bot.body.length > 25 && Math.random() < 0.4) {
              wantBoost = true;
            }
          }
        }
      }

      // Default to gentle wander if no food/prey
      if (!chosenTarget) {
        if (Math.random() < 0.05) {
          const wanderAngle = bot.angle + (Math.random() - 0.5) * 1.8;
          chosenTarget = {
            x: headX + Math.cos(wanderAngle) * 300,
            y: headY + Math.sin(wanderAngle) * 300,
          };
        }
      }

      if (chosenTarget) {
        bot.aiTarget = chosenTarget;
        bot.targetAngle = Math.atan2(chosenTarget.y - headY, chosenTarget.x - headX);
      }
      bot.isBoosting = wantBoost && bot.body.length > 20;
    } else if (bot.aiTarget) {
      // Continue steering toward chosen target
      bot.targetAngle = Math.atan2(bot.aiTarget.y - headY, bot.aiTarget.x - headX);
    }
  }
}
