import { db } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { createSnapshot, restoreEntity, SnapshotEntity } from '@/lib/snapshots'

// POST /api/snapshots/:id/restore → restore the snapshot (after creating a safety snapshot of current state)
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const prisma = await db()
  const snap = await prisma.snapshot.findUnique({ where: { id: parseInt(id) } })
  if (!snap) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Safety net: snapshot the current state before overwriting, so the user can undo the restore.
  await createSnapshot(
    prisma,
    snap.entity as SnapshotEntity,
    `Auto-save avant restore #${snap.id} (${snap.label})`,
  )

  // Now restore
  const n = await restoreEntity(prisma, snap.entity as SnapshotEntity, snap.data)
  return NextResponse.json({ restored: n, entity: snap.entity, from: snap.label })
}
