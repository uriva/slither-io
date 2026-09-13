import {
  Snake,
  Orb,
  Particle,
  FloatingText,
  LeaderboardEntry,
  GameStats,
  Point,
  SnakeSkin,
} from './types';
import {
  ARENA_RADIUS,
  INITIAL_SNAKE_LENGTH,
  BASE_RADIUS,
  MAX_RADIUS,
  BASE_SPEED,
  BOOST_SPEED,
  TURN_SPEED,
  BOOST_TURN_SPEED,
  INITIAL_FOOD_COUNT,
  MAX_FOOD_COUNT,
  PREY_COUNT,
  BOT_COUNT,
  SKINS,
  BOT_NAMES,
  FOOD_COLORS,
} from './constants';
import { SpatialGrid, GridItem } from './spatialGrid';
import { BotAIController } from './botAI';
import { sound } from './audio';

interface BodySegmentItem extends GridItem {
  snakeId: string;
  segmentIndex: number;
}

export class GameEngine {
  public player: Snake | null = null;
  public snakes: Snake[] = [];
  public orbs: Orb[] = [];
  public particles: Particle[] = [];
  public floatingTexts: FloatingText[] = [];

  public camera = { x: 0, y: 0, zoom: 1.0, targetZoom: 1.0 };
  public viewport = { width: 1200, height: 800 };

  public leaderboard: LeaderboardEntry[] = [];
  public killBanner: { text: string; timer: number } | null = null;
  public isGameOver: boolean = false;
  public stats: GameStats = {
    score: 0,
    length: INITIAL_SNAKE_LENGTH,
    kills: 0,
    timeAlive: 0,
    foodEaten: 0,
    maxRank: 999,
  };

  private foodGrid = new SpatialGrid<Orb & GridItem>(160);
  private bodyGrid = new SpatialGrid<BodySegmentItem>(140);

  private nextOrbId = 1;
  private nextTextId = 1;
  private gameTime = 0;
  private animFrameId: number | null = null;
  private lastFrameTime = 0;

  // Input states
  public mouseWorld: Point = { x: 0, y: 0 };
  public isMouseDown: boolean = false;
  public isSpaceDown: boolean = false;

  public onGameOverCallback?: (stats: GameStats) => void;
  public onStateUpdate?: (engine: GameEngine) => void;

  constructor() {
    this.initOrbs();
  }

  public setViewport(width: number, height: number): void {
    this.viewport.width = width;
    this.viewport.height = height;
  }

  public start(playerName: string, skinId: string): void {
    sound.init();
    this.isGameOver = false;
    this.gameTime = 0;
    this.particles = [];
    this.floatingTexts = [];
    this.killBanner = null;

    const selectedSkin = SKINS.find((s) => s.id === skinId) || SKINS[0];

    // Create player snake near center with slight random offset
    const playerStartAngle = Math.random() * Math.PI * 2;
    const startDist = Math.random() * 600;
    const px = Math.cos(playerStartAngle) * startDist;
    const py = Math.sin(playerStartAngle) * startDist;

    this.player = this.createSnake(
      'player',
      playerName.trim() || 'CosmicSerpent',
      true,
      selectedSkin,
      px,
      py
    );

    this.stats = {
      score: 10,
      length: INITIAL_SNAKE_LENGTH,
      kills: 0,
      timeAlive: 0,
      foodEaten: 0,
      maxRank: BOT_COUNT + 1,
    };

    // Camera immediately centers on player
    this.camera.x = px;
    this.camera.y = py;
    this.camera.zoom = 1.0;

    // Populate bot snakes
    this.snakes = [this.player];
    this.initBots();

    this.lastFrameTime = performance.now();
    this.loop(this.lastFrameTime);
  }

  private initOrbs(): void {
    this.orbs = [];
    for (let i = 0; i < INITIAL_FOOD_COUNT; i++) {
      this.spawnOrb();
    }
    for (let i = 0; i < PREY_COUNT; i++) {
      this.spawnPrey();
    }
  }

