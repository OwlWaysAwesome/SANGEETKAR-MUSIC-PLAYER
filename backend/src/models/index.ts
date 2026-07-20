export interface User {
  id: string;
  socketId?: string;
  isHost: boolean;
  roomId: string;
  username?: string;
  avatar?: string;
}

export interface QueueItem {
  id?: string;
  videoId: string;
  title: string;
  author: string;
  thumbnail: string;
}

export interface Room {
  id: string;
  hostId: string;
  users: User[];
  currentVideoId: string | null;
  currentTrack: QueueItem | null;
  status: 'playing' | 'paused';
  currentTimestamp: number;
  lastUpdatedServerTime: number;
  queue: QueueItem[];
  history: QueueItem[];
  allowGuestControl: boolean;
  bannedUsers: string[];
  loopMode: 'off' | 'track' | 'queue';
  isShuffle: boolean;
}

export interface SyncPlayCommand {
  videoId: string;
  timestamp: number;
  executeAt: number; // The exact server time playback should start
  track?: QueueItem;
}

export interface SyncPauseCommand {
  timestamp: number;
}

export interface SyncSeekCommand {
  timestamp: number;
  executeAt: number;
}
