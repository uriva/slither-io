'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage } from '@/game/types';
import { MessageSquare, Send, X, CornerDownLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ChatOverlayProps {
  messages: ChatMessage[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSendMessage: (text: string) => void;
  playerName: string;
  isTouchDevice?: boolean;
}

export const ChatOverlay: React.FC<ChatOverlayProps> = ({
  messages,
  isOpen,
  onOpenChange,
  onSendMessage,
  playerName,
  isTouchDevice,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [isFaded, setIsFaded] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Focus management when chat opens
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 30);
      return () => clearTimeout(timer);
    } else {
      inputRef.current?.blur();
    }
  }, [isOpen]);

  // Auto-scroll messages list to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen]);

  // Fade timer for inactive chat when closed
  useEffect(() => {
    const fadeTimer = setTimeout(() => {
      setIsFaded(true);
    }, 8000);

    return () => clearTimeout(fadeTimer);
  }, [messages.length, isOpen]);

  // Handle send submission
  const handleSend = () => {
    const trimmed = inputValue.trim();
    if (trimmed) {
      onSendMessage(trimmed);
      setInputValue('');
    }
    onOpenChange(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Prevent game hotkeys (like Space to boost) while typing
    e.stopPropagation();

    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onOpenChange(false);
    }
  };

  const shouldDim = !isOpen && isFaded;

  return (
    <div
      className={`pointer-events-auto flex flex-col transition-all duration-300 w-72 sm:w-80 md:w-96 select-none ${
        isOpen
          ? 'opacity-100 z-30'
          : shouldDim
          ? 'opacity-40 hover:opacity-95'
          : 'opacity-90'
      }`}
    >
      {/* Messages Card */}
      <div className="bg-slate-950/80 border border-white/10 backdrop-blur-md rounded-xl p-2.5 sm:p-3 shadow-xl flex flex-col gap-2">
        {/* Header / Room Radio bar */}
        <div className="flex items-center justify-between border-b border-white/10 pb-1.5 text-xs font-mono text-slate-400">
          <button
            type="button"
            onClick={() => {
              setIsFaded(false);
              onOpenChange(!isOpen);
            }}
            className="flex items-center gap-1.5 text-cyan-400 hover:text-cyan-300 font-bold transition-colors cursor-pointer"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span className="uppercase tracking-wider text-[11px]">Arena Transmissions</span>
          </button>
          <div className="flex items-center gap-2">
            {!isOpen && (
              <span className="text-[10px] text-slate-400 bg-white/5 px-1.5 py-0.5 rounded border border-white/10">
                [Enter] to chat
              </span>
            )}
            {isOpen && (
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="text-slate-400 hover:text-white p-0.5 rounded transition-colors cursor-pointer"
                title="Close chat (Esc)"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Message Feed */}
        <div className="flex flex-col gap-1.5 overflow-y-auto max-h-36 sm:max-h-44 pr-1 text-xs font-mono scrollbar-thin scrollbar-thumb-white/10">
          {messages.length === 0 ? (
            <div className="text-slate-500 italic text-[11px] py-2 text-center">
              No arena messages yet. Press <strong className="text-cyan-400 font-semibold">[Enter]</strong> to broadcast!
            </div>
          ) : (
            messages.map((msg) => {
              const isMe = msg.isPlayer || msg.senderName === playerName;
              return (
                <div
                  key={msg.id}
                  className="flex items-start gap-1.5 break-words leading-snug animate-in fade-in duration-200"
                >
                  <span
                    className={`font-bold shrink-0 ${
                      isMe ? 'text-cyan-400' : 'text-pink-400'
                    }`}
                  >
                    {msg.senderName}:
                  </span>
                  <span className="text-slate-100 selection:bg-cyan-500/30">
                    {msg.text}
                  </span>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Chat Input Bar */}
        {isOpen ? (
          <div className="pt-1.5 border-t border-white/10 flex flex-col gap-1">
            <div className="flex items-center gap-1.5 bg-black/50 border border-cyan-500/40 focus-within:border-cyan-400 focus-within:ring-1 focus-within:ring-cyan-400 rounded-lg p-1 transition-all">
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                maxLength={80}
                placeholder="Type transmission... [Enter]"
                className="bg-transparent text-white placeholder-slate-500 text-xs font-mono px-2 py-1 outline-none w-full"
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                variant="default"
                size="icon-xs"
                onClick={handleSend}
                disabled={!inputValue.trim()}
                title="Send transmission (Enter)"
                className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold h-7 w-7 rounded shrink-0 transition-transform active:scale-95 cursor-pointer"
              >
                <Send className="w-3 h-3" />
              </Button>
            </div>
            <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 px-1">
              <span>Press <strong className="text-slate-400">Enter</strong> to send</span>
              <span><strong className="text-slate-400">Esc</strong> to cancel</span>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setIsFaded(false);
              onOpenChange(true);
            }}
            className="w-full text-left py-1 px-2 rounded bg-white/5 hover:bg-white/10 border border-white/5 transition-colors flex items-center justify-between text-[11px] font-mono text-slate-400 group cursor-pointer"
          >
            <span className="truncate group-hover:text-slate-200">
              {isTouchDevice ? 'Tap here to chat...' : 'Press [Enter] to send a message...'}
            </span>
            <CornerDownLeft className="w-3 h-3 text-slate-500 group-hover:text-cyan-400 shrink-0 ml-1" />
          </button>
        )}
      </div>
    </div>
  );
};
