export interface Point {
  x: number;
  y: number;
}

export interface Segment {
  id?: string | number;
  x: number;
  y: number;
  radius: number;
  snakeId?: string;
  segmentIndex?: number;
  ownerSnake?: Snake;
}

export interface SnakeSkin {
  id: string;
  name: string;
  colors: string[];
  headColor: string;
  eyeColor: string;
  glowColor: string;
  pattern: 'stripes' | 'gradient' | 'segmented' | 'pulse';
  particleColor: string;
}

export interface Snake {
  id: string;
  name: string;
  isPlayer: boolean;
  isRemoteHuman?: boolean;
  skin: SnakeSkin;
  head: Point;
  prevHead?: Point;
  angle: number;
  targetAngle: number;
  speed: number;
  baseSpeed: number;
  boostSpeed: number;
  isBoosting: boolean;
  body: Segment[];
  targetLength: number;
  radius: number;
  score: number;
  kills: number;
  isDead: boolean;
  boostFuel: number; // Gradual mass consumption
  turnSpeed: number;
  trailTime: number;
  invulnerableTimer: number; // Spawn shield countdown (in frames)
  spawnTimestamp: number;
  aiTimer?: number;
  aiState?: 'wander' | 'eat' | 'attack' | 'flee';
  aiTarget?: Point | null;
  chatMessage?: string;
  chatTimer?: number;
  policyId?: string;
  aiArchetype?: string;
  trailX?: Float32Array;
  trailY?: Float32Array;
  trailHeadIdx?: number;
  trailDistAcc?: number;
}

export interface KillFeedItem {
  id: number;
  killerName: string;
  killerColor: string;
  victimName: string;
  victimColor: string;
  timer: number;
  isPlayerKiller?: boolean;
  isPlayerVictim?: boolean;
}

export interface Orb {
  id: number;
  x: number;
  y: number;
  radius: number;
  color: string;
  glowColor: string;
  colorIndex: number;
  value: number;
  gridKey?: number;
  arrayIndex?: number;
  radiance?: number; // Halo radiance factor (0.6 - 1.6)
  pulseSpeed?: number; // Individual shimmer speed
  vx?: number;
  vy?: number;
  isPrey?: boolean; // Wandering fleeing firefly
  preyAngle?: number;
  preySpeed?: number;
  pulsePhase: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  alpha: number;
  life: number;
  maxLife: number;
}

export interface FloatingText {
  id: number;
  text: string;
  x: number;
  y: number;
  color: string;
  alpha: number;
  scale: number;
}

export interface LeaderboardEntry {
  id: string;
  name: string;
  score: number;
  isPlayer: boolean;
  color: string;
}

export interface GameStats {
  score: number;
  length: number;
  kills: number;
  timeAlive: number;
  foodEaten: number;
  maxRank: number;
  killerName?: string;
}

export interface PlayerPresence {
  id: string;
  name: string;
  skinId: string;
  head: Point;
  angle: number;
  speed: number;
  radius: number;
  score: number;
  kills: number;
  isBoosting: boolean;
  isDead: boolean;
  spawnTimestamp: number;
  body: { x: number; y: number; radius: number }[];
  updatedAt: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
  isPlayer?: boolean;
}

export interface KeyboardState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

