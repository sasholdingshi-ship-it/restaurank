import { db } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

const MONTH_MAP: Record<string, number> = {
  janvier: 1, fevrier: 2, février: 2, mars: 3, avril: 4,
  mai: 5, juin: 6, juillet: 7, aout: 8, août: 8,
  septembre: 9, octobre: 10, novembre: 11, novem: 11,
  decembre: 12, décembre: 12, octob: 10,
}

function parseOrderSheetName(name: string): { restaurantCode: string; month: number; year: number } | null {
  const match = name.trim().match(/^(\d{1,2})\s+([a-zéûà]+)\s*(\d{2})?$/i)
  if (!match) return null
  const restaurantCode = match[1] + 'eme'
  const month = MONTH_MAP[match[2].toLowerCase()]
  if (!month) return null
  const year = match[3] ? 2000 + parseInt(match[3]) : (month >= 10 ? 2024 : 2025)
  return { restaurantCode, month, year }
}

/** POST — Import Excel file, upsert all data */
export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })

  const arrayBuffer = await file.arrayBuffer()
  const wb = XLSX.read(new Uint8Array(arrayBuffer))

  const prisma = await db()
  const results: Record<string, { updated: number; created: number; errors: string[] }> = {}

  // 1. Mercurial (ingredients)
  if (wb.Sheets['Mercurial']) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Mercurial'])
    const stats = { updated: 0, created: 0, errors: [] as string[] }
    for (const r of rows) {
      const ref = typeof r['Réf'] === 'number' ? r['Réf'] : parseInt(String(r['Réf'] || ''))
      if (isNaN(ref)) continue
      const name = String(r['Nom'] || '')
      if (!name) continue
      try {
        const existing = await prisma.ingredient.findUnique({ where: { ref } })
        const data = {
          name,
          supplier: r['Fournisseur'] ? String(r['Fournisseur']) : null,
          priceTtc: typeof r['Prix TTC'] === 'number' ? r['Prix TTC'] : null,
          priceHt: typeof r['Prix HT'] === 'number' ? r['Prix HT'] : null,
          weight: typeof r['Poids (kg)'] === 'number' ? r['Poids (kg)'] : null,
          pricePerKg: typeof r['Prix/kg'] === 'number' ? r['Prix/kg'] : null,
          lossPercent: typeof r['% Perte'] === 'number' ? r['% Perte'] : 0,
          netPriceKg: typeof r['Prix net/kg'] === 'number' ? r['Prix net/kg'] : null,
        }
        if (existing) {
          await prisma.ingredient.update({ where: { ref }, data })
          stats.updated++
        } else {
          await prisma.ingredient.create({ data: { ref, ...data } })
          stats.created++
        }
      } catch (e) {
        stats.errors.push(`Ingredient ${ref}: ${String(e)}`)
      }
    }
    results['Mercurial'] = stats
  }

  // 2. Recap prix (products)
  if (wb.Sheets['Recap prix']) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Recap prix'])
    const stats = { updated: 0, created: 0, errors: [] as string[] }
    for (const r of rows) {
      const ref = String(r['Réf'] || '')
      if (!ref) continue
      const name = String(r['Nom'] || '')
      if (!name) continue
      try {
        const existing = await prisma.product.findUnique({ where: { ref } })
        const data = {
          name,
          priceHt: typeof r['Prix HT'] === 'number' ? r['Prix HT'] : null,
          unit: r['Unité'] ? String(r['Unité']) : null,
        }
        if (existing) {
          await prisma.product.update({ where: { ref }, data })
          stats.updated++
        } else {
          await prisma.product.create({ data: { ref, ...data } })
          stats.created++
        }
      } catch (e) {
        stats.errors.push(`Product ${ref}: ${String(e)}`)
      }
    }
    results['Recap prix'] = stats
  }

  // 3. Recettes (recipe parameters)
  if (wb.Sheets['Recettes']) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Recettes'])
    const stats = { updated: 0, created: 0, errors: [] as string[] }
    for (const r of rows) {
      const ref = String(r['Réf'] || '')
      if (!ref) continue
      try {
        const existing = await prisma.recipe.findUnique({ where: { ref } })
        if (!existing) { stats.errors.push(`Recipe ${ref}: not found`); continue }
        const data: Record<string, unknown> = {}
        if (r['Nom']) data.name = String(r['Nom'])
        if (typeof r['Portions'] === 'number') data.portions = r['Portions']
        if (typeof r['Temps MO (h)'] === 'number') data.laborTime = r['Temps MO (h)']
        if (typeof r['Aléa %'] === 'number') data.aleaPercent = r['Aléa %']
        if (typeof r['Marge %'] === 'number') data.margin = r['Marge %']
        if (typeof r['Prix vente'] === 'number') data.sellingPrice = r['Prix vente']
        if (Object.keys(data).length > 0) {
          await prisma.recipe.update({ where: { ref }, data })
          // Cascade price to product
          if (data.sellingPrice != null) {
            await prisma.product.updateMany({ where: { ref }, data: { priceHt: data.sellingPrice as number } })
          }
          if (data.name) {
            await prisma.product.updateMany({ where: { ref }, data: { name: data.name as string } })
          }
          stats.updated++
        }
      } catch (e) {
        stats.errors.push(`Recipe ${ref}: ${String(e)}`)
      }
    }
    results['Recettes'] = stats
  }

  // 4. Monthly order sheets
  const restaurants = await prisma.restaurant.findMany()
  const restaurantByCode = new Map(restaurants.map(r => [r.code, r]))
  const allProducts = await prisma.product.findMany()
  const productByRef = new Map(allProducts.map(p => [p.ref, p]))

  for (const sheetName of wb.SheetNames) {
    const parsed = parseOrderSheetName(sheetName)
    if (!parsed) continue

    const restaurant = restaurantByCode.get(parsed.restaurantCode)
    if (!restaurant) continue

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName])
    const stats = { updated: 0, created: 0, errors: [] as string[] }

    // Get or create order
    let order = await prisma.order.findUnique({
      where: { restaurantId_year_month: { restaurantId: restaurant.id, year: parsed.year, month: parsed.month } },
    })
    if (!order) {
      order = await prisma.order.create({
        data: { restaurantId: restaurant.id, year: parsed.year, month: parsed.month },
      })
    }

    for (const r of rows) {
      const ref = String(r['Réf'] || '')
      const product = productByRef.get(ref)
      if (!product) continue

      for (let day = 1; day <= 31; day++) {
        const key = `J${day}`
        const val = r[key]
        if (val === '' || val === null || val === undefined) continue
        const qty = typeof val === 'number' ? val : parseFloat(String(val))
        if (isNaN(qty)) continue

        try {
          const existing = await prisma.orderItem.findUnique({
            where: { orderId_productId_day: { orderId: order.id, productId: product.id, day } },
          })
          if (existing) {
            if (existing.quantity !== qty) {
              await prisma.orderItem.update({ where: { id: existing.id }, data: { quantity: qty } })
              stats.updated++
            }
          } else if (qty > 0) {
            await prisma.orderItem.create({ data: { orderId: order.id, productId: product.id, day, quantity: qty } })
            stats.created++
          }
        } catch (e) {
          stats.errors.push(`${ref} J${day}: ${String(e)}`)
        }
      }
    }
    results[sheetName] = stats
  }

  return NextResponse.json({ success: true, results })
}
