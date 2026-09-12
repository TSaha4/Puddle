import { randomInt } from 'node:crypto';
import type { Identity } from './auth.js';
import type { PresenceMessage, PresenceUser } from './protocol.js';

export interface PresenceSocket {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: string, callback: (error?: Error) => void): void;
  close(code: number, reason: string): void;
  terminate(): void;
  ping(): void;
}

interface Member {
  roomId: string;
  socket: PresenceSocket;
  user: PresenceUser;
  slot: number;
  lastSeen: number;
  lastPing: number;
  expiresAt: number;
}

const COLORS = ['#FF6B4A', '#FFD93D', '#7FD1C4', '#C9B8FF'];
const OPEN = 1;

export class PresenceRooms {
  private rooms = new Map<string, Map<string, Member>>();
  private sockets = new Map<PresenceSocket, Member>();
  private readonly capacity: number;
  private readonly timeoutMs: number;
  private readonly pingEveryMs: number;
  private readonly now: () => number;

  constructor(options: { capacity?: number; timeoutMs?: number; pingEveryMs?: number; now?: () => number } = {}) {
    this.capacity = options.capacity ?? 12;
    this.timeoutMs = options.timeoutMs ?? 45_000;
    this.pingEveryMs = options.pingEveryMs ?? 15_000;
    this.now = options.now ?? Date.now;
    if (!Number.isInteger(this.capacity) || this.capacity < 1 || this.capacity > 12
      || this.pingEveryMs <= 0 || this.timeoutMs <= this.pingEveryMs) {
      throw new Error('Invalid presence limits');
    }
  }

  snapshot(roomId: string): PresenceUser[] {
    return [...(this.rooms.get(roomId)?.values() ?? [])].map(({ user }) => ({ ...user }));
  }

  join(roomId: string, identity: Identity, socket: PresenceSocket): boolean {
    if (socket.readyState !== OPEN || this.sockets.has(socket)) return false;
    if (identity.expiresAt <= this.now()) {
      socket.close(4401, 'Token expired');
      return false;
    }
    const room = this.rooms.get(roomId) ?? new Map<string, Member>();
    // A userId-only protocol cannot represent two independent sockets for the
    // same user in one room. Reject duplicate tabs rather than emit false leaves.
    if (room.has(identity.userId)) {
      socket.close(4409, 'User already connected to this room');
      return false;
    }
    if (room.size >= this.capacity) {
      socket.close(4409, 'Room full (maximum 12 users)');
      return false;
    }
    let slot = 0;
    const occupied = new Set([...room.values()].map((member) => member.slot));
    while (occupied.has(slot)) slot++;
    const now = this.now();
    const member: Member = {
      roomId, socket, slot, expiresAt: identity.expiresAt, lastSeen: now, lastPing: now,
      user: {
        userId: identity.userId,
        color: COLORS[randomInt(COLORS.length)],
        angle: (slot / this.capacity) * Math.PI * 2,
        radius: 1.6 + randomInt(401) / 1000
      }
    };
    // Atomic in one event-loop turn: async database work finishes before here.
    room.set(identity.userId, member);
    this.rooms.set(roomId, room);
    this.sockets.set(socket, member);
    this.deliver(member, { type: 'presence:snapshot', users: this.snapshot(roomId) });
    if (!this.sockets.has(socket)) return false;
    this.publish(roomId, { type: 'presence:join', ...member.user });
    return true;
  }

  // Single-replica delivery seam. Redis can relay publications here later, but
  // multiple replicas ALSO require shared snapshots, identity ownership and an
  // atomic global capacity check. Pub/sub alone would not make this safe to scale.
  publish(roomId: string, message: PresenceMessage): void {
    for (const member of [...(this.rooms.get(roomId)?.values() ?? [])]) {
      if (message.type === 'presence:join' && member.user.userId === message.userId) continue;
      this.deliver(member, message);
    }
  }

  private deliver(member: Member, message: PresenceMessage): void {
    const { socket } = member;
    if (!this.sockets.has(socket)) return;
    if (socket.readyState !== OPEN || socket.bufferedAmount > 64 * 1024) {
      this.drop(socket);
      return;
    }
    try {
      socket.send(JSON.stringify(message), (error) => { if (error) this.drop(socket); });
    } catch {
      this.drop(socket);
    }
  }

  heartbeat(socket: PresenceSocket): void {
    const member = this.sockets.get(socket);
    if (member) member.lastSeen = this.now();
  }

  leave(socket: PresenceSocket): void {
    const member = this.sockets.get(socket);
    if (!member) return;
    // Remove first, then broadcast; repeated close/error events are idempotent.
    this.sockets.delete(socket);
    const room = this.rooms.get(member.roomId);
    room?.delete(member.user.userId);
    if (room?.size === 0) this.rooms.delete(member.roomId);
    this.publish(member.roomId, { type: 'presence:leave', userId: member.user.userId });
  }

  reject(socket: PresenceSocket, code: number, reason: string): void {
    this.leave(socket);
    socket.close(code, reason);
  }

  drop(socket: PresenceSocket): void {
    this.leave(socket);
    socket.terminate();
  }

  tick(): void {
    const now = this.now();
    for (const member of [...this.sockets.values()]) {
      if (now >= member.expiresAt) {
        this.reject(member.socket, 4401, 'Token expired');
      } else if (now - member.lastSeen >= this.timeoutMs) {
        this.drop(member.socket);
      } else if (now - member.lastPing >= this.pingEveryMs) {
        member.lastPing = now;
        try { member.socket.ping(); } catch { this.drop(member.socket); }
      }
    }
  }

  shutdown(): void {
    for (const socket of [...this.sockets.keys()]) this.reject(socket, 1001, 'Service shutting down');
  }
}
