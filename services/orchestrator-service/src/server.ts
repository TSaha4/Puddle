import { resolve } from 'node:path';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}
// npm workspace scripts run from services/orchestrator-service in dev and production.
const server = createApp(resolve(process.cwd(), '../../frontend/dist')).listen(port, '0.0.0.0', () => {
  console.log(`puddle orchestrator listening on ${port}`);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
