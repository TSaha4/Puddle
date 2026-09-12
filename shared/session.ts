export interface AmbientSession {
  id: string;
  sessionType: 'ambient-audio';
  createdAt: string;
  payload: {
    title: string;
    durationSeconds: number;
    seed: number;
    tempo: number;
    key: 'C major';
    texture: 'soft-sine';
  };
}

// Validate the network boundary; a TypeScript cast cannot validate API JSON.
export function isAmbientSession(value: unknown): value is AmbientSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Record<string, unknown>;
  if (!session.payload || typeof session.payload !== 'object') return false;
  const p = session.payload as Record<string, unknown>;
  return typeof session.id === 'string' && session.id.length > 0
    && session.sessionType === 'ambient-audio'
    && typeof session.createdAt === 'string' && Number.isFinite(Date.parse(session.createdAt))
    && typeof p.title === 'string' && p.title.length > 0
    && typeof p.durationSeconds === 'number' && Number.isFinite(p.durationSeconds)
    && p.durationSeconds >= 1 && p.durationSeconds <= 600
    && typeof p.seed === 'number' && Number.isSafeInteger(p.seed)
    && typeof p.tempo === 'number' && Number.isFinite(p.tempo) && p.tempo >= 30 && p.tempo <= 120
    && p.key === 'C major' && p.texture === 'soft-sine';
}
