import 'dotenv/config';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PrismaClient } from '../generated/client/index.js';
import { createRoomStore } from '../src/roomStore.js';
import { assertTwoPeerLifecycle, start } from '../test/support.js';

test('PostgreSQL creates one durable room under concurrent joins; WebSocket membership stays ephemeral', { timeout: 20_000 }, async (t) => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must point to a migrated test database');
  const roomId = `test-${randomUUID()}`;
  const store = createRoomStore();
  const db = new PrismaClient();
  await store.connect();
  try {
    await Promise.all([store.ensureRoom(roomId), store.ensureRoom(roomId)]);
    assert.equal(await db.presenceRoom.count({ where: { id: roomId } }), 1);
    const service = await start(t, store);
    await assertTwoPeerLifecycle(service.url, roomId);
    await service.stop();
    assert.deepEqual(service.rooms.snapshot(roomId), []);
    assert.equal(await db.presenceRoom.count({ where: { id: roomId } }), 1);
  } finally {
    await db.presenceRoom.deleteMany({ where: { id: roomId } });
    await store.disconnect();
    await db.$disconnect();
  }
});
