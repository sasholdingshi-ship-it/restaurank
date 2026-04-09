import { PrismaClient } from '@prisma/client'
import seedJson from './seed-data.json'

const globalInit = globalThis as unknown as { dbReady: boolean }

type SeedData = typeof seedJson

export async function ensureDb(prisma: PrismaClient) {
  if (globalInit.dbReady) return
  globalInit.dbReady = true

  try {
    // Create all tables
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Restaurant" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT, "code" TEXT NOT NULL UNIQUE, "name" TEXT NOT NULL,
      "arrondissement" TEXT NOT NULL, "siren" TEXT, "deliveryPrice" REAL NOT NULL DEFAULT 25,
      "tvaRate" REAL NOT NULL DEFAULT 0.055, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`)

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Ingredient" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT, "ref" INTEGER NOT NULL UNIQUE, "name" TEXT NOT NULL,
      "supplier" TEXT, "priceTtc" REAL, "priceHt" REAL, "weight" REAL, "pricePerKg" REAL,
      "lossPercent" REAL NOT NULL DEFAULT 0, "netPriceKg" REAL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`)

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Recipe" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT, "ref" TEXT NOT NULL UNIQUE, "name" TEXT NOT NULL,
      "category" TEXT, "unit" TEXT, "portions" REAL, "portionLabel" TEXT, "laborTime" REAL,
      "aleaPercent" REAL NOT NULL DEFAULT 0.02, "margin" REAL, "costPerUnit" REAL, "sellingPrice" REAL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`)

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "RecipeIngredient" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT, "recipeId" INTEGER NOT NULL, "ingredientId" INTEGER,
      "ingredientRef" INTEGER, "quantity" REAL NOT NULL DEFAULT 0, "unitPrice" REAL NOT NULL DEFAULT 0,
      "amount" REAL NOT NULL DEFAULT 0, "unit" TEXT, "notes" TEXT,
      FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE,
      FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id"))`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "RecipeIngredient_recipeId_idx" ON "RecipeIngredient"("recipeId")`)

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Product" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT, "ref" TEXT NOT NULL UNIQUE, "name" TEXT NOT NULL,
      "priceHt" REAL, "unit" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`)

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Order" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT, "restaurantId" INTEGER NOT NULL, "year" INTEGER NOT NULL,
      "month" INTEGER NOT NULL, "nbPassages" INTEGER NOT NULL DEFAULT 0,
      "stuartPrice" REAL NOT NULL DEFAULT 0, "stuartQty" INTEGER NOT NULL DEFAULT 0,
      "livraisonPrice" REAL NOT NULL DEFAULT 0, "livraisonQty" INTEGER NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id"))`)
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "Order_restaurantId_year_month_key" ON "Order"("restaurantId","year","month")`)

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "OrderItem" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT, "orderId" INTEGER NOT NULL, "productId" INTEGER NOT NULL,
      "day" INTEGER NOT NULL, "quantity" REAL NOT NULL DEFAULT 0,
      FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE,
      FOREIGN KEY ("productId") REFERENCES "Product"("id"))`)
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "OrderItem_orderId_productId_day_key" ON "OrderItem"("orderId","productId","day")`)

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "OrderExtra" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT, "orderId" INTEGER NOT NULL,
      "type" TEXT NOT NULL, "label" TEXT NOT NULL DEFAULT '',
      "price" REAL NOT NULL DEFAULT 0, "quantity" INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE)`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "OrderExtra_orderId_idx" ON "OrderExtra"("orderId")`)

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "SmicConfig" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT, "hourlyRate" REAL NOT NULL,
      "monthlyRate" REAL, "effectiveDate" DATETIME)`)

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "MonthlyExpense" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT, "year" INTEGER NOT NULL,
      "month" INTEGER NOT NULL, "type" TEXT NOT NULL, "amount" REAL NOT NULL DEFAULT 0)`)
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "MonthlyExpense_year_month_type_key" ON "MonthlyExpense"("year","month","type")`)

    // Migrate: add unitPrice to OrderItem if missing
    try { await prisma.$executeRawUnsafe(`ALTER TABLE "OrderItem" ADD COLUMN "unitPrice" REAL`) } catch { /* already exists */ }

    // Migrate: add stuart/livraison columns if missing
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN "stuartPrice" REAL NOT NULL DEFAULT 0`)
      await prisma.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN "stuartQty" INTEGER NOT NULL DEFAULT 0`)
      await prisma.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN "livraisonPrice" REAL NOT NULL DEFAULT 0`)
      await prisma.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN "livraisonQty" INTEGER NOT NULL DEFAULT 0`)
    } catch { /* columns already exist */ }

    // Check if data exists (BigInt fix)
    const count: Array<{ c: bigint | number }> = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as c FROM "Restaurant"`)
    if (Number(count[0].c) === 0) {
      await seedData(prisma, seedJson as SeedData)
    } else {
      // Check if orderItems were seeded (might have timed out on previous attempt)
      const oiCount: Array<{ c: bigint | number }> = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as c FROM "OrderItem"`)
      if (Number(oiCount[0].c) === 0) await seedOrderItems(prisma, seedJson as SeedData)
    }
  } catch (e) {
    console.error('DB init error:', e)
    globalInit.dbReady = false
  }
}

