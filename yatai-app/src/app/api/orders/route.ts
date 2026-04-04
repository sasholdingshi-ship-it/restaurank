import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const restaurantId = req.nextUrl.searchParams.get('restaurantId')
  const year = req.nextUrl.searchParams.get('year')
  const month = req.nextUrl.searchParams.get('month')

  const where: Record<string, unknown> = {}
  if (restaurantId) where.restaurantId = parseInt(restaurantId)
  if (year) where.year = parseInt(year)
  if (month) where.month = parseInt(month)

  const orders = await prisma.order.findMany({
    where,
    include: {
      restaurant: true,
      items: { include: { product: true }, orderBy: { day: 'asc' } },
    },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
  })
  return NextResponse.json(orders)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { restaurantId, year, month, entries } = body as {
    restaurantId: number; year: number; month: number
    entries: { productId: number; day: number; quantity: number }[]
  }

  const order = await prisma.order.upsert({
    where: { restaurantId_year_month: { restaurantId, year, month } },
    create: { restaurantId, year, month },
    update: {},
  })

  for (const entry of entries) {
    if (entry.quantity <= 0) {
      await prisma.orderItem.deleteMany({
        where: { orderId: order.id, productId: entry.productId, day: entry.day },
      })
    } else {
      await prisma.orderItem.upsert({
        where: { orderId_productId_day: { orderId: order.id, productId: entry.productId, day: entry.day } },
        create: { orderId: order.id, productId: entry.productId, day: entry.day, quantity: entry.quantity },
        update: { quantity: entry.quantity },
      })
    }
  }

  return NextResponse.json({ success: true, orderId: order.id })
}
