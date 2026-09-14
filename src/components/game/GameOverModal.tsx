'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { GameStats } from '@/game/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Trophy,
  Skull,
  Zap,
  Clock,
  Shield,
  RotateCcw,
  Utensils,
  Eye,
  GripHorizontal,
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface GameOverModalProps {
  stats: GameStats;
  highScore: number;
  isNewHighScore: boolean;
  onPlayAgain: () => void;
  onMainMenu: () => void;
}

export const GameOverModal: React.FC<GameOverModalProps> = ({
  stats,
  highScore,
  isNewHighScore,
  onPlayAgain,
  onMainMenu,
}) => {
  const [isSpectating, setIsSpectating] = useState(false);
  const [cardOffset, setCardOffset] = useState({ x: 0, y: 0 });
  const [isDraggingCard, setIsDraggingCard] = useState(false);
  const isDraggingCardRef = useRef(false);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, posX: 0, posY: 0 });

  useEffect(() => {
    if (isNewHighScore || stats.maxRank === 1) {
      try {
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#00f0ff', '#ff007f', '#ffd700', '#00ff66'],
        });
      } catch {
        // Confetti optional
      }
    }
  }, [isNewHighScore, stats.maxRank]);

  // Keyboard shortcut listener: Space / Enter to play again, V to toggle spectate
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isTyping =
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable);

      if (isTyping) return;

      if (e.code === 'KeyV') {
        e.preventDefault();
        setIsSpectating((prev) => !prev);
      } else if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        onPlayAgain();
      } else if (e.code === 'Escape' && !isSpectating) {
        e.preventDefault();
        setIsSpectating(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSpectating, onPlayAgain]);

  // Draggable card header handlers
  const handlePointerDownHeader = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest('button')) return;
      isDraggingCardRef.current = true;
      setIsDraggingCard(true);
      dragStartRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        posX: cardOffset.x,
        posY: cardOffset.y,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [cardOffset]
  );

  const handlePointerMoveHeader = useCallback((e: React.PointerEvent) => {
    if (!isDraggingCardRef.current) return;
    const dx = e.clientX - dragStartRef.current.mouseX;
    const dy = e.clientY - dragStartRef.current.mouseY;
    setCardOffset({
      x: dragStartRef.current.posX + dx,
      y: dragStartRef.current.posY + dy,
    });
  }, []);

  const handlePointerUpHeader = useCallback((e: React.PointerEvent) => {
    isDraggingCardRef.current = false;
    setIsDraggingCard(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // When spectating: Minimal floating HUD bar at the bottom so user has 100% full view of the arena
  if (isSpectating) {
    return (
      <>
        {/* Top hint badge */}
        <div className="fixed top-4 inset-x-0 z-50 pointer-events-none flex justify-center px-4 animate-in fade-in slide-in-from-top-3 duration-200">
          <div className="px-3.5 py-1.5 rounded-full bg-slate-950/75 border border-white/15 backdrop-blur-md text-[11px] font-mono text-slate-300 flex items-center gap-2 shadow-xl select-none">
            <span className="flex items-center gap-1 text-cyan-300">
              <Eye className="w-3 h-3" />
              <span>Spectating Arena</span>
            </span>
            <span className="text-slate-600">•</span>
            <span>Drag background to pan</span>
            <span className="text-slate-600">•</span>
            <span>Scroll to zoom</span>
            <span className="text-slate-600">•</span>
            <span className="text-yellow-400 font-semibold">[V] Stats</span>
            <span className="text-slate-600">•</span>
            <span className="text-cyan-400 font-semibold">[Space] Respawn</span>
          </div>
        </div>

        {/* Bottom compact spectator controller */}
        <div className="fixed bottom-6 inset-x-0 z-50 pointer-events-none flex justify-center px-4 select-none">
          <div className="pointer-events-auto flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-2xl bg-slate-950/80 border border-white/20 backdrop-blur-xl shadow-[0_16px_40px_rgba(0,0,0,0.8)] animate-in slide-in-from-bottom-5 duration-200 max-w-lg w-full">
            <div className="flex items-center gap-2.5 text-xs font-mono text-slate-200">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
              </span>
              <span className="font-bold text-white tracking-wide">ELIMINATED</span>
              <span className="text-slate-600">•</span>
              <span className="text-slate-400">
                Mass: <strong className="text-cyan-300">{Math.floor(stats.score)}</strong>
              </span>
              <span className="text-slate-600">•</span>
              <span className="text-slate-400">
                Rank: <strong className="text-yellow-400">#{stats.maxRank}</strong>
              </span>
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setIsSpectating(false)}
                className="h-8 px-2.5 text-slate-300 hover:text-white hover:bg-white/10 font-mono text-xs flex items-center gap-1.5"
                title="View full statistics dialog (V)"
              >
                <Trophy className="w-3.5 h-3.5 text-yellow-400" />
                View Stats (V)
              </Button>
              <Button
                size="sm"
                onClick={onPlayAgain}
                className="h-8 px-3.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-mono font-bold text-xs uppercase rounded-xl flex items-center gap-1.5 shadow-[0_0_15px_rgba(0,240,255,0.4)]"
                title="Respawn in arena (Space)"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Play Again
              </Button>
            </div>
          </div>
        </div>
      </>
    );
  }

  // Full statistics dialog with transparent glassmorphic background & draggability
  return (
    <div className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center p-4 select-none animate-in fade-in duration-200">
      <Card
        className="pointer-events-auto w-full max-w-md bg-slate-950/75 border border-white/15 backdrop-blur-md p-5 md:p-6 shadow-[0_20px_60px_rgba(0,0,0,0.75)] flex flex-col gap-4 rounded-2xl relative select-none"
        style={{
          transform: `translate(${cardOffset.x}px, ${cardOffset.y}px)`,
          transition: isDraggingCard ? 'none' : 'transform 0.05s ease-out',
        }}
      >
        {/* Top Reposition & Spectate Bar */}
        <div
          onPointerDown={handlePointerDownHeader}
          onPointerMove={handlePointerMoveHeader}
          onPointerUp={handlePointerUpHeader}
          className="flex items-center justify-between pb-2 border-b border-white/10 cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-200 select-none touch-none"
          title="Click and drag to move dialog anywhere on screen"
        >
          <div className="flex items-center gap-1.5 text-[11px] font-mono tracking-wider uppercase text-slate-400">
            <GripHorizontal className="w-4 h-4 text-slate-500" />
            <span>Drag To Move</span>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setIsSpectating(true);
            }}
            className="h-7 px-2.5 text-[11px] font-mono text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 flex items-center gap-1.5 rounded-lg"
            title="Minimize dialog and spectate the full arena (V)"
          >
            <Eye className="w-3.5 h-3.5" />
            Watch Arena (V)
          </Button>
        </div>

        {/* Header */}
        <div className="flex flex-col items-center text-center gap-1.5 border-b border-white/10 pb-3">
          <div className="w-11 h-11 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center shadow-[0_0_20px_rgba(239,68,68,0.3)]">
            <Skull className="w-5 h-5 text-red-400" />
          </div>
          <h2 className="text-xl md:text-2xl font-black font-mono tracking-tight text-white uppercase">
            SUPERNOVA COLLISION
          </h2>
          <p className="text-xs font-mono text-slate-400">
            Terminated by <strong className="text-red-400">{stats.killerName || 'Arena Barrier'}</strong>
          </p>

          {isNewHighScore ? (
            <div className="mt-1 px-3 py-1 rounded-full bg-yellow-500/20 border border-yellow-500/40 text-yellow-300 font-mono text-xs font-bold flex items-center gap-1.5 animate-pulse">
              <Trophy className="w-3.5 h-3.5" /> NEW PERSONAL BEST: {highScore}!
            </div>
          ) : (
            <div className="text-[11px] font-mono text-slate-400">
              Personal Best: <strong className="text-yellow-400">{highScore}</strong>
            </div>
          )}
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-2.5 text-xs font-mono">
          <div className="p-2.5 rounded-xl bg-slate-900/60 border border-white/10 flex flex-col gap-0.5">
            <span className="text-slate-400 text-[10px] uppercase flex items-center gap-1">
              <Shield className="w-3 h-3 text-cyan-400" /> Final Mass
            </span>
            <span className="text-lg font-bold text-white tracking-tight">
              {Math.floor(stats.score)}
            </span>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-900/60 border border-white/10 flex flex-col gap-0.5">
            <span className="text-slate-400 text-[10px] uppercase flex items-center gap-1">
              <Trophy className="w-3 h-3 text-yellow-400" /> Peak Rank
            </span>
            <span className="text-lg font-bold text-yellow-400 tracking-tight">
              #{stats.maxRank}
            </span>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-900/60 border border-white/10 flex flex-col gap-0.5">
            <span className="text-slate-400 text-[10px] uppercase flex items-center gap-1">
              <Skull className="w-3 h-3 text-red-400" /> Eliminations
            </span>
            <span className="text-lg font-bold text-white tracking-tight">
              {stats.kills}
            </span>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-900/60 border border-white/10 flex flex-col gap-0.5">
            <span className="text-slate-400 text-[10px] uppercase flex items-center gap-1">
              <Utensils className="w-3 h-3 text-emerald-400" /> Orbs Devoured
            </span>
            <span className="text-lg font-bold text-white tracking-tight">
              {stats.foodEaten}
            </span>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-900/60 border border-white/10 flex flex-col gap-0.5">
            <span className="text-slate-400 text-[10px] uppercase flex items-center gap-1">
              <Zap className="w-3 h-3 text-cyan-400" /> Max Length
            </span>
            <span className="text-lg font-bold text-white tracking-tight">
              {stats.length}
            </span>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-900/60 border border-white/10 flex flex-col gap-0.5">
            <span className="text-slate-400 text-[10px] uppercase flex items-center gap-1">
              <Clock className="w-3 h-3 text-purple-400" /> Time Alive
            </span>
            <span className="text-lg font-bold text-white tracking-tight">
              {formatTime(stats.timeAlive)}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-2 pt-1">
          <Button
            onClick={onPlayAgain}
            size="lg"
            className="w-full h-11 bg-gradient-to-r from-cyan-500 hover:from-cyan-400 to-blue-600 hover:to-blue-500 text-slate-950 font-mono font-bold tracking-wider uppercase rounded-xl flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(0,240,255,0.4)]"
          >
            <RotateCcw className="w-4 h-4" /> PLAY AGAIN (Space)
          </Button>

          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={() => setIsSpectating(true)}
              variant="outline"
              className="w-full text-cyan-400 border-white/10 hover:bg-white/5 font-mono text-xs flex items-center justify-center gap-1.5 h-9"
            >
              <Eye className="w-3.5 h-3.5" /> Spectate Arena (V)
            </Button>
            <Button
              onClick={onMainMenu}
              variant="ghost"
              className="w-full text-slate-400 hover:text-white font-mono text-xs h-9"
            >
              Change Skin &amp; Name
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};
