import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import ytSearch from 'yt-search';
import { Innertube } from 'youtubei.js';
import { PrismaClient } from '@prisma/client';
import { RoomManager } from './managers/RoomManager';
import { SyncPlayCommand, SyncPauseCommand, SyncSeekCommand } from './models';
import { parseSpotify, parseAppleMusic, parseYouTube } from './utils/importer';

// Initialize Prisma
const prisma = new PrismaClient();

// Initialize Innertube singleton for audio streaming
let innertubeInstance: Innertube | null = null;
async function getInnertube(): Promise<Innertube> {
  if (!innertubeInstance) {
    innertubeInstance = await Innertube.create();
    console.log('[Innertube] Initialized successfully');
  }
  return innertubeInstance;
}
// Pre-warm at startup
getInnertube().catch(e => console.error('[Innertube] Failed to pre-warm:', e));

const allowedOrigins = process.env.FRONTEND_URL 
  ? process.env.FRONTEND_URL.split(',') 
  : ['http://localhost:5173', 'http://127.0.0.1:5173'];

const app = express();
app.set('trust proxy', 1); // Trust the first proxy (e.g., ngrok) to allow secure cookies over HTTP proxy
app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey';

// --- Auth Routes ---
app.get('/api/auth/discord', (req, res) => {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirectUri = encodeURIComponent(process.env.DISCORD_REDIRECT_URI as string);
  if (!clientId || clientId === 'YOUR_DISCORD_CLIENT_ID') {
    return res.status(400).send('Discord OAuth is not configured. Please set DISCORD_CLIENT_ID.');
  }
  const discordUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=identify`;
  res.redirect(discordUrl);
});

app.get('/api/auth/discord/callback', async (req, res) => {
  const code = req.query.code as string;
  if (!code) return res.status(400).send('No code provided');

  try {
    const params = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID!,
      client_secret: process.env.DISCORD_CLIENT_SECRET!,
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.DISCORD_REDIRECT_URI as string
    });

    const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const userResponse = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenResponse.data.access_token}` }
    });

    const discordUser = userResponse.data;

    let user = await prisma.user.findUnique({ where: { discordId: discordUser.id } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          discordId: discordUser.id,
          username: discordUser.username,
          avatar: discordUser.avatar
            ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
            : null
        }
      });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}?token=${token}`);
  } catch (error: any) {
    console.error('Discord auth error:', error.response?.data || error.message || error);
    res.status(500).send('Authentication failed');
  }
});

app.get('/api/auth/mock', async (req, res) => {
  try {
    let user = await prisma.user.findUnique({ where: { discordId: 'mock-id' } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          discordId: 'mock-id',
          username: 'MockUser',
          avatar: null
        }
      });
    }
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('auth_token', token, { httpOnly: true, secure: false, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 7 });
    res.redirect(process.env.FRONTEND_URL || 'http://localhost:5173');
  } catch (error) {
    res.status(500).send('Mock auth failed');
  }
});

app.get('/api/auth/me', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user) return res.status(401).json({ error: 'User not found' });
    res.json(user);
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

app.get('/api/auth/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.json({ success: true });
});

// --- Search Route ---
app.get('/api/search', async (req, res) => {
  const q = req.query.q as string;
  if (!q) return res.status(400).json({ error: 'Query required' });
  try {
    const r = await ytSearch(q);
    const videos = r.videos.slice(0, 5).map(v => ({
      videoId: v.videoId,
      title: v.title,
      author: v.author.name,
      thumbnail: v.thumbnail
    }));
    res.json(videos);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// --- Audio Stream Proxy ---
// Cache resolved audio URLs and required headers for 5 minutes to avoid repeated yt-dlp calls
const audioUrlCache = new Map<string, { url: string; headers: Record<string, string>; expires: number }>();

app.get('/api/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'Invalid video ID' });
  }

  try {
    // Check cache first
    let streamUrl: string;
    let proxyHeaders: Record<string, string> = {};
    const cached = audioUrlCache.get(videoId);
    
    if (cached && cached.expires > Date.now()) {
      streamUrl = cached.url;
      proxyHeaders = { ...cached.headers };
    } else {
      // Use yt-dlp to extract the direct audio stream URL and required headers
      const { execSync } = require('child_process');
      const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const result = execSync(
        `yt-dlp -f bestaudio -j --no-warnings "${ytUrl}"`,
        { encoding: 'utf-8', timeout: 30000, maxBuffer: 10 * 1024 * 1024 }
      ).trim();

      const data = JSON.parse(result);
      if (!data || !data.url) {
        return res.status(404).json({ error: 'Could not extract audio URL' });
      }

      streamUrl = data.url;
      proxyHeaders = data.http_headers || {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      };
      
      // Cache for 5 minutes (YouTube URLs typically expire in 6 hours)
      audioUrlCache.set(videoId, { url: streamUrl, headers: proxyHeaders, expires: Date.now() + 5 * 60 * 1000 });
      console.log(`[Stream] Resolved audio URL for ${videoId} (cached for 5 min)`);
    }

    // Proxy the audio stream with Range header support for seeking
    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      proxyHeaders['Range'] = rangeHeader;
    }

    const audioResponse = await axios.get(streamUrl, {
      headers: proxyHeaders,
      responseType: 'stream',
      validateStatus: (status) => status >= 200 && status < 300,
    });

    // Forward relevant headers
    res.status(audioResponse.status);
    if (audioResponse.headers['content-type']) {
      res.setHeader('Content-Type', audioResponse.headers['content-type'] as string);
    }
    if (audioResponse.headers['content-length']) {
      res.setHeader('Content-Length', audioResponse.headers['content-length'] as string);
    }
    if (audioResponse.headers['content-range']) {
      res.setHeader('Content-Range', audioResponse.headers['content-range'] as string);
    }
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Access-Control-Allow-Origin', '*');

    audioResponse.data.pipe(res);

    req.on('close', () => {
      audioResponse.data.destroy();
    });
  } catch (error: any) {
    console.error('[Stream] Error streaming audio for', videoId, ':', error.message || error);
    // Clear cached URL if it failed (might be expired)
    audioUrlCache.delete(videoId);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to stream audio' });
    }
  }
});

// --- Playlist Routes ---
app.post('/api/playlists/import', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user) return res.status(401).json({ error: 'User not found' });

    const parsePromise = (async () => {
      if (url.includes('spotify.com')) {
        return await parseSpotify(url);
      } else if (url.includes('apple.com')) {
        return await parseAppleMusic(url);
      } else if (url.includes('youtube.com') || url.includes('youtu.be')) {
        return await parseYouTube(url);
      } else {
        throw new Error('Unsupported platform');
      }
    })();

    const timeoutPromise = new Promise<any>((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT')), 15000)
    );

    let parsed;
    try {
      parsed = await Promise.race([parsePromise, timeoutPromise]);
    } catch (e: any) {
      if (e.message === 'TIMEOUT') {
        console.error('Import timed out for url:', url);
        return res.status(504).json({ error: "Import timed out. The platform may be rate-limiting requests." });
      }
      if (e.message === 'Unsupported platform') {
        return res.status(400).json({ error: 'Unsupported platform' });
      }
      throw e;
    }

    const playlist = await prisma.playlist.create({
      data: {
        name: parsed.title,
        userId: user.id,
        tracks: JSON.stringify(parsed.tracks)
      }
    });

    res.json(playlist);
  } catch (error) {
    console.error('Import error:', error);
    return res.status(500).json({ error: 'Failed to process playlist.' });
  }
});

app.get('/api/playlists', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    const playlists = await prisma.playlist.findMany({
      where: { userId: decoded.userId }
    });
    res.json(playlists);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch playlists' });
  }
});

// --- Delete Playlist Route ---
app.delete('/api/playlists/:id', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    const playlist = await prisma.playlist.findUnique({ where: { id: req.params.id } });

    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
    if (playlist.userId !== decoded.userId) return res.status(403).json({ error: 'Forbidden' });

    await prisma.playlist.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete playlist error:', error);
    return res.status(500).json({ error: 'Failed to delete playlist' });
  }
});

// --- Stream Route ---
app.get('/api/stream/:videoId', (req, res) => {
  // Local streaming proxy deactivated in favor of direct client-side Iframe / Extension rendering
  res.status(410).json({ 
    error: 'Backend streaming is deprecated. Please use client-side playback engines.' 
  });
});

// --- Rooms Route ---
app.post('/api/rooms', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    const crypto = require('crypto');
    const roomId = crypto.randomBytes(3).toString('hex');

    console.log('Creating room with Host ID:', decoded.userId);
    roomManager.createRoom(roomId, decoded.userId);
    res.json({ roomId });
  } catch (error) {
    console.error('Room creation error:', error);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// --- Socket.io ---
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

const roomManager = new RoomManager();
const BUFFER_DELAY_MS = 500;

const checkControlPermission = (room: any, socketId: string): boolean => {
  const user = room.users.find((u: any) => u.socketId === socketId || u.id === socketId);
  if (!user) return false;
  return user.isHost || room.allowGuestControl;
};

io.on('connection', (socket: Socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('ntp:sync', (data: { clientSendTime: number }) => {
    socket.emit('ntp:reply', {
      clientSendTime: data.clientSendTime,
      serverTime: Date.now()
    });
  });

  const socketRoomMap = new Map<string, string>();

  socket.on('join_room', async (payload: { roomId: string } | string) => {
    console.log("RAW SOCKET COOKIES:", socket.handshake.headers.cookie);
    const roomId = typeof payload === 'string' ? payload : payload?.roomId;
    if (!roomId) return;

    // Extract DB user ID from JWT if available
    let dbUserId = null;
    const token = socket.handshake.auth?.token || null;

    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
        dbUserId = decoded.userId;
      } catch (e) {
        // Ignored
      }
    }
    let username = undefined;
    let avatar = undefined;
    if (dbUserId) {
      try {
        const dbUser = await prisma.user.findUnique({ where: { id: dbUserId } });
        if (dbUser) {
          username = dbUser.username;
          avatar = dbUser.avatar || undefined;
        }
      } catch (e) {
        console.error("Failed to fetch user for socket:", e);
      }
    }

    const user = roomManager.joinRoom(roomId, socket.id, dbUserId, username, avatar);
    if (dbUserId) user.id = dbUserId;
    user.socketId = socket.id;
    socket.join(roomId);
    socketRoomMap.set(socket.id, roomId);

    socket.emit('role_assigned', { isHost: user.isHost });

    const room = roomManager.getRoom(roomId);
    if (room) {
      console.log('Evaluating Host for Socket:', socket.id, 'DB User:', dbUserId, 'Room Host:', room.hostId);
      io.to(roomId).emit('room_state', room);
    }

    console.log(`[join_room] Socket ${socket.id} (DB User: ${dbUserId || 'None'}) successfully joined ${roomId} as ${user.isHost ? 'Host' : 'Listener'}`);
  });

  socket.on('disconnect', () => {
    const roomId = socketRoomMap.get(socket.id);
    if (roomId) {
      roomManager.leaveRoom(roomId, socket.id);
      socketRoomMap.delete(socket.id);
      const room = roomManager.getRoom(roomId);
      if (room) io.to(roomId).emit('room_state', room);
      console.log(`User ${socket.id} left room ${roomId}`);
    }
  });

  socket.on('host:play', (data: { roomId: string, videoId: string, timestamp: number }) => {
    const room = roomManager.getRoom(data.roomId);
    if (!room) return;
    if (!checkControlPermission(room, socket.id)) return;

    roomManager.updateRoomState(data.roomId, {
      currentVideoId: data.videoId,
      status: 'playing',
      currentTimestamp: data.timestamp
    });

    const command: SyncPlayCommand = {
      videoId: data.videoId,
      timestamp: data.timestamp,
      executeAt: Date.now() + BUFFER_DELAY_MS,
      track: room.currentTrack || undefined
    };
    io.to(data.roomId).emit('sync:play', command);
  });

  socket.on('host:pause', (data: { roomId: string, timestamp: number }) => {
    const room = roomManager.getRoom(data.roomId);
    if (!room) return;
    if (!checkControlPermission(room, socket.id)) return;

    roomManager.updateRoomState(data.roomId, {
      status: 'paused',
      currentTimestamp: data.timestamp
    });

    const command: SyncPauseCommand = { timestamp: data.timestamp };
    io.to(data.roomId).emit('sync:pause', command);
  });

  socket.on('host:seek', (data: { roomId: string, timestamp: number }) => {
    const room = roomManager.getRoom(data.roomId);
    if (!room) return;
    if (!checkControlPermission(room, socket.id)) return;

    roomManager.updateRoomState(data.roomId, { currentTimestamp: data.timestamp });
    const command: SyncSeekCommand = { timestamp: data.timestamp, executeAt: Date.now() + BUFFER_DELAY_MS };
    io.to(data.roomId).emit('sync:seek', command);
  });

  socket.on('host:queue_add', (data: { roomId: string, item: any }) => {
    console.log(`[host:queue_add] Received for room ${data.roomId}, track: ${data.item?.title}`);

    // Ensure the room exists (handles race condition after server restart)
    const room = roomManager.ensureRoom(data.roomId);

    if (!checkControlPermission(room, socket.id)) return;

    const crypto = require('crypto');
    const newItem = { ...data.item, id: data.item.id || crypto.randomUUID() };
    room.queue.push(newItem);
    console.log(`[host:queue_add] ✅ Queue now has ${room.queue.length} items`);

    // Auto-play: if nothing is currently playing, pop first track and start it
    if (!room.currentVideoId && room.queue.length > 0) {
      const firstTrack = room.queue.shift()!;
      room.currentVideoId = firstTrack.videoId;
      room.currentTrack = firstTrack;
      room.status = 'playing';
      room.currentTimestamp = 0;
      room.lastUpdatedServerTime = Date.now();

      console.log(`[host:queue_add] 🎵 Auto-playing first track: ${firstTrack.title}`);

      const command: SyncPlayCommand = {
        videoId: firstTrack.videoId,
        timestamp: 0,
        executeAt: Date.now() + BUFFER_DELAY_MS,
        track: firstTrack
      };
      io.to(data.roomId).emit('sync:play', command);
    }

    io.to(data.roomId).emit('queue_updated', room.queue);
  });

  socket.on('host:queue_add_bulk', (data: { roomId: string, items: any[] }) => {
    console.log(`[host:queue_add_bulk] Received for room ${data.roomId}, ${data.items?.length ?? 0} tracks`);

    if (!data.items || data.items.length === 0) {
      console.log(`[host:queue_add_bulk] REJECTED — empty items array`);
      return;
    }

    // Ensure the room exists (handles race condition after server restart)
    const room = roomManager.ensureRoom(data.roomId);

    if (!checkControlPermission(room, socket.id)) return;

    const crypto = require('crypto');
    const newItems = data.items.map(item => ({ ...item, id: item.id || crypto.randomUUID() }));
    // Push all tracks into the queue
    room.queue.push(...newItems);
    console.log(`[host:queue_add_bulk] ✅ Queue now has ${room.queue.length} items`);

    // Auto-play: if nothing is currently playing, pop first track and start it
    if (!room.currentVideoId && room.queue.length > 0) {
      const firstTrack = room.queue.shift()!;
      room.currentVideoId = firstTrack.videoId;
      room.currentTrack = firstTrack;
      room.status = 'playing';
      room.currentTimestamp = 0;
      room.lastUpdatedServerTime = Date.now();

      console.log(`[host:queue_add_bulk] 🎵 Auto-playing first track: ${firstTrack.title} (${firstTrack.videoId})`);

      const command: SyncPlayCommand = {
        videoId: firstTrack.videoId,
        timestamp: 0,
        executeAt: Date.now() + BUFFER_DELAY_MS,
        track: firstTrack
      };
      io.to(data.roomId).emit('sync:play', command);
    }

    // Broadcast updated queue to all clients
    console.log(`[host:queue_add_bulk] Broadcasting queue_updated with ${room.queue.length} items to room ${data.roomId}`);
    io.to(data.roomId).emit('queue_updated', room.queue);
  });

  socket.on('host:play_next', (data: { roomId: string }) => {
    console.log('[host:play_next] Received for room ' + data.roomId);
    const room = roomManager.getRoom(data.roomId);
    if (!room) return;
    if (!checkControlPermission(room, socket.id)) return;

    if (room.loopMode === 'track' && room.currentTrack) {
      roomManager.updateRoomState(data.roomId, { status: 'playing', currentTimestamp: 0 });
      const command = { videoId: room.currentTrack.videoId, timestamp: 0, executeAt: Date.now() + 500, track: room.currentTrack };
      io.to(data.roomId).emit('sync:play', command);
      return;
    }

    if (room.currentTrack) {
      if (room.loopMode === 'queue') {
        room.queue.push(room.currentTrack);
      }
      room.history.push(room.currentTrack);
      io.to(data.roomId).emit('history_updated', room.history);
    }

    let nextItem = null;
    if (room.queue.length > 0) {
      if (room.isShuffle) {
        const randomIndex = Math.floor(Math.random() * room.queue.length);
        nextItem = room.queue.splice(randomIndex, 1)[0];
      } else {
        nextItem = room.queue.shift();
      }
    }

    if (nextItem) {
      roomManager.updateRoomState(data.roomId, {
        currentVideoId: nextItem.videoId,
        currentTrack: nextItem,
        status: 'playing',
        currentTimestamp: 0
      });
      const command = { videoId: nextItem.videoId, timestamp: 0, executeAt: Date.now() + 500, track: nextItem };
      io.to(data.roomId).emit('queue_updated', room.queue);
      io.to(data.roomId).emit('sync:play', command);
    } else {
      roomManager.updateRoomState(data.roomId, { currentVideoId: null, currentTrack: null, status: 'paused', currentTimestamp: 0 });
      io.to(data.roomId).emit('queue_updated', []);
      io.to(data.roomId).emit('room_state', room);
    }
  });

  socket.on('host:play_previous', (data: { roomId: string }) => {
    const room = roomManager.getRoom(data.roomId);
    if (!room) return;
    if (!checkControlPermission(room, socket.id)) return;

    if (room.history.length === 0) return;

    if (room.currentTrack) {
      room.queue.unshift(room.currentTrack);
    }

    const prevTrack = room.history.pop()!;
    roomManager.updateRoomState(data.roomId, {
      currentVideoId: prevTrack.videoId,
      currentTrack: prevTrack,
      status: 'playing',
      currentTimestamp: 0
    });

    const command: SyncPlayCommand = {
      videoId: prevTrack.videoId,
      timestamp: 0,
      executeAt: Date.now() + BUFFER_DELAY_MS,
      track: prevTrack
    };

    io.to(data.roomId).emit('queue_updated', room.queue);
    io.to(data.roomId).emit('history_updated', room.history);
    io.to(data.roomId).emit('sync:play', command);
  });

  socket.on('host:play_track', (data: { roomId: string, track: any, timestamp: number }) => {
    const room = roomManager.getRoom(data.roomId);
    if (!room) return;
    if (!checkControlPermission(room, socket.id)) return;

    if (room.currentTrack && room.currentTrack.videoId !== data.track.videoId) {
      room.history.push(room.currentTrack);
    }

    // Remove from queue if it was in there
    const qIndex = room.queue.findIndex((t: any) => t.id === data.track.id || t.videoId === data.track.videoId);
    if (qIndex !== -1) {
      room.queue.splice(qIndex, 1);
      io.to(data.roomId).emit('queue_updated', room.queue);
    }

    roomManager.updateRoomState(data.roomId, {
      currentVideoId: data.track.videoId,
      currentTrack: data.track,
      status: 'playing',
      currentTimestamp: data.timestamp
    });

    const command: SyncPlayCommand = {
      videoId: data.track.videoId,
      timestamp: data.timestamp,
      executeAt: Date.now() + BUFFER_DELAY_MS,
      track: data.track
    };
    io.to(data.roomId).emit('sync:play', command);
    io.to(data.roomId).emit('history_updated', room.history);
  });

  socket.on('host:reorder_queue', (data: { roomId: string, newQueue: any[] }) => {
    const room = roomManager.getRoom(data.roomId);
    if (!room) return;
    if (!checkControlPermission(room, socket.id)) return;

    room.queue = data.newQueue;
    io.to(data.roomId).emit('queue_updated', room.queue);
  });

  socket.on('host:kick_user', (data: { roomId: string, targetSocketId: string }) => {
    const room = roomManager.getRoom(data.roomId);
    if (!room) return;
    const user = room.users.find((u: any) => u.socketId === socket.id || u.id === socket.id);
    if (!user || !user.isHost) return;

    const targetUser = room.users.find((u: any) => u.socketId === data.targetSocketId || u.id === data.targetSocketId);
    roomManager.leaveRoom(data.roomId, data.targetSocketId);
    
    if (targetUser && targetUser.socketId) {
      io.to(targetUser.socketId).emit('force_disconnect', { reason: 'kicked' });
    } else {
      io.to(data.targetSocketId).emit('force_disconnect', { reason: 'kicked' });
    }
    
    io.to(data.roomId).emit('room_state', roomManager.getRoom(data.roomId));
  });

  socket.on('host:ban_user', (data: { roomId: string, targetSocketId: string }) => {
    const room = roomManager.getRoom(data.roomId);
    if (!room) return;
    const user = room.users.find((u: any) => u.socketId === socket.id || u.id === socket.id);
    if (!user || !user.isHost) return;

    const targetUser = room.users.find((u: any) => u.socketId === data.targetSocketId || u.id === data.targetSocketId);
    if (targetUser) {
      if (targetUser.id) room.bannedUsers.push(targetUser.id);
      if (targetUser.socketId) room.bannedUsers.push(targetUser.socketId);
    } else {
      room.bannedUsers.push(data.targetSocketId);
    }

    roomManager.leaveRoom(data.roomId, data.targetSocketId);
    
    if (targetUser && targetUser.socketId) {
      io.to(targetUser.socketId).emit('force_disconnect', { reason: 'banned' });
    } else {
      io.to(data.targetSocketId).emit('force_disconnect', { reason: 'banned' });
    }
    
    io.to(data.roomId).emit('room_state', roomManager.getRoom(data.roomId));
  });

  socket.on('host:toggle_guest_control', (data: { roomId: string, allow: boolean }) => {
    const room = roomManager.getRoom(data.roomId);
    if (!room) return;
    const user = room.users.find((u: any) => u.socketId === socket.id || u.id === socket.id);
    if (!user || !user.isHost) return;

    room.allowGuestControl = data.allow;
    io.to(data.roomId).emit('room_state', roomManager.getRoom(data.roomId));
  });

  socket.on('host:set_loop', (data: { roomId: string, mode: 'off' | 'track' | 'queue' }) => {
    const room = roomManager.getRoom(data.roomId);
    if (!room) return;
    if (!checkControlPermission(room, socket.id)) return;

    room.loopMode = data.mode;
    io.to(data.roomId).emit('room_state', roomManager.getRoom(data.roomId));
  });

  socket.on('host:set_shuffle', (data: { roomId: string, shuffle: boolean }) => {
    const room = roomManager.getRoom(data.roomId);
    if (!room) return;
    if (!checkControlPermission(room, socket.id)) return;

    room.isShuffle = data.shuffle;
    io.to(data.roomId).emit('room_state', roomManager.getRoom(data.roomId));
  });

});

const PORT = process.env.PORT || 3001;
server.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});