import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PresenceRooms, type PresenceSocket } from '../src/rooms.js';
import { isHeartbeat, type PresenceMessage } from '../src/protocol.js';

class FakeSocket implements PresenceSocket {
  readyState = 1;
  bufferedAmount = 0;
  messages: PresenceMessage[] = [];
  closes: { code: number; reason: string }[] = [];
  terminated = false;
  pings = 0;
  failSend = false;
  send(data: string, callback: (error?: Error) => void) {
    if (this.failSend) return callback(new Error('disconnected'));
    this.messages.push(JSON.parse(data) as PresenceMessage);
    callback();
  }
  close(code: number, reason: string) { this.closes.push({ code, reason }); this.readyState = 3; }
  terminate() { this.terminated = true; this.readyState = 3; }
  ping() { this.pings++; }
}

const identity = (userId: string, expiresAt = 100_000) => ({ userId, expiresAt });

test('snapshot includes self and existing users; other peers receive the identical join identity', () => {
  const rooms = new PresenceRooms({ now: () => 0 });
  const a = new FakeSocket(), b = new FakeSocket();
  assert.equal(rooms.join('default', identity('a'), a), true);
  assert.deepEqual(a.messages, [{ type: 'presence:snapshot', users: rooms.snapshot('default') }]);
  rooms.join('default', identity('b'), b);
  const users = rooms.snapshot('default');
  assert.equal(users.length, 2);
  assert.deepEqual(b.messages, [{ type: 'presence:snapshot', users }]);
  assert.deepEqual(a.messages[1], { type: 'presence:join', ...users[1] });
  assert.notEqual(users[0].angle, users[1].angle);
  assert.ok(users.every((user) => user.radius >= 1.6 && user.radius <= 2));
  assert.ok(users.every((user) => /^#[0-9A-F]{6}$/.test(user.color)));
  rooms.heartbeat(a);
  rooms.tick();
  assert.deepEqual(rooms.snapshot('default'), users);
  users[0].color = 'client tampering';
  assert.notEqual(rooms.snapshot('default')[0].color, 'client tampering');
});

test('leave is idempotent, isolated by room, and emptied rooms can be reused', () => {
  const rooms = new PresenceRooms({ now: () => 0 });
  const a = new FakeSocket(), b = new FakeSocket(), elsewhere = new FakeSocket();
  rooms.join('default', identity('a'), a);
  rooms.join('default', identity('b'), b);
  rooms.join('elsewhere', identity('c'), elsewhere);
  rooms.leave(a);
  rooms.leave(a);
  assert.deepEqual(b.messages.filter((message) => message.type === 'presence:leave'), [{ type: 'presence:leave', userId: 'a' }]);
  assert.equal(elsewhere.messages.length, 1);
  rooms.leave(b);
  assert.deepEqual(rooms.snapshot('default'), []);
  const fresh = new FakeSocket();
  assert.equal(rooms.join('default', identity('a'), fresh), true);
  assert.equal(fresh.messages[0].type, 'presence:snapshot');
});

test('capacity and duplicate tabs are rejected without replacing existing membership', () => {
  const rooms = new PresenceRooms({ now: () => 0, capacity: 2 });
  const a = new FakeSocket(), duplicate = new FakeSocket(), b = new FakeSocket(), extra = new FakeSocket();
  rooms.join('default', identity('a'), a);
  assert.equal(rooms.join('default', identity('a'), duplicate), false);
  assert.equal(duplicate.closes[0].code, 4409);
  rooms.leave(duplicate);
  rooms.join('default', identity('b'), b);
  assert.equal(rooms.join('default', identity('c'), extra), false);
  assert.match(extra.closes[0].reason, /Room full.*2/);
  assert.deepEqual(rooms.snapshot('default').map((user) => user.userId), ['a', 'b']);
});

test('native ping schedule, heartbeats, and silent-drop timeout use the injected clock', () => {
  let now = 0;
  const rooms = new PresenceRooms({ now: () => now });
  const a = new FakeSocket(), b = new FakeSocket();
  rooms.join('default', identity('a'), a);
  rooms.join('default', identity('b'), b);
  now = 15_000;
  rooms.tick();
  assert.equal(a.pings, 1);
  now = 44_000;
  rooms.heartbeat(b);
  now = 45_000;
  rooms.tick();
  assert.equal(a.terminated, true);
  assert.equal(b.terminated, false);
  assert.deepEqual(b.messages.at(-1), { type: 'presence:leave', userId: 'a' });
  now = 89_000;
  rooms.tick();
  assert.equal(b.terminated, true);
  assert.deepEqual(rooms.snapshot('default'), []);
});

test('expired credentials cannot join or stay connected through heartbeats', () => {
  let now = 0;
  const rooms = new PresenceRooms({ now: () => now });
  const expired = new FakeSocket(), a = new FakeSocket();
  assert.equal(rooms.join('default', identity('expired', 0), expired), false);
  rooms.join('default', identity('a', 1000), a);
  now = 1000;
  rooms.heartbeat(a);
  rooms.tick();
  assert.deepEqual(a.closes[0], { code: 4401, reason: 'Token expired' });
  assert.deepEqual(rooms.snapshot('default'), []);
});

test('slow or failing sockets are removed without breaking broadcasts to healthy peers', () => {
  for (const mode of ['buffer', 'send']) {
    const rooms = new PresenceRooms({ now: () => 0 });
    const a = new FakeSocket(), b = new FakeSocket();
    rooms.join('default', identity('a'), a);
    rooms.join('default', identity('b'), b);
    if (mode === 'buffer') a.bufferedAmount = 70_000;
    else a.failSend = true;
    rooms.publish('default', { type: 'presence:leave', userId: 'already-gone' });
    assert.equal(a.terminated, true);
    assert.deepEqual(rooms.snapshot('default').map((user) => user.userId), ['b']);
    assert.ok(b.messages.some((message) => message.type === 'presence:leave' && message.userId === 'a'));
  }
});

test('the only accepted client payload is an exact heartbeat object', () => {
  assert.equal(isHeartbeat({ type: 'presence:heartbeat' }), true);
  for (const value of [null, [], 'presence:heartbeat', {}, { type: 'chat', text: 'no' },
    { type: 'presence:heartbeat', color: '#111' }, { type: 'presence:heartbeat', session: {} }]) {
    assert.equal(isHeartbeat(value), false);
  }
});

test('shutdown removes every membership', () => {
  const rooms = new PresenceRooms({ now: () => 0 });
  const socket = new FakeSocket();
  rooms.join('default', identity('a'), socket);
  rooms.shutdown();
  assert.equal(socket.closes[0].code, 1001);
  assert.deepEqual(rooms.snapshot('default'), []);
});
