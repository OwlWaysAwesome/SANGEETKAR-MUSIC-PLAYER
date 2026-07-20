import React, { useState, useEffect, useCallback, useRef } from 'react';
import { socket } from '../lib/socket';

interface FloatingReaction {
  id: string;
  emoji: string;
  x: number;       // random horizontal position (%)
  username?: string;
}

interface FloatingReactionsProps {
  roomId: string;
  username?: string;
}

const REACTION_EMOJIS = ['🫪', '😍', '🫶🏻', '🌸', '🕺', '💃'];

const FloatingReactions: React.FC<FloatingReactionsProps> = ({ roomId, username }) => {
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const lastSentRef = useRef<number>(0);
  const cleanupTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const addReaction = useCallback((emoji: string, fromUsername?: string) => {
    const id = `r-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const x = 10 + Math.random() * 80; // 10% to 90% of width
    const reaction: FloatingReaction = { id, emoji, x, username: fromUsername };

    setReactions(prev => [...prev, reaction]);

    // Auto-remove after animation completes (2.5s)
    const timer = setTimeout(() => {
      setReactions(prev => prev.filter(r => r.id !== id));
      cleanupTimers.current.delete(id);
    }, 2500);
    cleanupTimers.current.set(id, timer);
  }, []);

  // Listen for broadcast reactions from other users
  useEffect(() => {
    const handleReaction = (data: { emoji: string; username?: string }) => {
      addReaction(data.emoji, data.username);
    };

    socket.on('reaction:broadcast', handleReaction);
    return () => {
      socket.off('reaction:broadcast', handleReaction);
      // Cleanup all timers
      cleanupTimers.current.forEach(timer => clearTimeout(timer));
      cleanupTimers.current.clear();
    };
  }, [addReaction]);

  const sendReaction = (emoji: string) => {
    const now = Date.now();
    // Rate limit: max 1 reaction per 300ms
    if (now - lastSentRef.current < 300) return;
    lastSentRef.current = now;

    socket.emit('reaction:send', { roomId, emoji, username });
    // Also show locally immediately
    addReaction(emoji, username);
  };

  return (
    <>
      {/* Floating emojis layer */}
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

      {/* Reaction bar */}
      <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1">
        <div className="flex items-center gap-1 px-3 py-2 rounded-2xl glass-panel border border-white/10 shadow-2xl reaction-bar">
          {REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => sendReaction(emoji)}
              className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-white/10 active:scale-90 transition-all duration-150 text-2xl hover:scale-125"
              title={`React with ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </>
  );
};

export default FloatingReactions;