  private spawnOrb(x?: number, y?: number, value: number = 1, isDeathDrop: boolean = false): void {
    let ox = x;
    let oy = y;

    if (ox === undefined || oy === undefined) {
      // Uniform random point within circular arena
      const r = Math.sqrt(Math.random()) * (ARENA_RADIUS - 80);
      const theta = Math.random() * Math.PI * 2;
      ox = Math.cos(theta) * r;
      oy = Math.sin(theta) * r;
    }

    const colorConfig = FOOD_COLORS[Math.floor(Math.random() * FOOD_COLORS.length)];
    const baseR = isDeathDrop ? Math.min(18, 5 + value * 0.9) : Math.min(10, 4 + value * 0.8);

    this.orbs.push({
      id: this.nextOrbId++,
      x: ox,
      y: oy,
      radius: baseR,
      color: colorConfig.color,
      glowColor: colorConfig.glow,
      value: value,
      pulsePhase: Math.random() * Math.PI * 2,
    });
  }

  private spawnPrey(): void {
    const r = Math.sqrt(Math.random()) * (ARENA_RADIUS - 300);
    const theta = Math.random() * Math.PI * 2;
    const ox = Math.cos(theta) * r;
    const oy = Math.sin(theta) * r;

    this.orbs.push({
      id: this.nextOrbId++,
      x: ox,
      y: oy,
      radius: 12,
      color: '#fffb00',
      glowColor: 'rgba(255, 251, 0, 0.8)',
      value: 35,
      isPrey: true,
      preyAngle: Math.random() * Math.PI * 2,
      preySpeed: 3.5,
      pulsePhase: Math.random() * Math.PI * 2,
    });
  }

  private createSnake(
    id: string,
    name: string,
    isPlayer: boolean,
    skin: SnakeSkin,
    x: number,
    y: number,
    initialLength: number = INITIAL_SNAKE_LENGTH
  ): Snake {
    const angle = Math.random() * Math.PI * 2;
    const body: { x: number; y: number; radius: number }[] = [];

    for (let i = 0; i < initialLength; i++) {
      body.push({
        x: x - Math.cos(angle) * (i * 8),
        y: y - Math.sin(angle) * (i * 8),
        radius: BASE_RADIUS,
      });
    }

    return {
      id,
      name,
      isPlayer,
      skin,
      head: { x, y },
      angle,
      targetAngle: angle,
      speed: BASE_SPEED,
      baseSpeed: BASE_SPEED,
      boostSpeed: BOOST_SPEED,
      isBoosting: false,
      body,
      targetLength: initialLength,
      radius: BASE_RADIUS,
      score: initialLength * 2,
      kills: 0,
      isDead: false,
      boostFuel: 0,
      turnSpeed: TURN_SPEED,
      trailTime: 0,
      invulnerableTimer: isPlayer ? 180 : 90, // 3 seconds spawn protection
      aiTimer: Math.floor(Math.random() * 60),
    };
  }

  private initBots(): void {
    const targetBots = BOT_COUNT;
    const currentBots = this.snakes.filter((s) => !s.isPlayer).length;

    for (let i = currentBots; i < targetBots; i++) {
      const name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)] + (i > 25 ? `${i}` : '');
      const skin = SKINS[Math.floor(Math.random() * SKINS.length)];

      let bx = 0;
      let by = 0;
      let attempts = 0;

      // Ensure bots spawn a safe distance away from player
      do {
        const r = 800 + Math.sqrt(Math.random()) * (ARENA_RADIUS - 1200);
        const theta = Math.random() * Math.PI * 2;
        bx = Math.cos(theta) * r;
        by = Math.sin(theta) * r;
        attempts++;
      } while (
        this.player &&
        Math.hypot(bx - this.player.head.x, by - this.player.head.y) < 700 &&
        attempts < 10
      );

