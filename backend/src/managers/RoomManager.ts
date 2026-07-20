import { Room, User } from '../models';

export class RoomManager {
  private rooms: Map<string, Room> = new Map();

  createRoom(roomId: string, hostId: string): Room {
    const room: Room = {
      id: roomId,
      hostId,
      users: [],
      currentVideoId: null,
      currentTrack: null,
      status: 'paused',
      currentTimestamp: 0,
      lastUpdatedServerTime: Date.now(),
      queue: [],
      history: [],
      allowGuestControl: true,
      bannedUsers: [],
      loopMode: 'off',
      isShuffle: false
    };
    this.rooms.set(roomId, room);
    return room;
  }

  joinRoom(roomId: string, socketId: string, dbUserId: string | null, username?: string, avatar?: string): User {
    let room = this.rooms.get(roomId);
    
    // Fallback for missing rooms (e.g., server restart or dev testing)
    if (!room) {
      room = this.createRoom(roomId, dbUserId || socketId);
    }

    if (dbUserId && room.bannedUsers.includes(dbUserId)) {
      throw new Error('User is banned from this room');
    }
    // Also block by socketId as fallback
    if (room.bannedUsers.includes(socketId)) {
      throw new Error('User is banned from this room');
    }

    const isHost = dbUserId === room.hostId || room.hostId === socketId;
    const user: User = { id: socketId, isHost, roomId, username, avatar };
    
    // Prevent duplicate entries on reconnect
    const existingIndex = room.users.findIndex(u => u.id === socketId);
    if (existingIndex !== -1) {
      room.users[existingIndex] = user;
    } else {
      room.users.push(user);
    }
    return user;
  }

  leaveRoom(roomId: string, identifier: string): Room | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    room.users = room.users.filter((u: any) => u.id !== identifier && u.socketId !== identifier);

    if (room.users.length === 0) {
      // We don't delete the room immediately so the host can reconnect without losing the queue
      // A cron job could clean up empty rooms later, but for now we keep it in memory
      // this.rooms.delete(roomId);
    } else {
      // If host left, we no longer blindly assign host to someone else. 
      // The host role is locked to the original creator.
    }

    return room;
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  /**
   * Ensures a room exists in memory. Used by queue handlers to avoid
   * the race condition where host:queue_add_bulk fires before join_room
   * (e.g. after a server restart).
   */
  ensureRoom(roomId: string): Room {
    let room = this.rooms.get(roomId);
    if (!room) {
      // If forced to ensure without host knowledge, fallback to creating with null-ish host
      room = this.createRoom(roomId, 'unknown_host');
    }
    return room;
  }

  updateRoomState(roomId: string, updates: Partial<Room>) {
    const room = this.rooms.get(roomId);
    if (room) {
      Object.assign(room, updates, { lastUpdatedServerTime: Date.now() });
    }
  }

  addToQueue(roomId: string, item: any) {
    const room = this.rooms.get(roomId);
    if (room) {
      room.queue.push(item);
    }
  }

  addToQueueBulk(roomId: string, items: any[]) {
    const room = this.rooms.get(roomId);
    if (room) {
      room.queue.push(...items);
    }
  }

  popQueue(roomId: string) {
    const room = this.rooms.get(roomId);
    if (room && room.queue.length > 0) {
      return room.queue.shift();
    }
    return null;
  }
}