async function seedData(prisma: PrismaClient, data: SeedData) {
  const now = new Date().toISOString()

  // Restaurants
  for (const r of data.restaurants) {
    await prisma.$executeRawUnsafe(
      `INSERT OR IGNORE INTO "Restaurant" ("id","code","name","arrondissement","siren","deliveryPrice","tvaRate","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?)`,
      r.id, r.code, r.name, r.arrondissement, r.siren || null, r.deliveryPrice, r.tvaRate, now, now
    )
  }

  // Ingredients
  for (const i of data.ingredients) {
    await prisma.$executeRawUnsafe(
      `INSERT OR IGNORE INTO "Ingredient" ("id","ref","name","supplier","priceTtc","priceHt","weight","pricePerKg","lossPercent","netPriceKg","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      i.id, i.ref, i.name, i.supplier || null, i.priceTtc || null, i.priceHt || null, i.weight || null, i.pricePerKg || null, i.lossPercent || 0, i.netPriceKg || null, now, now
    )
  }

  // Recipes
  for (const r of data.recipes) {
    await prisma.$executeRawUnsafe(
      `INSERT OR IGNORE INTO "Recipe" ("id","ref","name","category","unit","portions","portionLabel","laborTime","aleaPercent","margin","costPerUnit","sellingPrice","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      r.id, r.ref, r.name, r.category || null, r.unit || null, r.portions || null, r.portionLabel || null, r.laborTime || null, r.aleaPercent || 0.02, r.margin || null, r.costPerUnit || null, r.sellingPrice || null, now, now
    )
  }

  // RecipeIngredients (batch 50 at a time)
  for (let i = 0; i < data.recipeIngredients.length; i += 50) {
    const chunk = data.recipeIngredients.slice(i, i + 50)
    const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?)').join(',')
    const values = chunk.flatMap(ri => [ri.recipeId, ri.ingredientId || null, ri.ingredientRef || null, ri.quantity || 0, ri.unitPrice || 0, ri.amount || 0, ri.unit || null, ri.notes || null])
    await prisma.$executeRawUnsafe(
      `INSERT INTO "RecipeIngredient" ("recipeId","ingredientId","ingredientRef","quantity","unitPrice","amount","unit","notes") VALUES ${placeholders}`,
      ...values
    )
  }

  // Products
  for (const p of data.products) {
    await prisma.$executeRawUnsafe(
      `INSERT OR IGNORE INTO "Product" ("id","ref","name","priceHt","unit","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?)`,
      p.id, p.ref, p.name, p.priceHt || null, p.unit || null, now, now
    )
  }

  // Orders
  for (const o of data.orders) {
    await prisma.$executeRawUnsafe(
      `INSERT OR IGNORE INTO "Order" ("id","restaurantId","year","month","nbPassages","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?)`,
      o.id, o.restaurantId, o.year, o.month, o.nbPassages || 0, now, now
    )
  }

  // OrderItems (compact format: {orderId: {productId: {day: qty}}})
  // Batch insert 200 rows at a time to avoid Vercel/Turso timeout
  const orderItems = data.orderItems as Record<string, Record<string, Record<string, number>>>
  const allItems: [number, number, number, number][] = []
  for (const [orderId, products] of Object.entries(orderItems)) {
    for (const [productId, days] of Object.entries(products)) {
      for (const [day, qty] of Object.entries(days)) {
        allItems.push([parseInt(orderId), parseInt(productId), parseInt(day), qty])
      }
    }
  }
  const BATCH = 500
  for (let i = 0; i < allItems.length; i += BATCH) {
    const chunk = allItems.slice(i, i + BATCH)
    const placeholders = chunk.map(() => '(?,?,?,?)').join(',')
    const values = chunk.flat()
    await prisma.$executeRawUnsafe(
      `INSERT OR IGNORE INTO "OrderItem" ("orderId","productId","day","quantity") VALUES ${placeholders}`,
      ...values
    )
  }

  // SmicConfig
  const smic = data.smicConfig as { hourlyRate: number; monthlyRate?: number }
  await prisma.$executeRawUnsafe(
    `INSERT OR IGNORE INTO "SmicConfig" ("hourlyRate","monthlyRate") VALUES (?,?)`,
    smic.hourlyRate, smic.monthlyRate || null
  )

  console.log(`✅ Seeded: ${data.restaurants.length} restaurants, ${data.ingredients.length} ingredients, ${data.recipes.length} recipes, ${data.products.length} products, ${allItems.length} orderItems`)
}

async function seedOrderItems(prisma: PrismaClient, data: SeedData) {
  const now = new Date().toISOString()
  // Re-seed orders
  for (const o of data.orders) {
    await prisma.$executeRawUnsafe(
      `INSERT OR IGNORE INTO "Order" ("id","restaurantId","year","month","nbPassages","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?)`,
      o.id, o.restaurantId, o.year, o.month, o.nbPassages || 0, now, now
    )
  }
  // Batch insert order items
  const orderItems = data.orderItems as Record<string, Record<string, Record<string, number>>>
  const allItems: [number, number, number, number][] = []
  for (const [orderId, products] of Object.entries(orderItems)) {
    for (const [productId, days] of Object.entries(products)) {
      for (const [day, qty] of Object.entries(days)) {
        allItems.push([parseInt(orderId), parseInt(productId), parseInt(day), qty])
      }
    }
  }
  const BATCH = 500
  for (let i = 0; i < allItems.length; i += BATCH) {
    const chunk = allItems.slice(i, i + BATCH)
    const placeholders = chunk.map(() => '(?,?,?,?)').join(',')
    const values = chunk.flat()
    await prisma.$executeRawUnsafe(
      `INSERT OR IGNORE INTO "OrderItem" ("orderId","productId","day","quantity") VALUES ${placeholders}`,
      ...values
    )
  }
  console.log(`✅ Seeded ${allItems.length} orderItems`)
}
