'use client';

import React, { useState } from 'react';
import { GameEngine } from '@/game/engine';
import { Minimap } from './Minimap';
import { sound } from '@/game/audio';
import { MIN_BOOST_MASS } from '@/game/constants';
import { ChatMessage } from '@/game/types';
import { ChatOverlay } from './ChatOverlay';
import { Volume2, VolumeX, Trophy, Zap, Skull, Shield, ZoomIn, ZoomOut, Mouse, Users, Activity, Navigation } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface GameHUDProps {
  engine: GameEngine;
  onlineCount: number;
  roomId?: string;
  chatMessages: ChatMessage[];
  isChatOpen: boolean;
  onChatOpenChange: (open: boolean) => void;
  onSendMessage: (text: string) => void;
  onBoostStart: () => void;
  onBoostEnd: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  isTouchDevice: boolean;
}

export const GameHUD: React.FC<GameHUDProps> = ({
  engine,
  onlineCount,
  roomId,
  chatMessages,
  isChatOpen,
  onChatOpenChange,
  onSendMessage,
  onBoostStart,
  onBoostEnd,
  onZoomIn,
  onZoomOut,
  isTouchDevice,
}) => {
  const [isMuted, setIsMuted] = useState(sound.getMuted());
  const player = engine.player;

  const toggleSound = () => {
    const nextMuted = !isMuted;
    sound.setMuted(nextMuted);
    setIsMuted(nextMuted);
  };

  if (!player) return null;

  const playerRank = engine.leaderboard.findIndex((e) => e.isPlayer) + 1;
  let totalSnakes = 0;
  for (let i = 0; i < engine.snakes.length; i++) {
    if (!engine.snakes[i].isDead) totalSnakes++;
  }
  const currentZoomPercent = Math.round(engine.camera.userZoom * 100);
  const canBoost = player.score > MIN_BOOST_MASS;
  const fps = engine.fps || 60;
  const fpsColor = fps >= 55 ? 'text-emerald-400 bg-emerald-500/20 border-emerald-500/30' : fps >= 40 ? 'text-amber-400 bg-amber-500/20 border-amber-500/30' : 'text-red-400 bg-red-500/20 border-red-500/30';

  return (
    <div className="absolute inset-0 pointer-events-none select-none z-10 flex flex-col justify-between p-4 md:p-6 font-sans">
      {/* Top Header Row */}
      <div className="flex justify-between items-start gap-4">
        {/* Top-Left: Player Stats Card */}
        <div className="flex flex-col gap-2 pointer-events-auto">
          <div className="bg-slate-950/75 border border-white/10 backdrop-blur-md rounded-xl p-3 md:p-4 shadow-xl text-white flex flex-col gap-2 min-w-[170px] md:min-w-[200px]">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <span className="text-xs font-mono uppercase tracking-widest text-cyan-400 font-bold flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5" />
                {player.name}
              </span>
              <div className="flex items-center gap-1.5">
                <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border flex items-center gap-1 ${fpsColor}`}>
                  <Activity className="w-2.5 h-2.5" />
                  {fps} FPS
                </span>
                <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                  #{playerRank > 0 ? playerRank : totalSnakes} / {totalSnakes}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex flex-col">
                <span className="text-[10px] uppercase font-mono text-slate-400">Mass</span>
                <span className="text-base md:text-lg font-mono font-bold text-white tracking-tight">
                  {Math.floor(player.score)}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] uppercase font-mono text-slate-400">Length</span>
                <span className="text-base md:text-lg font-mono font-bold text-white tracking-tight">
                  {player.body.length}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1 border-t border-white/5 text-[11px] font-mono text-slate-300">
              <span className="flex items-center gap-1 text-red-400">
                <Skull className="w-3 h-3" />
                Kills: <strong className="text-white font-bold">{player.kills}</strong>
              </span>

              {canBoost ? (
                <span className={player.isBoosting ? 'text-cyan-400 flex items-center gap-1 font-bold animate-pulse' : 'text-emerald-400 flex items-center gap-1'}>
                  <Zap className="w-3 h-3" />
                  {player.isBoosting ? 'Boosting 2x' : 'Boost Ready'}
                </span>
              ) : (
                <span className="text-amber-400 flex items-center gap-1 text-[10px]">
                  Need {MIN_BOOST_MASS}+ Mass
                </span>
              )}
            </div>

            {/* Live Multiplayer Room Indicator */}
            <div className="flex items-center gap-1.5 pt-1 border-t border-white/5 text-[10px] font-mono text-emerald-400 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping inline-block" />
              <Users className="w-3 h-3 text-emerald-400 ml-0.5" />
              <span>{(roomId || 'sector-alpha').replace('-', ' ').toUpperCase()} ({onlineCount}/10 Humans)</span>
            </div>
          </div>
        </div>

        {/* Top-Center: Kill Notification Banner */}
        {engine.killBanner && (
          <div className="animate-in fade-in slide-in-from-top-4 duration-300 pointer-events-auto">
            <div className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-red-600/90 via-purple-600/90 to-cyan-600/90 border border-white/30 backdrop-blur-lg shadow-2xl flex items-center gap-2.5 text-white">
              <Skull className="w-5 h-5 text-yellow-300 animate-bounce" />
              <span className="font-mono text-xs md:text-sm font-black tracking-wide uppercase">
                {engine.killBanner.text}
              </span>
            </div>
          </div>
        )}

        {/* Top-Right: Leaderboard */}
        <div className="pointer-events-auto">
          <div className="bg-slate-950/75 border border-white/10 backdrop-blur-md rounded-xl p-3 md:p-4 shadow-xl text-white min-w-[190px] md:min-w-[240px]">
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/10">
              <span className="text-xs font-mono uppercase tracking-widest text-yellow-400 font-bold flex items-center gap-1.5">
                <Trophy className="w-3.5 h-3.5" />
                Live Arena Board
              </span>
              <span className="text-[10px] font-mono text-slate-400">Top 10</span>
            </div>

            <div className="flex flex-col gap-1 text-xs font-mono">
              {engine.leaderboard.map((entry, idx) => {
                const isFirst = idx === 0;
                return (
                  <div
                    key={entry.id}
                    className={`flex items-center justify-between px-2 py-1 rounded transition-colors ${
                      entry.isPlayer
                        ? 'bg-cyan-500/25 border border-cyan-400/40 text-cyan-200 font-bold'
                        : 'text-slate-300 hover:bg-white/5'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 truncate max-w-[120px] md:max-w-[150px]">
                      <span className={`w-4 text-center font-bold ${isFirst ? 'text-yellow-400' : 'text-slate-500'}`}>
                        {idx + 1}.
                      </span>
                      <span className="truncate">{entry.name}</span>
                    </div>
                    <span className="font-bold text-white/90">{entry.score}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Row */}
      <div className="flex justify-between items-end gap-4 mt-auto">
        {/* Bottom-Left: Chat, Control Guide, Audio Toggle, & Zoom Buttons */}
        <div className="flex flex-col gap-2 pointer-events-auto">
          {/* In-Game Multiplayer Chat Overlay */}
          <ChatOverlay
            messages={chatMessages}
            isOpen={isChatOpen}
            onOpenChange={onChatOpenChange}
            onSendMessage={onSendMessage}
            playerName={player.name}
            isTouchDevice={isTouchDevice}
          />

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={toggleSound}
              className="bg-slate-950/70 border-white/10 text-white hover:bg-white/10 backdrop-blur-md h-9 px-3"
            >
              {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4 text-cyan-400" />}
              <span className="text-xs font-mono ml-1.5">{isMuted ? 'Muted' : 'Audio On'}</span>
            </Button>

            {/* Interactive Zoom Buttons */}
            <div className="flex items-center rounded-lg bg-slate-950/70 border border-white/10 backdrop-blur-md p-0.5">
              <span className={`text-[10px] font-mono font-bold px-2 py-1 flex items-center gap-1 border-r border-white/10 ${fps >= 55 ? 'text-emerald-400' : fps >= 40 ? 'text-amber-400' : 'text-red-400'}`}>
                <Activity className="w-3 h-3" />
                {fps} FPS
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onZoomOut}
                title="Zoom Out (Scroll Down)"
                className="text-slate-300 hover:text-white h-8 w-8"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </Button>
              <span className="text-[11px] font-mono text-cyan-300 px-1.5 font-bold">
                {currentZoomPercent}%
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onZoomIn}
                title="Zoom In (Scroll Up)"
                className="text-slate-300 hover:text-white h-8 w-8"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-slate-950/70 border border-white/10 backdrop-blur-md text-[11px] font-mono text-slate-400">
            <span className="flex items-center gap-1.5 text-cyan-300">
              <Navigation className="w-3 h-3 text-cyan-400" />
              <span>← → / A D Steer</span>
            </span>
            <span>•</span>
            <span className="flex items-center gap-1 text-slate-300">
              <Zap className="w-3 h-3 text-yellow-400" />
              <span>↑ / Space / Shift Boost</span>
            </span>
            <span>•</span>
            <span className="flex items-center gap-1 text-slate-300">
              <Mouse className="w-3 h-3 text-cyan-400" /> Mouse / Scroll Zoom
            </span>
          </div>
        </div>

        {/* Mobile Boost Button */}
        {isTouchDevice && (
          <div className="pointer-events-auto block md:hidden mb-2">
            <button
              onTouchStart={onBoostStart}
              onTouchEnd={onBoostEnd}
              onMouseDown={onBoostStart}
              onMouseUp={onBoostEnd}
              disabled={!canBoost}
              className={`w-20 h-20 rounded-full font-mono font-bold text-xs flex flex-col items-center justify-center gap-1 shadow-2xl border-2 transition-all select-none ${
                canBoost
                  ? 'bg-gradient-to-tr from-cyan-600 to-blue-500 active:from-cyan-400 active:to-blue-400 text-white border-white/30 active:scale-95'
                  : 'bg-slate-800 text-slate-500 border-slate-700 opacity-60 cursor-not-allowed'
              }`}
            >
              <Zap className={`w-6 h-6 ${canBoost ? 'text-yellow-300 fill-yellow-300' : 'text-slate-500'}`} />
              <span>{canBoost ? 'BOOST' : 'LOW MASS'}</span>
            </button>
          </div>
        )}

        {/* Bottom-Right: Radar Minimap */}
        <Minimap engine={engine} />
      </div>
    </div>
  );
};
