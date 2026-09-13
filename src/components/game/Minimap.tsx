'use client';

import React, { useRef, useEffect } from 'react';
import { GameEngine } from '@/game/engine';
import { ARENA_RADIUS } from '@/game/constants';

interface MinimapProps {
  engine: GameEngine;
}

export const Minimap: React.FC<MinimapProps> = ({ engine }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let animId: number;

    const renderMinimap = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const size = canvas.width;
      const center = size / 2;
      const mapRadius = center - 6;
      const scale = mapRadius / ARENA_RADIUS;

      ctx.clearRect(0, 0, size, size);

      // Radar circular background
      ctx.beginPath();
      ctx.arc(center, center, mapRadius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(6, 7, 12, 0.75)';
      ctx.fill();

      // Radar border
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
      ctx.stroke();

      // Subtle crosshairs
      ctx.beginPath();
      ctx.moveTo(center - 12, center);
      ctx.lineTo(center + 12, center);
      ctx.moveTo(center, center - 12);
      ctx.lineTo(center, center + 12);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Draw all bots as small dots
      for (const snake of engine.snakes) {
        if (snake.isDead || snake.isPlayer) continue;
        const bx = center + snake.head.x * scale;
        const by = center + snake.head.y * scale;

        ctx.beginPath();
        const dotRadius = Math.min(3.5, Math.max(1.8, (snake.score / 200) * 1.5));
        ctx.arc(bx, by, dotRadius, 0, Math.PI * 2);
        ctx.fillStyle = snake.skin.colors[0];
        ctx.fill();
      }

      // Draw Player blip
      if (engine.player && !engine.player.isDead) {
        const px = center + engine.player.head.x * scale;
        const py = center + engine.player.head.y * scale;

        // Pulsing radar ring around player
        const pulse = 4 + (Date.now() % 1000) / 180;
        ctx.beginPath();
        ctx.arc(px, py, pulse, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Player core diamond
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(engine.player.angle);
        ctx.beginPath();
        ctx.moveTo(4, 0);
        ctx.lineTo(-3, -3);
        ctx.lineTo(-1, 0);
        ctx.lineTo(-3, 3);
        ctx.closePath();
        ctx.fillStyle = '#00f0ff';
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.restore();
      }

      animId = requestAnimationFrame(renderMinimap);
    };

    animId = requestAnimationFrame(renderMinimap);
    return () => cancelAnimationFrame(animId);
  }, [engine]);

  return (
    <div className="flex flex-col items-center gap-1.5 pointer-events-auto">
      <div className="relative rounded-full p-0.5 bg-gradient-to-tr from-cyan-500/20 via-transparent to-purple-500/20 shadow-2xl backdrop-blur-md">
        <canvas
          ref={canvasRef}
          width={130}
          height={130}
          className="rounded-full block"
        />
      </div>
      <div className="text-[10px] tracking-wider uppercase font-mono text-cyan-400/70 font-semibold">
        Radar Sector
      </div>
    </div>
  );
};
