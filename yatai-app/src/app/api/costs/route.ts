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

  // Per-restaurant Rekki cost (labo billings) — used for correlation with Zelty sales
  const rekkiByRestaurant = new Map<number, { rekkiHT: number; foodCost: number }>()

  const LABO_RESTAURANT_ID = 3 // Yatai Chateaudun (9ème) = labo
  for (const order of orders) {
    if (order.restaurantId === LABO_RESTAURANT_ID) continue // skip labo (no self-invoicing)
    let orderRevenue = 0
    let orderFoodCost = 0
    for (const item of order.items) {
      const qty = item.quantity
      const unitPrice = item.unitPrice ?? item.product.priceHt ?? 0
      revenue += qty * unitPrice
      orderRevenue += qty * unitPrice

      const recipe = recipeByRef.get(item.product.ref)
      if (recipe) {
        const portions = recipe.portions || 1
        const ingredientSubtotal = recipe.ingredients.reduce((s, ri) => s + ri.amount, 0)
        const foodCostPerUnit = ingredientSubtotal * (1 + (recipe.aleaPercent ?? 0.02)) / portions
        const laborCostPerUnit = ((recipe.laborTime ?? 0) * hourlyRate) / portions

        foodCost += foodCostPerUnit * qty
        staffCostTheo += laborCostPerUnit * qty
        orderFoodCost += foodCostPerUnit * qty
        matchedItems++
      } else {
        unmatchedItems++
      }
    }
    // Add extras to revenue
    for (const extra of (order.extras || [])) {
      revenue += extra.price * extra.quantity
      orderRevenue += extra.price * extra.quantity
    }

    const prev = rekkiByRestaurant.get(order.restaurantId) || { rekkiHT: 0, foodCost: 0 }
    rekkiByRestaurant.set(order.restaurantId, {
      rekkiHT: prev.rekkiHT + orderRevenue,
      foodCost: prev.foodCost + orderFoodCost,
    })
  }

  // Get manual expenses
  const expenses = await prisma.monthlyExpense.findMany({ where: { year, month } })
  const expenseMap: Record<string, number> = {}
  for (const e of expenses) expenseMap[e.type] = e.amount

  // Get Zelty sales — actual customer POS revenue per restaurant
  const zeltySales = await prisma.zeltySale.findMany({ where: { year, month } })
  const zeltyByRestaurant: Record<number, { totalHT: number; totalTTC: number; ordersCount: number; eatInTTC: number; takeawayTTC: number; deliveryTTC: number }> = {}
  let zeltyTotalHT = 0
  let zeltyTotalTTC = 0
  let zeltyOrdersCount = 0
  for (const z of zeltySales) {
    zeltyByRestaurant[z.restaurantId] = {
      totalHT: z.totalHT, totalTTC: z.totalTTC, ordersCount: z.ordersCount,
      eatInTTC: z.eatInTTC, takeawayTTC: z.takeawayTTC, deliveryTTC: z.deliveryTTC,
    }
    // Exclude labo from consolidated CA (Y Chateaudun = labo, restaurantId 3)
    if (z.restaurantId !== LABO_RESTAURANT_ID) {
      zeltyTotalHT += z.totalHT
      zeltyTotalTTC += z.totalTTC
      zeltyOrdersCount += z.ordersCount
    }
  }

  // Per-restaurant correlation: Rekki cost vs Zelty revenue
  const restaurants = await prisma.restaurant.findMany({ where: { id: { not: LABO_RESTAURANT_ID } }, orderBy: { id: 'asc' } })
  const correlation = restaurants.map(r => {
    const rekki = rekkiByRestaurant.get(r.id) || { rekkiHT: 0, foodCost: 0 }
    const zelty = zeltyByRestaurant[r.id] || { totalHT: 0, totalTTC: 0, ordersCount: 0, eatInTTC: 0, takeawayTTC: 0, deliveryTTC: 0 }
    const foodCostRatio = zelty.totalHT > 0 ? (rekki.foodCost / zelty.totalHT * 100) : 0
    const rekkiRatio = zelty.totalHT > 0 ? (rekki.rekkiHT / zelty.totalHT * 100) : 0
    return {
      restaurantId: r.id, name: r.name, arrondissement: r.arrondissement,
      rekkiHT: Math.round(rekki.rekkiHT * 100) / 100,
      rekkiFoodCost: Math.round(rekki.foodCost * 100) / 100,
      zeltyHT: Math.round(zelty.totalHT * 100) / 100,
      zeltyTTC: Math.round(zelty.totalTTC * 100) / 100,
      zeltyOrders: zelty.ordersCount,
      zeltyEatIn: Math.round(zelty.eatInTTC * 100) / 100,
      zeltyTakeaway: Math.round(zelty.takeawayTTC * 100) / 100,
      zeltyDelivery: Math.round(zelty.deliveryTTC * 100) / 100,
      foodCostRatio: Math.round(foodCostRatio * 100) / 100,
      rekkiRatio: Math.round(rekkiRatio * 100) / 100,
    }
  })

  return NextResponse.json({
    year, month,
    revenue: Math.round(revenue * 100) / 100,
    foodCost: Math.round(foodCost * 100) / 100,
    foodCostPercent: revenue > 0 ? Math.round(foodCost / revenue * 10000) / 100 : 0,
    staffCostTheo: Math.round(staffCostTheo * 100) / 100,
    staffCostTheoPercent: revenue > 0 ? Math.round(staffCostTheo / revenue * 10000) / 100 : 0,
    foodCostReel: expenseMap['food_cost_reel'] ?? null,
    staffCostReel: expenseMap['staff_reel'] ?? null,
    venteDarkKitchen: expenseMap['vente_dark_kitchen'] ?? null,
    venteAnnexe: expenseMap['vente_annexe'] ?? null,
    loyer: expenseMap['loyer'] ?? 3000,
    electricite: expenseMap['electricite'] ?? 2000,
    logistiqueCamion: expenseMap['logistique_camion'] ?? 1600,
    logistiqueEssence: expenseMap['logistique_essence'] ?? 130,
    charges: expenseMap['charges'] ?? 400,
    internet: expenseMap['internet'] ?? 30,
    nettoyage: expenseMap['nettoyage'] ?? 550,
    matchedItems,
    unmatchedItems,
    hourlyRate: Math.round(hourlyRate * 100) / 100,
    // Zelty CA (POS réel client, hors labo)
    zeltyHT: Math.round(zeltyTotalHT * 100) / 100,
    zeltyTTC: Math.round(zeltyTotalTTC * 100) / 100,
    zeltyOrdersCount,
    correlation,
  })
}
