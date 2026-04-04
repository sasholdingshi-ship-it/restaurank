import { db } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

/** PUT — Upsert a monthly expense */
export async function PUT(req: NextRequest) {
  const { year, month, type, amount } = await req.json()
  if (!year || !month || !type) return NextResponse.json({ error: 'year, month, type required' }, { status: 400 })

  const prisma = await db()

  const existing = await prisma.monthlyExpense.findUnique({
    where: { year_month_type: { year, month, type } },
  })

  if (existing) {
    await prisma.monthlyExpense.update({ where: { id: existing.id }, data: { amount } })
  } else {
    await prisma.monthlyExpense.create({ data: { year, month, type, amount } })
  }

  return NextResponse.json({ success: true })
}
