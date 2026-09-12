import { strict as assert } from 'node:assert';
import { once } from 'node:events';
import { SignJWT } from 'jose';
import WebSocket from 'ws';
import type { AddressInfo } from 'node:net';
import type { TestContext } from 'node:test';
import { createTokenVerifier } from '../src/auth.js';
import { createPresenceServer } from '../src/server.js';
import type { RoomStore } from '../src/roomStore.js';
import type { PresenceMessage } from '../src/protocol.js';
import type { PresenceRooms } from '../src/rooms.js';

// Test fixture only, never loaded by the executable service.
export const authConfig = { secret: 'presence-tests-only-not-a-production-signing-key', issuer: 'puddle-test', audience: 'presence-test' };
export const key = new TextEncoder().encode(authConfig.secret);
export const verifyToken = createTokenVerifier(authConfig);
export const sign = (userId: string) => new SignJWT({})
  .setProtectedHeader({ alg: 'HS256' }).setIssuer(authConfig.issuer)
  .setAudience(authConfig.audience).setSubject(userId).setIssuedAt().setExpirationTime('2m').sign(key);

export async function start(t: TestContext, store: RoomStore = { ensureRoom: async () => {} }, rooms?: PresenceRooms) {
  const service = createPresenceServer({ verifyToken, store, rooms });
  t.after(async () => { await service.stop(); });
  const listening = once(service.server, 'listening');
  service.server.listen(0, '127.0.0.1');
  await listening;
  return { ...service, url: `ws://127.0.0.1:${(service.server.address() as AddressInfo).port}` };
}

export async function connect(url: string) {
  const ws = new WebSocket(url);
  const queue: PresenceMessage[] = [];
  ws.on('message', (data) => queue.push(JSON.parse(data.toString()) as PresenceMessage));
  // once(open) still rejects on error; keep later teardown errors handled too.
  ws.on('error', () => {});
  await once(ws, 'open');
  return {
    ws,
    message: <T extends PresenceMessage['type']>(type: T): Promise<Extract<PresenceMessage, { type: T }>> => {
      type Match = Extract<PresenceMessage, { type: T }>;
      const take = () => {
        const index = queue.findIndex((message) => message.type === type);
        return index === -1 ? undefined : queue.splice(index, 1)[0] as Match;
      };
      const existing = take();
      if (existing) return Promise.resolve(existing);
      return new Promise<Match>((resolve, reject) => {
        const timer = setTimeout(() => {
          ws.off('message', receive);
          reject(new Error(`Timed out waiting for ${type}`));
        }, 3000);
        function receive() {
          const message = take();
          if (!message) return;
          clearTimeout(timer);
          ws.off('message', receive);
          resolve(message);
        }
        ws.on('message', receive);
      });
    }
  };
}

export async function assertTwoPeerLifecycle(baseUrl: string, roomId: string) {
  const a = await connect(`${baseUrl}/rooms/${roomId}?token=${await sign('alice')}`);
  const first = await a.message('presence:snapshot');
  assert.deepEqual(first.users.map((user) => user.userId), ['alice']);
  const b = await connect(`${baseUrl}/rooms/${roomId}?token=${await sign('bob')}`);
  const snapshot = await b.message('presence:snapshot');
  assert.deepEqual(snapshot.users.map((user) => user.userId), ['alice', 'bob']);
  assert.deepEqual(snapshot.users[0], first.users[0]);
  const join = await a.message('presence:join');
  assert.deepEqual(join, { type: 'presence:join', ...snapshot.users[1] });
  b.ws.send(JSON.stringify({ type: 'presence:heartbeat' }));
  const closed = once(a.ws, 'close');
  a.ws.close(1000, 'done');
  const leave = await b.message('presence:leave');
  assert.deepEqual(leave, { type: 'presence:leave', userId: 'alice' });
  assert.equal((await closed)[0], 1000);
  // The departed peer sees close, not an impossible post-disconnect message.
  b.ws.terminate();
}
