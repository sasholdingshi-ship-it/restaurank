import { PrismaClient } from '@prisma/client'

const globalInit = globalThis as unknown as { dbReady: boolean }

export async function ensureDb(prisma: PrismaClient) {
  if (globalInit.dbReady) return
  globalInit.dbReady = true

  try {
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
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id"))`)
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "Order_restaurantId_year_month_key" ON "Order"("restaurantId","year","month")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Order_restaurantId_idx" ON "Order"("restaurantId")`)

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "OrderItem" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT, "orderId" INTEGER NOT NULL, "productId" INTEGER NOT NULL,
      "day" INTEGER NOT NULL, "quantity" REAL NOT NULL DEFAULT 0,
      FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE,
      FOREIGN KEY ("productId") REFERENCES "Product"("id"))`)
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "OrderItem_orderId_productId_day_key" ON "OrderItem"("orderId","productId","day")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "OrderItem_orderId_idx" ON "OrderItem"("orderId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "OrderItem_productId_idx" ON "OrderItem"("productId")`)

    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "SmicConfig" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT, "hourlyRate" REAL NOT NULL,
      "monthlyRate" REAL, "effectiveDate" DATETIME)`)

    // Check if data exists (COUNT returns BigInt in Prisma/SQLite)
    const count: Array<{ c: bigint | number }> = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as c FROM "Restaurant"`)
    if (Number(count[0].c) === 0) await seedData(prisma)
  } catch (e) {
    console.error('DB init error:', e)
    globalInit.dbReady = false
  }
}

