import { strict as assert } from 'node:assert';
import { once } from 'node:events';
import { test } from 'node:test';
import WebSocket from 'ws';
import { PresenceRooms } from '../src/rooms.js';
import { assertTwoPeerLifecycle, connect, sign, start } from './support.js';

function rejectedStatus(url: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('Upgrade did not finish')); }, 3000);
    ws.on('error', () => {});
    ws.on('unexpected-response', (request, response) => {
      clearTimeout(timer);
      response.resume();
      resolve(response.statusCode);
      request.destroy();
      ws.terminate();
    });
    ws.on('open', () => { clearTimeout(timer); ws.terminate(); reject(new Error('Unexpectedly connected')); });
  });
}

test('two real WebSocket clients receive consistent snapshot/join/leave events', { timeout: 10_000 }, async (t) => {
  const ensured: string[] = [];
  const service = await start(t, { ensureRoom: async (roomId) => { ensured.push(roomId); } });
  await assertTwoPeerLifecycle(service.url, 'default');
  assert.deepEqual(ensured, ['default', 'default']);
});

test('invalid authentication and room paths are rejected before creating database rows', { timeout: 10_000 }, async (t) => {
  let created = 0;
  const service = await start(t, { ensureRoom: async () => { created++; } });
  assert.equal(await rejectedStatus(`${service.url}/rooms/default`), 401);
  assert.equal(await rejectedStatus(`${service.url}/rooms/default?token=invalid`), 401);
  assert.equal(await rejectedStatus(`${service.url}/rooms/default?token=a&token=b`), 401);
  assert.equal(await rejectedStatus(`${service.url}/rooms/bad%20room?token=${await sign('alice')}`), 404);
  assert.equal(created, 0);
});

test('database failure fails closed without phantom membership', { timeout: 10_000 }, async (t) => {
  const service = await start(t, { ensureRoom: async () => { throw new Error('offline'); } });
  assert.equal(await rejectedStatus(`${service.url}/rooms/default?token=${await sign('alice')}`), 503);
  assert.deepEqual(service.rooms.snapshot('default'), []);
});

test('room cap and duplicate users get explicit WebSocket close reasons', { timeout: 10_000 }, async (t) => {
  const service = await start(t, undefined, new PresenceRooms({ capacity: 1 }));
  const a = await connect(`${service.url}/rooms/default?token=${await sign('alice')}`);
  await a.message('presence:snapshot');
  for (const user of ['bob', 'alice']) {
    const denied = new WebSocket(`${service.url}/rooms/default?token=${await sign(user)}`);
    denied.on('error', () => {});
    const [code, reason] = await once(denied, 'close');
    assert.equal(code, 4409);
    assert.match(String(reason), user === 'bob' ? /Room full/ : /already connected/);
  }
  assert.deepEqual(service.rooms.snapshot('default').map((user) => user.userId), ['alice']);
});

test('content and client-selected visual identity are never accepted or broadcast', { timeout: 10_000 }, async (t) => {
  const service = await start(t);
  const a = await connect(`${service.url}/rooms/default?token=${await sign('alice')}`);
  await a.message('presence:snapshot');
  const b = await connect(`${service.url}/rooms/default?token=${await sign('bob')}`);
  await b.message('presence:snapshot');
  await a.message('presence:join');
  const closed = once(b.ws, 'close');
  b.ws.send(JSON.stringify({ type: 'presence:heartbeat', color: '#000', text: 'not allowed' }));
  assert.equal((await closed)[0], 1008);
  assert.deepEqual(await a.message('presence:leave'), { type: 'presence:leave', userId: 'bob' });
  assert.deepEqual(service.rooms.snapshot('default').map((user) => user.userId), ['alice']);
});

test('abrupt socket termination removes the departed user', { timeout: 10_000 }, async (t) => {
  const service = await start(t);
  const a = await connect(`${service.url}/rooms/default?token=${await sign('alice')}`);
  await a.message('presence:snapshot');
  const b = await connect(`${service.url}/rooms/default?token=${await sign('bob')}`);
  await b.message('presence:snapshot');
  b.ws.terminate();
  assert.deepEqual(await a.message('presence:leave'), { type: 'presence:leave', userId: 'bob' });
});
