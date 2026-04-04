import { PrismaClient } from '@prisma/client'
import { ensureDb } from './init-db'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma = globalForPrisma.prisma || new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

// Call this before any DB operation in API routes
export async function db() {
  await ensureDb(prisma)
  return prisma
}
