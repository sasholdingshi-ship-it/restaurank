import { db } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

const LABO_RESTAURANT_ID = 3 // Yatai Chateaudun (9ème) = labo (excluded from consolidated)

// Manual high-confidence mappings: Yatai product name → list of Zelty dish name keywords
// (case-insensitive substring match against the Zelty dish name)
// Use this when the auto-substring match isn't reliable.
const MANUAL_MAP: Record<string, string[]> = {
  'Gyoza porc': ['Gyoza maison'],
  'Gyoza veggie': ['Gyoza végétarien', 'Gyoza veggie'],
  'Karaage': ['Karaage'],
  'Torikatsu': ['Torikatsu'],
  'Cheesecake': ['Cheesecake'],
  'Fondant Matcha': ['Fondant Matcha'],
  'Mousse matcha': ['Mousse matcha'],
  'Mousse nature': ['Mousse nature'],
  'Pate mochi': ['Mochi'],
  'Wagyu tranché sur place': ['Wagyu'],
  'Wagyu tranché sous vide': ['Wagyu'],
  'Magret ': ['Magret'],
  'Riz au lait genmaicha': ['Riz au lait', 'Genmaicha'],
  'Cuisse de poulet Curry': ['Curry', 'Kare Raisu'],
  'Poulet teriyaki': ['Teriyaki'],
}

/** Normalize a string for fuzzy matching: lowercase, remove accents/emojis/punctuation */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')        // remove diacritics
    .replace(/[^\w\s]/g, ' ')                // remove punctuation/emojis
    .replace(/\s+/g, ' ')
    .trim()
}

/** For a given Yatai product name, find matching Zelty dishes (returns sorted by score) */
function findMatchingDishes(yataiName: string, zeltyDishNames: string[]): { name: string; score: number }[] {
  const normYatai = normalize(yataiName)
  const yataiTokens = normYatai.split(' ').filter(t => t.length >= 3)

  // 1. Manual map first
  const manual = MANUAL_MAP[yataiName]
  if (manual) {
    const normManual = manual.map(normalize)
    const matches = zeltyDishNames.filter(d => {
      const nd = normalize(d)
      return normManual.some(m => nd.includes(m))
    })
    if (matches.length > 0) return matches.map(name => ({ name, score: 100 }))
  }

  // 2. Auto: Yatai name fully contained in Zelty dish (substring)
  const subMatches = zeltyDishNames
    .map(d => ({ name: d, normD: normalize(d) }))
    .filter(({ normD }) => normD.includes(normYatai) && normYatai.length >= 4)
    .map(({ name }) => ({ name, score: 80 }))
  if (subMatches.length > 0) return subMatches

  // 3. Auto: token overlap (Jaccard-like)
  if (yataiTokens.length === 0) return []
  const scored = zeltyDishNames.map(d => {
    const dt = normalize(d).split(' ').filter(t => t.length >= 3)
    const overlap = yataiTokens.filter(t => dt.includes(t)).length
    if (overlap === 0) return null
    const score = Math.round((overlap / Math.max(yataiTokens.length, dt.length)) * 60)
    return { name: d, score }
  }).filter((x): x is { name: string; score: number } => x !== null && x.score >= 30)
  return scored.sort((a, b) => b.score - a.score).slice(0, 3)
}

