import React, { useState, useEffect, useCallback, useRef } from 'react';
import { socket } from '../lib/socket';

interface FloatingReaction {
  id: string;
  emoji: string;
  x: number;
}

const REACTION_EMOJIS = ['🫪', '😍', '🫶🏻', '🌸', '🕺', '💃'];

// Export the hook for use in Room.tsx controls
export const useFloatingReactions = (roomId: string, username?: string) => {
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const lastSentRef = useRef<number>(0);
  const cleanupTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const popoverRef = useRef<HTMLDivElement>(null);

  const addReaction = useCallback((emoji: string) => {
    const id = `r-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const x = 15 + Math.random() * 70;
    setReactions(prev => [...prev, { id, emoji, x }]);

    const timer = setTimeout(() => {
      setReactions(prev => prev.filter(r => r.id !== id));
      cleanupTimers.current.delete(id);
    }, 2500);
    cleanupTimers.current.set(id, timer);
  }, []);

  useEffect(() => {
    const handleReaction = (data: { emoji: string }) => {
      addReaction(data.emoji);
    };
    socket.on('reaction:broadcast', handleReaction);
    return () => {
      socket.off('reaction:broadcast', handleReaction);
      cleanupTimers.current.forEach(timer => clearTimeout(timer));
      cleanupTimers.current.clear();
    };
  }, [addReaction]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  const sendReaction = useCallback((emoji: string) => {
    const now = Date.now();
    if (now - lastSentRef.current < 300) return;
    lastSentRef.current = now;
    socket.emit('reaction:send', { roomId, emoji, username });
    addReaction(emoji);
  }, [roomId, username, addReaction]);

  return { reactions, isOpen, setIsOpen, sendReaction, popoverRef, REACTION_EMOJIS };
};

// The floating emoji overlay (rendered in the stage area)
export const ReactionOverlay: React.FC<{ reactions: FloatingReaction[] }> = ({ reactions }) => (
  <div className="absolute inset-0 pointer-events-none overflow-hidden z-30">
    {reactions.map((r) => (
      <div
        key={r.id}
        className="reaction-float absolute bottom-0"
        style={{ left: `${r.x}%` }}
      >
        <span className="text-4xl md:text-5xl drop-shadow-lg">{r.emoji}</span>
      </div>
    ))}
  </div>
);

// The reaction button + popover (rendered inline in controls)
export const ReactionButton: React.FC<{
  isOpen: boolean;
  setIsOpen: (v: boolean) => void;
  sendReaction: (emoji: string) => void;
  popoverRef: React.RefObject<HTMLDivElement | null>;
}> = ({ isOpen, setIsOpen, sendReaction, popoverRef }) => (
  <div className="relative" ref={popoverRef}>
    <button
      onClick={() => setIsOpen(!isOpen)}
      className={`transition-colors ${isOpen ? 'text-primary' : 'text-on-surface-variant hover:text-primary'}`}
      title="Reactions"
    >
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M8 14s1.5 2 4 2 4-2 4-2" />
        <line x1="9" y1="9" x2="9.01" y2="9" />
        <line x1="15" y1="9" x2="15.01" y2="9" />
      </svg>
    </button>

    {/* Vertical emoji popover */}
    {isOpen && (
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 flex flex-col items-center gap-1 p-1.5 rounded-2xl glass-panel border border-white/10 shadow-2xl emoji-popover">
        {REACTION_EMOJIS.map((emoji, i) => (
          <button
            key={emoji}
            onClick={() => { sendReaction(emoji); setIsOpen(false); }}
            className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-white/10 active:scale-90 transition-all duration-150 text-xl hover:scale-125"
            style={{ animationDelay: `${i * 40}ms` }}
            title={emoji}
          >
            {emoji}
          </button>
        ))}
      </div>
    )}
  </div>
);

export { REACTION_EMOJIS };
export type { FloatingReaction };
