import { PrismaClient } from '@prisma/client'
import { PrismaLibSQL } from '@prisma/adapter-libsql'
import { createClient } from '@libsql/client'
import { ensureDb } from './init-db'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

function createPrismaClient() {
  const tursoUrl = process.env.TURSO_DATABASE_URL
  const tursoToken = process.env.TURSO_AUTH_TOKEN

  if (tursoUrl && tursoToken) {
    // Production: Turso (persistent hosted SQLite)
    const libsql = createClient({ url: tursoUrl, authToken: tursoToken })
    const adapter = new PrismaLibSQL(libsql)
    // Prisma needs DATABASE_URL even with adapter — set dummy if missing
    if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'file:/tmp/prisma-dummy.db'
    return new PrismaClient({ adapter } as any)
  }

  // Local dev: file-based SQLite
  return new PrismaClient()
}

export const prisma = globalForPrisma.prisma || createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export async function db() {
  await ensureDb(prisma)
  return prisma
}
