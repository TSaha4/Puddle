export interface PresenceUser {
  userId: string;
  color: string;
  angle: number;
  radius: number;
}

export type PresenceMessage =
  | ({ type: 'presence:join' } & PresenceUser)
  | { type: 'presence:leave'; userId: string }
  | { type: 'presence:snapshot'; users: PresenceUser[] };

export function isHeartbeat(value: unknown): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 1
    && (value as Record<string, unknown>).type === 'presence:heartbeat';
}
