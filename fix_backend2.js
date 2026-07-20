const fs = require('fs');
let code = fs.readFileSync('backend/src/index.ts', 'utf8');

// Fix syntax errors introduced by previous regex
code = code.replace(/if \(!checkControlPermission\(room, socket\.id\)\) return; console\.log\('[^']*'\); return; \}/g, 'if (!checkControlPermission(room, socket.id)) return;');
code = code.replace(/if \(!checkControlPermission\(room, socket\.id\)\) return; \{?[^}]*\}?/g, 'if (!checkControlPermission(room, socket.id)) return;');

const loopAndShuffleLogic = `
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
  });`;

// remove old host:play_next
code = code.replace(/socket\.on\('host:play_next',[\s\S]*?io\.to\(data\.roomId\)\.emit\('room_state', roomManager\.getRoom\(data\.roomId\)\);\n\s*\}\n\s*}\);/g, loopAndShuffleLogic);

const moderationAndSettingsLogic = `
  socket.on('host:kick_user', (data: { roomId: string, targetSocketId: string }) => {
    const room = roomManager.getRoom(data.roomId);
    if (!room) return;
    const user = room.users.find((u: any) => u.id === socket.id);
    if (!user || !user.isHost) return;
    
    roomManager.leaveRoom(data.roomId, data.targetSocketId);
    io.to(data.targetSocketId).emit('force_disconnect', { reason: 'kicked' });
    io.to(data.roomId).emit('room_state', roomManager.getRoom(data.roomId));
  });

  socket.on('host:ban_user', (data: { roomId: string, targetSocketId: string }) => {
    const room = roomManager.getRoom(data.roomId);
    if (!room) return;
    const user = room.users.find((u: any) => u.id === socket.id);
    if (!user || !user.isHost) return;
    
    const targetUser = room.users.find((u: any) => u.id === data.targetSocketId);
    if (targetUser && targetUser.id) {
      room.bannedUsers.push(targetUser.id);
    }
    
    roomManager.leaveRoom(data.roomId, data.targetSocketId);
    io.to(data.targetSocketId).emit('force_disconnect', { reason: 'banned' });
    io.to(data.roomId).emit('room_state', roomManager.getRoom(data.roomId));
  });

  socket.on('host:toggle_guest_control', (data: { roomId: string, allow: boolean }) => {
    const room = roomManager.getRoom(data.roomId);
    if (!room) return;
    const user = room.users.find((u: any) => u.id === socket.id);
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
`;

code = code.replace(/}\);\n\nconst PORT = process\.env\.PORT/g, moderationAndSettingsLogic + '\n});\n\nconst PORT = process.env.PORT');

fs.writeFileSync('backend/src/index.ts', code);
console.log('Fixed backend script');
