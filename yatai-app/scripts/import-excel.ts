import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'path'

const prisma = new PrismaClient()

const EXCEL_PATH = process.argv[2] || path.join(__dirname, '..', 'data', 'Yatai Complet.xlsx')

// Restaurant mapping
const RESTAURANTS: Record<string, { name: string; arr: string; siren: string }> = {
  '2eme':  { name: 'Yatai Choiseul',   arr: '2ème',  siren: '901471367' },
  '8eme':  { name: 'Yatai 8ème',       arr: '8ème',  siren: '' },
  '9eme':  { name: 'Yatai 9ème',       arr: '9ème',  siren: '' },
  '11eme': { name: 'Yatai 11ème',      arr: '11ème', siren: '' },
  '14eme': { name: 'Yatai 14ème',      arr: '14ème', siren: '' },
}

// Month name → number
const MONTH_MAP: Record<string, number> = {
  janvier: 1, fevrier: 2, février: 2, mars: 3, avril: 4,
  mai: 5, juin: 6, juillet: 7, aout: 8, août: 8,
  septembre: 9, octobre: 10, novembre: 11, novem: 11,
  decembre: 12, décembre: 12,
  octob: 10, // abbreviations
}

function parseMonthlySheetName(name: string): { restaurantCode: string; month: number; year: number } | null {
  const trimmed = name.trim()
  // Patterns: "2 Mars", "14 janvier 26", "8 Fevrier", "2 octob", "11 Novembre "
  const match = trimmed.match(/^(\d{1,2})\s+([a-zéûà]+)\s*(\d{2})?$/i)
  if (!match) return null

  const arrNum = match[1]
  const monthStr = match[2].toLowerCase()
  const yearSuffix = match[3]

  const restaurantCode = arrNum + 'eme'
  if (!['2eme','8eme','9eme','11eme','14eme'].includes(restaurantCode)) return null

  const month = MONTH_MAP[monthStr]
  if (!month) return null

  // Determine year: if "26" suffix → 2026, else based on month ordering
  let year: number
  if (yearSuffix) {
    year = 2000 + parseInt(yearSuffix)
  } else {
    // Sheets without year suffix are 2024-2025 data
    // oct/nov/dec without year = 2024, jan-sept without year = 2025
    year = month >= 10 ? 2024 : 2025
  }

  return { restaurantCode, month, year }
}

async function importMercurial(wb: XLSX.WorkBook) {
  console.log('📦 Importing Mercurial...')
  const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['Mercurial'], { header: 1 })

  let count = 0
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || !r[1] || !r[2]) continue // skip empty rows

    const ref = parseInt(r[1])
    if (isNaN(ref)) continue

    const priceTtc = typeof r[3] === 'number' ? r[3] : null
    const priceHt = typeof r[4] === 'number' ? r[4] : null
    const weight = typeof r[5] === 'number' ? r[5] : null
    const lossPercent = typeof r[7] === 'number' ? r[7] : 0

    // Excel formulas: E = D/1.055, G = E/F, I = G - H
    let pricePerKg: number | null = null
    if (priceHt && weight && weight > 0) {
      pricePerKg = priceHt / weight
    } else if (priceTtc && weight && weight > 0) {
      pricePerKg = (priceTtc / 1.055) / weight
    }

    let netPriceKg: number | null = null
    if (pricePerKg !== null) {
      netPriceKg = pricePerKg - lossPercent // Excel: I = G - H (subtraction)
    }

    await prisma.ingredient.upsert({
      where: { ref },
      create: {
        ref,
        name: String(r[2]),
        supplier: r[0] ? String(r[0]) : null,
        priceTtc,
        priceHt,
        weight,
        pricePerKg,
        lossPercent,
        netPriceKg,
      },
      update: {
        name: String(r[2]),
        supplier: r[0] ? String(r[0]) : null,
        priceTtc,
        priceHt,
        weight,
        pricePerKg,
        lossPercent,
        netPriceKg,
      },
    })
    count++
  }
  console.log(`  ✅ ${count} ingredients imported`)
}

async function importRecapPrix(wb: XLSX.WorkBook) {
  console.log('💰 Importing Recap prix...')
  const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['Recap prix'], { header: 1 })

  let count = 0
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || !r[0]) continue

    const ref = String(r[0])
    const name = String(r[1] || '')
    const priceHt = typeof r[2] === 'number' ? r[2] : null
    const unit = r[3] ? String(r[3]) : null

    await prisma.product.upsert({
      where: { ref },
      create: { ref, name, priceHt, unit },
      update: { name, priceHt, unit },
    })
    count++
  }
  console.log(`  ✅ ${count} products imported`)
}

