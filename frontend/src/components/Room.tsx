import React, { useEffect, useState, useRef, useCallback } from 'react';
import { socket, getServerTime } from '../lib/socket';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Play, Disc3, Search, Plus, ListMusic, Trash2, Volume2, GripVertical, Link, Loader2, Repeat, Shuffle, Shield, ShieldOff, Mic2 } from 'lucide-react';
import { FastAverageColor } from 'fast-average-color';
import { BACKEND_URL } from '../config';
import { useToast } from './Toast';
import { useFloatingReactions, ReactionOverlay, ReactionButton } from './FloatingReactions';
import LyricsPanel from './LyricsPanel';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface RoomProps {
  roomId: string;
}

interface SearchResult {
  id?: string;
  videoId: string;
  title: string;
  author: string;
  thumbnail: string;
}

function SortableQueueItem({ item, isHost, onPlay }: any) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: item.id || item.videoId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 'auto',
  };

  return (
    <div 
      ref={setNodeRef} 
      style={style} 
      className={`flex items-center gap-3 px-4 py-3 transition-colors group border-b border-white/5 touch-pan-y ${isDragging ? 'bg-white/15 scale-[1.02] shadow-2xl opacity-90 rounded-lg' : 'hover:bg-white/5 bg-transparent'}`}
    >
      <div 
        className="relative w-10 h-10 flex-shrink-0 cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          onPlay();
        }}
      >
        <img src={item.thumbnail} alt={item.title} className="w-full h-full rounded object-cover bg-white/5 pointer-events-none" />
        {isHost && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded z-10 pointer-events-none">
            <Play className="text-white w-5 h-5 fill-current ml-0.5 pointer-events-none" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="text-sm text-white/90 truncate leading-snug">{item.title}</h4>
        <p className="text-[11px] text-white/40 truncate mt-0.5">{item.author}</p>
      </div>
      {isHost && (
        <div 
          className="text-white/15 hover:text-white/40 cursor-grab active:cursor-grabbing p-1.5 -mr-1 flex-shrink-0 transition-colors"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="w-4 h-4" />
        </div>
      )}
    </div>
  );
}

