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
    let sweepAngle = 0;

    const renderMinimap = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const size = canvas.width;
      const center = size / 2;
      const mapRadius = center - 8;
      const scale = mapRadius / ARENA_RADIUS;

      sweepAngle += 0.035;

      ctx.clearRect(0, 0, size, size);

      // Radar circular background
      ctx.beginPath();
      ctx.arc(center, center, mapRadius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(6, 7, 14, 0.82)';
      ctx.fill();

      // Range rings (concentric distance guides)
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.12)';
      ctx.beginPath();
      ctx.arc(center, center, mapRadius * 0.33, 0, Math.PI * 2);
      ctx.arc(center, center, mapRadius * 0.66, 0, Math.PI * 2);
      ctx.stroke();

      // Subtle crosshairs
      ctx.beginPath();
      ctx.moveTo(center - mapRadius, center);
      ctx.lineTo(center + mapRadius, center);
      ctx.moveTo(center, center - mapRadius);
      ctx.lineTo(center, center + mapRadius);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.stroke();

      // Rotating radar sweep line
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(center, center);
      ctx.arc(center, center, mapRadius, sweepAngle - 0.4, sweepAngle);
      ctx.closePath();
      ctx.fillStyle = 'rgba(0, 240, 255, 0.07)';
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(center, center);
      ctx.lineTo(center + Math.cos(sweepAngle) * mapRadius, center + Math.sin(sweepAngle) * mapRadius);
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.45)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();

      // Outer glowing border
      ctx.beginPath();
      ctx.arc(center, center, mapRadius, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.5)';
      ctx.stroke();

      // Draw all bots
      const snakes = engine.snakes;
      for (let i = 0; i < snakes.length; i++) {
        const snake = snakes[i];
        if (snake.isDead || snake.isPlayer) continue;

        const bx = center + snake.head.x * scale;
        const by = center + snake.head.y * scale;

        ctx.beginPath();
        const dotRadius = Math.min(4.5, Math.max(2.2, (snake.score / 250) * 1.5));
        ctx.arc(bx, by, dotRadius, 0, Math.PI * 2);
        ctx.fillStyle = snake.skin.colors[0];
        ctx.fill();
      }

      // Draw Player beacon
      if (engine.player && !engine.player.isDead) {
        const px = center + engine.player.head.x * scale;
        const py = center + engine.player.head.y * scale;

        // Pulsing radar ripple ring
        const pulse = 4 + (Date.now() % 1200) / 120;
        ctx.beginPath();
        ctx.arc(px, py, pulse, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0, 240, 255, ${Math.max(0, 1 - pulse / 14)})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Direction pointer
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(engine.player.angle);
        ctx.beginPath();
        ctx.moveTo(6, 0);
        ctx.lineTo(-4, -4);
        ctx.lineTo(-2, 0);
        ctx.lineTo(-4, 4);
        ctx.closePath();
        ctx.fillStyle = '#00f0ff';
        ctx.fill();
        ctx.restore();
      }

      animId = requestAnimationFrame(renderMinimap);
    };

    animId = requestAnimationFrame(renderMinimap);
    return () => cancelAnimationFrame(animId);
  }, [engine]);

  const player = engine.player;
  const posX = player ? Math.round(player.head.x) : 0;
  const posY = player ? Math.round(player.head.y) : 0;

  return (
    <div className="flex flex-col items-center gap-1.5 pointer-events-auto">
      <div className="relative rounded-full p-1 bg-gradient-to-tr from-cyan-500/30 via-transparent to-purple-500/30 shadow-2xl backdrop-blur-lg">
        <canvas
          ref={canvasRef}
          width={180}
          height={180}
          className="rounded-full block"
        />
      </div>
      <div className="flex items-center justify-between w-full px-1 text-[10px] tracking-wider uppercase font-mono text-cyan-400/80 font-bold">
        <span>SECTOR RADAR</span>
        <span>X:{posX} Y:{posY}</span>
      </div>
    </div>
  );
};
