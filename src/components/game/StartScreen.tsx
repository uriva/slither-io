'use client';

import React, { useState, useEffect, useRef } from 'react';
import { SKINS, BOT_NAMES } from '@/game/constants';
import { SnakeSkin } from '@/game/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Play, Sparkles, Volume2, VolumeX, Shield, Trophy, Zap, ChevronLeft, ChevronRight } from 'lucide-react';
import { sound } from '@/game/audio';

interface StartScreenProps {
  onPlay: (playerName: string, skinId: string) => void;
  highScore: number;
  onlineCount?: number;
}

export const StartScreen: React.FC<StartScreenProps> = ({ onPlay, highScore, onlineCount }) => {
  const [playerName, setPlayerName] = useState('QuantumViper');
  const [selectedSkinIndex, setSelectedSkinIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(sound.getMuted());
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const currentSkin: SnakeSkin = SKINS[selectedSkinIndex];

  // Random nickname generator
  const generateRandomName = () => {
    const prefixes = ['Hyper', 'Cyber', 'Neon', 'Cosmic', 'Solar', 'Quantum', 'Shadow', 'Apex', 'Vortex', 'Glitch'];
    const roots = ['Viper', 'Drake', 'Serpent', 'Titan', 'Ghost', 'Strike', 'Hydra', 'Basilisk', 'Reaper', 'Spectre'];
    const p = prefixes[Math.floor(Math.random() * prefixes.length)];
    const r = roots[Math.floor(Math.random() * roots.length)];
    const num = Math.floor(Math.random() * 90 + 10);
    setPlayerName(`${p}${r}${num}`);
  };

  // Interactive Live Snake Avatar preview on canvas
  useEffect(() => {
    let animId: number;
    let t = 0;
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const segCount = 24;
    const segments: { x: number; y: number }[] = [];

    for (let i = 0; i < segCount; i++) {
      segments.push({ x: width / 2 - i * 9, y: height / 2 });
    }

    const renderPreview = () => {
      t += 0.04;
      ctx.clearRect(0, 0, width, height);

      // Figure-8 / sinusoidal playful slither loop
      const headX = width / 2 + Math.cos(t) * 90;
      const headY = height / 2 + Math.sin(t * 2) * 35;
      const headAngle = Math.atan2(
        Math.cos(t * 2) * 70,
        -Math.sin(t) * 90
      );

      segments[0] = { x: headX, y: headY };
      const spacing = 8.5;

      for (let i = 1; i < segCount; i++) {
        const prev = segments[i - 1];
        const curr = segments[i];
        const dx = prev.x - curr.x;
        const dy = prev.y - curr.y;
        const d = Math.hypot(dx, dy);
        if (d > spacing) {
          curr.x += (dx / d) * (d - spacing);
          curr.y += (dy / d) * (d - spacing);
        }
      }

      // Draw segments from tail to head
      for (let i = segCount - 1; i >= 1; i--) {
        const seg = segments[i];
        const radius = Math.max(7, 14 * (1 - (i / segCount) * 0.4));

        let segColor = currentSkin.colors[0];
        if (currentSkin.pattern === 'stripes') {
          segColor = currentSkin.colors[i % currentSkin.colors.length];
        } else if (currentSkin.pattern === 'gradient') {
          const colorIdx = Math.floor((i / segCount) * currentSkin.colors.length) % currentSkin.colors.length;
          segColor = currentSkin.colors[colorIdx];
        } else if (currentSkin.pattern === 'segmented') {
          segColor = Math.floor(i / 3) % 2 === 0 ? currentSkin.colors[0] : currentSkin.colors[1] || currentSkin.colors[0];
        } else if (currentSkin.pattern === 'pulse') {
          const p = Math.floor((i + t * 4) % currentSkin.colors.length);
          segColor = currentSkin.colors[p];
        }

        ctx.beginPath();
        ctx.arc(seg.x, seg.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = segColor;
        ctx.shadowColor = currentSkin.particleColor;
        ctx.shadowBlur = 10;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(seg.x - radius * 0.2, seg.y - radius * 0.2, radius * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.fill();
      }

      // Head
      ctx.beginPath();
      ctx.arc(headX, headY, 15, 0, Math.PI * 2);
      ctx.fillStyle = currentSkin.headColor;
      ctx.shadowColor = currentSkin.glowColor;
      ctx.shadowBlur = 18;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Eyes
      const eyeOffset = 6.5;
      const eyeR = 4.5;
      const perp = headAngle + Math.PI / 2;

      const lx = headX + Math.cos(headAngle) * 5 + Math.cos(perp) * eyeOffset;
      const ly = headY + Math.sin(headAngle) * 5 + Math.sin(perp) * eyeOffset;
      const rx = headX + Math.cos(headAngle) * 5 - Math.cos(perp) * eyeOffset;
      const ry = headY + Math.sin(headAngle) * 5 - Math.sin(perp) * eyeOffset;

      ctx.beginPath();
      ctx.arc(lx, ly, eyeR, 0, Math.PI * 2);
      ctx.arc(rx, ry, eyeR, 0, Math.PI * 2);
      ctx.fillStyle = currentSkin.eyeColor;
      ctx.fill();

      // Pupils
      const plx = lx + Math.cos(headAngle) * 2;
      const ply = ly + Math.sin(headAngle) * 2;
      const prx = rx + Math.cos(headAngle) * 2;
      const pry = ry + Math.sin(headAngle) * 2;

      ctx.beginPath();
      ctx.arc(plx, ply, 2.2, 0, Math.PI * 2);
      ctx.arc(prx, pry, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = '#06070c';
      ctx.fill();

      animId = requestAnimationFrame(renderPreview);
    };

    animId = requestAnimationFrame(renderPreview);
    return () => cancelAnimationFrame(animId);
  }, [currentSkin]);

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    sound.init();
    onPlay(playerName, currentSkin.id);
  };

  const nextSkin = () => {
    setSelectedSkinIndex((prev) => (prev + 1) % SKINS.length);
  };

  const prevSkin = () => {
    setSelectedSkinIndex((prev) => (prev - 1 + SKINS.length) % SKINS.length);
  };

  return (
    <div className="absolute inset-0 z-20 w-full h-full flex items-center justify-center p-4 bg-[#06070c]/95 backdrop-blur-md overflow-hidden select-none">
      {/* Dynamic Background glow rings */}
      <div className="absolute w-[600px] h-[600px] rounded-full bg-cyan-500/10 blur-[120px] pointer-events-none -top-40 -left-40" />
      <div className="absolute w-[600px] h-[600px] rounded-full bg-purple-500/10 blur-[120px] pointer-events-none -bottom-40 -right-40" />

      {/* Grid Pattern */}
      <div
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)`,
          backgroundSize: '80px 80px',
        }}
      />

      <div className="relative z-10 w-full max-w-md flex flex-col items-center gap-6 animate-in fade-in zoom-in-95 duration-500">
        {/* Logo and Brand */}
        <div className="flex flex-col items-center text-center gap-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-mono tracking-widest uppercase">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Shared Live Arena &bull; {onlineCount || 1} Online</span>
          </div>

          <h1 className="text-5xl md:text-6xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-cyan-300 via-teal-200 to-indigo-400 drop-shadow-[0_0_35px_rgba(0,240,255,0.4)] uppercase">
            SLITHER<span className="text-cyan-400">.IO</span>
          </h1>
          <p className="text-sm text-slate-400 font-sans tracking-wide">
            Eat luminous orbs, encircle rival serpents, dominate the arena.
          </p>
        </div>

        {/* Live Animated Snake Preview */}
        <div className="relative flex flex-col items-center justify-center">
          <div className="relative rounded-2xl bg-slate-900/60 border border-white/10 p-2 shadow-2xl backdrop-blur-md">
            <canvas
              ref={previewCanvasRef}
              width={280}
              height={120}
              className="rounded-xl block"
            />
          </div>

          {/* Skin Selector Carousel Buttons */}
          <div className="flex items-center justify-between w-full max-w-[280px] mt-3 px-1">
            <button
              onClick={prevSkin}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex flex-col items-center">
              <span className="text-xs font-mono font-bold text-white tracking-wider uppercase">
                {currentSkin.name}
              </span>
              <div className="flex gap-1 mt-1">
                {currentSkin.colors.slice(0, 4).map((c, i) => (
                  <span
                    key={i}
                    className="w-2.5 h-2.5 rounded-full border border-white/20"
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <button
              onClick={nextSkin}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Input Form Card */}
        <Card className="w-full bg-slate-950/70 border-white/10 backdrop-blur-xl p-5 shadow-2xl flex flex-col gap-4">
          <form onSubmit={handleStart} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-center text-xs font-mono text-slate-400">
                <label htmlFor="nickname" className="flex items-center gap-1 text-cyan-300">
                  <Shield className="w-3.5 h-3.5" /> Serpent Moniker
                </label>
                <button
                  type="button"
                  onClick={generateRandomName}
                  className="text-[11px] text-cyan-400 hover:text-cyan-300 hover:underline flex items-center gap-1"
                >
                  <Sparkles className="w-3 h-3" /> Random
                </button>
              </div>

              <input
                id="nickname"
                type="text"
                maxLength={18}
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="Enter snake name..."
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 font-mono text-sm focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 transition-all"
              />
            </div>

            {/* Play Button */}
            <Button
              type="submit"
              onClick={() => {
                sound.init();
                onPlay(playerName, currentSkin.id);
              }}
              size="lg"
              className="w-full h-12 bg-gradient-to-r from-cyan-500 hover:from-cyan-400 to-blue-600 hover:to-blue-500 text-slate-950 font-mono font-black text-base tracking-wider uppercase shadow-[0_0_25px_rgba(0,240,255,0.45)] transition-all hover:scale-[1.02] active:scale-[0.98] border border-cyan-300/40 rounded-xl flex items-center justify-center gap-2 cursor-pointer"
            >
              <Play className="w-5 h-5 fill-slate-950" />
              SLITHER INTO ARENA
            </Button>
          </form>

          {/* High Score & Controls Info */}
          <div className="flex items-center justify-between pt-3 border-t border-white/10 text-xs font-mono text-slate-400">
            <span className="flex items-center gap-1.5 text-yellow-400">
              <Trophy className="w-3.5 h-3.5" />
              Best Mass: <strong className="text-white font-bold">{highScore}</strong>
            </span>
            <span className="flex items-center gap-1 text-slate-400">
              <Zap className="w-3.5 h-3.5 text-cyan-400" /> Click / Space Boost
            </span>
          </div>
        </Card>
      </div>
    </div>
  );
};