const Room: React.FC<RoomProps> = ({ roomId }) => {
  const [isHost, setIsHost] = useState(false);
  const [videoId, setVideoId] = useState<string | null>(null);
  
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Import state
  const [importUrl, setImportUrl] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState('');

  // Queue state
  const [queue, setQueue] = useState<SearchResult[]>([]);
  const [history, setHistory] = useState<SearchResult[]>([]);
  
  // Playlists state
  const [activeTab, setActiveTab] = useState<'queue' | 'playlists' | 'history' | 'people'>('queue');
  const [users, setUsers] = useState<any[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [expandedPlaylists, setExpandedPlaylists] = useState<Set<number>>(new Set());
  
  // Player state
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTrack, setCurrentTrack] = useState<SearchResult | null>(null);
  const [thumbnailError, setThumbnailError] = useState(false);
  const [dominantColor, setDominantColor] = useState('#a855f7');
  const [showLyrics, setShowLyrics] = useState(false);

  const { user } = useAuth();
  const navigate = useNavigate();
  const { showToast } = useToast();
  
  const { reactions, isOpen: reactionOpen, setIsOpen: setReactionOpen, sendReaction, popoverRef } = useFloatingReactions(roomId, user?.username);
  const [allowGuestControl, setAllowGuestControl] = useState(true);
  const [loopMode, setLoopMode] = useState<'off' | 'track' | 'queue'>('off');
  const [isShuffle, setIsShuffle] = useState(false);
  const [volume, setVolume] = useState(100);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSeeking = useRef(false);

  // --- Refs to avoid stale closures in socket callbacks ---
  const isHostRef = useRef(isHost);
  const allowGuestControlRef = useRef(allowGuestControl);
  const historyRef = useRef(history);
  const videoIdRef = useRef(videoId);
  const isPlayingRef = useRef(isPlaying);
  const isTransitioningRef = useRef(false);

  const executePlayNext = useCallback(() => {
    if (!isHostRef.current && !allowGuestControlRef.current) return;
    isTransitioningRef.current = true;
    socket.emit('host:play_next', { roomId });
  }, [roomId]);

  const playNext = useCallback(() => {
    if (!isHostRef.current && !allowGuestControlRef.current) return;
    executePlayNext();
  }, [executePlayNext]);

  useEffect(() => { isHostRef.current = isHost; }, [isHost]);
  useEffect(() => { allowGuestControlRef.current = allowGuestControl; }, [allowGuestControl]);
  useEffect(() => { historyRef.current = history; }, [history]);
  useEffect(() => { 
    videoIdRef.current = videoId;
    // When videoId changes, update the audio source
    if (audioRef.current && videoId) {
      const newSrc = `${BACKEND_URL}/api/stream/${videoId}`;
      if (audioRef.current.src !== newSrc) {
        audioRef.current.src = newSrc;
        audioRef.current.load();
        audioRef.current.play().catch(e => console.warn('[Jammer] Auto-play blocked:', e));
      }
    } else if (audioRef.current && !videoId) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
    }
  }, [videoId]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  // Set up audio element event listeners
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPlay = () => {
      setIsPlaying(true);
      isTransitioningRef.current = false;
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
    };
    const onPause = () => {
      setIsPlaying(false);
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    };
    const onEnded = () => {
      setIsPlaying(false);
      if (isHostRef.current && !isTransitioningRef.current) {
        playNext();
      }
    };
    const onError = () => {
      console.error('[Jammer] Audio element error for video:', videoIdRef.current, audio.error);
      showToast('Playback failed — skipping...', 'error');
      if (isHostRef.current && !isTransitioningRef.current) {
        isTransitioningRef.current = true;
        setTimeout(() => {
          isTransitioningRef.current = false;
          playNext();
        }, 500);
      }
    };

    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  }, [playNext]);


  useEffect(() => {
    const workerCode = `
      let timer = null;
      self.onmessage = function(e) {
        if (e.data === 'start') {
          if (!timer) timer = setInterval(() => self.postMessage('tick'), 500);
        } else if (e.data === 'stop') {
          clearInterval(timer);
          timer = null;
        }
      };
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    workerRef.current = new Worker(URL.createObjectURL(blob));
    return () => workerRef.current?.terminate();
  }, []);

  useEffect(() => {
    if (!workerRef.current) return;
    const handleTick = () => {
      if (audioRef.current && !isSeeking.current) {
        const currentTime = audioRef.current.currentTime || 0;
        const dur = audioRef.current.duration || 0;
        setProgress(currentTime);
        if (dur && !isNaN(dur)) setDuration(dur);

        // Pre-empt the track 1.5 seconds before it ends to maintain the active media session
        if (isHostRef.current && dur > 0 && (dur - currentTime) <= 1.5 && !isTransitioningRef.current) {
          playNext();
        }
      }
    };

    workerRef.current.onmessage = handleTick;
    if (isPlaying) {
      workerRef.current.postMessage('start');
    } else {
      workerRef.current.postMessage('stop');
    }
  }, [isPlaying, roomId]);

  // Listen for background tab heartbeat from extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "JAMMER_EXTENSION_HEARTBEAT") {
        if (audioRef.current && !isSeeking.current) {
          const currentTime = audioRef.current.currentTime || 0;
          const dur = audioRef.current.duration || 0;
          
          if (isHostRef.current && dur > 0 && (dur - currentTime) <= 1.5 && !isTransitioningRef.current) {
            playNext();
          }
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [roomId]);

  // --- Socket setup (runs ONCE on mount) ---
  useEffect(() => {
    
    socket.on('force_disconnect', (data) => {
      showToast(data.reason === 'banned' ? 'You have been banned from this room.' : 'You have been kicked from this room.', 'error', 5000);
      navigate('/');
    });

    const join = () => {
      console.log(`[Jammer] Emitting join_room for`, roomId);
      socket.emit('join_room', { roomId, user });
    };

    if (socket.connected) {
      join();
    } else {
      socket.on('connect', join);
    }

    socket.on('role_assigned', (data: { isHost: boolean }) => {
      console.log('[Jammer] role_assigned:', data.isHost ? 'Host' : 'Listener');
      setIsHost(data.isHost);
    });

    socket.on('user:joined', (data: { id: string, username: string, avatar?: string }) => {
      showToast(`${data.username} joined the room`, 'info', 3000, data.avatar);
    });

    socket.on('user:left', (data: { username: string, avatar?: string }) => {
      showToast(`${data.username} left the room`, 'info', 3000, data.avatar);
    });

    // Full room state on join — hydrates queue + currently playing track
    socket.on('room_state', (room: any) => {
      console.log('[Jammer] room_state received:', room);
      if (!room) return;
      
      const isActualHost = room.hostId === user?.id || room.users?.find((u: any) => u.id === socket.id)?.isHost || false;
      setIsHost(isActualHost);
      
      setAllowGuestControl(room.allowGuestControl ?? true);
      setLoopMode(room.loopMode || 'off');
      setIsShuffle(room.isShuffle || false);
      if (room.queue) setQueue(room.queue);
      if (room.history) setHistory(room.history);
      if (room.currentVideoId !== undefined) {
        setVideoId(room.currentVideoId);
        setThumbnailError(false);
      }
      if (room.currentTrack !== undefined) {
        setCurrentTrack(room.currentTrack);
      }
      if (room.users) {
        setUsers(room.users);
      }
    });

    socket.on('queue_updated', (newQueue: SearchResult[]) => {
      console.log('[Jammer] queue_updated received, length:', newQueue?.length ?? 0);
      setQueue(newQueue || []);
    });

    socket.on('history_updated', (newHistory: SearchResult[]) => {
      console.log('[Jammer] history_updated received, length:', newHistory?.length ?? 0);
      setHistory(newHistory || []);
    });

    socket.on('sync:play', (data: { videoId: string, timestamp: number, executeAt: number, track?: any }) => {
      console.log('[Jammer] sync:play received:', data.videoId, '@', data.timestamp);
      
      if (data.track) {
        setCurrentTrack(data.track);
      }
      
      // Update videoId if it changed — the useEffect on videoId will update audio src
      if (data.videoId !== videoIdRef.current) {
        setVideoId(data.videoId);
        setThumbnailError(false);
      }

      const delay = data.executeAt - getServerTime();

      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);

      const executePlay = () => {
        if (audioRef.current) {
          // If same video, seek and play. If new video, the useEffect handles src change.
          if (data.videoId === videoIdRef.current && audioRef.current.src.includes(data.videoId)) {
            audioRef.current.currentTime = data.timestamp;
          }
          audioRef.current.play().catch(e => console.warn('[Jammer] Play blocked:', e));
        }
      };

      if (delay <= 0 || document.hidden) {
        executePlay();
      } else {
        syncTimeoutRef.current = setTimeout(executePlay, delay);
      }
    });

    socket.on('sync:pause', (data: { timestamp: number }) => {
      console.log('[Jammer] sync:pause received @', data.timestamp);
      if (audioRef.current) {
        audioRef.current.currentTime = data.timestamp;
        audioRef.current.pause();
      }
    });

    socket.on('sync:seek', (data: { timestamp: number, executeAt: number }) => {
      console.log('[Jammer] sync:seek received @', data.timestamp);
      if (audioRef.current) {
        const delay = data.executeAt - getServerTime();
        if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
        const executeSeek = () => {
          if (audioRef.current) audioRef.current.currentTime = data.timestamp;
          setProgress(data.timestamp);
        };
        if (delay <= 0 || document.hidden) {
          executeSeek();
        } else {
          syncTimeoutRef.current = setTimeout(executeSeek, delay);
        }
      }
    });

    return () => {
      socket.off('connect', join);
      socket.off('role_assigned');
      socket.off('room_state');
      socket.off('queue_updated');
      socket.off('force_disconnect');
      socket.off('history_updated');
      socket.off('user:joined');
      socket.off('user:left');
      socket.off('sync:play');
      socket.off('sync:pause');
      socket.off('sync:seek');
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    };
  }, [roomId]); // Only depends on roomId — no more videoId in deps

  useEffect(() => {
    if (currentTrack) {
      document.title = `${currentTrack.title} • Sangeetkar`;
      
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: currentTrack.title,
          artist: currentTrack.author || 'Sangeetkar',
          artwork: [
            { src: `https://img.youtube.com/vi/${currentTrack.videoId}/maxresdefault.jpg`, sizes: '1280x720', type: 'image/jpeg' },
            { src: `https://img.youtube.com/vi/${currentTrack.videoId}/hqdefault.jpg`, sizes: '480x360', type: 'image/jpeg' },
            { src: `https://img.youtube.com/vi/${currentTrack.videoId}/mqdefault.jpg`, sizes: '320x180', type: 'image/jpeg' },
            { src: `https://img.youtube.com/vi/${currentTrack.videoId}/default.jpg`, sizes: '120x90', type: 'image/jpeg' }
          ]
        });

        navigator.mediaSession.setActionHandler('play', togglePlay);
        navigator.mediaSession.setActionHandler('pause', togglePlay);
        navigator.mediaSession.setActionHandler('previoustrack', playPrevious);
        navigator.mediaSession.setActionHandler('nexttrack', playNext);
      }
    } else {
      document.title = 'Sangeetkar';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack]);

  // Fetch user playlists
  useEffect(() => {
    if (activeTab === 'playlists') {
      fetchPlaylists();
    }
  }, [activeTab]);

  const fetchPlaylists = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/playlists`, { 
        credentials: 'include',
        headers: {
          'ngrok-skip-browser-warning': 'true',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setPlaylists(data);
      }
    } catch (e) {
      console.error('Failed to fetch playlists', e);
    }
  };



  const addPlaylistToQueueBulk = (playlist: any) => {
    try {
      const tracks = JSON.parse(playlist.tracks);
      console.log('[Jammer] addPlaylistToQueueBulk — emitting host:queue_add_bulk', { roomId, trackCount: tracks.length, firstTrack: tracks[0] });
      socket.emit('host:queue_add_bulk', { roomId, items: tracks });
      setActiveTab('queue'); // Switch back to queue to see them
    } catch (e) {
      console.error('Failed to parse playlist tracks', e);
    }
  };

  const deletePlaylist = async (playlistId: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/playlists/${playlistId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          'ngrok-skip-browser-warning': 'true',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      });
      if (res.ok) {
        setPlaylists(prev => prev.filter(p => p.id !== playlistId));
      } else {
        console.error('Failed to delete playlist:', await res.text());
      }
    } catch (e) {
      console.error('Failed to delete playlist', e);
    }
  };

  const handleImportPlaylist = async () => {
    if (!importUrl.trim() || !isHost) return;
    setIsImporting(true);
    setImportError('');
    try {
      const res = await fetch(`${BACKEND_URL}/api/playlists/import`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        credentials: 'include',
        body: JSON.stringify({ url: importUrl.trim() })
      });
      if (!res.ok) {
        const data = await res.json();
        setImportError(data.error || 'Import failed');
        return;
      }
      const playlist = await res.json();
      // Bulk-add the imported tracks to the live queue
      const tracks = JSON.parse(playlist.tracks);
      socket.emit('host:queue_add_bulk', { roomId, items: tracks });
      setImportUrl('');
      setActiveTab('queue');
      showToast(`Imported ${tracks.length} tracks!`, 'success');
    } catch (e) {
      console.error('Import failed', e);
      setImportError('Network error. Please try again.');
    } finally {
      setIsImporting(false);
    }
  };



  const playTrackImmediate = (track: SearchResult) => {
    if (!isHost) return;
    setCurrentTrack(track);
    setVideoId(track.videoId);
    setThumbnailError(false);
    socket.emit('host:play_track', { roomId, track, timestamp: 0 });
  };



  const searchYouTube = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/search?q=${encodeURIComponent(searchQuery)}`, {
        headers: {
          'ngrok-skip-browser-warning': 'true',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      });
      const data = await res.json();
      setSearchResults(data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSearching(false);
    }
  };

  const addToQueue = (item: SearchResult) => {
    socket.emit('host:queue_add', { roomId, item });
    showToast(`Added "${item.title}"`, 'success');
    setSearchResults([]);
    setSearchQuery('');
  };

  // playNext and executePlayNext are defined at the top of the file

  const playPrevious = () => {
    if ((!isHostRef.current && !allowGuestControlRef.current) || historyRef.current.length === 0) return;
    isTransitioningRef.current = true;
    socket.emit('host:play_previous', { roomId });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setQueue((items) => {
        const oldIndex = items.findIndex((i) => (i.id || i.videoId) === active.id);
        const newIndex = items.findIndex((i) => (i.id || i.videoId) === over.id);
        const newQueue = arrayMove(items, oldIndex, newIndex);
        socket.emit('host:reorder_queue', { roomId, newQueue });
        return newQueue;
      });
    }
  };

  const togglePlay = () => {
    if ((!isHostRef.current && !allowGuestControlRef.current) || !audioRef.current) return;
    const timestamp = audioRef.current.currentTime || 0;
    if (isPlayingRef.current) {
      socket.emit('host:pause', { roomId, timestamp });
    } else {
      const currentVid = videoIdRef.current;
      socket.emit('host:play', { roomId, videoId: currentVid, timestamp });
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isHost && !allowGuestControl) return;
    setProgress(Number(e.target.value));
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value);
    setVolume(val);
    if (audioRef.current) {
      audioRef.current.volume = val / 100;
    }
  };

  const toggleLoop = () => {
    if (!isHost && !allowGuestControl) return;
    const nextMode = loopMode === 'off' ? 'track' : loopMode === 'track' ? 'queue' : 'off';
    socket.emit('host:set_loop', { roomId, mode: nextMode });
  };

  const toggleShuffle = () => {
    if (!isHost && !allowGuestControl) return;
    socket.emit('host:set_shuffle', { roomId, shuffle: !isShuffle });
  };

  const toggleGuestControl = () => {
    if (!isHost) return;
    socket.emit('host:toggle_guest_control', { roomId, allow: !allowGuestControl });
  };

  const handleSeekCommit = (e: React.MouseEvent<HTMLInputElement> | React.TouchEvent<HTMLInputElement>) => {
    if ((!isHost && !allowGuestControl) || !audioRef.current) return;
    isSeeking.current = false;
    const newTime = Number((e.target as HTMLInputElement).value);
    socket.emit('host:seek', { roomId, timestamp: newTime });
  };

  const formatTime = (time: number) => {
    if (!time || isNaN(time)) return '0:00';
    const MathFloor = Math.floor;
    const m = MathFloor(time / 60);
    const s = MathFloor(time % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const thumbnailUrl = videoId 
    ? (thumbnailError 
        ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` 
        : `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`)
    : null;

  useEffect(() => {
    if (!thumbnailUrl) {
      setDominantColor('#a855f7');
      return;
    }
    const fac = new FastAverageColor();
    fac.getColorAsync(thumbnailUrl, { algorithm: 'dominant', crossOrigin: 'anonymous' })
      .then(color => {
        setDominantColor(color.hex);
      })
      .catch(e => {
        console.warn('CORS issue extracting color from YouTube thumbnail, falling back to default', e);
        setDominantColor('#a855f7');
      });
  }, [thumbnailUrl]);

  return (
    <div className="h-screen w-full flex flex-col md:flex-row bg-background relative overflow-hidden" style={{ '--theme-color': dominantColor } as React.CSSProperties}>
      <div className="ambient-mesh"></div>

      {/* Left Column (The Stage) - 70% */}
      <section className={`flex-1 h-screen md:h-full flex flex-col relative p-6 md:p-10 z-10 transition-all duration-300 ${isSidebarOpen ? 'lg:max-w-[70%]' : 'lg:max-w-full'}`}>
        
        {/* Top Header Area */}
        <header className="flex justify-between items-center w-full z-20 mb-6 flex-shrink-0">
          <div className="flex items-center gap-3">
            <h1 className="text-base text-white/90 font-playfair font-normal uppercase tracking-[0.2em]">SANGEETKAR</h1>
          </div>
          <div className="flex items-center gap-2">
            <div 
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-white/10 glass-panel cursor-pointer hover:bg-white/10 transition-colors" 
              onClick={() => { navigator.clipboard.writeText(window.location.href); showToast('Room link copied!', 'info'); }} 
              title="Copy Room Link"
            >
              <Link className="w-3.5 h-3.5 text-white/40" />
              <span className="text-[11px] text-white/60 uppercase tracking-widest font-medium truncate max-w-[80px]">{roomId}</span>
            </div>
            {isHost && (
              <button 
                onClick={toggleGuestControl} 
                className={`px-3 py-1.5 rounded-full border border-white/10 glass-panel transition-colors flex items-center justify-center ${allowGuestControl ? 'hover:bg-emerald-500/10' : 'hover:bg-white/10'}`} 
                title={allowGuestControl ? "Guest control enabled" : "Guest control disabled"}
              >
                {allowGuestControl ? <Shield className="w-3.5 h-3.5 text-emerald-400" /> : <ShieldOff className="w-3.5 h-3.5 text-white/40" />}
              </button>
            )}
            <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-white/10 glass-panel">
              <span className={`w-2 h-2 rounded-full ${isHost ? 'bg-fuchsia-500' : 'bg-emerald-400'} animate-pulse`}></span>
              <span className="text-[11px] text-white/60 uppercase tracking-widest font-medium">{isHost ? 'Host' : 'Listener'}</span>
            </div>
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="px-3.5 py-1.5 rounded-full border border-white/10 glass-panel hover:bg-white/10 transition-colors hidden lg:flex items-center justify-center text-white/60 hover:text-white"
              title="Toggle Sidebar"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="15" y1="3" x2="15" y2="21"></line>
              </svg>
            </button>
          </div>
        </header>

        {/* Hidden Audio Player — streams from backend proxy, bypasses embedding restrictions */}
        <audio ref={audioRef} preload="auto" style={{ display: 'none' }} />

        {/* Floating Reactions Overlay */}
        <ReactionOverlay reactions={reactions} />

        {/* Center: Album Artwork Display & Lyrics Flip Card */}
        <div className="flex-grow flex items-center justify-center relative w-full mb-6 z-10 min-h-0 perspective-1000">
          <div 
            className={`relative w-full max-w-md mx-auto aspect-square group transition-all duration-700 transform-style-3d ${showLyrics ? 'rotate-y-180' : ''}`}
          >
            {/* FRONT FACE (Album Art) */}
            <div className={`absolute inset-0 backface-hidden ${isHost && !showLyrics ? 'cursor-pointer' : ''}`} onClick={isHost && !showLyrics ? togglePlay : undefined}>
              <div className="media-glow"></div>
              {thumbnailUrl ? (
                <img 
                  src={thumbnailUrl} 
                  crossOrigin="anonymous"
                  onError={() => setThumbnailError(true)}
                  alt="Album Art" 
                  className="relative w-full h-full object-cover rounded-2xl border border-white/10 z-10 transition-transform duration-700 group-hover:scale-[1.02]"
                  style={{ boxShadow: '0 0 80px -20px var(--theme-color)' }}
                />
              ) : (
                <div className="relative w-full h-full glass-panel rounded-2xl flex items-center justify-center shadow-2xl border border-white/10 z-10">
                  <Disc3 className="w-24 h-24 text-white/20" />
                </div>
              )}
              
              {/* Playback indicator / Central motif when paused or waiting */}
              {!isPlaying && videoId && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
                  <div className="w-32 h-32 rounded-full border border-white/10 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <Play className="w-12 h-12 text-white/70 fill-current ml-2" />
                  </div>
                </div>
              )}
            </div>

            {/* BACK FACE (Lyrics) */}
            <div className="absolute inset-0 backface-hidden rotate-y-180 glass-panel rounded-2xl border border-white/10 overflow-hidden shadow-2xl z-20" style={{ boxShadow: '0 0 80px -20px var(--theme-color)' }}>
               {/* We keep LyricsPanel mounted so it can track progress and auto-scroll even if flipped back */}
               <LyricsPanel currentTrack={currentTrack} progress={progress} />
            </div>
          </div>
        </div>

        {/* Bottom: Media Control Bar */}
        <footer className="glass-panel rounded-2xl p-5 flex flex-col gap-5 flex-shrink-0 relative overflow-hidden group/footer z-20 w-full max-w-3xl mx-auto">
          {/* Hover gradient effect */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/3 to-transparent opacity-0 group-hover/footer:opacity-100 transition-opacity duration-1000 -translate-x-full group-hover/footer:translate-x-full ease-in-out pointer-events-none"></div>
          
          {/* Top Row: Track Info & Secondary Controls */}
          <div className="flex justify-between items-center px-1">
            <div className="flex flex-col max-w-[60%]">
              <h3 className="text-base text-white font-medium truncate leading-tight">{currentTrack ? currentTrack.title : 'Nothing Playing'}</h3>
              {!currentTrack ? (
                <p className="text-sm text-white/40 truncate mt-0.5">Add tracks to get started</p>
              ) : (
                <p className="text-sm text-white/50 truncate mt-0.5">{currentTrack.author}</p>
              )}
            </div>
            
            <div className="flex items-center gap-4">
              {!isHost && (
                <div className="flex gap-2 items-center bg-white/5 px-3 py-1 rounded-full border border-white/10 mr-2">

                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span className="text-[10px] uppercase tracking-wider text-white/50">Synced</span>
                </div>
              )}
              <div className="flex items-center gap-2 group relative">
                <Volume2 className="text-white/30 hover:text-white/70 transition-colors cursor-pointer w-5 h-5" />
                <input 
                  type="range" min="0" max="100" value={volume} onChange={handleVolumeChange}
                  className="w-20 h-1 bg-white/20 rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Middle Row: Timeline inline */}
          <div className="w-full flex items-center gap-4 relative">
            <span className="text-[11px] text-white/40 w-10 text-right tabular-nums">{formatTime(progress)}</span>
            <div className="flex-1 h-[4px] bg-white/10 rounded-full relative group/progress">
               <input 
                 type="range" 
                 min="0" 
                 max={duration || 100} 
                 value={progress}
                 onChange={handleSeek}
                 onMouseDown={() => { isSeeking.current = true; }}
                 onTouchStart={() => { isSeeking.current = true; }}
                 onMouseUp={handleSeekCommit}
                 onTouchEnd={handleSeekCommit}
                 disabled={!isHost && !allowGuestControl}
                 className={`absolute inset-0 w-full h-full appearance-none cursor-pointer focus:outline-none focus:ring-0 z-10 bg-transparent [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-amber-400 [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(251,191,36,0.8)] [&::-webkit-slider-thumb]:transition-transform hover:[&::-webkit-slider-thumb]:scale-150 [&::-webkit-slider-thumb]:opacity-0 group-hover/progress:[&::-webkit-slider-thumb]:opacity-100 ${!isHost && !allowGuestControl ? 'cursor-not-allowed' : ''}`}
               />
               <div className="absolute top-0 left-0 h-full rounded-full pointer-events-none"
                    style={{ 
                      width: `${(progress / (duration || 1)) * 100}%`,
                      background: 'linear-gradient(90deg, var(--theme-color, #3626ce) 0%, rgba(255,255,255,0.8) 100%)' 
                    }}>
               </div>
            </div>
            <span className="text-[11px] text-white/40 w-10 tabular-nums">{formatTime(duration)}</span>
          </div>

          {/* Bottom Row: Controls */}
          
          <div className="flex justify-center items-center gap-8 relative w-full">
             
             {/* Left side actions (Reactions & Shuffle) */}
             <div className="flex items-center gap-4 absolute left-0">
               <ReactionButton 
                 isOpen={reactionOpen} 
                 setIsOpen={setReactionOpen} 
                 sendReaction={sendReaction} 
                 popoverRef={popoverRef} 
               />
               <button 
                 onClick={toggleShuffle}
                 disabled={!isHost && !allowGuestControl}
                 className={`transition-colors ${isShuffle ? 'text-primary' : 'text-on-surface-variant hover:text-primary'} disabled:opacity-30 disabled:hover:text-on-surface-variant`}
               >
                 <Shuffle className="w-6 h-6" />
               </button>
             </div>

             {/* Center play controls */}
             <div className={`flex items-center gap-6 ${!isHost && !allowGuestControl ? 'opacity-40 pointer-events-none' : ''}`}>
               <button 
                 onClick={playPrevious}
                 disabled={(!isHost && !allowGuestControl) || history.length === 0}
               className="text-on-surface-variant hover:text-primary transition-colors disabled:opacity-30 disabled:hover:text-on-surface-variant"
             >
               <span className="material-symbols-outlined text-3xl"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/></svg></span>
             </button>

             <button 
               onClick={togglePlay}
               disabled={!videoId || (!isHost && !allowGuestControl)}
               className="w-16 h-16 flex-shrink-0 rounded-full bg-primary text-background flex items-center justify-center shadow-[0_0_20px_rgba(255,255,255,0.4)] hover:shadow-[0_0_30px_rgba(255,255,255,0.6)] hover:scale-105 transition-all duration-300 disabled:opacity-50 disabled:hover:scale-100 disabled:shadow-none"
             >
               {isPlaying ? (
                 <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
               ) : (
                 <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" className="ml-1"><polygon points="5 3 19 12 5 21 5 3"/></svg>
               )}
             </button>

             <button 
               onClick={playNext}
               disabled={(!isHost && !allowGuestControl) || (!currentTrack && queue.length === 0)}
               className="text-on-surface-variant hover:text-primary transition-colors disabled:opacity-30 disabled:hover:text-on-surface-variant"
             >
               <span className="material-symbols-outlined text-3xl"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg></span>
             </button>

             </div>

             {/* Right side actions (Loop & Lyrics) */}
             <div className="flex items-center gap-4 absolute right-0">
               <button 
                 onClick={toggleLoop}
                 disabled={!isHost && !allowGuestControl}
                 className={`relative transition-colors ${loopMode !== 'off' ? 'text-primary' : 'text-on-surface-variant hover:text-primary'} disabled:opacity-30 disabled:hover:text-on-surface-variant`}
               >
                 <Repeat className="w-6 h-6" />
                 {loopMode === 'track' && <span className="absolute -bottom-1 -right-2 text-[10px] bg-primary text-background rounded-full w-4 h-4 flex items-center justify-center font-bold">1</span>}
               </button>
               <button 
                 onClick={() => setShowLyrics(!showLyrics)}
                 className={`transition-colors ${showLyrics ? 'text-primary' : 'text-on-surface-variant hover:text-primary'}`}
                 title="Toggle Lyrics"
               >
                 <Mic2 className="w-6 h-6" />
               </button>
             </div>
          </div>

        </footer>
      </section>

      {/* Right Column: The Sidebar (30%) */}
      {isSidebarOpen && (
        <section className="w-full md:w-[30%] h-[50vh] md:h-screen glass-panel border-t md:border-t-0 md:border-l border-white/5 flex flex-col z-20 animate-in fade-in slide-in-from-right-4 duration-300">
        
        {/* Search Bar */}
        {isHost && (
          <div className="p-4 border-b border-white/5 relative flex flex-col gap-3 flex-shrink-0">
            {/* Search */}
            <div className="relative w-full">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30 w-4 h-4 z-10" />
              <input 
                type="text" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchYouTube()}
                placeholder="Search to add..." 
                className="w-full bg-white/5 border border-white/10 rounded-lg py-2.5 pl-10 pr-4 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/20 focus:bg-white/8 transition-all duration-300"
              />
            </div>
            {/* Import URL */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Link className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 w-4 h-4" />
                <input 
                  type="text" 
                  value={importUrl}
                  onChange={(e) => { setImportUrl(e.target.value); setImportError(''); }}
                  onKeyDown={(e) => e.key === 'Enter' && handleImportPlaylist()}
                  placeholder="Paste Spotify / Apple / YT link..." 
                  className="w-full bg-white/5 border border-white/10 rounded-lg py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/20 focus:bg-white/8 transition-all duration-300"
                />
              </div>
              <button
                onClick={handleImportPlaylist}
                disabled={isImporting || !importUrl.trim()}
                className="px-3 py-2.5 rounded-lg bg-white/10 border border-white/10 text-white/70 hover:bg-white/15 hover:text-white transition-all text-xs font-medium disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5 flex-shrink-0"
              >
                {isImporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Import
              </button>
            </div>
            {importError && (
              <p className="text-red-400/80 text-[11px] -mt-1">{importError}</p>
            )}
            {/* Search Results Dropdown */}
            {isSearching ? (
              <div className="absolute top-full left-4 right-4 mt-1 bg-[#1a1a22]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl z-50 p-4 text-center text-white/40 text-sm">
                <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-white/30" />
                Searching YouTube...
              </div>
            ) : searchResults.length > 0 && (
              <div className="absolute top-full left-4 right-4 mt-1 bg-[#1a1a22]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl z-50 max-h-[350px] overflow-y-auto">
                {searchResults.map((res, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 hover:bg-white/5 transition-colors border-b border-white/5 last:border-0 group/res cursor-pointer" onClick={() => addToQueue(res)}>
                    <img src={res.thumbnail} alt={res.title} className="w-10 h-10 object-cover rounded bg-white/5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-white/90 text-sm font-medium truncate">{res.title}</p>
                      <p className="text-white/40 text-[11px] truncate">{res.author}</p>
                    </div>
                    <button className="text-white/30 group-hover/res:text-white/70 transition-colors p-1.5 opacity-0 group-hover/res:opacity-100">
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab Selectors */}
        <div className="flex gap-6 px-4 pt-3 border-b border-white/5 flex-shrink-0">
          <button 
            onClick={() => setActiveTab('queue')}
            className="pb-3 relative group"
          >
            <span className={`text-[11px] tracking-widest uppercase font-medium ${activeTab === 'queue' ? 'text-white' : 'text-white/40 group-hover:text-white/70'} transition-colors`}>Queue ({queue.length})</span>
            <div className={`absolute bottom-0 left-0 h-[2px] bg-white rounded-t-full transition-all duration-300 ${activeTab === 'queue' ? 'w-full' : 'w-0 group-hover:w-full opacity-30'}`}></div>
          </button>
          <button 
            onClick={() => setActiveTab('playlists')}
            className="pb-3 relative group"
          >
            <span className={`text-[11px] tracking-widest uppercase font-medium ${activeTab === 'playlists' ? 'text-white' : 'text-white/40 group-hover:text-white/70'} transition-colors`}>My Playlists</span>
            <div className={`absolute bottom-0 left-0 h-[2px] bg-white rounded-t-full transition-all duration-300 ${activeTab === 'playlists' ? 'w-full' : 'w-0 group-hover:w-full opacity-30'}`}></div>
          </button>
          <button 
            onClick={() => setActiveTab('history')}
            className="pb-3 relative group whitespace-nowrap"
          >
            <span className={`text-[11px] tracking-widest uppercase font-medium ${activeTab === 'history' ? 'text-white' : 'text-white/40 group-hover:text-white/70'} transition-colors`}>History</span>
            <div className={`absolute bottom-0 left-0 h-[2px] bg-white rounded-t-full transition-all duration-300 ${activeTab === 'history' ? 'w-full' : 'w-0 group-hover:w-full opacity-30'}`}></div>
          </button>
          <button 
            onClick={() => setActiveTab('people')}
            className="pb-3 relative group whitespace-nowrap"
          >
            <span className={`text-[11px] tracking-widest uppercase font-medium ${activeTab === 'people' ? 'text-white' : 'text-white/40 group-hover:text-white/70'} transition-colors`}>People ({users.length})</span>
            <div className={`absolute bottom-0 left-0 h-[2px] bg-white rounded-t-full transition-all duration-300 ${activeTab === 'people' ? 'w-full' : 'w-0 group-hover:w-full opacity-30'}`}></div>
          </button>
        </div>

        {/* Scrolling List Content */}
        <div className="flex-1 overflow-y-auto flex flex-col [&::-webkit-scrollbar]:w-[5px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-white/20">
          {activeTab === 'queue' ? (
            <>
              {(!currentTrack && queue.length === 0) ? (
                <div className="text-center text-white/30 text-sm py-12 flex flex-col items-center gap-3">
                   <ListMusic className="w-10 h-10 text-white/15" />
                   <p>Queue is empty</p>
                </div>
              ) : (
                <>
                  {currentTrack && (
                    <>
                      <div className="flex items-center gap-3 px-4 py-3 transition-all bg-white/8 relative border-b border-white/5">
                        <div className="absolute left-0 top-0 h-full w-1 bg-fuchsia-500 rounded-r-full"></div>
                        <div className="relative w-10 h-10 flex-shrink-0">
                          <img src={currentTrack.thumbnail} alt={currentTrack.title} className="w-full h-full rounded object-cover bg-white/5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm text-white/90 truncate leading-snug">{currentTrack.title}</h4>
                          <p className="text-[10px] text-fuchsia-400 truncate mt-0.5 tracking-widest uppercase font-medium">Playing Now</p>
                        </div>
                      </div>
                      {queue.length > 0 && (
                        <div className="px-4 py-2 bg-black/40 border-b border-white/5 text-[10px] tracking-widest uppercase text-white/40 font-medium flex items-center justify-between">
                          <span>Up Next</span>
                        </div>
                      )}
                    </>
                  )}
                  
                  <DndContext 
                    sensors={sensors} 
                    collisionDetection={closestCenter} 
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext 
                      items={queue.map(item => item.id || item.videoId)} 
                      strategy={verticalListSortingStrategy}
                    >
                      {queue.map((item, index) => (
                        <SortableQueueItem 
                          key={item.id || item.videoId} 
                          item={item} 
                          index={index} 
                          isHost={isHost} 
                          onPlay={() => playTrackImmediate(item)} 
                        />
                      ))}
                    </SortableContext>
                  </DndContext>
                </>
              )}
            </>
          
          ) : activeTab === 'people' ? (
            <div className="flex flex-col p-4 gap-2">
              {users.map((u, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/5 hover:bg-white/10 transition-colors group">
                  <div className="relative">
                    <img src={u.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.username || 'User')}&background=random`} alt={u.username || 'User'} className="w-10 h-10 rounded-full object-cover bg-black/40" />
                    {u.isHost && (
                      <div className="absolute -bottom-1 -right-1 bg-fuchsia-500 w-4 h-4 rounded-full border-2 border-[#131317] flex items-center justify-center" title="Host">
                        <span className="text-white text-[10px] leading-none mb-[1px]">★</span>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-medium text-white/90 truncate">{u.username || 'Anonymous Listener'} {user?.id === u.id && '(You)'}</h4>
                    <p className="text-[10px] text-white/40 tracking-widest uppercase mt-0.5">{u.isHost ? 'Host' : 'Listener'}</p>
                  </div>
                  {isHost && u.id !== socket.id && (
                    <div className="relative">
                       <button onClick={() => {
                         socket.emit('host:kick_user', { roomId, targetSocketId: u.id });
                         showToast(`Kicked ${u.username || 'user'}`, 'warning');
                       }} className="text-[10px] bg-white/10 hover:bg-white/20 px-2 py-1 rounded mr-2">Kick</button>
                       <button onClick={() => {
                         socket.emit('host:ban_user', { roomId, targetSocketId: u.id });
                         showToast(`Banned ${u.username || 'user'}`, 'error');
                       }} className="text-[10px] bg-red-500/20 text-red-400 hover:bg-red-500/40 px-2 py-1 rounded">Ban</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
) : activeTab === 'history' ? (
            <>
              {history.length === 0 ? (
                <div className="text-center text-white/30 text-sm py-12 flex flex-col items-center gap-3">
                   <ListMusic className="w-10 h-10 text-white/15" />
                   <p>No history yet</p>
                </div>
              ) : (
                <div className="flex flex-col">
                  {/* Reverse history to show most recently played first */}
                  {[...history].reverse().map((item, index) => (
                    <div 
                      key={index} 
                      className="flex items-center gap-3 px-4 py-3 transition-colors group border-b border-white/5 hover:bg-white/5 bg-transparent"
                    >
                      <div 
                        className="relative w-10 h-10 flex-shrink-0 cursor-pointer"
                        onClick={() => playTrackImmediate(item)}
                      >
                        <img src={item.thumbnail} alt={item.title} className="w-full h-full rounded object-cover bg-white/5 pointer-events-none" />
                        {isHost && (
                          <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded z-10 pointer-events-none">
                            <Play className="text-white w-5 h-5 fill-current ml-0.5 pointer-events-none" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm text-white/90 truncate leading-snug">{item.title}</h4>
                        <p className="text-[11px] text-white/40 truncate mt-0.5">{item.author}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              {/* Playlists view */}

              {playlists.length === 0 ? (
                <div className="text-center text-white/30 text-sm py-8 flex flex-col items-center gap-3">
                  <Disc3 className="w-10 h-10 text-white/15" />
                  <p>No playlists saved</p>
                </div>
              ) : (
                playlists.map((pl, i) => {
                  const tracks = JSON.parse(pl.tracks);
                  const isExpanded = expandedPlaylists.has(i);
                  return (
                    <div key={i} className="flex flex-col rounded-xl group border border-white/5 bg-white/5 mx-3 mb-2 overflow-hidden">
                      <div className="flex items-center gap-3 p-3">
                        <div 
                          className="w-12 h-12 rounded bg-black/40 flex items-center justify-center border border-white/5 flex-shrink-0 cursor-pointer hover:bg-white/10 transition-colors"
                          onClick={() => {
                            setExpandedPlaylists(prev => {
                              const next = new Set(prev);
                              if (next.has(i)) next.delete(i);
                              else next.add(i);
                              return next;
                            });
                          }}
                        >
                           <Disc3 className="w-6 h-6 text-on-surface-variant group-hover:text-primary transition-colors" />
                        </div>
                        <div 
                          className="flex-1 min-w-0 cursor-pointer"
                          onClick={() => {
                            setExpandedPlaylists(prev => {
                              const next = new Set(prev);
                              if (next.has(i)) next.delete(i);
                              else next.add(i);
                              return next;
                            });
                          }}
                        >
                          <p className="text-white/90 text-sm font-medium truncate hover:text-white transition-colors">{pl.name}</p>
                          <p className="text-white/40 text-[11px] truncate mt-0.5">{tracks.length} tracks</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          {isHost && (
                            <button 
                              onClick={() => addPlaylistToQueueBulk(pl)}
                              className="text-primary hover:bg-white/10 p-2 rounded-full transition-all flex items-center justify-center"
                              title="Add all to Queue"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          )}
                          <button 
                            onClick={() => deletePlaylist(pl.id)}
                            className="text-red-400 hover:bg-red-500/20 p-2 rounded-full transition-all flex items-center justify-center"
                            title="Delete playlist"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      
                      {isExpanded && (
                        <div className="border-t border-white/5 bg-black/40 p-2 max-h-60 overflow-y-auto flex flex-col gap-1">
                          {tracks.map((track: any, idx: number) => (
                            <div key={idx} className="flex items-center gap-3 p-2 hover:bg-white/5 rounded-lg group/track transition-colors">
                              <span className="text-on-surface-variant font-label-caps text-[10px] w-4 text-right">{idx + 1}</span>
                              <img src={track.thumbnail} alt={track.title} className="w-8 h-8 object-cover rounded bg-white/5" />
                              <div className="flex-1 min-w-0">
                                <p className="text-white/80 text-xs font-medium truncate">{track.title}</p>
                                <p className="text-white/40 text-[10px] truncate">{track.author}</p>
                              </div>
                              {isHost && (
                                <button 
                                  onClick={() => socket.emit('host:queue_add', { roomId, item: track })}
                                  className="text-primary opacity-0 group-hover/track:opacity-100 hover:bg-white/10 p-1.5 rounded-full transition-all"
                                  title="Add track to queue"
                                >
                                  <Plus className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </>
          )}
        </div>
      </section>
      )}
    </div>
  );
};

export default Room;
