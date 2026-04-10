import { PrismaClient } from '@prisma/client'
import seedJson from './seed-data.json'
import recipeBom from '@/data/recipe-bom.json'

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

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ZeltySale" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT, "year" INTEGER NOT NULL, "month" INTEGER NOT NULL,
      "restaurantId" INTEGER NOT NULL, "zeltyId" INTEGER NOT NULL,
      "totalHT" REAL NOT NULL DEFAULT 0, "totalTTC" REAL NOT NULL DEFAULT 0,
      "ordersCount" INTEGER NOT NULL DEFAULT 0,
      "eatInTTC" REAL NOT NULL DEFAULT 0, "takeawayTTC" REAL NOT NULL DEFAULT 0, "deliveryTTC" REAL NOT NULL DEFAULT 0,
      "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`)
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "ZeltySale_year_month_restaurantId_key" ON "ZeltySale"("year","month","restaurantId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ZeltySale_year_month_idx" ON "ZeltySale"("year","month")`)

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ZeltyDishSale" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT, "year" INTEGER NOT NULL, "month" INTEGER NOT NULL,
      "restaurantId" INTEGER NOT NULL, "zeltyItemId" INTEGER NOT NULL,
      "name" TEXT NOT NULL, "quantity" INTEGER NOT NULL DEFAULT 0,
      "yataiProductRef" TEXT,
      "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`)
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "ZeltyDishSale_year_month_restaurantId_zeltyItemId_key" ON "ZeltyDishSale"("year","month","restaurantId","zeltyItemId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ZeltyDishSale_year_month_idx" ON "ZeltyDishSale"("year","month")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ZeltyDishSale_yataiProductRef_idx" ON "ZeltyDishSale"("yataiProductRef")`)

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "DishBom" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "name" TEXT NOT NULL UNIQUE,
      "category" TEXT NOT NULL,
      "zeltyKeywords" TEXT NOT NULL DEFAULT '[]',
      "isALaCarte" INTEGER NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`)

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "DishBomIngredient" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "dishBomId" INTEGER NOT NULL,
      "name" TEXT NOT NULL,
      "qtyPerPortion" REAL NOT NULL DEFAULT 0,
      "unit" TEXT,
      "yataiProductKeywords" TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY ("dishBomId") REFERENCES "DishBom"("id") ON DELETE CASCADE)`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DishBomIngredient_dishBomId_idx" ON "DishBomIngredient"("dishBomId")`)

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Snapshot" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "entity" TEXT NOT NULL,
      "label" TEXT NOT NULL,
      "data" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Snapshot_entity_createdAt_idx" ON "Snapshot"("entity","createdAt")`)

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

    // Seed DishBom if empty
    const bomCount: Array<{ c: bigint | number }> = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as c FROM "DishBom"`)
    if (Number(bomCount[0].c) === 0) {
      await seedDishBom(prisma)
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

// ─── DishBom seed: BOMs from Coût Plat Excel + à la carte items ───
// Each entry includes the zeltyKeywords (how to match Zelty dish names)
// and each ingredient has yataiProductKeywords (how to match Yatai Rekki product names).
type BomSeedEntry = {
  name: string
  category: string
  zeltyKeywords: string[]
  isALaCarte?: boolean
  ingredients: { name: string; qty: number; unit?: string; yataiKeywords: string[] }[]
}

// Yatai product keyword mapping by ingredient name (shared lookup for Excel-derived recipes)
const INGREDIENT_KEYWORDS: Record<string, string[]> = {
  // Liquids / sauces
  'Bouillon Porc': ['bouillon porc', 'bouillon'],
  'Bouillon poulet': ['bouillon poulet', 'concentré de poulet'],
  'Bouillon Veggie': ['bouillon veggie'],
  'bouillon tomate': ['bouillon tomate'],
  'Sauce Curry': ['sauce curry', 'curry'],
  'Sauce Tonkatsu': ['sauce tonkatsu'],
  'Sauce Goma': ['sauce goma', 'vinaigrette yuzu'],
  'sauce hiyashi': ['sauce hiyashi'],
  'sauce tomate hiyashi': ['sauce tomate'],
  'Sauce Spicy Karaage': ['sauce spicy karaage', 'spicy karaage'],
  'Mayonnaise': ['mayonnaise'],
  'Shoyu Tare': ['shoyu tare'],
  'Shoyu tare': ['shoyu tare'],
  'shio tare': ['shio tare'],
  'Miso tare': ['miso tare'],
  'Miso pesto': ['miso pesto'],
  // Noodles / rice
  'Nouille Bio': ['nouille', 'nouilles'],
  'nouille temomi': ['nouilles surgelees', 'nouille'],
  'Riz': [],
  'riz': [],
  // Proteins
  'Porc Chashu': ['porc chashu', 'chashu'],
  'Porc Chashu Spé': ['porc chashu', 'chashu'],
  'Poulet Chashu': ['poulet chashu', 'chashu'],
  'Poulet Chashu Spé': ['poulet chashu', 'chashu'],
  'Wagyu sur place': ['wagyu tranché sur place', 'wagyu'],
  'magret don': ['magret'],
  'Magret': ['magret'],
  'bœuf gyudon': ['oignon gyudon', 'basse côte', 'bœuf'],
  'bœuf gyudon base': ['oignon gyudon', 'basse côte', 'bœuf'],
  'bœuf gyudon spé': ['oignon gyudon', 'basse côte', 'bœuf'],
  'Tonkatsu': ['tonkatsu'],
  'Torikatsu': ['torikatsu'],
  'karaage': ['karaage'],
  'Foie gras': ['foie gras'],
  'poulet hiyashi': ['poulet'],
  'Poulet Spicy Miso': ['poulet'],
  // Eggs
  'Œuf Mollet': ['œuf mollet', 'oeuf mollet'],
  'Oeuf Mollet': ['œuf mollet', 'oeuf mollet'],
  'Demi Œuf Mollet': ['œuf mollet', 'oeuf mollet'],
  'Demi Oeuf Mollet': ['œuf mollet', 'oeuf mollet'],
  'œuf parfait': ['œuf parfait', 'oeuf parfait'],
  'omelette': ['œuf'],
  // Veggies
  'Aubergines': ['aubergine'],
  'Courgette': ['courgette'],
  'Bambou': ['bambou'],
  'Shiitake': ['shiitaké', 'shiitake'],
  'shiitake': ['shiitaké', 'shiitake'],
  'Soja': ['soja'],
  'Choufleur': ['chou fleur', 'choufleur'],
  'Cebette': [],
  'cebette': [],
  'Asperge': ['asperge'],
  'concombre hiyashi': ['concombre', 'vinaigre concombre'],
  'Concombre': ['concombre'],
  'Salade Mesclun': [],
  'Chou Rapé': ['chou'],
  'Chou rapé': ['chou'],
  'chou rapé': ['chou'],
  'PDT Grennaile': ['pdt grenaille', 'pomme de terre'],
  'Pignon de pain': [],
  'Tomate Cerise': [],
  'tomate cerise': [],
  'tomate confite base': [],
  'tomate confite spé': [],
  'Radis Mariné': [],
  'Pickle Daikon': [],
  'Gingembre': [],
  // Garnish / aromatics
  'Nori': ['nori'],
  'nori': ['nori'],
  'Filament Nori': ['nori'],
  'Truffe': ['truffe'],
  'Huile Truffe': ['huile truffe'],
  'Huile Han': ['huile ail noir'],
  'huile poireau': ['poireau moment', 'poireau'],
  'Enoki': [],
  'filament de piment': ['rayu'],
  'Furikake': [],
  'citron': [],
  'Citron': [],
  'Azuki': [],
  // Gyoza
  'Gyoza porc': ['gyoza porc'],
  'Gyoza Veggie': ['gyoza veggie'],
  'Gyoza Porc Salade': ['gyoza porc'],
  'Gyoza Veggie Salade': ['gyoza veggie'],
  'Tuile gyoza': ['tuile'],
  // Desserts
  'Pate mochi': ['pate mochi'],
  'Mousse matcha': ['mousse matcha'],
  'Fondant Matcha': ['fondant matcha'],
  'Cheesecake': ['cheesecake'],
  'Frambroise': [],
}

// How Excel recipe names match Zelty dish names
const RECIPE_ZELTY_KEYWORDS: Record<string, string[]> = {
  'Curry Veggie': ['Curry végétarien'],
  'Curry Tonkatsu': [],
  'Curry Torikatsu': ['Curry Torikatsu', 'Kare Raisu'],
  'Tonkatsu Don': [],
  'Torikatsu Don': ['Torikatsu Don', 'Poulet Teriyaki Don'],
  'Donburi Magret': ['Donburi Magret'],
  'Gyudon': ['Gyudon'],
  'Ramen Signature': ['Rāmen wagyu signature', 'wagyu signature'],
  'Ramen Tradi base': ['Rāmen traditionnel base', 'traditionnel base'],
  'Ramen Tradi Spé': ['Rāmen traditionnel spécial', 'traditionnel spécial'],
  'Ramen Moment Base': ['Rāmen du Moment Base', 'Moment Base'],
  'Ramen Moment Spé': ['Rāmen du Moment Special', 'Moment Special'],
  'Ramen Veggie Base': ['Rāmen végétarien base', 'végétarien base'],
  'Ramen Veggie Spé': ['Rāmen végétarien Special', 'végétarien Special'],
  'Ramen Bœuf Tomate Base': [],
  'Ramen Bœuf Tomate Spé': [],
  'Hiyashi': [],
  'Gyoza Porc': ['Gyoza maison'],
  'Gyoza Veggie': ['Gyoza végétarien', 'Gyoza veggie'],
  'Magret Slice': ['Magret Slices'],
  'Concombre Goma': ['Concombre goma'],
  'Karaage': ['Karaage'],
  'Spicy Karaage': ['Spicy Karaage'],
  'Tonkatsu': [],
  'Torikatsu': ['Torikatsu'],
  'Gyoza Salade Porc': ['Gyoza salade'],
  'Gyoza Salade Veggie': [],
  'Mochi Matcha': ['Mochi maison matcha'],
  'Fondant Matcha': ['Fondant Matcha'],
  'Cheesecake': ['Cheesecake'],
}

// À la carte items (sold individually via Zelty, not tied to a full plat Excel recipe)
const A_LA_CARTE: BomSeedEntry[] = [
  {
    name: 'Œuf nitamago (à la carte)',
    category: 'ALA_CARTE',
    isALaCarte: true,
    zeltyKeywords: ['nitamago', 'œuf nitamago', 'oeuf nitamago'],
    ingredients: [
      { name: 'Oeuf Mollet', qty: 1, unit: 'unit', yataiKeywords: ['œuf mollet', 'oeuf mollet'] },
    ],
  },
  {
    name: 'Tranches de porc chashu (à la carte)',
    category: 'ALA_CARTE',
    isALaCarte: true,
    zeltyKeywords: ['porc chashu', 'tranches porc', 'chashu porc'],
    ingredients: [
      { name: 'Porc Chashu', qty: 0.075, unit: 'kg', yataiKeywords: ['porc chashu', 'chashu'] },
    ],
  },
  {
    name: 'Tranches de poulet chashu (à la carte)',
    category: 'ALA_CARTE',
    isALaCarte: true,
    zeltyKeywords: ['poulet chashu', 'tranches poulet'],
    ingredients: [
      { name: 'Poulet Chashu', qty: 0.08, unit: 'kg', yataiKeywords: ['poulet chashu', 'chashu'] },
    ],
  },
  {
    name: 'Bambou menma (à la carte)',
    category: 'ALA_CARTE',
    isALaCarte: true,
    zeltyKeywords: ['bambou', 'menma'],
    ingredients: [
      { name: 'Bambou', qty: 0.05, unit: 'kg', yataiKeywords: ['bambou'] },
    ],
  },
  {
    name: 'Feuilles de nori (à la carte)',
    category: 'ALA_CARTE',
    isALaCarte: true,
    zeltyKeywords: ['nori', 'feuilles nori'],
    ingredients: [
      { name: 'Nori', qty: 0.02, unit: 'kg', yataiKeywords: ['nori'] },
    ],
  },
]

async function seedDishBom(prisma: PrismaClient) {
  const now = new Date().toISOString()
  const bomData = recipeBom as Record<string, { category: string; ingredients: { name: string; qty: number }[] }>

  let dishCount = 0
  let ingCount = 0

  // 1. Seed Excel-derived recipes
  for (const [recipeName, recipeData] of Object.entries(bomData)) {
    const zeltyKeywords = JSON.stringify(RECIPE_ZELTY_KEYWORDS[recipeName] || [])
    await prisma.$executeRawUnsafe(
      `INSERT OR IGNORE INTO "DishBom" ("name","category","zeltyKeywords","isALaCarte","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`,
      recipeName, recipeData.category, zeltyKeywords, 0, now, now
    )
    const row: Array<{ id: number }> = await prisma.$queryRawUnsafe(
      `SELECT id FROM "DishBom" WHERE name = ?`, recipeName
    )
    const dishBomId = row[0]?.id
    if (!dishBomId) continue
    dishCount++

    for (const ing of recipeData.ingredients) {
      const yataiKeywords = JSON.stringify(INGREDIENT_KEYWORDS[ing.name] || [])
      await prisma.$executeRawUnsafe(
        `INSERT INTO "DishBomIngredient" ("dishBomId","name","qtyPerPortion","unit","yataiProductKeywords") VALUES (?,?,?,?,?)`,
        dishBomId, ing.name, ing.qty, null, yataiKeywords
      )
      ingCount++
    }
  }

  // 2. Seed à la carte items
  for (const item of A_LA_CARTE) {
    await prisma.$executeRawUnsafe(
      `INSERT OR IGNORE INTO "DishBom" ("name","category","zeltyKeywords","isALaCarte","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`,
      item.name, item.category, JSON.stringify(item.zeltyKeywords), item.isALaCarte ? 1 : 0, now, now
    )
    const row: Array<{ id: number }> = await prisma.$queryRawUnsafe(
      `SELECT id FROM "DishBom" WHERE name = ?`, item.name
    )
    const dishBomId = row[0]?.id
    if (!dishBomId) continue
    dishCount++

    for (const ing of item.ingredients) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "DishBomIngredient" ("dishBomId","name","qtyPerPortion","unit","yataiProductKeywords") VALUES (?,?,?,?,?)`,
        dishBomId, ing.name, ing.qty, ing.unit || null, JSON.stringify(ing.yataiKeywords)
      )
      ingCount++
    }
  }

  console.log(`✅ Seeded DishBom: ${dishCount} dishes, ${ingCount} ingredients`)
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
