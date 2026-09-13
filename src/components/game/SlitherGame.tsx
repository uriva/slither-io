'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { GameEngine } from '@/game/engine';
import { GameStats } from '@/game/types';
import { StartScreen } from './StartScreen';
import { GameHUD } from './GameHUD';
import { GameOverModal } from './GameOverModal';

export const SlitherGame: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);

  const [gameState, setGameState] = useState<'menu' | 'playing' | 'gameover'>('menu');
  const [highScore, setHighScore] = useState<number>(0);
  const [isNewHighScore, setIsNewHighScore] = useState(false);
  const [stats, setStats] = useState<GameStats | null>(null);
  const [lastPlayerConfig, setLastPlayerConfig] = useState({ name: 'QuantumViper', skinId: 'void-dragon' });
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  // Force re-renders for HUD updates at 15fps
  const [, setTick] = useState(0);

  // Load High Score from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('slither_highscore');
      if (saved) {
        setHighScore(parseInt(saved, 10) || 0);
      }
      setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0);
    }
  }, []);

  // Initialize GameEngine instance
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

    engine.onStateUpdate = () => {
      setTick((prev) => prev + 1);
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

      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;

      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      engine.setViewport(w, h);
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Main Canvas Render Loop
  useEffect(() => {
    let animId: number;

    const renderLoop = () => {
      const canvas = canvasRef.current;
      const engine = engineRef.current;

      if (canvas && engine && gameState === 'playing') {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const dpr = window.devicePixelRatio || 1;
          ctx.save();
          ctx.scale(dpr, dpr);
          engine.render(ctx);
          ctx.restore();
        }
      }

      animId = requestAnimationFrame(renderLoop);
    };

    animId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(animId);
  }, [gameState]);

  // Mouse & Touch Input handlers
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const engine = engineRef.current;
    if (!engine) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    // Convert screen coordinates to world coordinates through camera
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
  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    const engine = engineRef.current;
    if (!engine || e.touches.length === 0) return;

    const touch = e.touches[0];
    const rect = e.currentTarget.getBoundingClientRect();
    const clientX = touch.clientX - rect.left;
    const clientY = touch.clientY - rect.top;

    const worldX = (clientX - engine.viewport.width / 2) / engine.camera.zoom + engine.camera.x;
    const worldY = (clientY - engine.viewport.height / 2) / engine.camera.zoom + engine.camera.y;

    engine.mouseWorld = { x: worldX, y: worldY };
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

    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (canvasRef.current) {
      canvasRef.current.width = w * dpr;
      canvasRef.current.height = h * dpr;
    }
    engine.setViewport(w, h);
    engine.start(name, skinId);
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
        onTouchMove={handleTouchMove}
        onTouchStart={handleTouchMove}
        className="block w-full h-full cursor-crosshair touch-none"
      />

      {/* Start Screen */}
      {gameState === 'menu' && (
        <StartScreen onPlay={startGame} highScore={highScore} />
      )}

      {/* Active Game HUD */}
      {gameState === 'playing' && engineRef.current && (
        <GameHUD
          engine={engineRef.current}
          onBoostStart={() => {
            if (engineRef.current) engineRef.current.isMouseDown = true;
          }}
          onBoostEnd={() => {
            if (engineRef.current) engineRef.current.isMouseDown = false;
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
