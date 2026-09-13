import { SlitherGameClient } from '@/components/game/GameClientWrapper';

export default function Home() {
  return (
    <main className="w-screen h-screen overflow-hidden bg-[#06070c]">
      <SlitherGameClient />
    </main>
  );
}
