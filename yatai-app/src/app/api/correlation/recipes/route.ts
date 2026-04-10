import { db } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

const LABO_RESTAURANT_ID = 3 // Yatai Chateaudun (9ème) = labo

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseKeywords(json: string): string[] {
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Find a Yatai product name in the available list that matches one of the keywords. */
function matchYataiProduct(keywords: string[], yataiNames: string[]): string | null {
  if (!keywords.length) return null
  for (const kw of keywords) {
    const nk = normalize(kw)
    if (!nk) continue
    const found = yataiNames.find(y => normalize(y).includes(nk))
    if (found) return found
  }
  return null
}

/** Find Zelty dish names matching a dish's keywords, with disambiguation. */
function matchZeltyDishesForDish(dishName: string, keywords: string[], zeltyNames: string[]): string[] {
  if (!keywords.length) return []
  const matched = new Set<string>()
  for (const kw of keywords) {
    const nk = normalize(kw)
    if (!nk) continue
    for (const z of zeltyNames) {
      if (normalize(z).includes(nk)) matched.add(z)
    }
  }
  // Disambiguate: avoid matching "Karaage" dish to "Spicy Karaage" and vice versa
  if (dishName === 'Karaage') {
    return Array.from(matched).filter(z => !normalize(z).includes('spicy'))
  }
  if (dishName === 'Torikatsu') {
    // Tapas Torikatsu is just "Torikatsu" alone, not Curry Torikatsu / Torikatsu Don
    return Array.from(matched).filter(z => {
      const n = normalize(z)
      return !n.includes('curry') && !n.includes('don')
    })
  }
  return Array.from(matched)
}

export async function GET(req: NextRequest) {
  const year = parseInt(req.nextUrl.searchParams.get('year') || '0')
  const month = parseInt(req.nextUrl.searchParams.get('month') || '0')
  const restaurantIdParam = req.nextUrl.searchParams.get('restaurantId')
  if (!year || !month) return NextResponse.json({ error: 'year, month required' }, { status: 400 })

  const prisma = await db()
  const targetRestaurantId = restaurantIdParam ? parseInt(restaurantIdParam) : null

  // 0. Load all DishBom + ingredients from DB
  const dishBoms = await prisma.dishBom.findMany({
    include: { ingredients: true },
    orderBy: { name: 'asc' },
  })

  // 1. Fetch Yatai Rekki orders (labo→restaurants), aggregated per product
  const orders = await prisma.order.findMany({
    where: {
      year, month,
      restaurantId: targetRestaurantId
        ? targetRestaurantId
        : { not: LABO_RESTAURANT_ID },
    },
    include: { items: { include: { product: true } } },
  })

  type YataiAgg = { name: string; qty: number; rekkiHT: number }
  const yataiByName = new Map<string, YataiAgg>()
  for (const o of orders) {
    for (const item of o.items) {
      const name = item.product.name
      const qty = item.quantity || 0
      const unitPrice = item.unitPrice ?? item.product.priceHt ?? 0
      let agg = yataiByName.get(name)
      if (!agg) {
        agg = { name, qty: 0, rekkiHT: 0 }
        yataiByName.set(name, agg)
      }
      agg.qty += qty
      agg.rekkiHT += qty * unitPrice
    }
  }
  const yataiNames = Array.from(yataiByName.keys())

  // 2. Fetch Zelty dish sales (downstream POS)
  const zeltyDishes = await prisma.zeltyDishSale.findMany({
    where: {
      year, month,
      ...(targetRestaurantId ? { restaurantId: targetRestaurantId } : { restaurantId: { not: LABO_RESTAURANT_ID } }),
    },
  })

  type ZeltyAgg = { name: string; qty: number }
  const zeltyByName = new Map<string, ZeltyAgg>()
  for (const d of zeltyDishes) {
    let agg = zeltyByName.get(d.name)
    if (!agg) {
      agg = { name: d.name, qty: 0 }
      zeltyByName.set(d.name, agg)
    }
    agg.qty += d.quantity
  }
  const zeltyNames = Array.from(zeltyByName.keys())

  // 3. For each DishBom, compute portions sold (= sum of matched Zelty dish qty)
  type RecipeRow = {
    recipe: string
    category: string
    isALaCarte: boolean
    portionsSold: number
    matchedZeltyDishes: { name: string; qty: number }[]
    unmappedZelty: boolean
  }
  const recipeRows: RecipeRow[] = []
  for (const bom of dishBoms) {
    const keywords = parseKeywords(bom.zeltyKeywords)
    const matched = matchZeltyDishesForDish(bom.name, keywords, zeltyNames)
    const matchedWithQty = matched.map(m => ({ name: m, qty: zeltyByName.get(m)?.qty || 0 }))
    const portions = matchedWithQty.reduce((s, m) => s + m.qty, 0)
    recipeRows.push({
      recipe: bom.name,
      category: bom.category,
      isALaCarte: bom.isALaCarte,
      portionsSold: portions,
      matchedZeltyDishes: matchedWithQty,
      unmappedZelty: matched.length === 0,
    })
  }

  // 4. Expected ingredient consumption = Σ qtyPerPortion × portionsSold
  // Aggregated per Yatai product (since multiple ingredient names may resolve to same product)
  type ProductRow = {
    yataiProduct: string
    actualQty: number
    actualHT: number
    expectedQty: number
    ratio: number | null
    contributingIngredients: { name: string; expected: number; fromDish: string }[]
  }
  const expectedByYataiProduct = new Map<string, {
    sum: number
    ingredients: { name: string; expected: number; fromDish: string }[]
  }>()

  for (const row of recipeRows) {
    if (row.portionsSold === 0) continue
    const bom = dishBoms.find(b => b.name === row.recipe)
    if (!bom) continue
    for (const ing of bom.ingredients) {
      const expected = ing.qtyPerPortion * row.portionsSold
      if (expected === 0) continue
      const keywords = parseKeywords(ing.yataiProductKeywords)
      const matchedYatai = matchYataiProduct(keywords, yataiNames)
      if (!matchedYatai) continue
      let agg = expectedByYataiProduct.get(matchedYatai)
      if (!agg) {
        agg = { sum: 0, ingredients: [] }
        expectedByYataiProduct.set(matchedYatai, agg)
      }
      agg.sum += expected
      agg.ingredients.push({
        name: ing.name,
        expected: Math.round(expected * 100) / 100,
        fromDish: row.recipe,
      })
    }
  }

  const productRows: ProductRow[] = []
  for (const [name, yAgg] of yataiByName.entries()) {
    const expAgg = expectedByYataiProduct.get(name)
    const expected = expAgg?.sum || 0
    if (expected === 0) continue
    productRows.push({
      yataiProduct: name,
      actualQty: Math.round(yAgg.qty * 100) / 100,
      actualHT: Math.round(yAgg.rekkiHT * 100) / 100,
      expectedQty: Math.round(expected * 100) / 100,
      ratio: expected > 0 ? Math.round((yAgg.qty / expected) * 1000) / 1000 : null,
      contributingIngredients: expAgg!.ingredients.sort((a, b) => b.expected - a.expected),
    })
  }
  productRows.sort((a, b) => b.actualHT - a.actualHT)

  // 5. Stats + unmapped
  const recipesMatched = recipeRows.filter(r => r.portionsSold > 0).length
  const recipesUnmapped = recipeRows.filter(r => r.matchedZeltyDishes.length === 0).map(r => r.recipe)
  const matchedZeltySet = new Set(recipeRows.flatMap(r => r.matchedZeltyDishes.map(m => m.name)))
  const unmatchedZelty = Array.from(zeltyByName.values())
    .filter(z => !matchedZeltySet.has(z.name))
    .sort((a, b) => b.qty - a.qty)
  const matchedYataiSet = new Set(productRows.map(r => r.yataiProduct))
  const unmatchedYatai = Array.from(yataiByName.values())
    .filter(y => !matchedYataiSet.has(y.name))
    .sort((a, b) => b.rekkiHT - a.rekkiHT)
    .map(y => ({ name: y.name, qty: Math.round(y.qty * 100) / 100, rekkiHT: Math.round(y.rekkiHT * 100) / 100 }))

  return NextResponse.json({
    year, month,
    restaurantId: targetRestaurantId,
    recipesTotal: recipeRows.length,
    recipesMatched,
    recipesUnmapped,
    recipes: recipeRows.sort((a, b) => b.portionsSold - a.portionsSold),
    products: productRows,
    unmatchedZelty: unmatchedZelty.slice(0, 50),
    unmatchedYatai: unmatchedYatai.slice(0, 50),
  })
}
