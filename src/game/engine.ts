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
  KeyboardState,
  KillFeedItem,
  SharedBotState,
} from './types';
import {
  ARENA_RADIUS,
  ARENA_RADIUS_SQ,
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
import { NeuralBotController } from './neuralAI';
import { sound } from './audio';

interface BodySegmentItem extends GridItem {
  snakeId?: string;
  segmentIndex?: number;
  ownerSnake?: Snake;
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
  public killFeed: KillFeedItem[] = [];
  public isGameOver: boolean = false;
  public isHost: boolean = true;
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
  private visibleOrbsList: (Orb & GridItem)[] = [];
  private sortedSnakes: Snake[] = [];

  public renderCtx: CanvasRenderingContext2D | null = null;

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

  // Real-time FPS monitoring
  public fps: number = 60;
  private fpsFrames: number = 0;
  private fpsLastTime: number = 0;

  // Input states
  public mouseWorld: Point = { x: 0, y: 0 };
  public mouseCanvas: Point | null = null;
  public lastReportedMouseCanvas: Point | null = null;
  public isMouseDown: boolean = false;
  public isSpaceDown: boolean = false;
  public isShiftDown: boolean = false;
  public keyboardKeys: KeyboardState = {
    up: false,
    down: false,
    left: false,
    right: false,
  };
  public lastInputSource: 'mouse' | 'keyboard' = 'mouse';

  public onGameOverCallback?: (stats: GameStats) => void;
  public onStateUpdate?: (engine: GameEngine) => void;
  public customBotUpdate?: (
    bot: Snake,
    allSnakes: Snake[],
    bodyGrid: SpatialGrid<BodySegmentItem>,
    foodGrid: SpatialGrid<Orb & GridItem>
  ) => void;
  public onSnakeKilled?: (victim: Snake, killer: Snake | null, reason: string) => void;
  public autoReplenishBots: boolean = true;

  constructor() {
    this.initOrbSprites();
    this.initGridPattern();
    this.initOrbs();
  }

  public resetFrameTime(): void {
    this.lastFrameTime = performance.now();
    this.fpsLastTime = this.lastFrameTime;
    this.fpsFrames = 0;
  }

  public setRenderContext(ctx: CanvasRenderingContext2D | null): void {
    this.renderCtx = ctx;
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
    const zoomFactor = deltaY < 0 ? 1.09 : 0.92;
    this.camera.userZoom = Math.max(0.45, Math.min(2.0, this.camera.userZoom * zoomFactor));
    this.reprojectMouse();
  }

  public panCamera(dx: number, dy: number): void {
    this.camera.x -= dx / this.camera.zoom;
    this.camera.y -= dy / this.camera.zoom;
    const dist = Math.hypot(this.camera.x, this.camera.y);
    const maxDist = ARENA_RADIUS - 100;
    if (dist > maxDist) {
      this.camera.x = (this.camera.x / dist) * maxDist;
      this.camera.y = (this.camera.y / dist) * maxDist;
    }
  }

  public setViewport(width: number, height: number): void {
    this.viewport.width = width;
    this.viewport.height = height;
    this.reprojectMouse();
  }

  public isKeyboardActive(): boolean {
    return this.keyboardKeys.left || this.keyboardKeys.right;
  }

  public setKeyboardKey(key: keyof KeyboardState, pressed: boolean): void {
    this.keyboardKeys[key] = pressed;
    if (pressed && (key === 'left' || key === 'right')) {
      this.lastInputSource = 'keyboard';
    }
  }

  public resetKeyboardKeys(): void {
    this.keyboardKeys.up = false;
    this.keyboardKeys.down = false;
    this.keyboardKeys.left = false;
    this.keyboardKeys.right = false;
    this.isSpaceDown = false;
    this.isShiftDown = false;
  }

  public getSnakeTurnSpeed(snake: Snake): number {
    const baseTurn = snake.isBoosting ? BOOST_TURN_SPEED : TURN_SPEED;
    // Keep tight, nimble handling for all sizes (never drops below 88% of base)
    const sizeFactor = Math.max(0.88, 1.0 - (snake.radius - BASE_RADIUS) * 0.003);
    return baseTurn * sizeFactor;
  }

  public setMouseCanvas(x: number, y: number): void {
    if (!this.mouseCanvas) {
      this.mouseCanvas = { x, y };
      this.lastReportedMouseCanvas = { x, y };
    } else {
      // Check if mouse actually moved (threshold: >3px) so keyboard steering isn't broken
      // by resting mouse jitter
      if (this.lastReportedMouseCanvas) {
        const dx = x - this.lastReportedMouseCanvas.x;
        const dy = y - this.lastReportedMouseCanvas.y;
        if (dx * dx + dy * dy > 9) {
          this.lastInputSource = 'mouse';
          this.lastReportedMouseCanvas.x = x;
          this.lastReportedMouseCanvas.y = y;
        }
      } else {
        this.lastReportedMouseCanvas = { x, y };
      }
      this.mouseCanvas.x = x;
      this.mouseCanvas.y = y;
    }
    this.reprojectMouse();
  }

  public reprojectMouse(): void {
    if (this.mouseCanvas) {
      this.mouseWorld.x = (this.mouseCanvas.x - this.viewport.width / 2) / this.camera.zoom + this.camera.x;
      this.mouseWorld.y = (this.mouseCanvas.y - this.viewport.height / 2) / this.camera.zoom + this.camera.y;
    }
  }

  public start(playerName: string, skinId: string, playerId?: string): void {
    this.stop();
    sound.init();
    this.isGameOver = false;
    this.gameTime = 0;
    this.particles = [];
    this.floatingTexts = [];
    this.killBanner = null;
    this.mouseCanvas = null;
    this.lastReportedMouseCanvas = null;

    const selectedSkin = SKINS.find((s) => s.id === skinId) || SKINS[0];

    // Spawn player at a random position within the arena
    const spawnRadius = ARENA_RADIUS - 1200;
    let px = 0;
    let py = 0;
    let attempts = 0;
    do {
      const playerDist = Math.sqrt(Math.random()) * spawnRadius;
      const playerAngle = Math.random() * Math.PI * 2;
      px = Math.cos(playerAngle) * playerDist;
      py = Math.sin(playerAngle) * playerDist;
      attempts++;
    } while (
      attempts < 15 &&
      this.snakes.some(
        (s) => !s.isDead && (s.head.x - px) ** 2 + (s.head.y - py) ** 2 < 640000
      )
    );

    const uniqueId = playerId || `user-${Math.random().toString(36).substring(2, 9)}`;

    this.player = this.createSnake(
      uniqueId,
      playerName.trim() || 'CosmicSerpent',
      true,
      selectedSkin,
      px,
      py
    );

    this.mouseWorld.x = px + Math.cos(this.player.angle) * 300;
    this.mouseWorld.y = py + Math.sin(this.player.angle) * 300;

    this.stats = {
      score: 55,
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
    this.rebuildBodyGrid();

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

    // Varied sizing for ambient pellets (all small, but diverse):
    // 50% tiny stardust specks (3.2px - 4.2px, value: 1)
    // 35% medium nutrient pellets (4.6px - 5.8px, value: 1-2)
    // 15% radiant glowing pearls (6.2px - 7.6px, value: 2-3)
    let finalRadius: number;
    let finalValue = value;

    if (!isDeathDrop && !isCustom && (x === undefined || y === undefined)) {
      const roll = Math.random();
      if (roll < 0.50) {
        finalRadius = 3.2 + Math.random() * 1.0;
        finalValue = 1;
      } else if (roll < 0.85) {
        finalRadius = 4.6 + Math.random() * 1.2;
        finalValue = Math.random() < 0.35 ? 2 : 1;
      } else {
        finalRadius = 6.2 + Math.random() * 1.4;
        finalValue = Math.random() < 0.5 ? 3 : 2;
      }
    } else {
      const baseR = isDeathDrop ? Math.min(22, 7 + value * 1.1) : Math.min(12, 5 + value * 0.9);
      finalRadius = Math.max(4.2, Math.min(26, baseR * sizeScale));
    }

    const orb: Orb = {
      id: this.nextOrbId++,
      x: ox,
      y: oy,
      radius: finalRadius,
      color: finalColor,
      glowColor: finalGlow,
      colorIndex,
      value: finalValue,
      radiance: radiance || (0.7 + Math.random() * 0.7),
      pulseSpeed: 0.02 + Math.random() * 0.045,
      pulsePhase: Math.random() * Math.PI * 2,
      arrayIndex: this.orbs.length,
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
      radius: 15,
      color: '#fffb00',
      glowColor: 'rgba(255, 251, 0, 0.85)',
      colorIndex: 3,
      value: 45,
      isPrey: true,
      preyAngle: Math.random() * Math.PI * 2,
      preySpeed: 2.6,
      pulsePhase: Math.random() * Math.PI * 2,
      arrayIndex: this.orbs.length,
    };
    prey.gridKey = this.foodGrid.insert(prey as Orb & GridItem);
    this.orbs.push(prey);
  }

  public createSnake(
    id: string,
    name: string,
    isPlayer: boolean,
    skin: SnakeSkin,
    x: number,
    y: number,
    initialLength: number = INITIAL_SNAKE_LENGTH,
    initialAngle?: number
  ): Snake {
    let angle = initialAngle;
    if (angle === undefined) {
      const distFromCenter = Math.hypot(x, y);
      if (distFromCenter > ARENA_RADIUS - 2000) {
        // Face inward toward arena center with natural variance (±45 deg)
        const inwardAngle = Math.atan2(-y, -x);
        angle = inwardAngle + (Math.random() - 0.5) * (Math.PI * 0.5);
      } else {
        angle = Math.random() * Math.PI * 2;
      }
    }
    const body: { x: number; y: number; radius: number }[] = [];

    for (let i = 0; i < initialLength; i++) {
      body.push({
        x: x - Math.cos(angle) * (i * 8),
        y: y - Math.sin(angle) * (i * 8),
        radius: BASE_RADIUS,
      });
    }

    const CAPACITY = 2048;
    const STEP = 3.5;
    const trailX = new Float32Array(CAPACITY);
    const trailY = new Float32Array(CAPACITY);
    for (let i = 0; i < CAPACITY; i++) {
      trailX[i] = x - Math.cos(angle) * (i * STEP);
      trailY[i] = y - Math.sin(angle) * (i * STEP);
    }

    return {
      id,
      name,
      isPlayer,
      skin,
      head: { x, y },
      prevHead: { x, y },
      angle,
      targetAngle: angle,
      speed: BASE_SPEED,
      baseSpeed: BASE_SPEED,
      boostSpeed: BOOST_SPEED,
      isBoosting: false,
      body,
      targetLength: initialLength,
      radius: BASE_RADIUS,
      score: isPlayer ? 55 : Math.max(35, initialLength * 2),
      kills: 0,
      isDead: false,
      boostFuel: 0,
      turnSpeed: TURN_SPEED,
      trailTime: 0,
      invulnerableTimer: isPlayer ? 180 : 90, // 3s spawn protection
      spawnTimestamp: Date.now(),
      aiTimer: Math.floor(Math.random() * 60),
      trailX,
      trailY,
      trailHeadIdx: 0,
      trailDistAcc: 0,
    };
  }

  private initBots(): void {
    if (!this.isHost) return;
    // Purge dead bot snakes so active bot count replenishes properly
    for (let i = this.snakes.length - 1; i >= 0; i--) {
      const s = this.snakes[i];
      if (!s.isPlayer && !s.isRemoteHuman && s.isDead) {
        this.snakes.splice(i, 1);
      }
    }

    const targetBots = BOT_COUNT;
    let currentBots = 0;
    for (let i = 0; i < this.snakes.length; i++) {
      if (!this.snakes[i].isPlayer && !this.snakes[i].isDead) currentBots++;
    }

    for (let i = currentBots; i < targetBots; i++) {
      const name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)] + (i > 30 ? `${i}` : '');
      const skin = SKINS[Math.floor(Math.random() * SKINS.length)];

      let bx = 0;
      let by = 0;
      let attempts = 0;

      // Safe spawn distance from player
      do {
        const r = Math.sqrt(Math.random()) * (ARENA_RADIUS - 1200);
        const theta = Math.random() * Math.PI * 2;
        bx = Math.cos(theta) * r;
        by = Math.sin(theta) * r;
        attempts++;
      } while (
        this.player &&
        ((bx - this.player.head.x) * (bx - this.player.head.x) + (by - this.player.head.y) * (by - this.player.head.y) < 640000) &&
        attempts < 10
      );

      const botLen = Math.floor(INITIAL_SNAKE_LENGTH + Math.random() * 50 + (Math.random() < 0.15 ? 90 : 0));
      const bot = this.createSnake(`bot-${Date.now()}-${i}`, name, false, skin, bx, by, botLen);
      bot.aiArchetype = BotAIController.getRandomArchetype();
      this.snakes.push(bot);
    }
  }

  private loop = (time: number): void => {
    if (this.animFrameId === null) return;

    const dt = Math.min(32, time - this.lastFrameTime);
    this.lastFrameTime = time;

    // Rolling FPS calculation over 350ms window
    this.fpsFrames++;
    if (time - this.fpsLastTime >= 350) {
      this.fps = Math.round((this.fpsFrames * 1000) / (time - this.fpsLastTime));
      this.fpsFrames = 0;
      this.fpsLastTime = time;
    }

    this.update(dt);

    if (this.renderCtx) {
      this.render(this.renderCtx);
    }

    // Sync state with React HUD at 6Hz to eliminate React reconciliation overhead
    if (this.onStateUpdate && this.gameTime % 10 === 0) {
      this.onStateUpdate(this);
    }

    this.animFrameId = requestAnimationFrame(this.loop);
  };

  public stop(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.mouseCanvas = null;
    this.lastReportedMouseCanvas = null;
    this.isMouseDown = false;
    this.isSpaceDown = false;
    this.isShiftDown = false;
    this.resetKeyboardKeys();
    this.lastInputSource = 'mouse';
    sound.setBoosting(false);
  }

  public syncRemotePeers(peers: Record<string, PlayerPresence>, myPlayerId?: string, myPeerId?: string): void {
    const now = Date.now();

    // 1. Remove disconnected or stale remote human snakes (no updates in > 3.5s)
    for (let i = this.snakes.length - 1; i >= 0; i--) {
      const s = this.snakes[i];
      if (s.isRemoteHuman) {
        const peer = peers[s.id] || Object.values(peers).find((p) => p.id === s.id);
        if (!peer || !peer.updatedAt || (now - peer.updatedAt > 3500)) {
          this.snakes.splice(i, 1);
        }
      }
    }

    // 2. Add or update active peer snakes
    for (const [peerId, peer] of Object.entries(peers)) {
      if (!peer || !peer.head) continue;

      // Drop stale peer updates immediately so they never spawn or jitter
      if (!peer.updatedAt || (now - peer.updatedAt > 3500)) continue;

      // Bulletproof self-filtering: never spawn yourself
      if (myPeerId && (peerId === myPeerId || peer.id === myPeerId)) continue;
      if (myPlayerId && (peer.id === myPlayerId || peerId === myPlayerId)) continue;
      if (this.player && (peer.id === this.player.id || peerId === this.player.id)) continue;
      if (this.player && peer.name === this.player.name) {
        const pdx = peer.head.x - this.player.head.x;
        const pdy = peer.head.y - this.player.head.y;
        if (pdx * pdx + pdy * pdy < 225) continue;
      }

      let remoteSnake = this.snakes.find((s) => s.id === peerId || s.id === peer.id);

      // Handle death state:
      if (remoteSnake) {
        if (remoteSnake.isDead) {
          // If already killed on our screen, do NOT revive from delayed network packets
          // unless the peer has genuinely respawned with a strictly newer spawnTimestamp!
          if (peer.spawnTimestamp && peer.spawnTimestamp > remoteSnake.spawnTimestamp && !peer.isDead) {
            remoteSnake.isDead = false;
            remoteSnake.spawnTimestamp = peer.spawnTimestamp;
            remoteSnake.head = { x: peer.head.x, y: peer.head.y };
          } else {
            continue;
          }
        }
        if (peer.isDead) {
          this.killSnake(remoteSnake, 'Eliminated');
          continue;
        }
      } else {
        // Don't spawn snakes that are already dead
        if (peer.isDead) continue;

        const skin = SKINS.find((sk) => sk.id === peer.skinId) || SKINS[0];
        remoteSnake = this.createSnake(
          peerId,
          peer.name || 'HumanSerpent',
          false,
          skin,
          peer.head.x,
          peer.head.y,
          INITIAL_SNAKE_LENGTH,
          peer.angle
        );
        remoteSnake.isRemoteHuman = true;
        remoteSnake.spawnTimestamp = peer.spawnTimestamp || Date.now();
        this.snakes.push(remoteSnake);
      }

      remoteSnake.name = peer.name || remoteSnake.name;
      remoteSnake.score = peer.score || remoteSnake.score;
      remoteSnake.kills = peer.kills || remoteSnake.kills;
      remoteSnake.isBoosting = !!peer.isBoosting;
      remoteSnake.speed = peer.speed || remoteSnake.speed;
      remoteSnake.radius = peer.radius || remoteSnake.radius;
      remoteSnake.targetAngle = peer.angle;
      remoteSnake.targetLength = Math.min(
        220,
        INITIAL_SNAKE_LENGTH + Math.floor(Math.sqrt(Math.max(0, remoteSnake.score)) * 3.2)
      );

      // Smooth interpolation toward peer head position
      if (!remoteSnake.prevHead) {
        remoteSnake.prevHead = { x: remoteSnake.head.x, y: remoteSnake.head.y };
      }
      remoteSnake.head.x += (peer.head.x - remoteSnake.head.x) * 0.35;
      remoteSnake.head.y += (peer.head.y - remoteSnake.head.y) * 0.35;
      remoteSnake.angle = peer.angle;
    }
  }

  public getSharedBotsSnapshot(): SharedBotState[] {
    const list: SharedBotState[] = [];
    for (let i = 0; i < this.snakes.length; i++) {
      const s = this.snakes[i];
      if (!s.isPlayer && !s.isRemoteHuman && !s.isSyncedBot) {
        list.push({
          id: s.id,
          name: s.name,
          skinId: s.skin.id,
          x: Math.round(s.head.x),
          y: Math.round(s.head.y),
          angle: Number(s.angle.toFixed(3)),
          speed: Number(s.speed.toFixed(1)),
          radius: Math.round(s.radius),
          score: Math.round(s.score),
          kills: s.kills,
          isBoosting: s.isBoosting,
          isDead: s.isDead,
          archetype: s.aiArchetype,
        });
      }
    }
    return list;
  }

  public syncRemoteBots(bots: SharedBotState[]): void {
    if (this.isHost) return; // Host calculates bots, never overwrites from network

    const seenIds = new Set<string>();
    for (let b = 0; b < bots.length; b++) {
      const data = bots[b];
      seenIds.add(data.id);

      let bot = this.snakes.find((s) => s.id === data.id);
      if (bot) {
        if (bot.isDead) {
          if (!data.isDead) bot.isDead = false;
          else continue;
        }
        if (data.isDead) {
          this.killSnake(bot, 'Eliminated');
          continue;
        }
      } else {
        if (data.isDead) continue;
        const skin = SKINS.find((sk) => sk.id === data.skinId) || SKINS[0];
        bot = this.createSnake(data.id, data.name, false, skin, data.x, data.y, INITIAL_SNAKE_LENGTH, data.angle);
        bot.isSyncedBot = true;
        bot.aiArchetype = data.archetype;
        this.snakes.push(bot);
      }

      bot.name = data.name;
      bot.score = data.score;
      bot.kills = data.kills;
      bot.isBoosting = data.isBoosting;
      bot.speed = data.speed;
      bot.radius = data.radius;
      bot.targetAngle = data.angle;

      // Smooth interpolation towards host's authoritative position
      bot.head.x += (data.x - bot.head.x) * 0.4;
      bot.head.y += (data.y - bot.head.y) * 0.4;
      bot.angle = data.angle;
    }

    // Remove stale synced bots
    for (let i = this.snakes.length - 1; i >= 0; i--) {
      const s = this.snakes[i];
      if (s.isSyncedBot && !seenIds.has(s.id)) {
        this.snakes.splice(i, 1);
      }
    }
  }

  public addChatMessage(snakeId: string, text: string, senderName?: string): void {
    let target = this.snakes.find((s) => s.id === snakeId);
    if (!target && this.player && (this.player.id === snakeId || this.player.name === senderName)) {
      target = this.player;
    }
    if (!target && senderName) {
      target = this.snakes.find((s) => s.name === senderName);
    }
    if (target) {
      target.chatMessage = text;
      target.chatTimer = 260; // ~4.3 seconds at 60fps
    }
  }

  public update(dt: number): void {
    this.gameTime++;

    // Decrement chat bubble timers
    for (let i = 0; i < this.snakes.length; i++) {
      const snake = this.snakes[i];
      if (snake.chatTimer && snake.chatTimer > 0) {
        snake.chatTimer--;
        if (snake.chatTimer <= 0) {
          snake.chatMessage = undefined;
        }
      }
    }

    const dtScale = Math.min(2.0, Math.max(0.1, dt / 16.6667));

    if (this.player && !this.player.isDead) {
      this.stats.timeAlive += dt / 1000;
      this.stats.score = this.player.score;
      this.stats.length = this.player.body.length;
      this.stats.kills = this.player.kills;

      const turnRate = this.getSnakeTurnSpeed(this.player) * dtScale;

      if (this.lastInputSource === 'keyboard') {
        // Classic Slither steering: Left/Right rotate continuously relative to current heading
        if (this.keyboardKeys.left && !this.keyboardKeys.right) {
          this.player.angle -= turnRate;
        } else if (this.keyboardKeys.right && !this.keyboardKeys.left) {
          this.player.angle += turnRate;
        }
        while (this.player.angle < -Math.PI) this.player.angle += Math.PI * 2;
        while (this.player.angle > Math.PI) this.player.angle -= Math.PI * 2;
        this.player.targetAngle = this.player.angle;

        // Project mouseWorld ahead in the snake's current heading
        this.mouseWorld.x = this.player.head.x + Math.cos(this.player.angle) * 350;
        this.mouseWorld.y = this.player.head.y + Math.sin(this.player.angle) * 350;
      } else {
        // Mouse steering
        this.reprojectMouse();

        // Steering towards cursor in world coordinates
        const dx = this.mouseWorld.x - this.player.head.x;
        const dy = this.mouseWorld.y - this.player.head.y;
        const distSq = dx * dx + dy * dy;

        // Cursor beyond 8px turns tightly and responsively towards cursor
        if (distSq > 64) {
          this.player.targetAngle = Math.atan2(dy, dx);
        }
      }

      const canBoost = this.player.score > MIN_BOOST_MASS;
      const wantsBoost =
        (this.isMouseDown ||
          this.isSpaceDown ||
          this.isShiftDown ||
          this.keyboardKeys.up) &&
        canBoost;
      this.player.isBoosting = wantsBoost;
      sound.setBoosting(wantsBoost);
    }

    // Update Bot AI (Only Room Host computes bot decisions; guests interpolate synchronized bot packets)
    if (this.isHost) {
      for (let i = 0; i < this.snakes.length; i++) {
        const snake = this.snakes[i];
        if (!snake.isPlayer && !snake.isRemoteHuman && !snake.isSyncedBot && !snake.isDead) {
          if (this.customBotUpdate) {
            this.customBotUpdate(snake, this.snakes, this.bodyGrid, this.foodGrid);
          } else {
            BotAIController.updateBot(snake, this.snakes, this.bodyGrid, this.foodGrid);
          }
        }
      }
    }

    // Update all snakes physics
    for (let i = 0; i < this.snakes.length; i++) {
      const snake = this.snakes[i];
      if (snake.isDead) continue;
      this.updateSnakePhysics(snake, dtScale);
    }

    // Rebuild Body Spatial Grid with fresh post-physics positions
    this.rebuildBodyGrid();

    // Check Collisions with up-to-date spatial grid
    this.checkCollisions();

    // Update Orbs & Prey
    this.updateOrbs();

    // Update Particles
    this.updateParticles();

    // Update Floating Text & Kill Banner
    this.updateFloatingText();

    // Maintain bot population
    let activeBots = 0;
    for (let i = 0; i < this.snakes.length; i++) {
      const s = this.snakes[i];
      if (!s.isPlayer && !s.isDead) activeBots++;
    }
    if (this.isHost && this.autoReplenishBots && activeBots < BOT_COUNT) {
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
    } else {
      this.camera.targetZoom = this.camera.baseZoom * this.camera.userZoom;
    }
    this.camera.zoom += (this.camera.targetZoom - this.camera.zoom) * 0.1;
  }

  private rebuildBodyGrid(): void {
    this.bodyGrid.clear();
    for (let s = 0; s < this.snakes.length; s++) {
      const snake = this.snakes[s];
      if (snake.isDead) continue;
      const body = snake.body;
      const bodyLen = body.length;
      for (let i = 1; i < bodyLen; i++) {
        const seg = body[i] as unknown as BodySegmentItem;
        seg.id = i;
        seg.snakeId = snake.id;
        seg.segmentIndex = i;
        seg.ownerSnake = snake;
        this.bodyGrid.insert(seg);
      }
    }
  }

  private updateSnakePhysics(snake: Snake, dtScale: number = 1.0): void {
    if (snake.invulnerableTimer > 0) {
      snake.invulnerableTimer -= 1;
    }

    // 1. Angle Interpolation (Smooth Steering)
    let diff = snake.targetAngle - snake.angle;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;

    const maxTurn = this.getSnakeTurnSpeed(snake) * dtScale;
    snake.angle += Math.sign(diff) * Math.min(Math.abs(diff), maxTurn);
    while (snake.angle < -Math.PI) snake.angle += Math.PI * 2;
    while (snake.angle > Math.PI) snake.angle -= Math.PI * 2;

    // 2. Speed and Boost Logic
    const targetSpeed = snake.isBoosting ? snake.boostSpeed : snake.baseSpeed;
    snake.speed += (targetSpeed - snake.speed) * Math.min(1, 0.2 * dtScale);

    // Boosting consumes mass and drops glowing food orbs behind
    if (snake.isBoosting) {
      if (snake.score <= MIN_BOOST_MASS) {
        snake.isBoosting = false;
      } else {
        snake.boostFuel += 1;
        if (snake.boostFuel >= 5) {
          snake.boostFuel = 0;
          snake.score = Math.max(MIN_BOOST_MASS, snake.score - 0.7);

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

    // Track previous head position for continuous swept collision
    if (!snake.prevHead) {
      snake.prevHead = { x: snake.head.x, y: snake.head.y };
    } else {
      snake.prevHead.x = snake.head.x;
      snake.prevHead.y = snake.head.y;
    }

    // 3. Move Head Forward
    const moveDist = snake.speed * dtScale;
    const dx = Math.cos(snake.angle) * moveDist;
    const dy = Math.sin(snake.angle) * moveDist;
    snake.head.x += dx;
    snake.head.y += dy;

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

    // 5. Body Segment Kinematics (Path History Footprint - Rigid Against Knots & Loops)
    const CAPACITY = 2048;
    const MASK = 2047;
    const STEP = 3.5;

    if (!snake.trailX || !snake.trailY) {
      snake.trailX = new Float32Array(CAPACITY);
      snake.trailY = new Float32Array(CAPACITY);
      snake.trailHeadIdx = 0;
      snake.trailDistAcc = 0;
      for (let i = 0; i < CAPACITY; i++) {
        snake.trailX[i] = snake.head.x - Math.cos(snake.angle) * (i * STEP);
        snake.trailY[i] = snake.head.y - Math.sin(snake.angle) * (i * STEP);
      }
    }

    const trailX = snake.trailX;
    const trailY = snake.trailY;

    let headIdx = snake.trailHeadIdx || 0;
    let distAcc = (snake.trailDistAcc || 0) + moveDist;
    const numSteps = Math.floor(distAcc / STEP);
    distAcc -= numSteps * STEP;
    snake.trailDistAcc = distAcc;

    if (numSteps > 0 && moveDist > 0.0001) {
      const ux = dx / moveDist;
      const uy = dy / moveDist;
      const startX = snake.head.x - dx;
      const startY = snake.head.y - dy;

      for (let s = 1; s <= numSteps; s++) {
        headIdx = (headIdx + 1) & MASK;
        trailX[headIdx] = startX + ux * (s * STEP);
        trailY[headIdx] = startY + uy * (s * STEP);
      }
      snake.trailHeadIdx = headIdx;
    }

    const spacing = Math.max(7, snake.radius * 0.55);
    snake.body[0].x = snake.head.x;
    snake.body[0].y = snake.head.y;
    snake.body[0].radius = snake.radius;

    const bodyLen = snake.body.length;
    for (let i = 1; i < bodyLen; i++) {
      const targetDist = i * spacing + distAcc;
      const trailPos = targetDist / STEP;
      const step0 = Math.floor(trailPos);
      const frac = trailPos - step0;

      const idx0 = (headIdx - step0 + CAPACITY) & MASK;
      const idx1 = (headIdx - step0 - 1 + CAPACITY) & MASK;

      snake.body[i].x = trailX[idx0] * (1 - frac) + trailX[idx1] * frac;
      snake.body[i].y = trailY[idx0] * (1 - frac) + trailY[idx1] * frac;

      // Taper radius slightly toward tail
      const taper = Math.max(0.65, 1 - (i / bodyLen) * 0.35);
      snake.body[i].radius = snake.radius * taper;
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
    const pickupRadius = snake.radius * 2.4;
    const eatRadius = snake.radius * 1.05;

    this.orbQueryList.length = 0;
    this.foodGrid.queryInto(snake.head.x, snake.head.y, pickupRadius + 40, this.orbQueryList);

    for (let i = 0; i < this.orbQueryList.length; i++) {
      const orb = this.orbQueryList[i];
      const odx = snake.head.x - orb.x;
      const ody = snake.head.y - orb.y;
      const odistSq = odx * odx + ody * ody;

      // Fireflies get more generous capture and magnetic suction
      const effectiveEat = (orb.isPrey ? eatRadius * 1.35 : eatRadius) + orb.radius;
      const effectivePickup = orb.isPrey ? pickupRadius * 1.35 : pickupRadius;

      if (odistSq <= effectiveEat * effectiveEat) {
        this.eatOrb(snake, orb);
      } else if (odistSq <= effectivePickup * effectivePickup) {
        const odist = Math.sqrt(odistSq);
        const pullFactor = 1 - odist / effectivePickup;
        const pullSpeed = pullFactor * (orb.isPrey ? 15 : 10);
        orb.x += (odx / odist) * pullSpeed;
        orb.y += (ody / odist) * pullSpeed;
      }
    }
  }

  private eatOrb(snake: Snake, orb: Orb): void {
    const idx = orb.arrayIndex !== undefined && this.orbs[orb.arrayIndex] === orb
      ? orb.arrayIndex
      : this.orbs.indexOf(orb);
    if (idx === -1) return;

    this.foodGrid.remove(orb as Orb & GridItem, orb.gridKey);

    // O(1) swap-and-pop removal from orbs array
    const lastOrb = this.orbs.pop()!;
    if (idx < this.orbs.length) {
      this.orbs[idx] = lastOrb;
      lastOrb.arrayIndex = idx;
    }

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

  // Airtight zero-allocation continuous swept segment-to-capsule collision
  private testSegmentCapsuleCollision(
    p1x: number, p1y: number, p2x: number, p2y: number, snakeRadius: number,
    s1x: number, s1y: number, s2x: number, s2y: number, r1: number, r2: number
  ): boolean {
    const ux = p2x - p1x;
    const uy = p2y - p1y;
    const vx = s2x - s1x;
    const vy = s2y - s1y;
    const wx = p1x - s1x;
    const wy = p1y - s1y;

    const a = ux * ux + uy * uy;
    const b = ux * vx + uy * vy;
    const c = vx * vx + vy * vy;
    const d = ux * wx + uy * wy;
    const e = vx * wx + vy * wy;
    const D = a * c - b * b;

    let sN: number;
    let sD = D;
    let tN: number;
    let tD = D;
    const EPS = 1e-7;

    if (D < EPS) {
      sN = 0.0;
      sD = 1.0;
      tN = e;
      tD = c;
    } else {
      sN = b * e - c * d;
      tN = a * e - b * d;
      if (sN < 0.0) {
        sN = 0.0;
        tN = e;
        tD = c;
      } else if (sN > sD) {
        sN = sD;
        tN = e + b;
        tD = c;
      }
    }

    if (tN < 0.0) {
      tN = 0.0;
      if (-d < 0.0) {
        sN = 0.0;
      } else if (-d > a) {
        sN = sD;
      } else {
        sN = -d;
        sD = a;
      }
    } else if (tN > tD) {
      tN = tD;
      if (-d + b < 0.0) {
        sN = 0.0;
      } else if (-d + b > a) {
        sN = sD;
      } else {
        sN = -d + b;
        sD = a;
      }
    }

    const sc = Math.abs(sN) < EPS ? 0.0 : sN / sD;
    const tc = Math.abs(tN) < EPS || c < EPS ? 0.0 : Math.max(0, Math.min(1, tN / tD));

    const dPx = wx + sc * ux - tc * vx;
    const dPy = wy + sc * uy - tc * vy;
    const distSq = dPx * dPx + dPy * dPy;

    const effSegR = r1 * (1.0 - tc) + r2 * tc;
    // Authentic forgiving Slither.io collision:
    // Visual head is ~1.15r, visual body is ~1.0r.
    // Core collision radius is 0.85r + 0.82r: allows slight edge grazing on outer glowing aura,
    // but firmly prevents bodies from ever overlapping or clipping on top of each other!
    const headCoreR = snakeRadius * 0.85;
    const segCoreR = effSegR * 0.82;
    const maxDist = headCoreR + segCoreR;
    return distSq < maxDist * maxDist;
  }

  private checkCollisions(): void {
    for (let sIdx = 0; sIdx < this.snakes.length; sIdx++) {
      const snake = this.snakes[sIdx];
      if (snake.isDead) continue;
      if (snake.invulnerableTimer > 0) continue; // Spawn protection

      const hx = snake.head.x;
      const hy = snake.head.y;
      const prevHx = snake.prevHead ? snake.prevHead.x : hx;
      const prevHy = snake.prevHead ? snake.prevHead.y : hy;

      // 1. Arena Boundary Collision (zero Math.hypot)
      if (hx * hx + hy * hy >= ARENA_RADIUS_SQ) {
        this.killSnake(snake, 'Arena Barrier', null);
        continue;
      }

      // 2. Direct Head-to-Head Collision Check (each pair checked once: O(N*(N-1)/2))
      for (let j = sIdx + 1; j < this.snakes.length; j++) {
        const other = this.snakes[j];
        if (other.id === snake.id || other.isDead || other.invulnerableTimer > 0) continue;

        const otherPrevHx = other.prevHead ? other.prevHead.x : other.head.x;
        const otherPrevHy = other.prevHead ? other.prevHead.y : other.head.y;

        const dhx = hx - other.head.x;
        const dhy = hy - other.head.y;
        const contactRadius = (snake.radius + other.radius) * 0.80;

        // Continuous swept head-to-head collision
        const isHeadCollision =
          dhx * dhx + dhy * dhy < contactRadius * contactRadius ||
          this.testSegmentCapsuleCollision(
            prevHx, prevHy, hx, hy, snake.radius,
            otherPrevHx, otherPrevHy, other.head.x, other.head.y, other.radius, other.radius
          );

        if (isHeadCollision) {
          const massDiff = snake.score - other.score;
          if (massDiff < -4) {
            // This snake is smaller -> dies!
            this.killSnake(snake, other.name, other);
            if (!other.isDead) {
              other.kills += 1;
              if (other.isPlayer) {
                this.stats.kills += 1;
                sound.playKill();
                this.triggerKillBanner(`CRUSHED ${snake.name}! +${Math.floor(snake.score)} MASS`);
                this.addFloatingText(`CRUSHED! +${Math.floor(snake.score)}`, hx, hy - 40, '#00f0ff', 1.4);
              }
            }
            break;
          } else if (massDiff > 4) {
            // Other snake is smaller -> other dies!
            this.killSnake(other, snake.name, snake);
            if (!snake.isDead) {
              snake.kills += 1;
              if (snake.isPlayer) {
                this.stats.kills += 1;
                sound.playKill();
                this.triggerKillBanner(`CRUSHED ${other.name}! +${Math.floor(other.score)} MASS`);
                this.addFloatingText(`CRUSHED! +${Math.floor(other.score)}`, other.head.x, other.head.y - 40, '#00f0ff', 1.4);
              }
            }
          } else {
            // Virtually identical mass: mutual explosion
            this.killSnake(snake, other.name, other);
            this.killSnake(other, snake.name, snake);
            break;
          }
        }
      }

      if (snake.isDead) continue;

      // 3. Head-to-Body Collision with other snakes (airtight continuous capsule physics)
      this.bodyQueryList.length = 0;
      const midX = (prevHx + hx) * 0.5;
      const midY = (prevHy + hy) * 0.5;
      const stepDist = Math.hypot(hx - prevHx, hy - prevHy);
      const queryRange = snake.radius + MAX_RADIUS + stepDist * 0.5 + 25;
      this.bodyGrid.queryInto(midX, midY, queryRange, this.bodyQueryList);

      for (let i = 0; i < this.bodyQueryList.length; i++) {
        const seg = this.bodyQueryList[i] as unknown as BodySegmentItem;
        if (seg.snakeId === snake.id) continue; // Cannot hit own body!

        const killer = seg.ownerSnake || this.snakes.find((s) => s.id === seg.snakeId);
        // Don't collide with dead snakes
        if (!killer || killer.isDead) continue;

        const segIdx = seg.segmentIndex !== undefined ? seg.segmentIndex : -1;
        const prevSeg = (segIdx >= 1 && killer.body && killer.body[segIdx - 1]) ? killer.body[segIdx - 1] : null;

        const s1x = prevSeg ? prevSeg.x : seg.x;
        const s1y = prevSeg ? prevSeg.y : seg.y;
        const s1r = prevSeg ? prevSeg.radius : seg.radius;
        const s2x = seg.x;
        const s2y = seg.y;
        const s2r = seg.radius;

        const hasCollided = this.testSegmentCapsuleCollision(
          prevHx, prevHy, hx, hy, snake.radius,
          s1x, s1y, s2x, s2y, s1r, s2r
        );

        if (hasCollided) {
          this.killSnake(snake, killer ? killer.name : 'Unknown', killer);
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

  public killSnake(snake: Snake, killerName: string, killerSnake?: Snake | null): void {
    if (snake.isDead) return;
    snake.isDead = true;

    if (this.onSnakeKilled) {
      this.onSnakeKilled(snake, killerSnake ?? null, killerName);
    }

    // Add to room kill feed (visible to all players in arena)
    if (killerName && killerName !== 'Arena Barrier') {
      const killerCol = killerSnake?.skin?.colors[0] || (killerSnake?.isPlayer ? '#00f0ff' : '#ffd700');
      const victimCol = snake.skin?.colors[0] || (snake.isPlayer ? '#00f0ff' : '#ff4466');

      this.killFeed.unshift({
        id: this.nextTextId++,
        killerName: killerSnake ? killerSnake.name : killerName,
        killerColor: killerCol,
        victimName: snake.name,
        victimColor: victimCol,
        timer: 240, // ~4 seconds at 60 FPS
        isPlayerKiller: killerSnake?.isPlayer,
        isPlayerVictim: snake.isPlayer,
      });

      if (this.killFeed.length > 5) {
        this.killFeed.pop();
      }
    }

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
      sound.setBoosting(false);
      this.isMouseDown = false;
      this.isSpaceDown = false;
      this.isShiftDown = false;
      this.resetKeyboardKeys();
      // Smoothly widen camera perspective slightly for dramatic spectator view of the aftermath
      this.camera.baseZoom = Math.max(0.52, this.camera.baseZoom * 0.85);
      if (this.onGameOverCallback) {
        this.onGameOverCallback(this.stats);
      }
    }
  }

  private updateOrbs(): void {
    const maxOrbDist = ARENA_RADIUS - 70;
    const maxOrbDistSq = maxOrbDist * maxOrbDist;
    const preyBoundaryDist = ARENA_RADIUS - 350;
    const preyBoundaryDistSq = preyBoundaryDist * preyBoundaryDist;

    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const orb = this.orbs[i];
      orb.pulsePhase += (orb.pulseSpeed || 0.04);

      if (orb.isPrey) {
        this.foodGrid.remove(orb as Orb & GridItem, orb.gridKey);

        // Flee sprint from nearby snake heads (squared dist = zero Math.hypot)
        let fleeingFromSnake = false;
        for (let s = 0; s < this.snakes.length; s++) {
          const snake = this.snakes[s];
          if (snake.isDead) continue;
          const odx = snake.head.x - orb.x;
          const ody = snake.head.y - orb.y;
          if (odx * odx + ody * ody < 27225) { // 165 * 165
            const baseFleeAngle = Math.atan2(-ody, -odx);
            orb.preyAngle = baseFleeAngle + Math.sin(this.gameTime * 0.2) * 0.3;
            orb.preySpeed = 4.7; // Easily catchable with boost (6.4 speed)
            fleeingFromSnake = true;
            break;
          }
        }

        if (!fleeingFromSnake) {
          // Relax back to gentle wander speed
          orb.preyAngle = (orb.preyAngle || 0) + (Math.random() - 0.5) * 0.25;
          orb.preySpeed = (orb.preySpeed || 2.6) + (2.6 - (orb.preySpeed || 2.6)) * 0.08;
        }

        orb.x += Math.cos(orb.preyAngle!) * orb.preySpeed!;
        orb.y += Math.sin(orb.preyAngle!) * orb.preySpeed!;

        // Steer back inside if approaching boundary
        if (orb.x * orb.x + orb.y * orb.y > preyBoundaryDistSq) {
          orb.preyAngle = Math.atan2(-orb.y, -orb.x);
        }

        orb.gridKey = this.foodGrid.insert(orb as Orb & GridItem);
      }

      // Hard clamp so no orb can ever be outside the red circle
      const distSq = orb.x * orb.x + orb.y * orb.y;
      if (distSq > maxOrbDistSq) {
        const dist = Math.sqrt(distSq);
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
        const last = this.particles.pop()!;
        if (i < this.particles.length) {
          this.particles[i] = last;
        }
      }
    }
  }

  private updateFloatingText(): void {
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const t = this.floatingTexts[i];
      t.y -= 1.2;
      t.alpha -= 0.02;
      if (t.alpha <= 0) {
        const last = this.floatingTexts.pop()!;
        if (i < this.floatingTexts.length) {
          this.floatingTexts[i] = last;
        }
      }
    }

    if (this.killBanner) {
      this.killBanner.timer -= 1;
      if (this.killBanner.timer <= 0) {
        this.killBanner = null;
      }
    }

    // Decrement kill feed timers
    for (let i = this.killFeed.length - 1; i >= 0; i--) {
      this.killFeed[i].timer -= 1;
      if (this.killFeed[i].timer <= 0) {
        this.killFeed.splice(i, 1);
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
    this.sortedSnakes.length = 0;
    for (let i = 0; i < this.snakes.length; i++) {
      const s = this.snakes[i];
      if (!s.isDead) this.sortedSnakes.push(s);
    }
    this.sortedSnakes.sort((a, b) => b.score - a.score);

    const topCount = Math.min(10, this.sortedSnakes.length);
    this.leaderboard.length = 0;
    for (let i = 0; i < topCount; i++) {
      const s = this.sortedSnakes[i];
      this.leaderboard.push({
        id: s.id,
        name: s.name,
        score: Math.floor(s.score),
        isPlayer: s.isPlayer,
        color: s.skin.colors[0],
      });
    }

    if (this.player && !this.player.isDead) {
      const playerRank = this.sortedSnakes.findIndex((s) => s.id === this.player?.id) + 1;
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
    const halfW = this.viewport.width / (2 * this.camera.zoom);
    const halfH = this.viewport.height / (2 * this.camera.zoom);
    const maxScreenRadius = Math.sqrt(halfW * halfW + halfH * halfH);

    // Frustum culling: Skip expensive 62,800px boundary rasterization if completely off-screen
    const camDist = Math.sqrt(this.camera.x * this.camera.x + this.camera.y * this.camera.y);
    if (Math.abs(camDist - ARENA_RADIUS) > maxScreenRadius + 30) {
      return;
    }

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

    this.visibleOrbsList.length = 0;
    this.foodGrid.queryRectInto(viewLeft, viewRight, viewTop, viewBottom, this.visibleOrbsList);

    const hasSprites = this.orbSprites.length > 0;
    const count = this.visibleOrbsList.length;

    for (let i = 0; i < count; i++) {
      const orb = this.visibleOrbsList[i] as unknown as Orb;
      const pulse = 1 + Math.sin(orb.pulsePhase) * 0.12;
      const r = orb.radius * pulse;

      if (hasSprites) {
        if (orb.isPrey && this.preySprite) {
          ctx.drawImage(this.preySprite, orb.x - r * 1.5, orb.y - r * 1.5, r * 3, r * 3);
        } else if (orb.colorIndex === -1) {
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
        ctx.beginPath();
        ctx.arc(orb.x, orb.y, r, 0, Math.PI * 2);
        ctx.fillStyle = orb.color;
        ctx.fill();
      }
    }
  }

  private drawParticles(ctx: CanvasRenderingContext2D): void {
    const halfW = (this.viewport.width / (2 * this.camera.zoom)) + 40;
    const halfH = (this.viewport.height / (2 * this.camera.zoom)) + 40;
    const viewLeft = this.camera.x - halfW;
    const viewRight = this.camera.x + halfW;
    const viewTop = this.camera.y - halfH;
    const viewBottom = this.camera.y + halfH;

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.x < viewLeft || p.x > viewRight || p.y < viewTop || p.y > viewBottom) continue;

      ctx.globalAlpha = p.alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 - p.life / p.maxLife), 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;
  }

  private drawSnakes(ctx: CanvasRenderingContext2D): void {
    const halfW = (this.viewport.width / (2 * this.camera.zoom)) + 200;
    const halfH = (this.viewport.height / (2 * this.camera.zoom)) + 200;
    const viewLeft = this.camera.x - halfW;
    const viewRight = this.camera.x + halfW;
    const viewTop = this.camera.y - halfH;
    const viewBottom = this.camera.y + halfH;

    this.sortedSnakes.length = 0;
    for (let i = 0; i < this.snakes.length; i++) {
      const s = this.snakes[i];
      if (!s.isDead) this.sortedSnakes.push(s);
    }
    this.sortedSnakes.sort((a, b) => a.score - b.score);

    for (let sIdx = 0; sIdx < this.sortedSnakes.length; sIdx++) {
      const snake = this.sortedSnakes[sIdx];
      // Frustum culling: Skip snakes completely outside screen
      if (
        (snake.head.x < viewLeft && snake.body[snake.body.length - 1].x < viewLeft) ||
        (snake.head.x > viewRight && snake.body[snake.body.length - 1].x > viewRight) ||
        (snake.head.y < viewTop && snake.body[snake.body.length - 1].y < viewTop) ||
        (snake.head.y > viewBottom && snake.body[snake.body.length - 1].y > viewBottom)
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
    const head = snake.head;

    ctx.save();

    // 1. If Boosting / Accelerating: Draw multi-layer pulsating glow aura
    const speedRatio = Math.max(0, Math.min(1, (snake.speed - snake.baseSpeed) / (snake.boostSpeed - snake.baseSpeed)));
    const boostIntensity = snake.isBoosting ? Math.max(0.7, speedRatio) : speedRatio;

    if (boostIntensity > 0.08) {
      const pulseSpeed = 0.32;
      const hash = (snake.id.charCodeAt(0) || 0) * 0.7;
      const pulse = 0.5 + 0.5 * Math.sin(this.gameTime * pulseSpeed + hash);
      const harmonicPulse = 0.5 + 0.5 * Math.sin(this.gameTime * pulseSpeed * 2.1 + hash);

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(snake.body[0].x, snake.body[0].y);
      for (let i = 1; i < bodyLen; i += 2) {
        ctx.lineTo(snake.body[i].x, snake.body[i].y);
      }
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // 1a. Outer expansive pulsating glow aura
      ctx.lineWidth = snake.radius * (2.6 + pulse * 1.3) * boostIntensity;
      ctx.strokeStyle = skin.glowColor || skin.particleColor;
      ctx.globalAlpha = (0.2 + pulse * 0.25) * boostIntensity;
      ctx.stroke();

      // 1b. Inner radiant high-energy corona
      ctx.lineWidth = snake.radius * (2.0 + harmonicPulse * 0.5) * boostIntensity;
      ctx.strokeStyle = skin.particleColor;
      ctx.globalAlpha = (0.35 + pulse * 0.3) * boostIntensity;
      ctx.stroke();

      // 1c. Head leading energy halo
      ctx.beginPath();
      ctx.arc(head.x, head.y, snake.radius * (1.3 + pulse * 0.45) * boostIntensity, 0, Math.PI * 2);
      ctx.fillStyle = skin.particleColor;
      ctx.globalAlpha = (0.28 + pulse * 0.32) * boostIntensity;
      ctx.fill();

      ctx.restore();
    }

    const isZoomedOut = this.camera.zoom < 0.68;
    const camDx = head.x - this.camera.x;
    const camDy = head.y - this.camera.y;
    const isNearCamera = snake.isPlayer || snake.isRemoteHuman || (camDx * camDx + camDy * camDy < 490000);

    // 2. Base Smooth Continuous Body Stroke (ultra-smooth liquid spine with LOD step)
    const spineStep = isZoomedOut && !isNearCamera ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(snake.body[bodyLen - 1].x, snake.body[bodyLen - 1].y);
    for (let i = bodyLen - 2; i >= 0; i -= spineStep) {
      ctx.lineTo(snake.body[i].x, snake.body[i].y);
    }
    ctx.lineWidth = snake.radius * 1.9;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = skin.colors[0];
    ctx.stroke();

    // 3. Draw Decorative Segment Discs (LOD: when zoomed out, skip for distant snakes to save 2,500 draw calls)
    if (!isZoomedOut || isNearCamera) {
      const drawStep = Math.max(1, Math.floor(snake.radius * (isZoomedOut ? 0.6 : 0.28)));
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

        if (!isZoomedOut) {
          // Specular 3D highlight
          ctx.beginPath();
          ctx.arc(seg.x - seg.radius * 0.15, seg.y - seg.radius * 0.15, seg.radius * 0.55, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
          ctx.fill();
        }
      }
    }

    // 4. Draw Snake Head
    ctx.beginPath();
    ctx.arc(head.x, head.y, snake.radius * 1.15, 0, Math.PI * 2);
    ctx.fillStyle = skin.headColor;
    ctx.fill();

    // 5. Draw Eyes (LOD: skip for distant bots when zoomed out to save 200 circle paths)
    if (!isZoomedOut || isNearCamera) {
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
    }

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

    // 7. Draw Name Tag and Score (LOD: skip for distant bots when zoomed out to avoid heavy font overhead)
    if (!isZoomedOut || isNearCamera || isTopLeader) {
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
    }

    // 8. Draw Spawn Protection Shield
    if (snake.invulnerableTimer > 0) {
      const shieldPulse = 0.5 + Math.sin(this.gameTime * 0.25) * 0.35;
      ctx.beginPath();
      ctx.arc(head.x, head.y, snake.radius * 1.6, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(0, 240, 255, ${shieldPulse})`;
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(head.x, head.y, snake.radius * 1.6, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 240, 255, ${shieldPulse * 0.15})`;
      ctx.fill();
    }

    // 9. Draw In-Game Chat Speech Bubble
    if (snake.chatMessage && snake.chatTimer && snake.chatTimer > 0) {
      this.drawChatBubble(ctx, snake, isTopLeader);
    }

    ctx.restore();
  }

  private drawChatBubble(ctx: CanvasRenderingContext2D, snake: Snake, isTopLeader: boolean): void {
    const text = snake.chatMessage;
    if (!text) return;
    const displayText = text.length > 38 ? text.slice(0, 36) + '…' : text;

    const head = snake.head;
    const alpha = snake.chatTimer && snake.chatTimer < 30 ? snake.chatTimer / 30 : 1.0;

    const fontSize = Math.max(12, Math.min(15, snake.radius * 0.72));
    ctx.font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`;
    const textMetrics = ctx.measureText(displayText);

    const padX = 10;
    const padY = 5;
    const bubbleW = Math.max(50, textMetrics.width + padX * 2);
    const bubbleH = fontSize + padY * 2;

    const nameTagOffset = snake.radius * 1.5 + (isTopLeader ? 24 : 10) + fontSize;
    const bubbleY = head.y - nameTagOffset - bubbleH;
    const bubbleX = head.x - bubbleW / 2;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Background bubble with glow
    ctx.fillStyle = 'rgba(6, 7, 12, 0.92)';
    if (snake.isPlayer) {
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.85)';
      ctx.shadowColor = 'rgba(0, 240, 255, 0.4)';
      ctx.shadowBlur = 8;
    } else if (snake.isRemoteHuman) {
      ctx.strokeStyle = 'rgba(255, 0, 170, 0.85)';
      ctx.shadowColor = 'rgba(255, 0, 170, 0.4)';
      ctx.shadowBlur = 8;
    } else {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.shadowColor = 'rgba(255, 255, 255, 0.2)';
      ctx.shadowBlur = 6;
    }
    ctx.lineWidth = 1.5;

    // Rounded rectangle bubble
    const r = 8;
    ctx.beginPath();
    ctx.moveTo(bubbleX + r, bubbleY);
    ctx.lineTo(bubbleX + bubbleW - r, bubbleY);
    ctx.quadraticCurveTo(bubbleX + bubbleW, bubbleY, bubbleX + bubbleW, bubbleY + r);
    ctx.lineTo(bubbleX + bubbleW, bubbleY + bubbleH - r);
    ctx.quadraticCurveTo(bubbleX + bubbleW, bubbleY + bubbleH, bubbleX + bubbleW - r, bubbleY + bubbleH);

    // Downward arrow pointer to head
    const midX = head.x;
    ctx.lineTo(midX + 5, bubbleY + bubbleH);
    ctx.lineTo(midX, bubbleY + bubbleH + 6);
    ctx.lineTo(midX - 5, bubbleY + bubbleH);

    ctx.lineTo(bubbleX + r, bubbleY + bubbleH);
    ctx.quadraticCurveTo(bubbleX, bubbleY + bubbleH, bubbleX, bubbleY + bubbleH - r);
    ctx.lineTo(bubbleX, bubbleY + r);
    ctx.quadraticCurveTo(bubbleX, bubbleY, bubbleX + r, bubbleY);
    ctx.closePath();

    ctx.fill();
    ctx.stroke();

    // Reset shadow for text clarity
    ctx.shadowBlur = 0;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(displayText, head.x, bubbleY + bubbleH / 2);

    ctx.restore();
  }

  private drawFloatingTexts(ctx: CanvasRenderingContext2D): void {
    const halfW = (this.viewport.width / (2 * this.camera.zoom)) + 60;
    const halfH = (this.viewport.height / (2 * this.camera.zoom)) + 60;
    const viewLeft = this.camera.x - halfW;
    const viewRight = this.camera.x + halfW;
    const viewTop = this.camera.y - halfH;
    const viewBottom = this.camera.y + halfH;

    ctx.textAlign = 'center';
    let lastScale = -1;

    for (let i = 0; i < this.floatingTexts.length; i++) {
      const t = this.floatingTexts[i];
      if (t.x < viewLeft || t.x > viewRight || t.y < viewTop || t.y > viewBottom) continue;

      ctx.globalAlpha = Math.max(0, t.alpha);
      if (t.scale !== lastScale) {
        ctx.font = `bold ${Math.round(20 * t.scale)}px sans-serif`;
        lastScale = t.scale;
      }
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1.0;
  }
}
