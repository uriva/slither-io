'use client';

import dynamic from 'next/dynamic';

export const SlitherGameClient = dynamic(
  () => import('./SlitherGame').then((mod) => mod.SlitherGame),
  { ssr: false }
);
