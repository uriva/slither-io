import { SnakeSkin } from './types';

export const ARENA_RADIUS = 5500;
export const INITIAL_SNAKE_LENGTH = 16;
export const BASE_RADIUS = 13;
export const MAX_RADIUS = 42;
export const BASE_SPEED = 4.2;
export const BOOST_SPEED = 8.5;
export const TURN_SPEED = 0.085;
export const BOOST_TURN_SPEED = 0.11;
export const SEGMENT_SPACING = 8;
export const INITIAL_FOOD_COUNT = 3000;
export const MAX_FOOD_COUNT = 4500;
export const PREY_COUNT = 25;
export const BOT_COUNT = 40;

export const SKINS: SnakeSkin[] = [
  {
    id: 'void-dragon',
    name: 'Void Dragon',
    colors: ['#00f0ff', '#0099ff', '#0044ff', '#1a0066', '#00f0ff'],
    headColor: '#00f0ff',
    eyeColor: '#ffffff',
    glowColor: 'rgba(0, 240, 255, 0.4)',
    pattern: 'gradient',
    particleColor: '#00f0ff',
  },
  {
    id: 'solar-flare',
    name: 'Solar Flare',
    colors: ['#ffaa00', '#ff5500', '#ff2200', '#ffcc00', '#ff3300'],
    headColor: '#ffdd00',
    eyeColor: '#ffffff',
    glowColor: 'rgba(255, 120, 0, 0.4)',
    pattern: 'segmented',
    particleColor: '#ff9900',
  },
  {
    id: 'toxic-basilisk',
    name: 'Toxic Basilisk',
    colors: ['#00ff66', '#00cc44', '#118833', '#88ff00', '#00ff88'],
    headColor: '#22ff66',
    eyeColor: '#000000',
    glowColor: 'rgba(0, 255, 102, 0.4)',
    pattern: 'stripes',
    particleColor: '#39ff14',
  },
  {
    id: 'synthwave-sunset',
    name: 'Synthwave Sunset',
    colors: ['#ff007f', '#aa00ff', '#00f0ff', '#ff007f', '#7700ff'],
    headColor: '#ff0099',
    eyeColor: '#00ffff',
    glowColor: 'rgba(255, 0, 128, 0.4)',
    pattern: 'pulse',
    particleColor: '#ff00aa',
  },
  {
    id: 'rainbow-prism',
    name: 'Rainbow Prism',
    colors: ['#ff0000', '#ff7700', '#ffff00', '#00ff00', '#00ffff', '#0022ff', '#9900ff'],
    headColor: '#ff0055',
    eyeColor: '#ffffff',
    glowColor: 'rgba(255, 255, 255, 0.4)',
    pattern: 'segmented',
    particleColor: '#ffff00',
  },
  {
    id: 'frostbite',
    name: 'Frostbite Glitch',
    colors: ['#e0f7ff', '#80deea', '#00b0ff', '#00e5ff', '#ffffff'],
    headColor: '#ffffff',
    eyeColor: '#00e5ff',
    glowColor: 'rgba(128, 222, 234, 0.4)',
    pattern: 'gradient',
    particleColor: '#80deea',
  },
  {
    id: 'imperial-gold',
    name: 'Imperial Gold',
    colors: ['#ffd700', '#ffb700', '#b8860b', '#2a2000', '#ffd700'],
    headColor: '#ffe555',
    eyeColor: '#1a1a1a',
    glowColor: 'rgba(255, 215, 0, 0.4)',
    pattern: 'stripes',
    particleColor: '#ffd700',
  },
  {
    id: 'blood-moon',
    name: 'Blood Moon',
    colors: ['#ff1144', '#b3002d', '#66001a', '#ff3366', '#990026'],
    headColor: '#ff2255',
    eyeColor: '#ffe6ea',
    glowColor: 'rgba(255, 17, 68, 0.4)',
    pattern: 'segmented',
    particleColor: '#ff1144',
  }
];

export const BOT_NAMES = [
  'Viperion', 'ApexPredator', 'NeonGhost', 'NebulaKing',
  'Hyperion', 'ZeroGravity', 'ShadowCoil', 'GlitchWorm',
  'Solaris', 'QuantumFlux', 'TitanSnake', 'Velociraptor',
  'AuraMaster', 'CyberStrike', 'Ouroboros', 'AbyssWalker',
  'Nightshade', 'Chronos', 'ThunderTail', 'VenomByte',
  'Spectralis', 'HydraNine', 'Vortex', 'Krypton',
  'BlazeRunner', 'EchoReaper', 'Zenith', 'Phantom',
  'CosmoDrifter', 'NovaBurst', 'Striker', 'Leviathan',
  'NebulaBeast', 'DarkMatter', 'Pulsar', 'Eclipse',
  'VoidReaper', 'IonCannon', 'GalacticWorm', 'Supernova'
];

export const FOOD_COLORS = [
  { color: '#00f0ff', glow: 'rgba(0, 240, 255, 0.4)' },
  { color: '#ff0077', glow: 'rgba(255, 0, 119, 0.4)' },
  { color: '#00ff66', glow: 'rgba(0, 255, 102, 0.4)' },
  { color: '#ffff00', glow: 'rgba(255, 255, 0, 0.4)' },
  { color: '#bf00ff', glow: 'rgba(191, 0, 255, 0.4)' },
  { color: '#ff6600', glow: 'rgba(255, 102, 0, 0.4)' },
  { color: '#00ffff', glow: 'rgba(0, 255, 255, 0.4)' },
  { color: '#ff00ff', glow: 'rgba(255, 0, 255, 0.4)' },
];
