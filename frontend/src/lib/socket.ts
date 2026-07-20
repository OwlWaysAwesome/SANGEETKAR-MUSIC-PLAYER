import { io, Socket } from 'socket.io-client';

import { BACKEND_URL } from '../config';

const URL = BACKEND_URL;

export const socket: Socket = io(URL, {
  autoConnect: true,
  withCredentials: true,
  extraHeaders: {
    'ngrok-skip-browser-warning': 'true'
  }
});

let serverOffset = 0;

export const syncClock = () => {
  socket.emit('ntp:sync', { clientSendTime: Date.now() });
};

socket.on('ntp:reply', (data: { clientSendTime: number, serverTime: number }) => {
  const clientReceiveTime = Date.now();
  const rtt = clientReceiveTime - data.clientSendTime;
  const estimatedServerTime = data.serverTime + (rtt / 2);
  serverOffset = estimatedServerTime - clientReceiveTime;
  console.log(`Clock synced. RTT: ${rtt}ms, Server Offset: ${serverOffset}ms`);
});

// Run sync periodically
socket.on('connect', () => {
  syncClock();
  setInterval(syncClock, 30000); // Re-sync every 30s
});

export const getServerTime = () => {
  return Date.now() + serverOffset;
};
