import { db } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const prisma = await db()
  const { restaurantId, year, month, type, label, price, quantity } = await req.json()
  if (!restaurantId || !year || !month || !type) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const order = await prisma.order.upsert({
    where: { restaurantId_year_month: { restaurantId, year, month } },
    create: { restaurantId, year, month },
    update: {},
  })

  const extra = await prisma.orderExtra.create({
    data: { orderId: order.id, type, label: label || '', price: price ?? 0, quantity: quantity ?? 0 },
  })

  return NextResponse.json(extra)
}

export async function DELETE(req: NextRequest) {
  const prisma = await db()
  const id = parseInt(req.nextUrl.searchParams.get('id') || '0')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  await prisma.orderExtra.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
