import 'dotenv/config';
import { createTokenVerifier } from './auth.js';
import { createRoomStore } from './roomStore.js';
import { createPresenceServer } from './server.js';

async function main() {
  const port = Number(process.env.PORT ?? 3002);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const verifyToken = createTokenVerifier({
    secret: process.env.JWT_SECRET ?? '',
    issuer: process.env.JWT_ISSUER ?? '',
    audience: process.env.JWT_AUDIENCE ?? ''
  });
  const store = createRoomStore();
  await store.connect();
  const service = createPresenceServer({ verifyToken, store });
  try {
    await new Promise<void>((resolve, reject) => {
      service.server.once('error', reject);
      service.server.listen(port, '0.0.0.0', () => {
        service.server.off('error', reject);
        resolve();
      });
    });
  } catch (error) {
    await service.stop();
    await store.disconnect();
    throw error;
  }
  console.info(`puddle presence listening on ${port} (single replica only)`);
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 10_000);
    deadline.unref();
    try {
      await service.stop();
      await store.disconnect();
      clearTimeout(deadline);
    } catch {
      console.error('presence.shutdown_failed');
      process.exit(1);
    }
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void shutdown(); });
}

void main().catch(() => {
  console.error('presence.start_failed: check database migration and JWT/PORT configuration');
  process.exitCode = 1;
});
