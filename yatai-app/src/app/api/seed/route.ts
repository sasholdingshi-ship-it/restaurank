import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/prisma'

export async function GET() {
  try {
    const prisma = await db()
    const restaurants = await prisma.restaurant.findMany()
    const ingredients = await prisma.ingredient.findMany({ take: 3 })
    const products = await prisma.product.findMany({ take: 3 })
    return NextResponse.json({
      restaurants: restaurants.length,
      ingredients: ingredients.length,
      products: products.length,
      sample: restaurants.map(r => r.name),
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const { secret } = await req.json()
  if (secret !== 'yatai-reseed-2026') return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const prisma = await db()

  // Clear all data in correct order (foreign keys)
  await prisma.$executeRawUnsafe(`DELETE FROM "OrderExtra"`)
  await prisma.$executeRawUnsafe(`DELETE FROM "OrderItem"`)
  await prisma.$executeRawUnsafe(`DELETE FROM "Order"`)
  await prisma.$executeRawUnsafe(`DELETE FROM "RecipeIngredient"`)
  await prisma.$executeRawUnsafe(`DELETE FROM "Recipe"`)
  await prisma.$executeRawUnsafe(`DELETE FROM "Product"`)
  await prisma.$executeRawUnsafe(`DELETE FROM "Ingredient"`)
  await prisma.$executeRawUnsafe(`DELETE FROM "Restaurant"`)
  await prisma.$executeRawUnsafe(`DELETE FROM "SmicConfig"`)

  // Re-import from seed-data.json
  const seedJson = await import('@/lib/seed-data.json')
  const data = seedJson.default || seedJson
  const now = new Date().toISOString()

  // SMIC
  const smic = data.smicConfig as { hourlyRate: number; monthlyRate?: number }
  await prisma.$executeRawUnsafe(`INSERT INTO "SmicConfig" ("hourlyRate","monthlyRate") VALUES (?,?)`, smic.hourlyRate, smic.monthlyRate || null)

  // Restaurants
  for (const r of data.restaurants as any[]) {
    await prisma.$executeRawUnsafe(
      `INSERT OR REPLACE INTO "Restaurant" ("id","code","name","arrondissement","siren","deliveryPrice","tvaRate","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?)`,
      r.id, r.code, r.name, r.arrondissement, r.siren || null, r.deliveryPrice ?? 25, r.tvaRate ?? 0.055, now, now
    )
  }

  // Ingredients
  for (const i of data.ingredients as any[]) {
    await prisma.$executeRawUnsafe(
      `INSERT OR REPLACE INTO "Ingredient" ("id","ref","name","supplier","priceTtc","priceHt","weight","pricePerKg","lossPercent","netPriceKg","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      i.id, i.ref, i.name, i.supplier || null, i.priceTtc || null, i.priceHt || null, i.weight || null, i.pricePerKg || null, i.lossPercent || 0, i.netPriceKg || null, now, now
    )
  }

  // Recipes
  for (const r of data.recipes as any[]) {
    await prisma.$executeRawUnsafe(
      `INSERT OR REPLACE INTO "Recipe" ("id","ref","name","category","unit","portions","portionLabel","laborTime","aleaPercent","margin","costPerUnit","sellingPrice","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      r.id, r.ref, r.name, r.category || null, r.unit || null, r.portions || null, r.portionLabel || null, r.laborTime || null, r.aleaPercent || 0.02, r.margin || null, r.costPerUnit || null, r.sellingPrice || null, now, now
    )
  }

  // RecipeIngredients
  const ri = data.recipeIngredients as any[]
  for (let i = 0; i < ri.length; i += 50) {
    const chunk = ri.slice(i, i + 50)
    const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?)').join(',')
    const values = chunk.flatMap((r: any) => [r.recipeId, r.ingredientId || null, r.ingredientRef || null, r.quantity || 0, r.unitPrice || 0, r.amount || 0, r.unit || null, r.notes || null])
    await prisma.$executeRawUnsafe(`INSERT INTO "RecipeIngredient" ("recipeId","ingredientId","ingredientRef","quantity","unitPrice","amount","unit","notes") VALUES ${placeholders}`, ...values)
  }

  // Products
  for (const p of data.products as any[]) {
    await prisma.$executeRawUnsafe(
      `INSERT OR REPLACE INTO "Product" ("id","ref","name","priceHt","unit","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?)`,
      p.id, p.ref, p.name, p.priceHt || null, p.unit || null, now, now
    )
  }

  // Orders
  for (const o of data.orders as any[]) {
    await prisma.$executeRawUnsafe(
      `INSERT OR REPLACE INTO "Order" ("id","restaurantId","year","month","nbPassages","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?)`,
      o.id, o.restaurantId, o.year, o.month, o.nbPassages || 0, now, now
    )
  }

  // OrderItems
  const orderItems = data.orderItems as Record<string, Record<string, Record<string, number>>>
  const allItems: [number, number, number, number][] = []
  for (const [orderId, products] of Object.entries(orderItems)) {
    for (const [productId, days] of Object.entries(products as Record<string, Record<string, number>>)) {
      for (const [day, qty] of Object.entries(days as Record<string, number>)) {
        allItems.push([parseInt(orderId), parseInt(productId), parseInt(day), qty])
      }
    }
  }
  const BATCH = 500
  for (let i = 0; i < allItems.length; i += BATCH) {
    const chunk = allItems.slice(i, i + BATCH)
    const placeholders = chunk.map(() => '(?,?,?,?)').join(',')
    const values = chunk.flat()
    await prisma.$executeRawUnsafe(`INSERT OR IGNORE INTO "OrderItem" ("orderId","productId","day","quantity") VALUES ${placeholders}`, ...values)
  }

  return NextResponse.json({
    success: true,
    restaurants: (data.restaurants as any[]).length,
    ingredients: (data.ingredients as any[]).length,
    recipes: (data.recipes as any[]).length,
    recipeIngredients: ri.length,
    products: (data.products as any[]).length,
    orders: (data.orders as any[]).length,
    orderItems: allItems.length,
  })
}
