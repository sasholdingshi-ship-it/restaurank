import { db } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const prisma = await db()
  const restaurantId = req.nextUrl.searchParams.get('restaurantId')
  const year = req.nextUrl.searchParams.get('year')
  const month = req.nextUrl.searchParams.get('month')
  const where: Record<string, unknown> = {}
  if (restaurantId) where.restaurantId = parseInt(restaurantId)
  if (year) where.year = parseInt(year)
  if (month) where.month = parseInt(month)
  const orders = await prisma.order.findMany({
    where, include: { restaurant: true, extras: true, items: { include: { product: true }, orderBy: { day: 'asc' } } },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
  })
  return NextResponse.json(orders)
}

export async function POST(req: NextRequest) {
  const prisma = await db()
  const { restaurantId, year, month, entries } = await req.json() as {
    restaurantId: number; year: number; month: number
    entries: { productId: number; day: number; quantity: number; unitPrice?: number | null }[]
  }
  const order = await prisma.order.upsert({
    where: { restaurantId_year_month: { restaurantId, year, month } },
    create: { restaurantId, year, month }, update: {},
  })
  for (const entry of entries) {
    if (entry.quantity <= 0) {
      await prisma.orderItem.deleteMany({ where: { orderId: order.id, productId: entry.productId, day: entry.day } })
    } else {
      const data = { quantity: entry.quantity, unitPrice: entry.unitPrice ?? null }
      await prisma.orderItem.upsert({
        where: { orderId_productId_day: { orderId: order.id, productId: entry.productId, day: entry.day } },
        create: { orderId: order.id, productId: entry.productId, day: entry.day, ...data },
        update: data,
      })
    }
  }
  return NextResponse.json({ success: true, orderId: order.id })
}
