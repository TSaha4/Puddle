import { PrismaClient } from '../generated/client/index.js';

export interface RoomStore { ensureRoom(roomId: string): Promise<void> }

export function createRoomStore() {
  const prisma = new PrismaClient();
  return {
    connect: async () => { await prisma.$connect(); },
    disconnect: async () => { await prisma.$disconnect(); },
    ensureRoom: async (roomId: string) => {
      // Non-empty, flat update allows a native PostgreSQL upsert, including when
      // simultaneous first joins race to create the same room.
      await prisma.presenceRoom.upsert({
        where: { id: roomId },
        create: { id: roomId, name: roomId },
        update: { name: roomId }
      });
    }
  };
}
