'use client';

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { GameEngine } from '@/game/engine';
import { GameStats, PlayerPresence, ChatMessage } from '@/game/types';
import { sound } from '@/game/audio';
import { StartScreen } from './StartScreen';
import { GameHUD } from './GameHUD';
import { GameOverModal } from './GameOverModal';
import { Minimap } from './Minimap';
import { db, getArenaRoom, SECTORS, MAX_PLAYERS_PER_ROOM } from '@/lib/instant';

function getStoredPlayerId(): string {
  if (typeof window === 'undefined') return 'user-guest';
  const existing = sessionStorage.getItem('slither_pid');
  if (existing) return existing;
  const newId = `user-${Math.random().toString(36).substring(2, 9)}`;
  try {
    sessionStorage.setItem('slither_pid', newId);
  } catch {
    // Ignore storage errors
  }
  return newId;
}

export const SlitherGame: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const lastPinchDistRef = useRef<number | null>(null);
  const lastMouseClientRef = useRef<{ x: number; y: number } | null>(null);
  const isPanningRef = useRef(false);
  const [isPanning, setIsPanning] = useState(false);
  const lastPanPosRef = useRef<{ x: number; y: number } | null>(null);

  // Unique player ID per browser session/tab so multiple tabs see each other as distinct players
  const [playerId] = useState(getStoredPlayerId);
  const playerIdRef = useRef<string>(playerId);

  const [gameState, setGameState] = useState<'menu' | 'playing' | 'gameover'>('menu');
  const [highScore, setHighScore] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('slither_highscore');
      if (saved) return parseInt(saved, 10) || 0;
    }
    return 0;
  });
  const [isNewHighScore, setIsNewHighScore] = useState(false);
  const [stats, setStats] = useState<GameStats | null>(null);
  const [lastPlayerConfig, setLastPlayerConfig] = useState({ name: 'QuantumViper', skinId: 'void-dragon' });
  const [isTouchDevice] = useState(
    () => typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)
  );

  // Dynamic Room partitioning: auto-balance to a new sector if room is full
  const [roomId, setRoomId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const customRoom = params.get('room');
      if (customRoom) return customRoom.toLowerCase().trim();
    }
    return 'sector-alpha';
  });
  const [, setRoomIndex] = useState<number>(0);

  const currentRoom = useMemo(() => getArenaRoom(roomId), [roomId]);
  const { publishPresence, peers, user } = db.rooms.usePresence(currentRoom);

  // In-Game Multiplayer Chat state & InstantDB Room Topic pub/sub
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatOpen, setIsChatOpen] = useState(false);

  const publishChat = db.rooms.usePublishTopic(currentRoom, 'chat');

  db.rooms.useTopicEffect(currentRoom, 'chat', (event: ChatMessage) => {
    if (!event || !event.text) return;
    setChatMessages((prev) => {
      if (prev.some((m) => m.id === event.id)) return prev;
      return [...prev.slice(-49), event];
    });
    sound.playChat();
    if (engineRef.current && event.senderId) {
      engineRef.current.addChatMessage(event.senderId, event.text, event.senderName);
    }
  });

  const handleSendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const player = engineRef.current?.player;
      const myName = player?.name || lastPlayerConfig.name || 'QuantumViper';
      const myId = playerIdRef.current;

      const msg: ChatMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        senderId: myId,
        senderName: myName,
        text: trimmed,
        timestamp: Date.now(),
        isPlayer: true,
      };

      setChatMessages((prev) => [...prev.slice(-49), msg]);
      sound.playChat();

      if (engineRef.current) {
        engineRef.current.addChatMessage(myId, trimmed, myName);
      }

      try {
        publishChat(msg);
      } catch (err) {
        console.error('Failed to broadcast chat transmission:', err);
      }
    },
    [publishChat, lastPlayerConfig.name]
  );

  const peerCount = Object.keys(peers || {}).length;
  const onlineCount = peerCount + (gameState === 'playing' ? 1 : 0);

  // Auto-route to a new room if the current room has reached maximum player capacity
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('room')) return; // Honor explicit custom room
    }

    if (peerCount >= MAX_PLAYERS_PER_ROOM && gameState === 'menu') {
      const timer = setTimeout(() => {
        setRoomIndex((prev) => {
          const nextIdx = (prev + 1) % SECTORS.length;
          setRoomId(SECTORS[nextIdx]);
          return nextIdx;
        });
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [peerCount, gameState]);

  // Periodic state refresh for HUD
  const [, setTick] = useState(0);

  // Sync peers into GameEngine with bulletproof self-filtering
  useEffect(() => {
    if (engineRef.current && peers) {
      engineRef.current.syncRemotePeers(
        peers as unknown as Record<string, PlayerPresence>,
        playerIdRef.current,
        user?.peerId
      );
    }
  }, [peers, user]);

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
        spawnTimestamp: player.spawnTimestamp || Date.now(),
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
              spawnTimestamp: player.spawnTimestamp || Date.now(),
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

  const highScoreRef = useRef(highScore);
  useEffect(() => {
    highScoreRef.current = highScore;
  }, [highScore]);

  const publishPresenceRef = useRef(publishPresence);
  useEffect(() => {
    publishPresenceRef.current = publishPresence;
  }, [publishPresence]);

  // Initialize Game Engine once on mount
  useEffect(() => {
    const eng = new GameEngine();
    engineRef.current = eng;

    eng.onGameOverCallback = (finalStats: GameStats) => {
      setStats(finalStats);
      setGameState('gameover');

      if (finalStats.score > highScoreRef.current) {
        setHighScore(Math.floor(finalStats.score));
        setIsNewHighScore(true);
        if (typeof window !== 'undefined') {
          localStorage.setItem('slither_highscore', Math.floor(finalStats.score).toString());
        }
      } else {
        setIsNewHighScore(false);
      }

      // Immediately notify all peers of death so no delayed packets resurrect the corpse
      try {
        publishPresenceRef.current({
          id: playerIdRef.current,
          isDead: true,
          updatedAt: Date.now(),
        });
      } catch {
        // Ignore
      }
    };

    let lastScore = 0;
    let lastKills = 0;
    let lastBoost = false;
    let lastFps = 0;

    eng.onStateUpdate = (engineInstance) => {
      const p = engineInstance.player;
      if (!p) return;
      const score = Math.floor(p.score);
      const fps = engineInstance.fps;
      if (
        score !== lastScore ||
        p.kills !== lastKills ||
        p.isBoosting !== lastBoost ||
        fps !== lastFps
      ) {
        lastScore = score;
        lastKills = p.kills;
        lastBoost = p.isBoosting;
        lastFps = fps;
        setTick((prev) => prev + 1);
      }
    };

    return () => {
      eng.stop();
    };
  }, []);

  // Convert mouse/touch screen coordinates accurately to canvas world coordinates
  const updateMousePosition = useCallback((clientX: number, clientY: number) => {
    const engine = engineRef.current;
    const canvas = canvasRef.current;
    if (!engine || !canvas) return;

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    // Convert CSS client coordinates to internal canvas buffer coordinates accurately,
    // accounting for devicePixelRatio, canvas scaling, CSS width/height, and canvas offsets
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = (clientX - rect.left) * scaleX;
    const canvasY = (clientY - rect.top) * scaleY;

    engine.setMouseCanvas(canvasX, canvasY);
  }, []);

  // Window Resize & Viewport Sync
  const handleResize = useCallback(() => {
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

    engine.setRenderContext(ctxRef.current);
    engine.setViewport(canvas.width, canvas.height);

    if (lastMouseClientRef.current) {
      updateMousePosition(lastMouseClientRef.current.x, lastMouseClientRef.current.y);
    }
  }, [updateMousePosition]);

  useEffect(() => {
    window.addEventListener('resize', handleResize);
    handleResize();

    // Listen for display changes (e.g. dragging between laptop screen and external monitor)
    let dprQuery: MediaQueryList | null = null;
    const handleDprChange = () => {
      handleResize();
    };
    try {
      dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      dprQuery.addEventListener('change', handleDprChange);
    } catch {
      // Fallback
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      if (dprQuery) {
        try {
          dprQuery.removeEventListener('change', handleDprChange);
        } catch {
          // Fallback
        }
      }
    };
  }, [handleResize]);

  // Global window pointer & mouse listeners so steering works across entire screen (even over HUD elements)
  useEffect(() => {
    const onWindowMouseMove = (e: MouseEvent) => {
      lastMouseClientRef.current = { x: e.clientX, y: e.clientY };
      if (gameState === 'playing') {
        updateMousePosition(e.clientX, e.clientY);
      } else if (gameState === 'gameover' && isPanningRef.current && engineRef.current) {
        if (lastPanPosRef.current) {
          const dx = e.clientX - lastPanPosRef.current.x;
          const dy = e.clientY - lastPanPosRef.current.y;
          engineRef.current.panCamera(dx, dy);
        }
        lastPanPosRef.current = { x: e.clientX, y: e.clientY };
      }
    };

    const onWindowMouseUp = (e: MouseEvent) => {
      if (e.button === 0) {
        if (engineRef.current) {
          engineRef.current.isMouseDown = false;
        }
        isPanningRef.current = false;
        setIsPanning(false);
        lastPanPosRef.current = null;
      }
    };

    window.addEventListener('mousemove', onWindowMouseMove, { passive: true });
    window.addEventListener('mouseup', onWindowMouseUp);

    return () => {
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup', onWindowMouseUp);
    };
  }, [gameState, updateMousePosition]);

  // Mouse Wheel Zoom In / Out Listener
  useEffect(() => {
    const handleWheelEvent = (e: WheelEvent) => {
      if ((gameState === 'playing' || gameState === 'gameover') && engineRef.current) {
        e.preventDefault();
        engineRef.current.handleWheel(e.deltaY);
      }
    };

    window.addEventListener('wheel', handleWheelEvent, { passive: false });
    return () => {
      window.removeEventListener('wheel', handleWheelEvent);
    };
  }, [gameState]);

  // Mouse Input handlers
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    lastMouseClientRef.current = { x: e.clientX, y: e.clientY };
    if (gameState === 'playing') {
      updateMousePosition(e.clientX, e.clientY);
    }
  }, [gameState, updateMousePosition]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) {
      if (gameState === 'playing' && engineRef.current) {
        engineRef.current.isMouseDown = true;
      } else if (gameState === 'gameover') {
        isPanningRef.current = true;
        setIsPanning(true);
        lastPanPosRef.current = { x: e.clientX, y: e.clientY };
      }
    }
  }, [gameState]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) {
      if (engineRef.current) {
        engineRef.current.isMouseDown = false;
      }
      isPanningRef.current = false;
      setIsPanning(false);
      lastPanPosRef.current = null;
    }
  }, []);

  // Touch handlers for mobile
  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastPinchDistRef.current = Math.sqrt(dx * dx + dy * dy);
    } else if (e.touches.length === 1) {
      const touch = e.touches[0];
      lastMouseClientRef.current = { x: touch.clientX, y: touch.clientY };
      if (gameState === 'playing') {
        updateMousePosition(touch.clientX, touch.clientY);
      } else if (gameState === 'gameover') {
        lastPanPosRef.current = { x: touch.clientX, y: touch.clientY };
      }
    }
  }, [gameState, updateMousePosition]);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    const engine = engineRef.current;
    if (!engine || e.touches.length === 0) return;

    if (e.touches.length === 2 && lastPinchDistRef.current !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const delta = lastPinchDistRef.current - dist;
      engine.handleWheel(delta * 5);
      lastPinchDistRef.current = dist;
      return;
    }

    const touch = e.touches[0];
    if (gameState === 'playing') {
      lastMouseClientRef.current = { x: touch.clientX, y: touch.clientY };
      updateMousePosition(touch.clientX, touch.clientY);
    } else if (gameState === 'gameover' && lastPanPosRef.current) {
      const dx = touch.clientX - lastPanPosRef.current.x;
      const dy = touch.clientY - lastPanPosRef.current.y;
      engine.panCamera(dx, dy);
      lastPanPosRef.current = { x: touch.clientX, y: touch.clientY };
    }
  }, [gameState, updateMousePosition]);

  const handleTouchEnd = useCallback(() => {
    lastPinchDistRef.current = null;
    lastPanPosRef.current = null;
  }, []);

  // Keyboard handlers (Arrow keys / WASD steering, Space/Shift to boost, Enter for chat, C to toggle mode)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isTyping =
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable);

      if (isTyping) {
        return;
      }

      const code = e.code;

      // Prevent scrolling on arrow keys and spacebar during gameplay
      if (
        code === 'ArrowUp' ||
        code === 'ArrowDown' ||
        code === 'ArrowLeft' ||
        code === 'ArrowRight' ||
        code === 'Space'
      ) {
        e.preventDefault();
      }

      // Boosting with Space or Shift
      if (code === 'Space' && gameState === 'playing') {
        if (engineRef.current) engineRef.current.isSpaceDown = true;
        return;
      }
      if ((code === 'ShiftLeft' || code === 'ShiftRight') && gameState === 'playing') {
        if (engineRef.current) engineRef.current.isShiftDown = true;
        return;
      }

      // Arrow keys and WASD steering (Classic Slither: Up/W boosts, Left/Right steers, Down is ignored)
      if ((code === 'ArrowUp' || code === 'KeyW') && gameState === 'playing') {
        engineRef.current?.setKeyboardKey('up', true);
        return;
      }
      if (code === 'ArrowDown' || code === 'KeyS') {
        // Classic mode: down does nothing (prevents scrolling)
        return;
      }
      if ((code === 'ArrowLeft' || code === 'KeyA') && gameState === 'playing') {
        engineRef.current?.setKeyboardKey('left', true);
        return;
      }
      if ((code === 'ArrowRight' || code === 'KeyD') && gameState === 'playing') {
        engineRef.current?.setKeyboardKey('right', true);
        return;
      }

      // Zoom keys: '+' / '=' to zoom in, '-' / '_' to zoom out
      if ((code === 'Equal' || code === 'NumpadAdd') && (gameState === 'playing' || gameState === 'gameover')) {
        engineRef.current?.handleWheel(-100);
        return;
      }
      if ((code === 'Minus' || code === 'NumpadSubtract') && (gameState === 'playing' || gameState === 'gameover')) {
        engineRef.current?.handleWheel(100);
        return;
      }

      // Enter key opens chat input when playing
      if ((e.key === 'Enter' || e.code === 'Enter') && gameState === 'playing') {
        e.preventDefault();
        if (activeEl instanceof HTMLElement) {
          activeEl.blur();
        }
        setIsChatOpen(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isTyping =
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable);

      if (isTyping) {
        return;
      }

      const code = e.code;

      if (code === 'Space' && engineRef.current) {
        engineRef.current.isSpaceDown = false;
      }
      if ((code === 'ShiftLeft' || code === 'ShiftRight') && engineRef.current) {
        engineRef.current.isShiftDown = false;
      }

      if (code === 'ArrowUp' || code === 'KeyW') {
        engineRef.current?.setKeyboardKey('up', false);
      }
      if (code === 'ArrowLeft' || code === 'KeyA') {
        engineRef.current?.setKeyboardKey('left', false);
      }
      if (code === 'ArrowRight' || code === 'KeyD') {
        engineRef.current?.setKeyboardKey('right', false);
      }
    };

    const handleBlur = () => {
      engineRef.current?.resetKeyboardKeys();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [gameState]);

  const startGame = (name: string, skinId: string) => {
    setLastPlayerConfig({ name, skinId });
    const engine = engineRef.current;
    if (!engine) return;

    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    canvasRef.current?.focus();

    handleResize();
    engine.start(name, skinId, playerIdRef.current);
    if (lastMouseClientRef.current) {
      updateMousePosition(lastMouseClientRef.current.x, lastMouseClientRef.current.y);
    }
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
        tabIndex={0}
        onMouseMove={handleMouseMove}
        onMouseDown={(e) => {
          if (isChatOpen) {
            setIsChatOpen(false);
          }
          handleMouseDown(e);
        }}
        onMouseUp={handleMouseUp}
        onTouchStart={(e) => {
          if (isChatOpen) {
            setIsChatOpen(false);
          }
          handleTouchStart(e);
        }}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={`block w-full h-full touch-none ${
          gameState === 'gameover'
            ? isPanning
              ? 'cursor-grabbing'
              : 'cursor-grab'
            : 'cursor-crosshair'
        }`}
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
      {/* eslint-disable-next-line react-hooks/refs */}
      {gameState === 'playing' && engineRef.current && (
        <GameHUD
          /* eslint-disable-next-line react-hooks/refs */
          engine={engineRef.current}
          onlineCount={onlineCount}
          roomId={roomId}
          chatMessages={chatMessages}
          isChatOpen={isChatOpen}
          onChatOpenChange={setIsChatOpen}
          onSendMessage={handleSendMessage}
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

      {/* Radar Minimap during Game Over / Spectator Mode */}
      {/* eslint-disable-next-line react-hooks/refs */}
      {gameState === 'gameover' && engineRef.current && (
        <div className="hidden sm:block absolute bottom-6 right-6 z-30 pointer-events-auto animate-in fade-in duration-300">
          {/* eslint-disable-next-line react-hooks/refs */}
          <Minimap engine={engineRef.current} />
        </div>
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
