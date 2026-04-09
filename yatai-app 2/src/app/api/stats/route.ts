import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

// Get stats for anomaly detection: average, min, max per product per restaurant
export async function GET(req: NextRequest) {
  const restaurantId = req.nextUrl.searchParams.get('restaurantId')
  const productId = req.nextUrl.searchParams.get('productId')

  if (!restaurantId) {
    return NextResponse.json({ error: 'restaurantId required' }, { status: 400 })
  }

  const where: Record<string, unknown> = {
    order: { restaurantId: parseInt(restaurantId) },
  }
  if (productId) where.productId = parseInt(productId)

  // Get all order items for this restaurant
  const items = await prisma.orderItem.findMany({
    where,
    include: { product: true, order: true },
  })

  // Group by product and compute stats
  const statsMap = new Map<number, { productId: number; ref: string; name: string; quantities: number[] }>()

  for (const item of items) {
    if (!statsMap.has(item.productId)) {
      statsMap.set(item.productId, {
        productId: item.productId,
        ref: item.product.ref,
        name: item.product.name,
        quantities: [],
      })
    }
    statsMap.get(item.productId)!.quantities.push(item.quantity)
  }

  const stats = Array.from(statsMap.values()).map(s => {
    const avg = s.quantities.reduce((a, b) => a + b, 0) / s.quantities.length
    const min = Math.min(...s.quantities)
    const max = Math.max(...s.quantities)
    return {
      productId: s.productId,
      ref: s.ref,
      name: s.name,
      avg: Math.round(avg * 100) / 100,
      min,
      max,
      count: s.quantities.length,
    }
  })

  return NextResponse.json(stats)
}
