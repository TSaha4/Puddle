import express from 'express';
import { createServer, type IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import type { Identity, VerifyToken } from './auth.js';
import type { RoomStore } from './roomStore.js';
import { isHeartbeat } from './protocol.js';
import { PresenceRooms } from './rooms.js';

function rejectUpgrade(socket: Duplex, status: number, reason: string) {
  if (socket.destroyed) return;
  const body = `${reason}\n`;
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`, () => socket.destroy());
}

export function createPresenceServer(options: {
  verifyToken: VerifyToken;
  store: RoomStore;
  rooms?: PresenceRooms;
  tickMs?: number;
}) {
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256, perMessageDeflate: false });
  const rooms = options.rooms ?? new PresenceRooms();
  const pending = new Set<Duplex>();
  let stopping = false;
  const timer = setInterval(() => rooms.tick(), options.tickMs ?? 5000);
  timer.unref();

  async function upgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    pending.add(socket);
    const deadline = setTimeout(() => socket.destroy(), 10_000);
    try {
      if (stopping) return rejectUpgrade(socket, 503, 'Service Unavailable');
      const url = new URL(request.url ?? '/', 'http://presence.local');
      const match = /^\/rooms\/([A-Za-z0-9_-]{1,64})$/.exec(url.pathname);
      if (!match) return rejectUpgrade(socket, 404, 'Room Path Not Found');
      const tokens = url.searchParams.getAll('token');
      if (tokens.length !== 1 || !tokens[0] || tokens[0].length > 4096) {
        return rejectUpgrade(socket, 401, 'Unauthorized');
      }
      let identity: Identity;
      try { identity = await options.verifyToken(tokens[0]); }
      catch { return rejectUpgrade(socket, 401, 'Unauthorized'); }
      if (socket.destroyed || stopping) return rejectUpgrade(socket, 503, 'Service Unavailable');
      try { await options.store.ensureRoom(match[1]); }
      catch { return rejectUpgrade(socket, 503, 'Service Unavailable'); }
      if (socket.destroyed || stopping) return rejectUpgrade(socket, 503, 'Service Unavailable');

      wss.handleUpgrade(request, socket, head, (ws) => {
        ws.on('close', () => rooms.leave(ws));
        ws.on('error', () => rooms.drop(ws));
        ws.on('pong', () => rooms.heartbeat(ws));
        ws.on('message', (data, binary) => {
          if (binary) return rooms.reject(ws, 1003, 'Text heartbeat required');
          try {
            const message: unknown = JSON.parse(data.toString());
            if (!isHeartbeat(message)) return rooms.reject(ws, 1008, 'Only presence:heartbeat is accepted');
            rooms.heartbeat(ws);
          } catch {
            rooms.reject(ws, 1008, 'Invalid heartbeat JSON');
          }
        });
        rooms.join(match[1], identity, ws);
      });
    } finally {
      clearTimeout(deadline);
      pending.delete(socket);
    }
  }

  // Never log request URLs: the allowed query token is a credential. Production
  // must use wss:// and redact query strings in proxy/access logs as well.
  server.on('upgrade', (request, socket, head) => {
    socket.on('error', () => socket.destroy());
    void upgrade(request, socket, head).catch(() => rejectUpgrade(socket, 500, 'Internal Server Error'));
  });

  return {
    server,
    rooms,
    stop: async () => {
      stopping = true;
      clearInterval(timer);
      for (const socket of pending) socket.destroy();
      rooms.shutdown();
      for (const client of wss.clients) client.terminate();
      await Promise.all([
        new Promise<void>((resolve) => wss.close(() => resolve())),
        new Promise<void>((resolve, reject) => {
          if (!server.listening) return resolve();
          server.close((error) => error ? reject(error) : resolve());
        })
      ]);
    }
  };
}
