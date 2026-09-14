'use client';

import React, { useEffect } from 'react';
import { GameStats } from '@/game/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Trophy, Skull, Zap, Clock, Shield, RotateCcw, Utensils } from 'lucide-react';
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

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-300 select-none">
      <Card className="w-full max-w-md bg-slate-950/90 border-white/10 backdrop-blur-2xl p-6 shadow-2xl flex flex-col gap-5 border">
        {/* Header */}
        <div className="flex flex-col items-center text-center gap-1.5 border-b border-white/10 pb-4">
          <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mb-1 shadow-[0_0_20px_rgba(239,68,68,0.3)]">
            <Skull className="w-6 h-6 text-red-400" />
          </div>
          <h2 className="text-2xl font-black font-mono tracking-tight text-white uppercase">
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
        <div className="grid grid-cols-2 gap-3 text-xs font-mono">
          <div className="p-3 rounded-xl bg-white/5 border border-white/5 flex flex-col gap-1">
            <span className="text-slate-400 text-[10px] uppercase flex items-center gap-1">
              <Shield className="w-3 h-3 text-cyan-400" /> Final Mass
            </span>
            <span className="text-xl font-bold text-white tracking-tight">
              {Math.floor(stats.score)}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-white/5 border border-white/5 flex flex-col gap-1">
            <span className="text-slate-400 text-[10px] uppercase flex items-center gap-1">
              <Trophy className="w-3 h-3 text-yellow-400" /> Peak Rank
            </span>
            <span className="text-xl font-bold text-yellow-400 tracking-tight">
              #{stats.maxRank}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-white/5 border border-white/5 flex flex-col gap-1">
            <span className="text-slate-400 text-[10px] uppercase flex items-center gap-1">
              <Skull className="w-3 h-3 text-red-400" /> Eliminations
            </span>
            <span className="text-xl font-bold text-white tracking-tight">
              {stats.kills}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-white/5 border border-white/5 flex flex-col gap-1">
            <span className="text-slate-400 text-[10px] uppercase flex items-center gap-1">
              <Utensils className="w-3 h-3 text-emerald-400" /> Orbs Devoured
            </span>
            <span className="text-xl font-bold text-white tracking-tight">
              {stats.foodEaten}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-white/5 border border-white/5 flex flex-col gap-1">
            <span className="text-slate-400 text-[10px] uppercase flex items-center gap-1">
              <Zap className="w-3 h-3 text-cyan-400" /> Max Length
            </span>
            <span className="text-xl font-bold text-white tracking-tight">
              {stats.length}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-white/5 border border-white/5 flex flex-col gap-1">
            <span className="text-slate-400 text-[10px] uppercase flex items-center gap-1">
              <Clock className="w-3 h-3 text-purple-400" /> Time Alive
            </span>
            <span className="text-xl font-bold text-white tracking-tight">
              {formatTime(stats.timeAlive)}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-2 pt-2">
          <Button
            onClick={onPlayAgain}
            size="lg"
            className="w-full h-11 bg-gradient-to-r from-cyan-500 hover:from-cyan-400 to-blue-600 hover:to-blue-500 text-slate-950 font-mono font-bold tracking-wider uppercase rounded-xl flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(0,240,255,0.4)]"
          >
            <RotateCcw className="w-4 h-4" /> PLAY AGAIN
          </Button>
          <Button
            onClick={onMainMenu}
            variant="ghost"
            className="w-full text-slate-400 hover:text-white font-mono text-xs"
          >
            CHANGE SKIN &amp; NAME
          </Button>
        </div>
      </Card>
    </div>
  );
};
