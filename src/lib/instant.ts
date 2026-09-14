import { init } from '@instantdb/react';

export const APP_ID =
  process.env.NEXT_PUBLIC_INSTANT_APP_ID || '713a22f4-b2eb-49b3-af20-be684e990963';
export const API_URI =
  process.env.NEXT_PUBLIC_INSTANT_API_URI || 'https://api.instantdb.uriv.me';
export const WS_URI =
  process.env.NEXT_PUBLIC_INSTANT_WS_URI || 'wss://api.instantdb.uriv.me/runtime/session';

export const db = init({
  appId: APP_ID,
  apiURI: API_URI,
  websocketURI: WS_URI,
});

export const SECTORS = [
  'sector-alpha-v3',
  'sector-beta-v3',
  'sector-gamma-v3',
  'sector-delta-v3',
  'sector-omega-v3',
];

export const MAX_PLAYERS_PER_ROOM = 10;

export const getArenaRoom = (roomId: string = 'sector-alpha-v3') => {
  return db.room('arena', roomId);
};

export const arenaRoom = getArenaRoom('sector-alpha-v3');
