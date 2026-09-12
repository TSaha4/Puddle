import { randomUUID } from 'node:crypto';
import type { AmbientSession } from '../../../shared/session.js';

// Phase 1 deliberately stays local and canned. Phase 2 replaces this generator
// with an MCP client calling generate_session on an independently deployed server.
// MCP's novel role here is a hot-swappable plugin bus for generative personal
// content, not enterprise tool orchestration. Keep generator internals out of routing.
export function generateSession(): AmbientSession {
  return {
    id: randomUUID(),
    sessionType: 'ambient-audio',
    createdAt: new Date().toISOString(),
    payload: {
      title: 'a tiny tide of nothing',
      durationSeconds: 120,
      seed: 2718,
      tempo: 60,
      key: 'C major',
      texture: 'soft-sine'
    }
  };
}
