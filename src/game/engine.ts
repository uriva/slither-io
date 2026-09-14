import {
  Snake,
  Orb,
  Particle,
  FloatingText,
  LeaderboardEntry,
  GameStats,
  Point,
  SnakeSkin,
  PlayerPresence,
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
  MIN_BOOST_MASS,
  INITIAL_FOOD_COUNT,
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

  public camera = {
    x: 0,
    y: 0,
    zoom: 1.0,
    baseZoom: 1.0,
    userZoom: 1.0,
    targetZoom: 1.0,
  };
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

  private foodGrid = new SpatialGrid<Orb & GridItem>(180);
  private bodyGrid = new SpatialGrid<BodySegmentItem>(160);

  // Reusable query arrays to avoid garbage collection
  private orbQueryList: (Orb & GridItem)[] = [];
  private bodyQueryList: BodySegmentItem[] = [];

  // Pre-rendered sprite cache for high-performance orb drawing
  private orbSprites: HTMLCanvasElement[] = [];
  private preySprite: HTMLCanvasElement | null = null;
  private customSpriteCache: Map<string, HTMLCanvasElement> = new Map();
  private gridPattern: CanvasPattern | null = null;

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
    this.initOrbSprites();
    this.initGridPattern();
    this.initOrbs();
  }

  // Pre-render procedural background pattern once
  private initGridPattern(): void {
    if (typeof document === 'undefined') return;
    const tile = document.createElement('canvas');
    tile.width = 140;
    tile.height = 140;
    const tCtx = tile.getContext('2d');
    if (!tCtx) return;

    tCtx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
    tCtx.lineWidth = 1;
    tCtx.strokeRect(0, 0, 140, 140);

    tCtx.fillStyle = 'rgba(0, 240, 255, 0.16)';
    tCtx.fillRect(0, 0, 3, 3);

    this.gridPattern = tCtx.createPattern(tile, 'repeat');
  }

  // Pre-render orb textures to offscreen canvases once
  private initOrbSprites(): void {
    if (typeof document === 'undefined') return;

    this.orbSprites = [];
    const spriteSize = 64;
    const center = spriteSize / 2;
    const radius = 22;

    for (const colorCfg of FOOD_COLORS) {
      const canvas = document.createElement('canvas');
      canvas.width = spriteSize;
      canvas.height = spriteSize;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;

      // Outer soft glow gradient
      const glowGrad = ctx.createRadialGradient(center, center, radius * 0.2, center, center, radius * 1.4);
      glowGrad.addColorStop(0, colorCfg.glow);
      glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(center, center, radius * 1.4, 0, Math.PI * 2);
      ctx.fill();

      // Solid core
      ctx.beginPath();
      ctx.arc(center, center, radius, 0, Math.PI * 2);
      ctx.fillStyle = colorCfg.color;
      ctx.fill();

      // Specular highlight
      ctx.beginPath();
      ctx.arc(center - radius * 0.3, center - radius * 0.3, radius * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fill();

      this.orbSprites.push(canvas);
    }

    // Pre-render wandering prey (firefly) sprite
    const preyCanvas = document.createElement('canvas');
    preyCanvas.width = 80;
    preyCanvas.height = 80;
    const pCtx = preyCanvas.getContext('2d');
    if (pCtx) {
      const pCenter = 40;
      const pRadius = 24;

      const pGlow = pCtx.createRadialGradient(pCenter, pCenter, pRadius * 0.2, pCenter, pCenter, pRadius * 1.6);
      pGlow.addColorStop(0, 'rgba(255, 255, 0, 0.9)');
      pGlow.addColorStop(0.6, 'rgba(255, 200, 0, 0.4)');
      pGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      pCtx.fillStyle = pGlow;
      pCtx.beginPath();
      pCtx.arc(pCenter, pCenter, pRadius * 1.6, 0, Math.PI * 2);
      pCtx.fill();

      pCtx.beginPath();
      pCtx.arc(pCenter, pCenter, pRadius, 0, Math.PI * 2);
      pCtx.fillStyle = '#ffff33';
      pCtx.fill();

      pCtx.beginPath();
      pCtx.arc(pCenter - 6, pCenter - 6, 8, 0, Math.PI * 2);
      pCtx.fillStyle = '#ffffff';
      pCtx.fill();

      this.preySprite = preyCanvas;
    }
  }

  // Memoized custom orb sprite generator for snake-colored mass drops
  private getCustomOrbSprite(color: string, glowColor: string): HTMLCanvasElement | null {
    if (typeof document === 'undefined') return null;
    const key = `${color}|${glowColor}`;
    let sprite = this.customSpriteCache.get(key);
    if (!sprite) {
      const size = 64;
      const center = size / 2;
      const radius = 22;

      sprite = document.createElement('canvas');
      sprite.width = size;
      sprite.height = size;
      const ctx = sprite.getContext('2d');
      if (ctx) {
        const glowGrad = ctx.createRadialGradient(center, center, radius * 0.2, center, center, radius * 1.45);
        glowGrad.addColorStop(0, glowColor);
        glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(center, center, radius * 1.45, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(center, center, radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(center - radius * 0.3, center - radius * 0.3, radius * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
        ctx.fill();
      }
      this.customSpriteCache.set(key, sprite);
    }
    return sprite;
  }

  public handleWheel(deltaY: number): void {
    const zoomFactor = deltaY < 0 ? 1.12 : 0.89;
    this.camera.userZoom = Math.max(0.35, Math.min(2.4, this.camera.userZoom * zoomFactor));
  }

  public setViewport(width: number, height: number): void {
    this.viewport.width = width;
    this.viewport.height = height;
  }

  public start(playerName: string, skinId: string): void {
    this.stop();
    sound.init();
    this.isGameOver = false;
    this.gameTime = 0;
    this.particles = [];
    this.floatingTexts = [];
    this.killBanner = null;

    const selectedSkin = SKINS.find((s) => s.id === skinId) || SKINS[0];

    // Create player snake near center
    const playerStartAngle = Math.random() * Math.PI * 2;
    const startDist = Math.random() * 500;
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
    this.camera.userZoom = 1.0;
    this.camera.baseZoom = 1.0;
    this.camera.targetZoom = 1.0;

    // Populate bot snakes
    this.snakes = [this.player];
    this.initBots();

    this.lastFrameTime = performance.now();
    this.animFrameId = requestAnimationFrame(this.loop);
  }

  private initOrbs(): void {
    this.foodGrid.clear();
    this.orbs = [];
    for (let i = 0; i < INITIAL_FOOD_COUNT; i++) {
      this.spawnOrb();
    }
    for (let i = 0; i < PREY_COUNT; i++) {
      this.spawnPrey();
    }
  }

  private spawnOrb(
    x?: number,
    y?: number,
    value: number = 1,
    isDeathDrop: boolean = false,
    customColor?: string,
    customGlow?: string,
    sizeScale: number = 1.0,
    radiance: number = 1.0
  ): void {
    let ox = x;
    let oy = y;

    if (ox === undefined || oy === undefined) {
      const r = Math.sqrt(Math.random()) * (ARENA_RADIUS - 160);
      const theta = Math.random() * Math.PI * 2;
      ox = Math.cos(theta) * r;
      oy = Math.sin(theta) * r;
    } else {
      // Strictly clamp custom spawn positions (death drops, boost drops) inside boundary
      const maxOrbDist = ARENA_RADIUS - 80;
      const d = Math.hypot(ox, oy);
      if (d > maxOrbDist) {
        ox = (ox / d) * maxOrbDist;
        oy = (oy / d) * maxOrbDist;
      }
    }

    const isCustom = !!customColor;
    const colorIndex = isCustom ? -1 : Math.floor(Math.random() * FOOD_COLORS.length);
    const colorConfig = isCustom ? null : FOOD_COLORS[colorIndex];

    const finalColor = customColor || colorConfig!.color;
    const finalGlow = customGlow || (customColor ? `rgba(255, 255, 255, 0.4)` : colorConfig!.glow);

    const baseR = isDeathDrop ? Math.min(22, 7 + value * 1.1) : Math.min(12, 5 + value * 0.9);
    const finalRadius = Math.max(4.5, Math.min(26, baseR * sizeScale));

    const orb: Orb = {
      id: this.nextOrbId++,
      x: ox,
      y: oy,
      radius: finalRadius,
      color: finalColor,
      glowColor: finalGlow,
      colorIndex,
      value: value,
      radiance: radiance || (0.75 + Math.random() * 0.6),
      pulseSpeed: 0.025 + Math.random() * 0.045,
      pulsePhase: Math.random() * Math.PI * 2,
    };
    orb.gridKey = this.foodGrid.insert(orb as Orb & GridItem);
    this.orbs.push(orb);
  }

  private spawnPrey(): void {
    const r = Math.sqrt(Math.random()) * (ARENA_RADIUS - 400);
    const theta = Math.random() * Math.PI * 2;
    const ox = Math.cos(theta) * r;
    const oy = Math.sin(theta) * r;

    const prey: Orb = {
      id: this.nextOrbId++,
      x: ox,
      y: oy,
      radius: 14,
      color: '#fffb00',
      glowColor: 'rgba(255, 251, 0, 0.8)',
      colorIndex: 3,
      value: 40,
      isPrey: true,
      preyAngle: Math.random() * Math.PI * 2,
      preySpeed: 3.6,
      pulsePhase: Math.random() * Math.PI * 2,
    };
    prey.gridKey = this.foodGrid.insert(prey as Orb & GridItem);
    this.orbs.push(prey);
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
      invulnerableTimer: isPlayer ? 180 : 90, // 3s spawn protection
      aiTimer: Math.floor(Math.random() * 60),
    };
  }

  private initBots(): void {
    const targetBots = BOT_COUNT;
    const currentBots = this.snakes.filter((s) => !s.isPlayer).length;

    for (let i = currentBots; i < targetBots; i++) {
      const name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)] + (i > 30 ? `${i}` : '');
      const skin = SKINS[Math.floor(Math.random() * SKINS.length)];

      let bx = 0;
      let by = 0;
      let attempts = 0;

      // Safe spawn distance from player
      do {
        const r = 900 + Math.sqrt(Math.random()) * (ARENA_RADIUS - 1400);
        const theta = Math.random() * Math.PI * 2;
        bx = Math.cos(theta) * r;
        by = Math.sin(theta) * r;
        attempts++;
      } while (
        this.player &&
        Math.hypot(bx - this.player.head.x, by - this.player.head.y) < 800 &&
        attempts < 10
      );

      const botLen = Math.floor(INITIAL_SNAKE_LENGTH + Math.random() * 50 + (Math.random() < 0.15 ? 90 : 0));
      this.snakes.push(this.createSnake(`bot-${Date.now()}-${i}`, name, false, skin, bx, by, botLen));
    }
  }

  private loop = (time: number): void => {
    if (this.animFrameId === null) return;

    const dt = Math.min(32, time - this.lastFrameTime);
    this.lastFrameTime = time;

    this.update(dt);

    // Sync state with React HUD at 6Hz to eliminate React reconciliation overhead
    if (this.onStateUpdate && this.gameTime % 10 === 0) {
      this.onStateUpdate(this);
    }

    if (!this.isGameOver) {
      this.animFrameId = requestAnimationFrame(this.loop);
    } else {
      this.animFrameId = null;
    }
  };

  public stop(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    sound.setBoosting(false);
  }

  public syncRemotePeers(peers: Record<string, PlayerPresence>): void {
    const peerIds = new Set(Object.keys(peers));
    const now = Date.now();

    // 1. Remove disconnected remote human snakes
    for (let i = this.snakes.length - 1; i >= 0; i--) {
      const s = this.snakes[i];
      if (s.isRemoteHuman) {
        if (!peerIds.has(s.id) || (peers[s.id] && now - (peers[s.id].updatedAt || 0) > 8000)) {
          this.snakes.splice(i, 1);
        }
      }
    }

    // 2. Add or update active peer snakes
    for (const [peerId, peer] of Object.entries(peers)) {
      if (!peer || !peer.head || peer.isDead) continue;
      if (this.player && (peer.id === this.player.id || peerId === this.player.id)) continue;

      let remoteSnake = this.snakes.find((s) => s.id === peerId);
      if (!remoteSnake) {
        const skin = SKINS.find((sk) => sk.id === peer.skinId) || SKINS[0];
        remoteSnake = this.createSnake(
          peerId,
          peer.name || 'HumanSerpent',
          false,
          skin,
          peer.head.x,
          peer.head.y,
          peer.body?.length || INITIAL_SNAKE_LENGTH
        );
        remoteSnake.isRemoteHuman = true;
        this.snakes.push(remoteSnake);
      }

      remoteSnake.name = peer.name || remoteSnake.name;
      remoteSnake.score = peer.score || remoteSnake.score;
      remoteSnake.kills = peer.kills || remoteSnake.kills;
      remoteSnake.isBoosting = !!peer.isBoosting;
      remoteSnake.isDead = !!peer.isDead;
      remoteSnake.speed = peer.speed || remoteSnake.speed;
      remoteSnake.radius = peer.radius || remoteSnake.radius;
      remoteSnake.targetAngle = peer.angle;

      // Smooth interpolation toward peer head position
      remoteSnake.head.x += (peer.head.x - remoteSnake.head.x) * 0.35;
      remoteSnake.head.y += (peer.head.y - remoteSnake.head.y) * 0.35;
      remoteSnake.angle = peer.angle;

      if (peer.body && peer.body.length > 0) {
        remoteSnake.body = peer.body.map((seg) => ({
          x: seg.x,
          y: seg.y,
          radius: seg.radius || remoteSnake.radius,
        }));
      }
    }
  }

  public update(dt: number): void {
    this.gameTime++;

    if (this.player && !this.player.isDead) {
      this.stats.timeAlive += dt / 1000;
      this.stats.score = this.player.score;
      this.stats.length = this.player.body.length;
      this.stats.kills = this.player.kills;

      // Steering towards cursor in world coordinates
      const dx = this.mouseWorld.x - this.player.head.x;
      const dy = this.mouseWorld.y - this.player.head.y;
      if (Math.hypot(dx, dy) > 20) {
        this.player.targetAngle = Math.atan2(dy, dx);
      }

      const canBoost = this.player.score > MIN_BOOST_MASS;
      const wantsBoost = (this.isMouseDown || this.isSpaceDown) && canBoost;
      this.player.isBoosting = wantsBoost;
      sound.setBoosting(wantsBoost);
    }

    // Build Body Spatial Grid (zero string allocations)
    this.bodyGrid.clear();
    for (const snake of this.snakes) {
      if (snake.isDead) continue;
      // Insert every segment (no stride gaps) for 100% airtight collision
      for (let i = 2; i < snake.body.length; i++) {
        const seg = snake.body[i];
        this.bodyGrid.insert({
          id: i,
          x: seg.x,
          y: seg.y,
          radius: seg.radius,
          snakeId: snake.id,
          segmentIndex: i,
        });
      }
    }

    // Update Bot AI
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

    // Check Collisions
    this.checkCollisions();

    // Update Orbs & Prey
    this.updateOrbs();

    // Update Particles
    this.updateParticles();

    // Update Floating Text & Kill Banner
    this.updateFloatingText();

    // Maintain bot population
    if (this.snakes.filter((s) => !s.isPlayer && !s.isDead).length < BOT_COUNT) {
      this.initBots();
    }

    // Maintain ambient food
    if (this.orbs.length < INITIAL_FOOD_COUNT) {
      for (let i = 0; i < 6; i++) {
        this.spawnOrb();
      }
    }

    // Update Leaderboard
    if (this.gameTime % 25 === 0) {
      this.updateLeaderboard();
    }

    // Smooth Camera Follow & Dynamic Zoom
    if (this.player && !this.player.isDead) {
      const lerp = 0.085;
      this.camera.x += (this.player.head.x - this.camera.x) * lerp;
      this.camera.y += (this.player.head.y - this.camera.y) * lerp;

      // Base zoom scales with mass, userZoom modifies it via mouse wheel
      this.camera.baseZoom = Math.max(0.38, 1.0 / (1.0 + (this.player.radius - BASE_RADIUS) * 0.024));
      this.camera.targetZoom = this.camera.baseZoom * this.camera.userZoom;
      this.camera.zoom += (this.camera.targetZoom - this.camera.zoom) * 0.1;
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
    if (snake.isBoosting) {
      if (snake.score <= MIN_BOOST_MASS) {
        snake.isBoosting = false;
      } else {
        snake.boostFuel += 1;
        if (snake.boostFuel >= 4) {
          snake.boostFuel = 0;
          snake.score = Math.max(MIN_BOOST_MASS, snake.score - 1.2);

          // Spawn dropped mass orb from tail matching snake skin colors!
          const tail = snake.body[snake.body.length - 1];
          if (tail) {
            const chosenColor = snake.skin.colors[Math.floor(Math.random() * snake.skin.colors.length)];
            const glow = snake.skin.glowColor;
            const sizeScale = 0.75 + Math.random() * 0.55;
            const radiance = 0.8 + Math.random() * 0.5;
            this.spawnOrb(tail.x, tail.y, 2, false, chosenColor, glow, sizeScale, radiance);
            this.particles.push({
              x: tail.x + (Math.random() - 0.5) * 10,
              y: tail.y + (Math.random() - 0.5) * 10,
              vx: -Math.cos(snake.angle) * 3 + (Math.random() - 0.5) * 2,
              vy: -Math.sin(snake.angle) * 3 + (Math.random() - 0.5) * 2,
              color: snake.skin.particleColor,
              size: Math.random() * 4 + 3,
              alpha: 1,
              life: 0,
              maxLife: 16,
            });
          }
        }
      }
    }

    // 3. Move Head Forward
    snake.head.x += Math.cos(snake.angle) * snake.speed;
    snake.head.y += Math.sin(snake.angle) * snake.speed;

    // 4. Update Dynamic Radius and Target Length
    // Logarithmic segment scaling: capped at 220 visual joints so performance never drops!
    snake.radius = Math.min(
      MAX_RADIUS,
      BASE_RADIUS + Math.sqrt(Math.max(0, snake.score)) * 0.42
    );
    snake.targetLength = Math.min(
      220,
      INITIAL_SNAKE_LENGTH + Math.floor(Math.sqrt(Math.max(0, snake.score)) * 3.2)
    );

    // 5. Body Segment Kinematics (Inverse Distance Constraint)
    const spacing = Math.max(7, snake.radius * 0.55);
    snake.body[0] = { x: snake.head.x, y: snake.head.y, radius: snake.radius };

    const bodyLen = snake.body.length;
    for (let i = 1; i < bodyLen; i++) {
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
      const taper = Math.max(0.65, 1 - (i / bodyLen) * 0.35);
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

    this.orbQueryList.length = 0;
    this.foodGrid.queryInto(snake.head.x, snake.head.y, pickupRadius, this.orbQueryList);

    for (let i = 0; i < this.orbQueryList.length; i++) {
      const orb = this.orbQueryList[i];
      const odx = snake.head.x - orb.x;
      const ody = snake.head.y - orb.y;
      const odist = Math.hypot(odx, ody);

      if (odist <= eatRadius + orb.radius) {
        this.eatOrb(snake, orb);
      } else if (odist <= pickupRadius) {
        const pullSpeed = (1 - odist / pickupRadius) * 10;
        orb.x += (odx / odist) * pullSpeed;
        orb.y += (ody / odist) * pullSpeed;
      }
    }
  }

  private eatOrb(snake: Snake, orb: Orb): void {
    const idx = this.orbs.findIndex((o) => o.id === orb.id);
    if (idx === -1) return;

    this.foodGrid.remove(orb as Orb & GridItem, orb.gridKey);
    this.orbs.splice(idx, 1);

    const gain = orb.value;
    snake.score += gain * 2;

    if (snake.isPlayer) {
      this.stats.foodEaten += 1;
      sound.playEat(gain);

      if (orb.isPrey) {
        this.addFloatingText('+50 FIREFLY!', snake.head.x, snake.head.y - 20, '#ffff00');
        for (let p = 0; p < 12; p++) {
          const a = (p / 12) * Math.PI * 2;
          this.particles.push({
            x: orb.x,
            y: orb.y,
            vx: Math.cos(a) * 4,
            vy: Math.sin(a) * 4,
            color: '#ffff00',
            size: 5,
            alpha: 1,
            life: 0,
            maxLife: 20,
          });
        }
      }
    }
  }

  private checkCollisions(): void {
    for (const snake of this.snakes) {
      if (snake.isDead) continue;
      if (snake.invulnerableTimer > 0) continue; // Spawn protection

      const hx = snake.head.x;
      const hy = snake.head.y;

      // 1. Arena Boundary Collision
      if (Math.hypot(hx, hy) >= ARENA_RADIUS) {
        this.killSnake(snake, 'Arena Barrier');
        continue;
      }

      // 2. Head-to-Body Collision with other snakes
      this.bodyQueryList.length = 0;
      this.bodyGrid.queryInto(hx, hy, snake.radius * 2.0, this.bodyQueryList);

      for (let i = 0; i < this.bodyQueryList.length; i++) {
        const seg = this.bodyQueryList[i];
        if (seg.snakeId === snake.id) continue; // Cannot hit own body!

        const dist = Math.hypot(hx - seg.x, hy - seg.y);
        if (dist < snake.radius * 0.92 + seg.radius * 0.88) {
          const killer = this.snakes.find((s) => s.id === seg.snakeId);
          // Don't collide with shielded spawning snakes
          if (killer && killer.invulnerableTimer > 0) continue;

          this.killSnake(snake, killer ? killer.name : 'Unknown');
          if (killer && !killer.isDead) {
            killer.kills += 1;
            if (killer.isPlayer) {
              this.stats.kills += 1;
              sound.playKill();
              this.triggerKillBanner(`ELIMINATED ${snake.name}! +${Math.floor(snake.score)} MASS`);
              this.addFloatingText(`KILL! +${Math.floor(snake.score)}`, hx, hy - 40, '#00f0ff', 1.4);
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

    // Drop luminous mass orbs along snake's former body segments matching snake's colors!
    const colors = snake.skin.colors;
    const step = Math.max(1, Math.floor(snake.body.length / 36));
    for (let i = 0; i < snake.body.length; i += step) {
      const seg = snake.body[i];
      const scatter = (Math.random() - 0.5) * snake.radius * 2.2;
      const orbVal = Math.min(18, Math.max(4, Math.floor(snake.score / 25)));

      // Color from snake's skin palette
      const chosenColor = colors[i % colors.length];
      const glow = snake.skin.glowColor;

      // Varied size and radiance:
      // Giant pulsating core orbs, medium glowing spheres, and shimmering satellite glimmers
      const sizeScale = 0.6 + Math.random() * 0.9; // 0.6x to 1.5x
      const radiance = 0.7 + Math.random() * 0.8;  // 0.7x to 1.5x

      this.spawnOrb(
        seg.x + scatter,
        seg.y + scatter,
        orbVal,
        true,
        chosenColor,
        glow,
        sizeScale,
        radiance
      );
    }

    // Supernova particle shockwave
    const particleCount = Math.min(45, 18 + Math.floor(snake.score / 30));
    for (let i = 0; i < particleCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = Math.random() * 8 + 2;
      this.particles.push({
        x: snake.head.x,
        y: snake.head.y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        color: snake.skin.particleColor,
        size: Math.random() * 6 + 3,
        alpha: 1,
        life: 0,
        maxLife: Math.random() * 20 + 16,
      });
    }

    if (snake.isPlayer) {
      this.isGameOver = true;
      this.stats.killerName = killerName;
      sound.playDeath();
      this.stop(); // Stop game loop immediately so animation frames don't multiply on respawn
      if (this.onGameOverCallback) {
        this.onGameOverCallback(this.stats);
      }
    }
  }

  private updateOrbs(): void {
    const maxOrbDist = ARENA_RADIUS - 70;

    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const orb = this.orbs[i];
      orb.pulsePhase += (orb.pulseSpeed || 0.04);

      if (orb.isPrey) {
        this.foodGrid.remove(orb as Orb & GridItem, orb.gridKey);

        orb.preyAngle = (orb.preyAngle || 0) + (Math.random() - 0.5) * 0.2;
        orb.x += Math.cos(orb.preyAngle) * (orb.preySpeed || 4.2);
        orb.y += Math.sin(orb.preyAngle) * (orb.preySpeed || 4.2);

        // Flee sprint from nearby snake heads
        for (const snake of this.snakes) {
          if (snake.isDead) continue;
          const d = Math.hypot(snake.head.x - orb.x, snake.head.y - orb.y);
          if (d < 240) {
            orb.preyAngle = Math.atan2(orb.y - snake.head.y, orb.x - snake.head.x);
            orb.preySpeed = 6.0;
            break;
          }
        }

        // Steer back inside if approaching boundary
        const currentDist = Math.hypot(orb.x, orb.y);
        if (currentDist > ARENA_RADIUS - 350) {
          orb.preyAngle = Math.atan2(-orb.y, -orb.x);
        }

        orb.gridKey = this.foodGrid.insert(orb as Orb & GridItem);
      }

      // Hard clamp so no orb can ever be outside the red circle
      const dist = Math.hypot(orb.x, orb.y);
      if (dist > maxOrbDist) {
        orb.x = (orb.x / dist) * maxOrbDist;
        orb.y = (orb.y / dist) * maxOrbDist;
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

    ctx.clearRect(0, 0, width, height);

    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(this.camera.zoom, this.camera.zoom);
    ctx.translate(-this.camera.x, -this.camera.y);

    // 1. Cyber Space Grid Matrix
    this.drawBackground(ctx);

    // 2. Arena Boundary Wall
    this.drawBoundary(ctx);

    // 3. Ultra-Fast Cached Food Orbs
    this.drawOrbs(ctx);

    // 4. Particles & Spark Trails
    this.drawParticles(ctx);

    // 5. Optimized High-Performance Snakes
    this.drawSnakes(ctx);

    // 6. Floating In-Game Texts
    this.drawFloatingTexts(ctx);

    ctx.restore();
  }

  private drawBackground(ctx: CanvasRenderingContext2D): void {
    const halfW = (this.viewport.width / (2 * this.camera.zoom)) + 100;
    const halfH = (this.viewport.height / (2 * this.camera.zoom)) + 100;
    const viewLeft = this.camera.x - halfW;
    const viewTop = this.camera.y - halfH;
    const viewW = halfW * 2;
    const viewH = halfH * 2;

    if (this.gridPattern) {
      ctx.fillStyle = this.gridPattern;
      ctx.fillRect(viewLeft, viewTop, viewW, viewH);
    }
  }

  private drawBoundary(ctx: CanvasRenderingContext2D): void {
    const pulse = 0.5 + Math.sin(this.gameTime * 0.04) * 0.2;

    // Outer glow ring
    ctx.beginPath();
    ctx.arc(0, 0, ARENA_RADIUS, 0, Math.PI * 2);
    ctx.lineWidth = 14;
    ctx.strokeStyle = `rgba(255, 30, 80, ${pulse * 0.35})`;
    ctx.stroke();

    // Mid laser ring
    ctx.beginPath();
    ctx.arc(0, 0, ARENA_RADIUS, 0, Math.PI * 2);
    ctx.lineWidth = 5;
    ctx.strokeStyle = `rgba(255, 60, 110, ${pulse * 0.6 + 0.3})`;
    ctx.stroke();

    // Sharp laser core
    ctx.beginPath();
    ctx.arc(0, 0, ARENA_RADIUS, 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }

  private drawOrbs(ctx: CanvasRenderingContext2D): void {
    const halfW = (this.viewport.width / (2 * this.camera.zoom)) + 40;
    const halfH = (this.viewport.height / (2 * this.camera.zoom)) + 40;
    const viewLeft = this.camera.x - halfW;
    const viewRight = this.camera.x + halfW;
    const viewTop = this.camera.y - halfH;
    const viewBottom = this.camera.y + halfH;

    const hasSprites = this.orbSprites.length > 0;
    const maxDrawRadiusSq = (ARENA_RADIUS - 30) * (ARENA_RADIUS - 30);

    for (let i = 0; i < this.orbs.length; i++) {
      const orb = this.orbs[i];
      if (orb.x < viewLeft || orb.x > viewRight || orb.y < viewTop || orb.y > viewBottom) {
        continue;
      }
      // Never draw food pellets outside the red barrier circle
      if (orb.x * orb.x + orb.y * orb.y > maxDrawRadiusSq) {
        continue;
      }

      const pulse = 1 + Math.sin(orb.pulsePhase) * 0.12;
      const r = orb.radius * pulse;

      if (hasSprites) {
        if (orb.isPrey && this.preySprite) {
          ctx.drawImage(this.preySprite, orb.x - r * 1.5, orb.y - r * 1.5, r * 3, r * 3);
        } else if (orb.colorIndex === -1) {
          // Hardware-accelerated custom orb matching snake's skin color!
          const sprite = this.getCustomOrbSprite(orb.color, orb.glowColor);
          if (sprite) {
            const glowMul = 1.35 + (orb.radiance || 1.0) * 0.25;
            ctx.drawImage(sprite, orb.x - r * glowMul, orb.y - r * glowMul, r * (glowMul * 2), r * (glowMul * 2));
          }
        } else {
          const sprite = this.orbSprites[orb.colorIndex || 0];
          if (sprite) {
            ctx.drawImage(sprite, orb.x - r * 1.4, orb.y - r * 1.4, r * 2.8, r * 2.8);
          }
        }
      } else {
        // Fallback if sprites not initialized
        ctx.beginPath();
        ctx.arc(orb.x, orb.y, r, 0, Math.PI * 2);
        ctx.fillStyle = orb.color;
        ctx.fill();
      }
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
      ctx.fill();
      ctx.restore();
    }
  }

  private drawSnakes(ctx: CanvasRenderingContext2D): void {
    const halfW = (this.viewport.width / (2 * this.camera.zoom)) + 200;
    const halfH = (this.viewport.height / (2 * this.camera.zoom)) + 200;
    const viewLeft = this.camera.x - halfW;
    const viewRight = this.camera.x + halfW;
    const viewTop = this.camera.y - halfH;
    const viewBottom = this.camera.y + halfH;

    const sortedSnakes = [...this.snakes].filter((s) => !s.isDead);
    sortedSnakes.sort((a, b) => a.score - b.score);

    for (const snake of sortedSnakes) {
      // Frustum culling: Skip snakes completely outside screen
      if (
        snake.head.x < viewLeft && snake.body[snake.body.length - 1].x < viewLeft ||
        snake.head.x > viewRight && snake.body[snake.body.length - 1].x > viewRight ||
        snake.head.y < viewTop && snake.body[snake.body.length - 1].y < viewTop ||
        snake.head.y > viewBottom && snake.body[snake.body.length - 1].y > viewBottom
      ) {
        let inView = false;
        for (let i = 0; i < snake.body.length; i += 8) {
          const s = snake.body[i];
          if (s.x >= viewLeft && s.x <= viewRight && s.y >= viewTop && s.y <= viewBottom) {
            inView = true;
            break;
          }
        }
        if (!inView) continue;
      }

      this.drawSingleSnake(ctx, snake);
    }
  }

  private drawSingleSnake(ctx: CanvasRenderingContext2D, snake: Snake): void {
    const skin = snake.skin;
    const bodyLen = snake.body.length;
    if (bodyLen === 0) return;

    ctx.save();

    // 1. If Boosting: Draw single smooth continuous glow aura behind snake (1 fast draw call)
    if (snake.isBoosting) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(snake.body[0].x, snake.body[0].y);
      for (let i = 1; i < bodyLen; i += 2) {
        ctx.lineTo(snake.body[i].x, snake.body[i].y);
      }
      ctx.lineWidth = snake.radius * 2.8;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = skin.particleColor;
      ctx.globalAlpha = 0.35;
      ctx.stroke();
      ctx.restore();
    }

    // 2. Base Smooth Continuous Body Stroke (ultra-smooth liquid spine)
    ctx.beginPath();
    ctx.moveTo(snake.body[bodyLen - 1].x, snake.body[bodyLen - 1].y);
    for (let i = bodyLen - 2; i >= 0; i--) {
      ctx.lineTo(snake.body[i].x, snake.body[i].y);
    }
    ctx.lineWidth = snake.radius * 1.9;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = skin.colors[0];
    ctx.stroke();

    // 3. Draw Decorative Segment Discs with optimal stride (no redundant overdraw)
    const drawStep = Math.max(1, Math.floor(snake.radius * 0.28));
    for (let i = bodyLen - 1; i >= 1; i -= drawStep) {
      const seg = snake.body[i];

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

      ctx.beginPath();
      ctx.arc(seg.x, seg.y, seg.radius, 0, Math.PI * 2);
      ctx.fillStyle = segColor;
      ctx.fill();

      // Specular 3D highlight
      ctx.beginPath();
      ctx.arc(seg.x - seg.radius * 0.15, seg.y - seg.radius * 0.15, seg.radius * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.fill();
    }

    // 4. Draw Snake Head
    const head = snake.head;
    ctx.beginPath();
    ctx.arc(head.x, head.y, snake.radius * 1.15, 0, Math.PI * 2);
    ctx.fillStyle = skin.headColor;
    ctx.fill();

    // 5. Draw Eyes
    const eyeAngle = snake.angle;
    const eyeDist = snake.radius * 0.65;
    const eyeRadius = snake.radius * 0.38;
    const pupilRadius = eyeRadius * 0.55;

    const perpAngle = eyeAngle + Math.PI / 2;
    const lx = head.x + Math.cos(eyeAngle) * (eyeDist * 0.7) + Math.cos(perpAngle) * (eyeDist * 0.8);
    const ly = head.y + Math.sin(eyeAngle) * (eyeDist * 0.7) + Math.sin(perpAngle) * (eyeDist * 0.8);

    const rx = head.x + Math.cos(eyeAngle) * (eyeDist * 0.7) - Math.cos(perpAngle) * (eyeDist * 0.8);
    const ry = head.y + Math.sin(eyeAngle) * (eyeDist * 0.7) - Math.sin(perpAngle) * (eyeDist * 0.8);

    ctx.beginPath();
    ctx.arc(lx, ly, eyeRadius, 0, Math.PI * 2);
    ctx.arc(rx, ry, eyeRadius, 0, Math.PI * 2);
    ctx.fillStyle = skin.eyeColor;
    ctx.fill();

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

    // 6. Draw Crown if #1 on Leaderboard
    const isTopLeader = this.leaderboard.length > 0 && this.leaderboard[0].id === snake.id;
    if (isTopLeader) {
      ctx.save();
      ctx.translate(head.x, head.y - snake.radius * 1.5);
      ctx.fillStyle = '#ffd700';

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

    // 7. Draw Name Tag and Score
    ctx.font = `600 ${Math.max(12, snake.radius * 0.8)}px sans-serif`;
    ctx.textAlign = 'center';
    if (snake.isPlayer) {
      ctx.fillStyle = '#00f0ff';
      ctx.fillText(`${snake.name} (${Math.floor(snake.score)})`, head.x, head.y - snake.radius * 1.5 - (isTopLeader ? 16 : 4));
    } else if (snake.isRemoteHuman) {
      ctx.fillStyle = '#ff00aa';
      ctx.fillText(`⚡ ${snake.name} (${Math.floor(snake.score)})`, head.x, head.y - snake.radius * 1.5 - (isTopLeader ? 16 : 4));
    } else {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fillText(`${snake.name} (${Math.floor(snake.score)})`, head.x, head.y - snake.radius * 1.5 - (isTopLeader ? 16 : 4));
    }

    // 8. Draw Spawn Protection Shield
    if (snake.invulnerableTimer > 0) {
      const shieldPulse = 0.5 + Math.sin(this.gameTime * 0.25) * 0.35;
      ctx.save();
      ctx.beginPath();
      ctx.arc(head.x, head.y, snake.radius * 1.6, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(0, 240, 255, ${shieldPulse})`;
      ctx.lineWidth = 3;
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
      ctx.fillText(t.text, t.x, t.y);
      ctx.restore();
    }
  }
}