async function importRecipes(wb: XLSX.WorkBook) {
  console.log('📋 Importing Fiches techniques...')
  const recipeSheets = wb.SheetNames.filter(n => /^P\d{3}\s*-/.test(n) || /^[A-Z][a-z]/.test(n))

  // Categories based on product names
  const CATEGORY_MAP: Record<string, string> = {
    'bouillon': 'BOUILLONS',
    'tare': 'TARE & ASSAISONNEMENTS',
    'sauce': 'SAUCES',
    'huile': 'HUILES & CONDIMENTS',
    'rayu': 'HUILES & CONDIMENTS',
    'ponzu': 'SAUCES',
    'chashu': 'VIANDES & POISSONS',
    'poulet': 'VIANDES & POISSONS',
    'karaage': 'VIANDES & POISSONS',
    'tonkatsu': 'VIANDES & POISSONS',
    'torikatsu': 'VIANDES & POISSONS',
    'wagyu': 'VIANDES & POISSONS',
    'magret': 'VIANDES & POISSONS',
    'foie gras': 'VIANDES & POISSONS',
    'poulpe': 'VIANDES & POISSONS',
    'marinade': 'MARINADES',
    'laquage': 'MARINADES',
    'gyoza': 'GYOZAS',
    'topping': 'TOPPINGS & LÉGUMES',
    'asperge': 'TOPPINGS & LÉGUMES',
    'aubergine': 'TOPPINGS & LÉGUMES',
    'courgette': 'TOPPINGS & LÉGUMES',
    'chou': 'TOPPINGS & LÉGUMES',
    'echalotte': 'TOPPINGS & LÉGUMES',
    'pickle': 'PICKLES & VINAIGRETTES',
    'vinaigre': 'PICKLES & VINAIGRETTES',
    'vinaigrette': 'PICKLES & VINAIGRETTES',
    'furikake': 'PICKLES & VINAIGRETTES',
    'nouille': 'NOUILLES & PÂTES',
    'pâte': 'NOUILLES & PÂTES',
    'tempura': 'NOUILLES & PÂTES',
    'mochi': 'DESSERTS',
    'cheesecake': 'DESSERTS',
    'mousse': 'DESSERTS',
    'panacotta': 'DESSERTS',
    'fondant': 'DESSERTS',
    'crumble': 'DESSERTS',
    'tuile': 'DESSERTS',
    'ananas': 'DESSERTS',
    'caramel': 'DESSERTS',
    'riz au lait': 'DESSERTS',
    'purrin': 'DESSERTS',
    'sirop': 'SIROPS & BOISSONS',
    'whisky': 'SIROPS & BOISSONS',
    'solution': 'SIROPS & BOISSONS',
    'miso': 'TARE & ASSAISONNEMENTS',
    'shio': 'TARE & ASSAISONNEMENTS',
    'shoyu': 'TARE & ASSAISONNEMENTS',
    'teriyaki': 'SAUCES',
    'patate': 'TOPPINGS & LÉGUMES',
    'pomme de terre': 'TOPPINGS & LÉGUMES',
    'mais': 'TOPPINGS & LÉGUMES',
    'poireau': 'TOPPINGS & LÉGUMES',
    'kikurage': 'TOPPINGS & LÉGUMES',
    'shiitake': 'TOPPINGS & LÉGUMES',
    'oeuf': 'TOPPINGS & LÉGUMES',
    'œuf': 'TOPPINGS & LÉGUMES',
    'msg': 'HUILES & CONDIMENTS',
  }

  function guessCategory(name: string): string {
    const lower = name.toLowerCase()
    for (const [key, cat] of Object.entries(CATEGORY_MAP)) {
      if (lower.includes(key)) return cat
    }
    return 'AUTRES'
  }

  // Only process sheets that start with "P0xx - "
  const ficheSheets = wb.SheetNames.filter(n => /^P\d{2,3}\s*-/.test(n))

  let count = 0
  for (const sheetName of ficheSheets) {
    const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sheetName], { header: 1 })
    if (rows.length < 10) continue

    // Extract ref from row 0: "FICHE TECHNIQUE — P012"
    const titleRow = rows[0]
    const titleStr = titleRow ? String(titleRow[0] || '') : ''
    const refMatch = titleStr.match(/P(\d{3})/)
    if (!refMatch) continue
    const ref = 'P' + refMatch[1]

    // Name from row 2
    const name = rows[2] && rows[2][1] ? String(rows[2][1]) : sheetName.replace(/^P\d{3}\s*-\s*/, '')

    // Unit/portions from row 6
    const unitRow = rows[6]
    const portions = unitRow && typeof unitRow[5] === 'number' ? unitRow[5] : null
    const portionLabel = unitRow && unitRow[3] ? String(unitRow[3]) : null

    // Labor time from row 45
    const laborTime = rows[45] && typeof rows[45][3] === 'number' ? rows[45][3] : null

    // Margin from row 50
    const margin = rows[50] && typeof rows[50][1] === 'number' ? rows[50][1] : null

    const category = guessCategory(name)

    // Get selling price from Recap prix if available
    const product = await prisma.product.findUnique({ where: { ref } })
    const sellingPrice = product?.priceHt || null

    const recipe = await prisma.recipe.upsert({
      where: { ref },
      create: {
        ref, name, category,
        unit: portionLabel,
        portions,
        portionLabel,
        laborTime,
        margin,
        sellingPrice,
      },
      update: {
        name, category,
        unit: portionLabel,
        portions,
        portionLabel,
        laborTime,
        margin,
        sellingPrice,
      },
    })

    // Parse ingredients (rows 11-16 typically, ref in column H=7)
    for (let i = 11; i <= 16; i++) {
      const r = rows[i]
      if (!r) continue
      const ingredientRef = typeof r[8] === 'number' ? r[8] : null
      const qty = typeof r[3] === 'number' ? r[3] : 0
      const unitPrice = typeof r[7] === 'number' ? r[7] : 0

      if (!ingredientRef && qty === 0) continue

      const ingredient = ingredientRef
        ? await prisma.ingredient.findUnique({ where: { ref: ingredientRef } })
        : null

      await prisma.recipeIngredient.create({
        data: {
          recipeId: recipe.id,
          ingredientId: ingredient?.id || null,
          ingredientRef,
          quantity: qty,
          unitPrice,
          amount: qty * unitPrice,
          unit: r[1] ? String(r[1]) : null,
        },
      })
    }

    count++
  }
  console.log(`  ✅ ${count} recipes imported`)
}

