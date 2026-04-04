import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const restaurantId = req.nextUrl.searchParams.get('restaurantId')
  if (!restaurantId) return NextResponse.json({ error: 'restaurantId required' }, { status: 400 })

  // Get all orders for this restaurant (all months) — matches Excel's cross-sheet references
  const orders = await prisma.order.findMany({
    where: { restaurantId: parseInt(restaurantId) },
    include: { items: true },
  })

  // Aggregate monthly totals per product
  // Excel: AJ3 = SUM(E3:AI3) per month per product
  const monthlyTotals = new Map<number, Map<string, number>>() // productId → { "year-month" → total }

  for (const order of orders) {
    for (const item of order.items) {
      if (!monthlyTotals.has(item.productId)) monthlyTotals.set(item.productId, new Map())
      const key = `${order.year}-${order.month}`
      const productMap = monthlyTotals.get(item.productId)!
      productMap.set(key, (productMap.get(key) || 0) + item.quantity)
    }
  }

  // Calculate stats per product matching Excel formulas:
  // AL = average of non-zero monthly totals (IFERROR with count of non-zero months)
  // AM = MIN of non-zero monthly totals (uses 9999999 sentinel to ignore zeros)
  // AN = MAX of all monthly totals
  const stats = Array.from(monthlyTotals.entries()).map(([productId, monthMap]) => {
    const totals = Array.from(monthMap.values())
    const nonZero = totals.filter(t => t > 0)

    const avg = nonZero.length > 0 ? nonZero.reduce((a, b) => a + b, 0) / nonZero.length : 0
    const min = nonZero.length > 0 ? Math.min(...nonZero) : 0
    const max = totals.length > 0 ? Math.max(...totals) : 0

    return { productId, avg: Math.round(avg * 100) / 100, min, max, months: monthMap.size }
  })

  return NextResponse.json(stats)
}
