'use client';

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { GameEngine } from '@/game/engine';
import { GameStats, PlayerPresence } from '@/game/types';
import { StartScreen } from './StartScreen';
import { GameHUD } from './GameHUD';
import { GameOverModal } from './GameOverModal';
import { db, getArenaRoom, SECTORS, MAX_PLAYERS_PER_ROOM } from '@/lib/instant';

export const SlitherGame: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const lastPinchDistRef = useRef<number | null>(null);

  // Unique player ID per browser session/tab so multiple tabs see each other as distinct players
  const playerIdRef = useRef<string>(
    typeof window !== 'undefined'
      ? sessionStorage.getItem('slither_pid') || `user-${Math.random().toString(36).substring(2, 9)}`
      : `user-${Math.random().toString(36).substring(2, 9)}`
  );

  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('slither_pid', playerIdRef.current);
    }
  }, []);

  const [gameState, setGameState] = useState<'menu' | 'playing' | 'gameover'>('menu');
  const [highScore, setHighScore] = useState<number>(0);
  const [isNewHighScore, setIsNewHighScore] = useState(false);
  const [stats, setStats] = useState<GameStats | null>(null);
  const [lastPlayerConfig, setLastPlayerConfig] = useState({ name: 'QuantumViper', skinId: 'void-dragon' });
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  // Dynamic Room partitioning: auto-balance to a new sector if room is full
  const [roomId, setRoomId] = useState<string>('sector-alpha');
  const [roomIndex, setRoomIndex] = useState<number>(0);

  // Read URL query parameter ?room= if present (allows playing with friends in a custom room)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const customRoom = params.get('room');
      if (customRoom) {
        setRoomId(customRoom.toLowerCase().trim());
      }
    }
  }, []);

  const currentRoom = useMemo(() => getArenaRoom(roomId), [roomId]);
  const { publishPresence, peers } = db.rooms.usePresence(currentRoom);

  const peerCount = Object.keys(peers || {}).length;
  const onlineCount = peerCount + (gameState === 'playing' ? 1 : 0);

  // Auto-route to a new room if the current room has reached maximum player capacity
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('room')) return; // Honor explicit custom room
    }

    if (peerCount >= MAX_PLAYERS_PER_ROOM && gameState === 'menu') {
      const nextIdx = (roomIndex + 1) % SECTORS.length;
      setRoomIndex(nextIdx);
      setRoomId(SECTORS[nextIdx]);
    }
  }, [peerCount, roomIndex, gameState]);

  // Periodic state refresh for HUD
  const [, setTick] = useState(0);

  // Sync peers into GameEngine
  useEffect(() => {
    if (engineRef.current && peers) {
      engineRef.current.syncRemotePeers(peers as unknown as Record<string, PlayerPresence>);
    }
  }, [peers]);

  // Publish player presence to InstantDB room periodically (~18Hz)
  useEffect(() => {
    if (gameState !== 'playing') return;

    const interval = setInterval(() => {
      // If tab is visible, publish via normal interval (worker handles background)
      if (document.hidden) return;

      const engine = engineRef.current;
      const player = engine?.player;
      if (!engine || !player || player.isDead) return;

      publishPresence({
        id: player.id,
        name: player.name,
        skinId: player.skin.id,
        head: { x: Math.round(player.head.x), y: Math.round(player.head.y) },
        angle: Number(player.angle.toFixed(3)),
        speed: Number(player.speed.toFixed(1)),
        radius: Math.round(player.radius),
        score: Math.round(player.score),
        kills: player.kills,
        isBoosting: player.isBoosting,
        isDead: player.isDead,
        updatedAt: Date.now(),
      });
    }, 55);

    return () => clearInterval(interval);
  }, [gameState, publishPresence]);

  // Background Web Worker heartbeat: keeps game & presence 100% active when tab is unfocused/hidden
  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const workerCode = `
        let timer = null;
        self.onmessage = function(e) {
          if (e.data === 'start') {
            if (!timer) {
              timer = setInterval(function() {
                self.postMessage('tick');
              }, 1000 / 25);
            }
          } else if (e.data === 'stop') {
            if (timer) {
              clearInterval(timer);
              timer = null;
            }
          }
        };
      `;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      const worker = new Worker(workerUrl);
      workerRef.current = worker;

      worker.onmessage = () => {
        if (document.hidden && engineRef.current && gameState === 'playing') {
          engineRef.current.update(40);

          const player = engineRef.current.player;
          if (player && !player.isDead) {
            publishPresence({
              id: player.id,
              name: player.name,
              skinId: player.skin.id,
              head: { x: Math.round(player.head.x), y: Math.round(player.head.y) },
              angle: Number(player.angle.toFixed(3)),
              speed: Number(player.speed.toFixed(1)),
              radius: Math.round(player.radius),
              score: Math.round(player.score),
              kills: player.kills,
              isBoosting: player.isBoosting,
              isDead: player.isDead,
              updatedAt: Date.now(),
            });
          }
        }
      };

      const onVisibilityChange = () => {
        if (document.hidden) {
          worker.postMessage('start');
        } else {
          worker.postMessage('stop');
          if (engineRef.current) {
            engineRef.current.resetFrameTime();
          }
        }
      };

      document.addEventListener('visibilitychange', onVisibilityChange);

      return () => {
        document.removeEventListener('visibilitychange', onVisibilityChange);
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
      };
    } catch {
      // Background worker fallback
    }
  }, [gameState, publishPresence]);

  // Load High Score
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('slither_highscore');
      if (saved) {
        setHighScore(parseInt(saved, 10) || 0);
      }
      setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0);
    }
  }, []);

  // Initialize Game Engine
  useEffect(() => {
    const engine = new GameEngine();
    engineRef.current = engine;

    engine.onGameOverCallback = (finalStats: GameStats) => {
      setStats(finalStats);
      setGameState('gameover');

      if (finalStats.score > highScore) {
        setHighScore(Math.floor(finalStats.score));
        setIsNewHighScore(true);
        if (typeof window !== 'undefined') {
          localStorage.setItem('slither_highscore', Math.floor(finalStats.score).toString());
        }
      } else {
        setIsNewHighScore(false);
      }
    };

    let lastScore = 0;
    let lastKills = 0;
    let lastBoost = false;

    engine.onStateUpdate = (eng) => {
      const p = eng.player;
      if (!p) return;
      const score = Math.floor(p.score);
      if (
        score !== lastScore ||
        p.kills !== lastKills ||
        p.isBoosting !== lastBoost
      ) {
        lastScore = score;
        lastKills = p.kills;
        lastBoost = p.isBoosting;
        setTick((prev) => prev + 1);
      }
    };

    return () => {
      engine.stop();
    };
  }, [highScore]);

  // Window Resize & Viewport Sync
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      const engine = engineRef.current;
      if (!canvas || !engine) return;

      // Clamp DPR to max 1.25 for crisp graphics with huge GPU performance gains
      const dpr = Math.min(1.25, window.devicePixelRatio || 1);
      const w = window.innerWidth;
      const h = window.innerHeight;

      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      // Get optimized, direct-to-screen hardware-accelerated 2D context
      if (!ctxRef.current) {
        ctxRef.current = canvas.getContext('2d', {
          alpha: false,
          desynchronized: true,
        });
      }

      engine.setViewport(canvas.width, canvas.height);
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Mouse Wheel Zoom In / Out Listener
  useEffect(() => {
    const handleWheelEvent = (e: WheelEvent) => {
      if (gameState === 'playing' && engineRef.current) {
        e.preventDefault();
        engineRef.current.handleWheel(e.deltaY);
      }
    };

    window.addEventListener('wheel', handleWheelEvent, { passive: false });
    return () => {
      window.removeEventListener('wheel', handleWheelEvent);
    };
  }, [gameState]);

  // Main Canvas Render Loop
  useEffect(() => {
    let animId: number;

    const renderLoop = () => {
      const engine = engineRef.current;
      const ctx = ctxRef.current;

      if (ctx && engine && gameState === 'playing') {
        engine.render(ctx);
      }

      animId = requestAnimationFrame(renderLoop);
    };

    animId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(animId);
  }, [gameState]);

  // Mouse Input handlers
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const engine = engineRef.current;
    if (!engine) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const worldX = (clientX - engine.viewport.width / 2) / engine.camera.zoom + engine.camera.x;
    const worldY = (clientY - engine.viewport.height / 2) / engine.camera.zoom + engine.camera.y;

    engine.mouseWorld = { x: worldX, y: worldY };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0 && engineRef.current) {
      engineRef.current.isMouseDown = true;
    }
  }, []);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (e.button === 0 && engineRef.current) {
      engineRef.current.isMouseDown = false;
    }
  }, []);

  // Touch handlers for mobile
  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastPinchDistRef.current = Math.hypot(dx, dy);
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    const engine = engineRef.current;
    if (!engine || e.touches.length === 0) return;

    if (e.touches.length === 2 && lastPinchDistRef.current !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const delta = lastPinchDistRef.current - dist;
      engine.handleWheel(delta * 5);
      lastPinchDistRef.current = dist;
      return;
    }

    const touch = e.touches[0];
    const rect = e.currentTarget.getBoundingClientRect();
    const clientX = touch.clientX - rect.left;
    const clientY = touch.clientY - rect.top;

    const worldX = (clientX - engine.viewport.width / 2) / engine.camera.zoom + engine.camera.x;
    const worldY = (clientY - engine.viewport.height / 2) / engine.camera.zoom + engine.camera.y;

    engine.mouseWorld = { x: worldX, y: worldY };
  }, []);

  const handleTouchEnd = useCallback(() => {
    lastPinchDistRef.current = null;
  }, []);

  // Keyboard handlers (Space to boost)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && engineRef.current) {
        engineRef.current.isSpaceDown = true;
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && engineRef.current) {
        engineRef.current.isSpaceDown = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const startGame = (name: string, skinId: string) => {
    setLastPlayerConfig({ name, skinId });
    const engine = engineRef.current;
    if (!engine) return;

    const dpr = Math.min(1.25, window.devicePixelRatio || 1);
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (canvasRef.current) {
      canvasRef.current.width = Math.round(w * dpr);
      canvasRef.current.height = Math.round(h * dpr);
    }
    engine.setViewport(canvasRef.current ? canvasRef.current.width : w, canvasRef.current ? canvasRef.current.height : h);
    engine.start(name, skinId, playerIdRef.current);
    setGameState('playing');
  };

  const playAgain = () => {
    startGame(lastPlayerConfig.name, lastPlayerConfig.skinId);
  };

  const returnToMenu = () => {
    if (engineRef.current) {
      engineRef.current.stop();
    }
    setGameState('menu');
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#06070c] select-none">
      {/* Interactive Fullscreen Canvas */}
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="block w-full h-full cursor-crosshair touch-none"
      />

      {/* Start Screen */}
      {gameState === 'menu' && (
        <StartScreen
          onPlay={startGame}
          highScore={highScore}
          onlineCount={onlineCount}
          roomId={roomId}
        />
      )}

      {/* Active Game HUD */}
      {gameState === 'playing' && engineRef.current && (
        <GameHUD
          engine={engineRef.current}
          onlineCount={onlineCount}
          roomId={roomId}
          onBoostStart={() => {
            if (engineRef.current) engineRef.current.isMouseDown = true;
          }}
          onBoostEnd={() => {
            if (engineRef.current) engineRef.current.isMouseDown = false;
          }}
          onZoomIn={() => {
            if (engineRef.current) engineRef.current.handleWheel(-100);
          }}
          onZoomOut={() => {
            if (engineRef.current) engineRef.current.handleWheel(100);
          }}
          isTouchDevice={isTouchDevice}
        />
      )}

      {/* Game Over Modal */}
      {gameState === 'gameover' && stats && (
        <GameOverModal
          stats={stats}
          highScore={highScore}
          isNewHighScore={isNewHighScore}
          onPlayAgain={playAgain}
          onMainMenu={returnToMenu}
        />
      )}
    </div>
  );
};
