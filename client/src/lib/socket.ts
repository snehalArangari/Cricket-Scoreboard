import { io, type Socket } from 'socket.io-client';

/**
 * The socket lives at MODULE scope, not inside a component.
 *
 * React StrictMode mounts every effect twice in development. A socket created
 * inside useEffect would open two connections, join the room twice and register
 * duplicate listeners — everything appearing to happen twice in dev and once in
 * production, which is miserable to debug. Creating it here means both mounts
 * get the same instance.
 */
let socket: Socket | null = null;
let currentKey = '';

export function getSocket(matchId: string, scorerToken?: string): Socket {
  const key = `${matchId}|${scorerToken ?? ''}`;
  if (socket && currentKey === key) return socket;

  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }

  currentKey = key;
  // No URL argument — same origin. Identical in dev (through the Vite proxy)
  // and in production (served by the same Express process).
  socket = io({
    // Auth travels in the handshake so it is replayed automatically on every
    // reconnect, BEFORE any buffered emits are flushed.
    auth: { matchId, scorerToken },
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
    timeout: 20000,
  });
  return socket;
}

export function teardownSocket(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
    currentKey = '';
  }
}