async function importRestaurants() {
  console.log('🏪 Importing Restaurants...')
  for (const [code, info] of Object.entries(RESTAURANTS)) {
    await prisma.restaurant.upsert({
      where: { code },
      create: {
        code,
        name: info.name,
        arrondissement: info.arr,
        siren: info.siren || null,
      },
      update: {
        name: info.name,
        arrondissement: info.arr,
        siren: info.siren || null,
      },
    })
  }
  console.log(`  ✅ 5 restaurants imported`)
}

async function importMonthlyOrders(wb: XLSX.WorkBook) {
  console.log('📊 Importing monthly orders...')

  // Get all products for mapping
  const products = await prisma.product.findMany()
  const productByRef = new Map(products.map(p => [p.ref, p]))

  // Get all restaurants
  const restaurants = await prisma.restaurant.findMany()
  const restaurantByCode = new Map(restaurants.map(r => [r.code, r]))

  let orderCount = 0
  let itemCount = 0

  for (const sheetName of wb.SheetNames) {
    const parsed = parseMonthlySheetName(sheetName)
    if (!parsed) continue

    const restaurant = restaurantByCode.get(parsed.restaurantCode)
    if (!restaurant) continue

    const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sheetName], { header: 1 })
    if (rows.length < 5) continue

    // Create/get order
    const order = await prisma.order.upsert({
      where: {
        restaurantId_year_month: {
          restaurantId: restaurant.id,
          year: parsed.year,
          month: parsed.month,
        },
      },
      create: {
        restaurantId: restaurant.id,
        year: parsed.year,
        month: parsed.month,
      },
      update: {},
    })

    // Parse daily quantities (row 2+ = products, columns 4-34 = days 1-31)
    for (let i = 2; i < rows.length && i < 140; i++) {
      const r = rows[i]
      if (!r || !r[0]) continue

      const productRef = String(r[0])
      const product = productByRef.get(productRef)
      if (!product) continue

      // Days 1-31 are in columns 4-34
      for (let day = 1; day <= 31; day++) {
        const colIdx = day + 3 // column 4 = day 1
        const qty = typeof r[colIdx] === 'number' ? r[colIdx] : 0
        if (qty <= 0) continue

        try {
          await prisma.orderItem.upsert({
            where: {
              orderId_productId_day: {
                orderId: order.id,
                productId: product.id,
                day,
              },
            },
            create: {
              orderId: order.id,
              productId: product.id,
              day,
              quantity: qty,
            },
            update: { quantity: qty },
          })
          itemCount++
        } catch (e) {
          // Skip duplicates
        }
      }
    }
    orderCount++
    if (orderCount % 10 === 0) console.log(`  ... ${orderCount} months processed`)
  }
  console.log(`  ✅ ${orderCount} monthly orders, ${itemCount} daily entries imported`)
}

async function importSmic(wb: XLSX.WorkBook) {
  console.log('💶 Importing SMIC...')
  const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['Smic Horaire'], { header: 1 })
  // Default SMIC values for 2025
  await prisma.smicConfig.create({
    data: {
      hourlyRate: 14.94, // Approximate SMIC horaire CP compris 2025
      monthlyRate: 1801.80,
    },
  })
  console.log('  ✅ SMIC config imported')
}

async function main() {
  console.log('🚀 Starting import from:', EXCEL_PATH)
  const wb = XLSX.readFile(EXCEL_PATH)
  console.log(`📄 ${wb.SheetNames.length} sheets found\n`)

  await importMercurial(wb)
  await importRecapPrix(wb)
  await importRecipes(wb)
  await importRestaurants()
  await importSmic(wb)
  await importMonthlyOrders(wb)

  console.log('\n🎉 Import complete!')
  await prisma.$disconnect()
}

main().catch(e => {
  console.error(e)
  prisma.$disconnect()
  process.exit(1)
})