async function seedData(prisma: PrismaClient) {
  const now = new Date().toISOString()

  // 5 Yatai restaurants
  const restaurants = [
    { code: 'YM', name: 'Yatai Montorgueil', arr: '2e', siren: '912345678' },
    { code: 'YSG', name: 'Yatai Saint-Germain', arr: '6e', siren: '912345679' },
    { code: 'YB', name: 'Yatai Batignolles', arr: '17e', siren: '912345680' },
    { code: 'YO', name: 'Yatai Oberkampf', arr: '11e', siren: '912345681' },
    { code: 'YP', name: 'Yatai Passy', arr: '16e', siren: '912345682' },
  ]
  for (const r of restaurants) {
    await prisma.$executeRawUnsafe(
      `INSERT OR IGNORE INTO "Restaurant" ("code","name","arrondissement","siren","deliveryPrice","tvaRate","createdAt","updatedAt") VALUES (?,?,?,?,25,0.055,?,?)`,
      r.code, r.name, r.arr, r.siren, now, now
    )
  }

  // Ingredients (ref, name, supplier, priceHt, weight, lossPercent, pricePerKg, netPriceKg)
  const ings: [number, string, string, number, number, number][] = [
    [101, 'Miso blanc (Shiro)', 'Nihon Shokuhin', 18.50, 1.0, 0],
    [102, 'Miso rouge (Aka)', 'Nihon Shokuhin', 22.00, 1.0, 0],
    [103, 'Sauce soja (Koikuchi)', 'Kikkoman', 8.90, 1.8, 0],
    [104, 'Mirin', 'Takara', 12.50, 1.0, 0],
    [105, 'Saké de cuisine', 'Takara', 9.80, 1.0, 0],
    [106, 'Dashi granulé (Hondashi)', 'Ajinomoto', 45.00, 1.0, 0],
    [107, 'Kombu séché', 'Nihon Shokuhin', 38.00, 0.5, 0],
    [108, 'Katsuobushi (bonite)', 'Nihon Shokuhin', 52.00, 0.5, 0],
    [109, 'Nouilles fraîches ramen', 'Menami Paris', 3.20, 1.2, 0.05],
    [110, 'Porc poitrine (chashu)', 'Metro', 8.90, 2.5, 0.12],
    [111, 'Os de porc (tonkotsu)', 'Metro', 3.50, 5.0, 0],
    [112, 'Poulet entier', 'Metro', 6.80, 1.5, 0.15],
    [113, 'Oeufs frais', 'Metro', 3.20, 1.8, 0.08],
    [114, 'Oignon vert (negi)', 'Rungis', 2.80, 1.0, 0.10],
    [115, 'Gingembre frais', 'Rungis', 4.50, 0.5, 0.05],
    [116, 'Ail frais', 'Rungis', 5.20, 0.5, 0.03],
    [117, 'Huile de sésame', 'Kadoya', 15.00, 0.5, 0],
    [118, 'Nori (algue)', 'Nihon Shokuhin', 12.50, 0.1, 0],
    [119, 'Menma (pousses bambou)', 'Nihon Shokuhin', 8.00, 1.0, 0],
    [120, 'Maïs doux', 'Metro', 2.80, 0.4, 0],
    [121, 'Beurre', 'Metro', 4.50, 0.25, 0],
    [122, 'Pâte de sésame (tahini)', 'Kadoya', 18.00, 0.9, 0],
    [123, 'Huile pimentée (rayu)', 'S&B', 9.50, 0.33, 0],
    [124, 'Ciboulette chinoise (nira)', 'Rungis', 6.00, 0.5, 0.08],
    [125, 'Champignons shiitake secs', 'Nihon Shokuhin', 35.00, 0.2, 0],
    [126, 'Farine T55', 'Metro', 1.20, 1.0, 0],
    [127, 'Porc haché', 'Metro', 7.50, 1.0, 0.05],
    [128, 'Chou chinois', 'Rungis', 2.20, 1.0, 0.10],
    [129, 'Sel fin', 'Metro', 0.80, 1.0, 0],
    [130, 'Sucre', 'Metro', 1.10, 1.0, 0],
  ]
  for (const [ref, name, supplier, priceHt, weight, loss] of ings) {
    const pricePerKg = priceHt / weight
    const netPriceKg = pricePerKg - loss
    await prisma.$executeRawUnsafe(
      `INSERT OR IGNORE INTO "Ingredient" ("ref","name","supplier","priceHt","weight","pricePerKg","lossPercent","netPriceKg","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ref, name, supplier, priceHt, weight, pricePerKg, loss, netPriceKg, now, now
    )
  }

  // Recipes
  const recipes: [string, string, string, number, number, number, number][] = [
    ['R01', 'Bouillon Tonkotsu', 'BOUILLONS', 10, 8, 0.02, 0.30],
    ['R02', 'Bouillon Miso', 'BOUILLONS', 10, 4, 0.02, 0.30],
    ['R03', 'Bouillon Shoyu', 'BOUILLONS', 10, 3, 0.02, 0.30],
    ['R04', 'Tare Shoyu', 'TARE & ASSAISONNEMENTS', 5, 1, 0.02, 0.25],
    ['R05', 'Tare Miso', 'TARE & ASSAISONNEMENTS', 5, 1, 0.02, 0.25],
    ['R06', 'Chashu porc', 'VIANDES & POISSONS', 8, 3, 0.02, 0.35],
    ['R07', 'Oeuf mariné (Ajitama)', 'TOPPINGS & LEGUMES', 20, 0.5, 0.02, 0.40],
    ['R08', 'Gyoza porc (x6)', 'GYOZAS', 30, 1, 0.02, 0.35],
    ['R09', 'Huile noire (Mayu)', 'HUILES & CONDIMENTS', 2, 0.5, 0.02, 0.25],
    ['R10', 'Poulet karaage', 'VIANDES & POISSONS', 10, 2, 0.02, 0.35],
    ['R11', 'Riz vinaigré', 'AUTRES', 6, 0.5, 0.02, 0.20],
    ['R12', 'Sauce gyoza', 'SAUCES', 4, 0.3, 0.02, 0.20],
  ]
  for (const [ref, name, cat, portions, labor, alea, margin] of recipes) {
    await prisma.$executeRawUnsafe(
      `INSERT OR IGNORE INTO "Recipe" ("ref","name","category","portions","laborTime","aleaPercent","margin","unit","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,'portion',?,?)`,
      ref, name, cat, portions, labor, alea, margin, now, now
    )
  }

  // Recipe ingredients (link some ingredients to recipes)
  const riLinks: [string, number, number, string][] = [
    ['R01', 111, 5.0, 'kg'], ['R01', 114, 0.3, 'kg'], ['R01', 116, 0.1, 'kg'], ['R01', 115, 0.1, 'kg'],
    ['R02', 101, 0.5, 'kg'], ['R02', 106, 0.05, 'kg'], ['R02', 117, 0.02, 'L'],
    ['R03', 103, 0.3, 'L'], ['R03', 104, 0.1, 'L'], ['R03', 106, 0.05, 'kg'],
    ['R04', 103, 1.0, 'L'], ['R04', 104, 0.3, 'L'], ['R04', 105, 0.2, 'L'],
    ['R05', 101, 1.0, 'kg'], ['R05', 103, 0.3, 'L'], ['R05', 117, 0.05, 'L'],
    ['R06', 110, 2.0, 'kg'], ['R06', 103, 0.2, 'L'], ['R06', 104, 0.1, 'L'], ['R06', 105, 0.1, 'L'],
    ['R07', 113, 20, 'pcs'], ['R07', 103, 0.2, 'L'], ['R07', 104, 0.1, 'L'],
    ['R08', 127, 0.6, 'kg'], ['R08', 128, 0.3, 'kg'], ['R08', 126, 0.3, 'kg'], ['R08', 117, 0.03, 'L'],
    ['R09', 116, 0.2, 'kg'], ['R09', 117, 0.5, 'L'],
    ['R10', 112, 2.0, 'kg'], ['R10', 126, 0.3, 'kg'], ['R10', 103, 0.1, 'L'],
    ['R11', 129, 0.02, 'kg'], ['R11', 130, 0.05, 'kg'],
    ['R12', 103, 0.5, 'L'], ['R12', 117, 0.1, 'L'], ['R12', 123, 0.05, 'L'],
  ]

  // Get recipe IDs and ingredient data for linking
  const allRecipes: Array<{ id: number; ref: string }> = await prisma.$queryRawUnsafe(`SELECT id, ref FROM "Recipe"`)
  const allIngs: Array<{ id: number; ref: number; netPriceKg: number | null }> = await prisma.$queryRawUnsafe(`SELECT id, ref, "netPriceKg" FROM "Ingredient"`)
  const recipeMap = new Map(allRecipes.map(r => [r.ref, r.id]))
  const ingMap = new Map(allIngs.map(i => [i.ref, i]))

  for (const [recipeRef, ingRef, qty, unit] of riLinks) {
    const recipeId = recipeMap.get(recipeRef)
    const ing = ingMap.get(ingRef)
    if (!recipeId || !ing) continue
    const unitPrice = ing.netPriceKg ?? 0
    const amount = qty * unitPrice
    await prisma.$executeRawUnsafe(
      `INSERT INTO "RecipeIngredient" ("recipeId","ingredientId","ingredientRef","quantity","unitPrice","amount","unit") VALUES (?,?,?,?,?,?,?)`,
      recipeId, ing.id, ingRef, qty, unitPrice, amount, unit
    )
  }

  // Recalculate recipe costs
  const hourlyRate = (1801.80 * 12) / 11 / 151.67 // SMIC 2026
  for (const [ref, , , portions, labor, alea, margin] of recipes) {
    const recipeId = recipeMap.get(ref)
    if (!recipeId) continue
    const ris: Array<{ amount: number }> = await prisma.$queryRawUnsafe(`SELECT amount FROM "RecipeIngredient" WHERE "recipeId" = ?`, recipeId)
    const subtotal = ris.reduce((s, ri) => s + ri.amount, 0)
    const totalWithAlea = subtotal * (1 + alea)
    const laborCost = labor * hourlyRate
    const costPerUnit = (laborCost + totalWithAlea) / (portions || 1)
    const sellingPrice = costPerUnit * (1 + margin)
    await prisma.$executeRawUnsafe(
      `UPDATE "Recipe" SET "costPerUnit" = ?, "sellingPrice" = ? WHERE id = ?`,
      costPerUnit, sellingPrice, recipeId
    )
  }

  // Products (derived from recipes + standalone)
  const products: [string, string, number | null, string][] = [
    ['P01', 'Ramen Tonkotsu', null, 'bol'],
    ['P02', 'Ramen Miso', null, 'bol'],
    ['P03', 'Ramen Shoyu', null, 'bol'],
    ['P04', 'Gyoza porc x6', null, 'portion'],
    ['P05', 'Gyoza légumes x6', 6.50, 'portion'],
    ['P06', 'Poulet karaage x5', null, 'portion'],
    ['P07', 'Edamame', 3.50, 'portion'],
    ['P08', 'Riz nature', 2.50, 'bol'],
    ['P09', 'Oeuf mariné sup.', null, 'pcs'],
    ['P10', 'Chashu sup.', null, 'portion'],
    ['P11', 'Maïs beurre sup.', 1.50, 'portion'],
    ['P12', 'Nori sup. x3', 1.00, 'portion'],
    ['P13', 'Bière Asahi 33cl', 4.00, 'bouteille'],
    ['P14', 'Bière Kirin 33cl', 4.00, 'bouteille'],
    ['P15', 'Ramune', 3.50, 'bouteille'],
    ['P16', 'Thé glacé maison', 2.80, 'verre'],
    ['P17', 'Matcha latte', 4.50, 'verre'],
    ['P18', 'Mochi x2', 4.00, 'portion'],
    ['P19', 'Dorayaki', 3.50, 'pcs'],
    ['P20', 'Menu Midi (ramen+gyoza)', 15.90, 'menu'],
  ]

  // Link product prices to recipe selling prices where applicable
  const recipeProductMap: Record<string, string> = {
    'P01': 'R01', 'P02': 'R02', 'P03': 'R03', 'P04': 'R08',
    'P06': 'R10', 'P09': 'R07', 'P10': 'R06',
  }

  for (const [ref, name, fixedPrice, unit] of products) {
    let priceHt = fixedPrice
    if (!priceHt && recipeProductMap[ref]) {
      const rRef = recipeProductMap[ref]
      const r: Array<{ sellingPrice: number | null }> = await prisma.$queryRawUnsafe(`SELECT "sellingPrice" FROM "Recipe" WHERE ref = ?`, rRef)
      if (r.length > 0 && r[0].sellingPrice) priceHt = Math.round(r[0].sellingPrice * 100) / 100
    }
    await prisma.$executeRawUnsafe(
      `INSERT OR IGNORE INTO "Product" ("ref","name","priceHt","unit","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`,
      ref, name, priceHt, unit, now, now
    )
  }

  // Sample orders for March 2026
  const allProducts: Array<{ id: number; ref: string }> = await prisma.$queryRawUnsafe(`SELECT id, ref FROM "Product"`)
  const productIdMap = new Map(allProducts.map(p => [p.ref, p.id]))
  const restRows: Array<{ id: number }> = await prisma.$queryRawUnsafe(`SELECT id FROM "Restaurant" ORDER BY id`)

  for (let ri = 0; ri < Math.min(restRows.length, 3); ri++) {
    const restId = restRows[ri].id
    await prisma.$executeRawUnsafe(
      `INSERT OR IGNORE INTO "Order" ("restaurantId","year","month","nbPassages","createdAt","updatedAt") VALUES (?,2026,3,0,?,?)`,
      restId, now, now
    )
    const orderRows: Array<{ id: number }> = await prisma.$queryRawUnsafe(
      `SELECT id FROM "Order" WHERE "restaurantId" = ? AND year = 2026 AND month = 3`, restId
    )
    if (orderRows.length === 0) continue
    const orderId = orderRows[0].id

    // Add some realistic order quantities for days 1-15
    const topProducts = ['P01', 'P02', 'P03', 'P04', 'P06', 'P07', 'P13', 'P20']
    for (const pRef of topProducts) {
      const pid = productIdMap.get(pRef)
      if (!pid) continue
      for (let day = 1; day <= 15; day++) {
        const qty = Math.floor(Math.random() * 8) + 2 + (pRef === 'P01' ? 5 : 0)
        await prisma.$executeRawUnsafe(
          `INSERT OR IGNORE INTO "OrderItem" ("orderId","productId","day","quantity") VALUES (?,?,?,?)`,
          orderId, pid, day, qty
        )
      }
    }
  }

  // SMIC config
  await prisma.$executeRawUnsafe(
    `INSERT OR IGNORE INTO "SmicConfig" ("hourlyRate","monthlyRate") VALUES (?,?)`,
    14.27, 1801.80
  )

  console.log('✅ Database seeded with demo data')
}
