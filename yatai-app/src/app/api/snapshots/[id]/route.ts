import { db } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

// DELETE /api/snapshots/:id
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const prisma = await db()
  await prisma.snapshot.delete({ where: { id: parseInt(id) } })
  return NextResponse.json({ ok: true })
}

// GET /api/snapshots/:id → full data (for preview before restore)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const prisma = await db()
  const snap = await prisma.snapshot.findUnique({ where: { id: parseInt(id) } })
  if (!snap) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(snap)
}
