export interface Point {
  x: number;
  y: number;
}

export interface Segment {
  x: number;
  y: number;
  radius: number;
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
  skin: SnakeSkin;
  head: Point;
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
  aiTimer?: number;
  aiState?: 'wander' | 'eat' | 'attack' | 'flee';
  aiTarget?: Point | null;
}

export interface Orb {
  id: number;
  x: number;
  y: number;
  radius: number;
  color: string;
  glowColor: string;
  value: number;
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
