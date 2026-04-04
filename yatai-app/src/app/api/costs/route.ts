import { db } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

/** GET — Calculate P&L for a given month: food cost, staff cost, fixed charges */
export async function GET(req: NextRequest) {
  const year = parseInt(req.nextUrl.searchParams.get('year') || '0')
  const month = parseInt(req.nextUrl.searchParams.get('month') || '0')
  if (!year || !month) return NextResponse.json({ error: 'year, month required' }, { status: 400 })

  const prisma = await db()

  // Get recipes with ingredients for cost breakdown
  const recipes = await prisma.recipe.findMany({ include: { ingredients: true } })
  const recipeByRef = new Map(recipes.map(r => [r.ref, r]))

  // Get SMIC hourly rate
  const smic = await prisma.smicConfig.findFirst()
  const hourlyRate = smic?.monthlyRate ? (smic.monthlyRate * 12) / 11 / 151.67 : smic?.hourlyRate ?? 16.33

  // Get all orders for the period
  const orders = await prisma.order.findMany({
    where: { year, month },
    include: { items: { include: { product: true } }, extras: true, restaurant: true },
  })

  let foodCost = 0
  let staffCostTheo = 0
  let revenue = 0
  let matchedItems = 0
  let unmatchedItems = 0

  for (const order of orders) {
    for (const item of order.items) {
      const qty = item.quantity
      const unitPrice = item.unitPrice ?? item.product.priceHt ?? 0
      revenue += qty * unitPrice

      const recipe = recipeByRef.get(item.product.ref)
      if (recipe) {
        const portions = recipe.portions || 1
        const ingredientSubtotal = recipe.ingredients.reduce((s, ri) => s + ri.amount, 0)
        const foodCostPerUnit = ingredientSubtotal * (1 + (recipe.aleaPercent ?? 0.02)) / portions
        const laborCostPerUnit = ((recipe.laborTime ?? 0) * hourlyRate) / portions

        foodCost += foodCostPerUnit * qty
        staffCostTheo += laborCostPerUnit * qty
        matchedItems++
      } else {
        unmatchedItems++
      }
    }
    // Add extras to revenue
    for (const extra of (order.extras || [])) {
      revenue += extra.price * extra.quantity
    }
  }

  // Get manual expenses
  const expenses = await prisma.monthlyExpense.findMany({ where: { year, month } })
  const expenseMap: Record<string, number> = {}
  for (const e of expenses) expenseMap[e.type] = e.amount

  return NextResponse.json({
    year, month,
    revenue: Math.round(revenue * 100) / 100,
    foodCost: Math.round(foodCost * 100) / 100,
    foodCostPercent: revenue > 0 ? Math.round(foodCost / revenue * 10000) / 100 : 0,
    staffCostTheo: Math.round(staffCostTheo * 100) / 100,
    staffCostTheoPercent: revenue > 0 ? Math.round(staffCostTheo / revenue * 10000) / 100 : 0,
    staffCostReel: expenseMap['staff_reel'] ?? null,
    loyer: expenseMap['loyer'] ?? 3000,
    electricite: expenseMap['electricite'] ?? 2000,
    logistiqueCamion: expenseMap['logistique_camion'] ?? 1600,
    logistiqueEssence: expenseMap['logistique_essence'] ?? 130,
    charges: expenseMap['charges'] ?? 400,
    internet: expenseMap['internet'] ?? 30,
    matchedItems,
    unmatchedItems,
    hourlyRate: Math.round(hourlyRate * 100) / 100,
  })
}
