import { db } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { createSnapshot, SnapshotEntity } from '@/lib/snapshots'

// GET /api/snapshots?entity=DishBom → list snapshots (without full data)
export async function GET(req: NextRequest) {
  const prisma = await db()
  const entity = req.nextUrl.searchParams.get('entity') || undefined
  const rows = await prisma.snapshot.findMany({
    where: entity ? { entity } : undefined,
    orderBy: { createdAt: 'desc' },
    select: { id: true, entity: true, label: true, createdAt: true },
  })
  return NextResponse.json(rows)
}

// POST /api/snapshots { entity, label } → create manual snapshot
export async function POST(req: NextRequest) {
  const prisma = await db()
  const body = await req.json()
  const { entity, label } = body
  if (!entity) return NextResponse.json({ error: 'entity required' }, { status: 400 })
  const id = await createSnapshot(prisma, entity as SnapshotEntity, label || `Manuel ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`)
  return NextResponse.json({ id }, { status: 201 })
}