      // Varied bot lengths for dynamic arena (some small, some giant titans)
      const botLen = Math.floor(INITIAL_SNAKE_LENGTH + Math.random() * 60 + (Math.random() < 0.15 ? 120 : 0));
      this.snakes.push(this.createSnake(`bot-${Date.now()}-${i}`, name, false, skin, bx, by, botLen));
    }
  }

  private loop = (time: number): void => {
    const dt = Math.min(32, time - this.lastFrameTime);
    this.lastFrameTime = time;

    this.update(dt);

    if (this.onStateUpdate && this.gameTime % 4 === 0) {
      this.onStateUpdate(this);
    }

    this.animFrameId = requestAnimationFrame(this.loop);
  };

  public stop(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    sound.setBoosting(false);
  }

  public update(dt: number): void {
    this.gameTime++;

    if (this.player && !this.player.isDead) {
      this.stats.timeAlive += dt / 1000;
      this.stats.score = this.player.score;
      this.stats.length = this.player.body.length;
      this.stats.kills = this.player.kills;

      // Update player steering towards cursor
      const dx = this.mouseWorld.x - this.player.head.x;
      const dy = this.mouseWorld.y - this.player.head.y;
      if (Math.hypot(dx, dy) > 20) {
        this.player.targetAngle = Math.atan2(dy, dx);
      }

      const wantsBoost = (this.isMouseDown || this.isSpaceDown) && this.player.body.length > 14;
      this.player.isBoosting = wantsBoost;
      sound.setBoosting(wantsBoost);
    }

    // Build Spatial Grids for fast O(1) queries
    this.foodGrid.clear();
    for (let i = 0; i < this.orbs.length; i++) {
      const orb = this.orbs[i];
      this.foodGrid.insert(orb as Orb & GridItem);
    }

    this.bodyGrid.clear();
    for (const snake of this.snakes) {
      if (snake.isDead) continue;
      // Index segments (skip first 2 segments near neck to avoid self-clip false-positives)
      for (let i = 2; i < snake.body.length; i++) {
        const seg = snake.body[i];
        this.bodyGrid.insert({
          id: `${snake.id}-${i}`,
          x: seg.x,
          y: seg.y,
          radius: seg.radius,
          snakeId: snake.id,
          segmentIndex: i,
        });
      }
    }

    // Update AI for bots
    for (const snake of this.snakes) {
      if (!snake.isPlayer && !snake.isDead) {
        BotAIController.updateBot(snake, this.snakes, this.bodyGrid, this.foodGrid);
      }
    }

    // Update all snakes physics
    for (const snake of this.snakes) {
      if (snake.isDead) continue;
      this.updateSnakePhysics(snake);
    }

    // Check Collisions (Head vs Body & Boundary)
    this.checkCollisions();

    // Update Food Orbs & Prey fireflies
    this.updateOrbs();

    // Update Particles
    this.updateParticles();

    // Update Floating Text & Kill Banner
    this.updateFloatingText();

    // Respawn bots if population dropped
    if (this.snakes.filter((s) => !s.isPlayer && !s.isDead).length < BOT_COUNT) {
      this.initBots();
    }

    // Top off ambient food orbs
    if (this.orbs.length < INITIAL_FOOD_COUNT) {
      for (let i = 0; i < 4; i++) {
        this.spawnOrb();
      }
    }

    // Update Leaderboard
    if (this.gameTime % 20 === 0) {
      this.updateLeaderboard();
    }

    // Smooth Camera Follow
    if (this.player && !this.player.isDead) {
      const lerp = 0.085;
      this.camera.x += (this.player.head.x - this.camera.x) * lerp;
      this.camera.y += (this.player.head.y - this.camera.y) * lerp;

      // Dynamic zoom: scale out smoothly as snake grows
      const targetZoom = Math.max(0.48, 1.0 / (1.0 + (this.player.radius - BASE_RADIUS) * 0.03));
      this.camera.zoom += (targetZoom - this.camera.zoom) * 0.05;
    }
  }

  private updateSnakePhysics(snake: Snake): void {
    if (snake.invulnerableTimer > 0) {
      snake.invulnerableTimer -= 1;
    }

    // 1. Angle Interpolation (Smooth Steering)
    let diff = snake.targetAngle - snake.angle;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;

    const maxTurn = snake.isBoosting ? BOOST_TURN_SPEED : TURN_SPEED;
    snake.angle += Math.sign(diff) * Math.min(Math.abs(diff), maxTurn);

    // 2. Speed and Boost Logic
    const targetSpeed = snake.isBoosting ? snake.boostSpeed : snake.baseSpeed;
    snake.speed += (targetSpeed - snake.speed) * 0.2;

    // Boosting consumes mass and drops glowing food orbs behind
    if (snake.isBoosting && snake.body.length > 14) {
      snake.boostFuel += 1;
      if (snake.boostFuel >= 7) {
        snake.boostFuel = 0;
        snake.score = Math.max(10, snake.score - 2);
        snake.targetLength = Math.max(14, snake.targetLength - 1);

        // Spawn dropped mass orb from tail
        const tail = snake.body[snake.body.length - 1];
        if (tail) {
          this.spawnOrb(tail.x, tail.y, 2, false);
          // Boost spark particle
          this.particles.push({
            x: tail.x + (Math.random() - 0.5) * 10,
            y: tail.y + (Math.random() - 0.5) * 10,
            vx: -Math.cos(snake.angle) * 3 + (Math.random() - 0.5) * 2,
            vy: -Math.sin(snake.angle) * 3 + (Math.random() - 0.5) * 2,
            color: snake.skin.particleColor,
            size: Math.random() * 4 + 3,
            alpha: 1,
            life: 0,
            maxLife: 18,
          });
        }
      }
    } else {
      snake.isBoosting = false;
    }

    // 3. Move Head Forward
    snake.head.x += Math.cos(snake.angle) * snake.speed;
    snake.head.y += Math.sin(snake.angle) * snake.speed;

    // 4. Update Dynamic Radius and Target Length
    snake.radius = Math.min(
      MAX_RADIUS,
      BASE_RADIUS + Math.sqrt(Math.max(0, snake.score)) * 0.42
    );

    // 5. Body Segment Kinematics (Inverse Distance Constraint with Serpentine Wiggle)
    const spacing = Math.max(7, snake.radius * 0.58);
    const waveAmp = snake.isBoosting ? 2.8 : 1.8;
    const waveFreq = 0.16;

    snake.body[0] = { x: snake.head.x, y: snake.head.y, radius: snake.radius };

    for (let i = 1; i < snake.body.length; i++) {
      const prev = snake.body[i - 1];
      const curr = snake.body[i];

      const dx = prev.x - curr.x;
      const dy = prev.y - curr.y;
      const dist = Math.hypot(dx, dy);

      if (dist > spacing) {
        const factor = (dist - spacing) / dist;
        curr.x += dx * factor;
        curr.y += dy * factor;
      }

      // Taper radius slightly toward tail
      const taper = Math.max(0.65, 1 - (i / snake.body.length) * 0.35);
      curr.radius = snake.radius * taper;
    }

    // Adjust body length to target length
    while (snake.body.length < snake.targetLength) {
      const last = snake.body[snake.body.length - 1];
      snake.body.push({ x: last.x, y: last.y, radius: last.radius });
    }
    while (snake.body.length > snake.targetLength && snake.body.length > 14) {
      snake.body.pop();
    }

    // 6. Food Eating & Pickup Magnetism
    const pickupRadius = snake.radius * 2.2;
    const eatRadius = snake.radius * 1.05;
    const nearbyOrbs = this.foodGrid.query(snake.head.x, snake.head.y, pickupRadius);

    for (const orb of nearbyOrbs) {
      const odx = snake.head.x - orb.x;
      const ody = snake.head.y - orb.y;
      const odist = Math.hypot(odx, ody);

      if (odist <= eatRadius + orb.radius) {
        // Orb Eaten!
        this.eatOrb(snake, orb);
      } else if (odist <= pickupRadius) {
        // Gravitational magnetic pull into mouth
        const pullSpeed = (1 - odist / pickupRadius) * 10;
        orb.x += (odx / odist) * pullSpeed;
        orb.y += (ody / odist) * pullSpeed;
      }
    }
  }

  private eatOrb(snake: Snake, orb: Orb): void {
    const idx = this.orbs.findIndex((o) => o.id === orb.id);
    if (idx === -1) return;

    this.orbs.splice(idx, 1);

    const gain = orb.value;
    snake.score += gain * 2;
    snake.targetLength += Math.max(1, Math.floor(gain * 0.6));

    if (snake.isPlayer) {
      this.stats.foodEaten += 1;
      sound.playEat(gain);

      if (orb.isPrey) {
        this.addFloatingText('+50 FIREFLY!', snake.head.x, snake.head.y - 20, '#ffff00');
        // Spawn ring burst particles
        for (let p = 0; p < 16; p++) {
          const a = (p / 16) * Math.PI * 2;
          this.particles.push({
            x: orb.x,
            y: orb.y,
            vx: Math.cos(a) * 4,
            vy: Math.sin(a) * 4,
            color: '#ffff00',
            size: 5,
            alpha: 1,
            life: 0,
            maxLife: 25,
          });
        }
      }
    }
  }

  private checkCollisions(): void {
    for (const snake of this.snakes) {
      if (snake.isDead) continue;
      if (snake.invulnerableTimer > 0) continue; // Spawn protection active

      const hx = snake.head.x;
      const hy = snake.head.y;

      // 1. Arena Boundary Collision
      if (Math.hypot(hx, hy) >= ARENA_RADIUS) {
        this.killSnake(snake, 'Arena Barrier');
        continue;
      }

      // 2. Head-to-Body Collision with other snakes
      const nearbySegments = this.bodyGrid.query(hx, hy, snake.radius * 1.5);

      for (const seg of nearbySegments) {
        if (seg.snakeId === snake.id) continue; // Cannot hit own body!

        const dist = Math.hypot(hx - seg.x, hy - seg.y);
        if (dist < snake.radius * 0.85 + seg.radius * 0.7) {
          const killer = this.snakes.find((s) => s.id === seg.snakeId);
          this.killSnake(snake, killer ? killer.name : 'Unknown');
          if (killer && !killer.isDead) {
            killer.kills += 1;
            if (killer.isPlayer) {
              this.stats.kills += 1;
              sound.playKill();
              this.triggerKillBanner(`ELIMINATED ${snake.name}! +${snake.score} MASS`);
              this.addFloatingText(`KILL! +${snake.score}`, hx, hy - 40, '#00f0ff', 1.4);
            }
          }
          break;
        }
      }
    }
  }

  public killSnake(snake: Snake, killerName: string): void {
    if (snake.isDead) return;
    snake.isDead = true;

    // Drop luminous mass orbs along snake's former body segments
    const step = Math.max(1, Math.floor(snake.body.length / 45));
    for (let i = 0; i < snake.body.length; i += step) {
      const seg = snake.body[i];
      const scatter = (Math.random() - 0.5) * snake.radius * 2;
      const orbVal = Math.min(15, Math.max(4, Math.floor(snake.score / 25)));
      this.spawnOrb(seg.x + scatter, seg.y + scatter, orbVal, true);
    }

    // Supernova particle shockwave
    const particleCount = Math.min(60, 20 + Math.floor(snake.score / 20));
    for (let i = 0; i < particleCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = Math.random() * 8 + 2;
      this.particles.push({
        x: snake.head.x,
        y: snake.head.y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        color: snake.skin.particleColor,
        size: Math.random() * 6 + 4,
        alpha: 1,
        life: 0,
        maxLife: Math.random() * 25 + 20,
      });
    }

    if (snake.isPlayer) {
      this.isGameOver = true;
      this.stats.killerName = killerName;
      sound.playDeath();
      if (this.onGameOverCallback) {
        this.onGameOverCallback(this.stats);
      }
    }
  }

  private updateOrbs(): void {
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const orb = this.orbs[i];
      orb.pulsePhase += 0.05;

      // Prey (Firefly) dynamic movement & evasion
      if (orb.isPrey) {
        orb.preyAngle = (orb.preyAngle || 0) + (Math.random() - 0.5) * 0.2;
        orb.x += Math.cos(orb.preyAngle) * (orb.preySpeed || 3.5);
        orb.y += Math.sin(orb.preyAngle) * (orb.preySpeed || 3.5);

        // Turn back if near boundary
        if (Math.hypot(orb.x, orb.y) > ARENA_RADIUS - 150) {
          orb.preyAngle = Math.atan2(-orb.y, -orb.x);
        }

        // Flee from nearby snake heads
        for (const snake of this.snakes) {
          if (snake.isDead) continue;
          const d = Math.hypot(snake.head.x - orb.x, snake.head.y - orb.y);
          if (d < 220) {
            orb.preyAngle = Math.atan2(orb.y - snake.head.y, orb.x - snake.head.x);
            orb.preySpeed = 5.5; // Flee sprint
            break;
          }
        }
      }
    }
  }

  private updateParticles(): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.94;
      p.vy *= 0.94;
      p.life++;
      p.alpha = 1 - p.life / p.maxLife;

      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
      }
    }
  }

  private updateFloatingText(): void {
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const t = this.floatingTexts[i];
      t.y -= 1.2;
      t.alpha -= 0.02;
      if (t.alpha <= 0) {
        this.floatingTexts.splice(i, 1);
      }
    }

    if (this.killBanner) {
      this.killBanner.timer -= 1;
      if (this.killBanner.timer <= 0) {
        this.killBanner = null;
      }
    }
  }

  public addFloatingText(text: string, x: number, y: number, color: string = '#ffffff', scale: number = 1): void {
    this.floatingTexts.push({
      id: this.nextTextId++,
      text,
      x,
      y,
      color,
      alpha: 1,
      scale,
    });
  }

  public triggerKillBanner(text: string): void {
    this.killBanner = { text, timer: 140 };
  }

  private updateLeaderboard(): void {
    const activeSnakes = this.snakes.filter((s) => !s.isDead);
    activeSnakes.sort((a, b) => b.score - a.score);

    this.leaderboard = activeSnakes.slice(0, 10).map((s) => ({
      id: s.id,
      name: s.name,
      score: Math.floor(s.score),
      isPlayer: s.isPlayer,
      color: s.skin.colors[0],
    }));

    if (this.player && !this.player.isDead) {
      const playerRank = activeSnakes.findIndex((s) => s.id === this.player?.id) + 1;
      if (playerRank > 0 && playerRank < this.stats.maxRank) {
        this.stats.maxRank = playerRank;
      }
    }
  }

  // ================= RENDERER =================

  public render(ctx: CanvasRenderingContext2D): void {
    const { width, height } = this.viewport;

    // Clear Canvas
    ctx.clearRect(0, 0, width, height);

    // Save Context for World Camera
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(this.camera.zoom, this.camera.zoom);
    ctx.translate(-this.camera.x, -this.camera.y);

    // 1. Draw Deep Cyber Space Grid Background
    this.drawBackground(ctx);

    // 2. Draw Arena Boundary Barrier Wall
    this.drawBoundary(ctx);

    // 3. Draw Food Orbs & Fireflies
    this.drawOrbs(ctx);

    // 4. Draw Boost Trails & Particles
    this.drawParticles(ctx);

    // 5. Draw All Snakes (Tail to Head)
    this.drawSnakes(ctx);

    // 6. Draw World Floating Texts
    this.drawFloatingTexts(ctx);

    ctx.restore();
  }

  private drawBackground(ctx: CanvasRenderingContext2D): void {
    // Hexagonal / Grid Matrix background
    const gridSize = 120;
    const viewLeft = this.camera.x - this.viewport.width / (2 * this.camera.zoom);
    const viewRight = this.camera.x + this.viewport.width / (2 * this.camera.zoom);
    const viewTop = this.camera.y - this.viewport.height / (2 * this.camera.zoom);
    const viewBottom = this.camera.y + this.viewport.height / (2 * this.camera.zoom);

    const startX = Math.floor(viewLeft / gridSize) * gridSize;
    const endX = Math.ceil(viewRight / gridSize) * gridSize;
    const startY = Math.floor(viewTop / gridSize) * gridSize;
    const endY = Math.ceil(viewBottom / gridSize) * gridSize;

    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';

    ctx.beginPath();
    for (let x = startX; x <= endX; x += gridSize) {
      ctx.moveTo(x, viewTop);
      ctx.lineTo(x, viewBottom);
    }
    for (let y = startY; y <= endY; y += gridSize) {
      ctx.moveTo(viewLeft, y);
      ctx.lineTo(viewRight, y);
    }
    ctx.stroke();

    // Subtle grid intersection stars
    ctx.fillStyle = 'rgba(0, 240, 255, 0.15)';
    for (let x = startX; x <= endX; x += gridSize) {
      for (let y = startY; y <= endY; y += gridSize) {
        if (x * x + y * y <= ARENA_RADIUS * ARENA_RADIUS) {
          ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
        }
      }
    }
  }

  private drawBoundary(ctx: CanvasRenderingContext2D): void {
    const pulse = 0.5 + Math.sin(this.gameTime * 0.04) * 0.2;

    // Outer Void Ring
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, ARENA_RADIUS, 0, Math.PI * 2);
    ctx.lineWidth = 16;
    ctx.strokeStyle = `rgba(255, 30, 80, ${pulse * 0.4})`;
    ctx.stroke();

    // Sharp Laser Edge
    ctx.beginPath();
    ctx.arc(0, 0, ARENA_RADIUS, 0, Math.PI * 2);
    ctx.lineWidth = 4;
    ctx.strokeStyle = `rgba(255, 50, 100, ${pulse + 0.3})`;
    ctx.shadowColor = '#ff2255';
    ctx.shadowBlur = 20;
    ctx.stroke();
    ctx.restore();
  }

  private drawOrbs(ctx: CanvasRenderingContext2D): void {
    const viewLeft = this.camera.x - (this.viewport.width / (2 * this.camera.zoom)) - 50;
    const viewRight = this.camera.x + (this.viewport.width / (2 * this.camera.zoom)) + 50;
    const viewTop = this.camera.y - (this.viewport.height / (2 * this.camera.zoom)) - 50;
    const viewBottom = this.camera.y + (this.viewport.height / (2 * this.camera.zoom)) + 50;

    for (let i = 0; i < this.orbs.length; i++) {
      const orb = this.orbs[i];
      if (orb.x < viewLeft || orb.x > viewRight || orb.y < viewTop || orb.y > viewBottom) {
        continue;
      }

      const pulse = 1 + Math.sin(orb.pulsePhase) * 0.15;
      const r = orb.radius * pulse;

      // Outer soft glow
      ctx.save();
      ctx.beginPath();
      ctx.arc(orb.x, orb.y, r * 1.6, 0, Math.PI * 2);
      ctx.fillStyle = orb.glowColor;
      ctx.fill();

      // Core sphere
      ctx.beginPath();
      ctx.arc(orb.x, orb.y, r, 0, Math.PI * 2);
      ctx.fillStyle = orb.color;
      ctx.fill();

      // White inner glint
      ctx.beginPath();
      ctx.arc(orb.x - r * 0.3, orb.y - r * 0.3, r * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.fill();
      ctx.restore();
    }
  }

  private drawParticles(ctx: CanvasRenderingContext2D): void {
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 - p.life / p.maxLife), 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.restore();
    }
  }

  private drawSnakes(ctx: CanvasRenderingContext2D): void {
    // Sort so smaller snakes are drawn first and larger snakes overlay them
    const sortedSnakes = [...this.snakes].filter((s) => !s.isDead);
    sortedSnakes.sort((a, b) => a.score - b.score);

    for (const snake of sortedSnakes) {
      this.drawSingleSnake(ctx, snake);
    }
  }

  private drawSingleSnake(ctx: CanvasRenderingContext2D, snake: Snake): void {
    const skin = snake.skin;
    const bodyLen = snake.body.length;
    if (bodyLen === 0) return;

    ctx.save();

    // 1. Draw Body Segments (Tail to Neck)
    for (let i = bodyLen - 1; i >= 1; i--) {
      const seg = snake.body[i];

      // Determine segment color based on skin pattern
      let segColor = skin.colors[0];
      if (skin.pattern === 'stripes') {
        segColor = skin.colors[i % skin.colors.length];
      } else if (skin.pattern === 'gradient') {
        const colorIdx = Math.floor((i / bodyLen) * skin.colors.length) % skin.colors.length;
        segColor = skin.colors[colorIdx];
      } else if (skin.pattern === 'segmented') {
        segColor = Math.floor(i / 3) % 2 === 0 ? skin.colors[0] : skin.colors[1] || skin.colors[0];
      } else if (skin.pattern === 'pulse') {
        const p = Math.floor((i + this.gameTime * 0.2) % skin.colors.length);
        segColor = skin.colors[p];
      }

      // Outer segment circle
      ctx.beginPath();
      ctx.arc(seg.x, seg.y, seg.radius, 0, Math.PI * 2);
      ctx.fillStyle = segColor;
      ctx.shadowColor = snake.isBoosting ? skin.particleColor : 'transparent';
      ctx.shadowBlur = snake.isBoosting ? 14 : 0;
      ctx.fill();

      // Inner highlight circle for 3D liquid scale effect
      ctx.beginPath();
      ctx.arc(seg.x - seg.radius * 0.15, seg.y - seg.radius * 0.15, seg.radius * 0.65, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.fill();
    }

    // 2. Draw Snake Head
    const head = snake.head;
    ctx.beginPath();
    ctx.arc(head.x, head.y, snake.radius * 1.15, 0, Math.PI * 2);
    ctx.fillStyle = skin.headColor;
    ctx.shadowColor = skin.glowColor;
    ctx.shadowBlur = 18;
    ctx.fill();
    ctx.shadowBlur = 0;

    // 3. Draw Eyes
    const eyeAngle = snake.angle;
    const eyeDist = snake.radius * 0.65;
    const eyeRadius = snake.radius * 0.38;
    const pupilRadius = eyeRadius * 0.55;

    // Left eye & Right eye offsets perpendicular to angle
    const perpAngle = eyeAngle + Math.PI / 2;
    const lx = head.x + Math.cos(eyeAngle) * (eyeDist * 0.7) + Math.cos(perpAngle) * (eyeDist * 0.8);
    const ly = head.y + Math.sin(eyeAngle) * (eyeDist * 0.7) + Math.sin(perpAngle) * (eyeDist * 0.8);

    const rx = head.x + Math.cos(eyeAngle) * (eyeDist * 0.7) - Math.cos(perpAngle) * (eyeDist * 0.8);
    const ry = head.y + Math.sin(eyeAngle) * (eyeDist * 0.7) - Math.sin(perpAngle) * (eyeDist * 0.8);

    // Sclera (White eye ball)
    ctx.beginPath();
    ctx.arc(lx, ly, eyeRadius, 0, Math.PI * 2);
    ctx.arc(rx, ry, eyeRadius, 0, Math.PI * 2);
    ctx.fillStyle = skin.eyeColor;
    ctx.fill();

    // Pupil (looks forward along snake's heading)
    const pupilOffset = eyeRadius * 0.35;
    const plx = lx + Math.cos(eyeAngle) * pupilOffset;
    const ply = ly + Math.sin(eyeAngle) * pupilOffset;
    const prx = rx + Math.cos(eyeAngle) * pupilOffset;
    const pry = ry + Math.sin(eyeAngle) * pupilOffset;

    ctx.beginPath();
    ctx.arc(plx, ply, pupilRadius, 0, Math.PI * 2);
    ctx.arc(prx, pry, pupilRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#06070c';
    ctx.fill();

    // 4. Draw Crown if #1 on Leaderboard
    const isTopLeader = this.leaderboard.length > 0 && this.leaderboard[0].id === snake.id;
    if (isTopLeader) {
      ctx.save();
      ctx.translate(head.x, head.y - snake.radius * 1.5);
      ctx.fillStyle = '#ffd700';
      ctx.shadowColor = '#ffd700';
      ctx.shadowBlur = 12;

      ctx.beginPath();
      ctx.moveTo(-12, 0);
      ctx.lineTo(-14, -14);
      ctx.lineTo(-5, -6);
      ctx.lineTo(0, -18);
      ctx.lineTo(5, -6);
      ctx.lineTo(14, -14);
      ctx.lineTo(12, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // 5. Draw Name Tag and Score
    ctx.font = `600 ${Math.max(12, snake.radius * 0.8)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = snake.isPlayer ? '#00f0ff' : 'rgba(255, 255, 255, 0.85)';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 4;
    ctx.fillText(`${snake.name} (${Math.floor(snake.score)})`, head.x, head.y - snake.radius * 1.5 - (isTopLeader ? 16 : 4));

    // 6. Draw Spawn Protection Shield
    if (snake.invulnerableTimer > 0) {
      const shieldPulse = 0.5 + Math.sin(this.gameTime * 0.25) * 0.35;
      ctx.save();
      ctx.beginPath();
      ctx.arc(head.x, head.y, snake.radius * 1.6, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(0, 240, 255, ${shieldPulse})`;
      ctx.lineWidth = 3;
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 15;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(head.x, head.y, snake.radius * 1.6, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 240, 255, ${shieldPulse * 0.15})`;
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  private drawFloatingTexts(ctx: CanvasRenderingContext2D): void {
    for (let i = 0; i < this.floatingTexts.length; i++) {
      const t = this.floatingTexts[i];
      ctx.save();
      ctx.globalAlpha = Math.max(0, t.alpha);
      ctx.font = `bold ${Math.round(20 * t.scale)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = t.color;
      ctx.shadowColor = t.color;
      ctx.shadowBlur = 12;
      ctx.fillText(t.text, t.x, t.y);
      ctx.restore();
    }
  }
}