export async function GET(req: NextRequest) {
  const year = parseInt(req.nextUrl.searchParams.get('year') || '0')
  const month = parseInt(req.nextUrl.searchParams.get('month') || '0')
  const restaurantIdParam = req.nextUrl.searchParams.get('restaurantId')
  if (!year || !month) return NextResponse.json({ error: 'year, month required' }, { status: 400 })

  const prisma = await db()
  const targetRestaurantId = restaurantIdParam ? parseInt(restaurantIdParam) : null

  // Fetch all Yatai labo orders for this period (excluding labo destination = no self-billing)
  const orders = await prisma.order.findMany({
    where: {
      year, month,
      restaurantId: targetRestaurantId
        ? targetRestaurantId
        : { not: LABO_RESTAURANT_ID },
    },
    include: {
      items: { include: { product: true } },
      restaurant: true,
    },
  })

  // Build per-product aggregate from Rekki orders
  // Key: productName → { qty, cost, byRestaurant: Map<restaurantId, qty> }
  type YataiAgg = { name: string; qty: number; rekkiHT: number; byRestaurant: Map<number, number> }
  const yataiByName = new Map<string, YataiAgg>()

  for (const o of orders) {
    for (const item of o.items) {
      const name = item.product.name
      const qty = item.quantity || 0
      const unitPrice = item.unitPrice ?? item.product.priceHt ?? 0
      const cost = qty * unitPrice
      let agg = yataiByName.get(name)
      if (!agg) {
        agg = { name, qty: 0, rekkiHT: 0, byRestaurant: new Map() }
        yataiByName.set(name, agg)
      }
      agg.qty += qty
      agg.rekkiHT += cost
      agg.byRestaurant.set(o.restaurantId, (agg.byRestaurant.get(o.restaurantId) || 0) + qty)
    }
  }

  // Fetch Zelty dish sales for the same period
  const zeltyDishes = await prisma.zeltyDishSale.findMany({
    where: {
      year, month,
      ...(targetRestaurantId ? { restaurantId: targetRestaurantId } : { restaurantId: { not: LABO_RESTAURANT_ID } }),
    },
  })

  // Build per-dish-name aggregate (sum across restaurants since same dish has different itemId per restaurant)
  type ZeltyAgg = { name: string; qty: number; byRestaurant: Map<number, number>; itemIds: number[] }
  const zeltyByName = new Map<string, ZeltyAgg>()
  for (const d of zeltyDishes) {
    let agg = zeltyByName.get(d.name)
    if (!agg) {
      agg = { name: d.name, qty: 0, byRestaurant: new Map(), itemIds: [] }
      zeltyByName.set(d.name, agg)
    }
    agg.qty += d.quantity
    agg.byRestaurant.set(d.restaurantId, (agg.byRestaurant.get(d.restaurantId) || 0) + d.quantity)
    agg.itemIds.push(d.zeltyItemId)
  }

  // Build the correlation list
  const allZeltyNames = Array.from(zeltyByName.keys())
  const yataiList = Array.from(yataiByName.values()).sort((a, b) => b.qty - a.qty)

  type ProductMatch = {
    yataiName: string
    yataiQty: number
    yataiRekkiHT: number
    matchedZelty: { name: string; qty: number; score: number }[]
    totalZeltyQty: number
    ratio: number | null  // yataiQty / totalZeltyQty (e.g. 1.0 = 1 Yatai unit per Zelty unit)
  }

  const correlations: ProductMatch[] = yataiList.map(y => {
    const matches = findMatchingDishes(y.name, allZeltyNames)
    const matched = matches.map(m => ({
      name: m.name,
      qty: zeltyByName.get(m.name)?.qty || 0,
      score: m.score,
    }))
    const totalZeltyQty = matched.reduce((s, m) => s + m.qty, 0)
    return {
      yataiName: y.name,
      yataiQty: Math.round(y.qty),
      yataiRekkiHT: Math.round(y.rekkiHT * 100) / 100,
      matchedZelty: matched,
      totalZeltyQty,
      ratio: totalZeltyQty > 0 ? Math.round((y.qty / totalZeltyQty) * 1000) / 1000 : null,
    }
  })

  // Stats
  const matchedCount = correlations.filter(c => c.matchedZelty.length > 0).length
  const unmatchedCount = correlations.length - matchedCount

  // Unmatched Zelty dishes (sold but no Yatai product mapped to them)
  const matchedZeltyNames = new Set(correlations.flatMap(c => c.matchedZelty.map(m => m.name)))
  const unmatchedZelty = Array.from(zeltyByName.values())
    .filter(z => !matchedZeltyNames.has(z.name))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 50)
    .map(z => ({ name: z.name, qty: z.qty }))

  return NextResponse.json({
    year, month,
    restaurantId: targetRestaurantId,
    yataiProductsTotal: yataiList.length,
    zeltyDishesTotal: zeltyByName.size,
    matchedCount, unmatchedCount,
    correlations: correlations.slice(0, 80),
    unmatchedZelty,
  })
}
