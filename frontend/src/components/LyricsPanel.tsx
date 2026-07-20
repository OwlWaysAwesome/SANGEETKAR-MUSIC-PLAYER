import React, { useEffect, useState, useRef, useCallback } from 'react';
import { BACKEND_URL } from '../config';

interface LyricLine {
  time: number;  // seconds
  text: string;
}

interface LyricsPanelProps {
  currentTrack: { title: string; author: string; videoId: string } | null;
  progress: number; // current playback time in seconds
}

type LyricsState = 'idle' | 'loading' | 'found' | 'not_found' | 'error';

const parseLRC = (lrc: string): LyricLine[] => {
  const lines: LyricLine[] = [];
  const regex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)/;

  for (const line of lrc.split('\n')) {
    const match = line.match(regex);
    if (match) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const ms = parseInt(match[3].padEnd(3, '0'), 10);
      const time = minutes * 60 + seconds + ms / 1000;
      const text = match[4].trim();
      if (text) {
        lines.push({ time, text });
      }
    }
  }

  return lines.sort((a, b) => a.time - b.time);
};

const cleanTitle = (title: string): string => {
  // Remove common YouTube suffixes and noise
  return title
    .replace(/\s*\(.*?(official|video|audio|lyric|visualizer|hd|hq|4k).*?\)/gi, '')
    .replace(/\s*\[.*?(official|video|audio|lyric|visualizer|hd|hq|4k).*?\]/gi, '')
    .replace(/\s*[-|]\s*(official|video|audio|lyric|visualizer).*$/gi, '')
    .replace(/\s*ft\.?\s*.*/gi, '')
    .replace(/\s*feat\.?\s*.*/gi, '')
    .trim();
};

const LyricsPanel: React.FC<LyricsPanelProps> = ({ currentTrack, progress }) => {
  const [state, setState] = useState<LyricsState>('idle');
  const [syncedLyrics, setSyncedLyrics] = useState<LyricLine[]>([]);
  const [plainLyrics, setPlainLyrics] = useState<string>('');
  const [activeLine, setActiveLine] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastTrackId = useRef<string | null>(null);
  const lineRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const fetchLyrics = useCallback(async (title: string, artist: string) => {
    setState('loading');
    setSyncedLyrics([]);
    setPlainLyrics('');
    setActiveLine(-1);

    try {
      const cleanedTitle = cleanTitle(title);
      const res = await fetch(
        `${BACKEND_URL}/api/lyrics?title=${encodeURIComponent(cleanedTitle)}&artist=${encodeURIComponent(artist)}`,
        {
          headers: {
            'ngrok-skip-browser-warning': 'true',
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
          }
        }
      );

      if (!res.ok) {
        setState('not_found');
        return;
      }

      const data = await res.json();

      if (data.syncedLyrics) {
        const parsed = parseLRC(data.syncedLyrics);
        if (parsed.length > 0) {
          setSyncedLyrics(parsed);
          setState('found');
          return;
        }
      }

      if (data.plainLyrics) {
        setPlainLyrics(data.plainLyrics);
        setState('found');
        return;
      }

      setState('not_found');
    } catch (e) {
      console.error('[Lyrics] Fetch error:', e);
      setState('error');
    }
  }, []);

  // Fetch lyrics when track changes
  useEffect(() => {
    if (!currentTrack) {
      setState('idle');
      lastTrackId.current = null;
      return;
    }

    if (currentTrack.videoId === lastTrackId.current) return;
    lastTrackId.current = currentTrack.videoId;

    fetchLyrics(currentTrack.title, currentTrack.author);
  }, [currentTrack, fetchLyrics]);

  // Update active line based on playback progress
  useEffect(() => {
    if (syncedLyrics.length === 0) return;

    let currentLine = -1;
    for (let i = syncedLyrics.length - 1; i >= 0; i--) {
      if (progress >= syncedLyrics[i].time - 0.3) {
        currentLine = i;
        break;
      }
    }

    if (currentLine !== activeLine) {
      setActiveLine(currentLine);
    }
  }, [progress, syncedLyrics, activeLine]);

  // Auto-scroll to active line
  useEffect(() => {
    if (activeLine < 0) return;

    const lineEl = lineRefs.current.get(activeLine);
    if (lineEl && containerRef.current) {
      lineEl.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [activeLine]);

  const setLineRef = useCallback((index: number, el: HTMLDivElement | null) => {
    if (el) {
      lineRefs.current.set(index, el);
    } else {
      lineRefs.current.delete(index);
    }
  }, []);

  if (state === 'idle') {
    return (
      <div className="text-center text-white/30 text-sm py-12 flex flex-col items-center gap-3">
        <svg className="w-10 h-10 text-white/15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
        </svg>
        <p>Play a song to see lyrics</p>
      </div>
    );
  }

  if (state === 'loading') {
    return (
      <div className="text-center text-white/40 text-sm py-12 flex flex-col items-center gap-3">
        <div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
        <p>Searching for lyrics...</p>
      </div>
    );
  }

  if (state === 'not_found') {
    return (
      <div className="text-center text-white/30 text-sm py-12 flex flex-col items-center gap-3">
        <svg className="w-10 h-10 text-white/15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" />
        </svg>
        <p>No lyrics found</p>
        <p className="text-[11px] text-white/20">for "{currentTrack?.title}"</p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="text-center text-red-400/60 text-sm py-12 flex flex-col items-center gap-3">
        <svg className="w-10 h-10 text-red-400/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <p>Failed to load lyrics</p>
      </div>
    );
  }

  // Synced lyrics
  if (syncedLyrics.length > 0) {
    return (
      <div ref={containerRef} className="lyrics-container flex flex-col px-5 py-6 overflow-y-auto h-full [&::-webkit-scrollbar]:w-[5px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-full">
        <div className="min-h-[30vh]" /> {/* Top padding for scroll centering */}
        {syncedLyrics.map((line, i) => (
          <div
            key={i}
            ref={(el) => setLineRef(i, el)}
            className={`lyrics-line py-2 px-2 rounded-lg transition-all duration-500 ease-out cursor-default ${
              i === activeLine
                ? 'text-white text-lg font-semibold lyrics-active scale-[1.02]'
                : i < activeLine
                ? 'text-white/20 text-base'
                : 'text-white/35 text-base'
            }`}
          >
            {line.text}
          </div>
        ))}
        <div className="min-h-[40vh]" /> {/* Bottom padding for scroll centering */}
      </div>
    );
  }

  // Plain lyrics fallback
  return (
    <div ref={containerRef} className="lyrics-container flex flex-col px-5 py-6 overflow-y-auto h-full [&::-webkit-scrollbar]:w-[5px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-full">
      {plainLyrics.split('\n').map((line, i) => (
        <div
          key={i}
          className={`py-1.5 px-2 text-white/50 text-sm leading-relaxed ${
            line.trim() === '' ? 'h-4' : ''
          }`}
        >
          {line || '\u00A0'}
        </div>
      ))}
    </div>
  );
};

export default LyricsPanel;
