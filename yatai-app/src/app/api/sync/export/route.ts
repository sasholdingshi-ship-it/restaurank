import { db } from '@/lib/prisma'
import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

const MONTHS = ['', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

/** GET — Export full database as multi-sheet Excel */
export async function GET() {
  const prisma = await db()
  const wb = XLSX.utils.book_new()

  // 1. Mercurial (ingredients)
  const ingredients = await prisma.ingredient.findMany({ orderBy: { ref: 'asc' } })
  const mercRows = ingredients.map(i => ({
    'Fournisseur': i.supplier || '',
    'Réf': i.ref,
    'Nom': i.name,
    'Prix TTC': i.priceTtc,
    'Prix HT': i.priceHt,
    'Poids (kg)': i.weight,
    'Prix/kg': i.pricePerKg,
    '% Perte': i.lossPercent,
    'Prix net/kg': i.netPriceKg,
  }))
  const wsMerc = XLSX.utils.json_to_sheet(mercRows)
  wsMerc['!cols'] = [{ wch: 15 }, { wch: 6 }, { wch: 30 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }]
  XLSX.utils.book_append_sheet(wb, wsMerc, 'Mercurial')

  // 2. Recap prix (products)
  const products = await prisma.product.findMany({ orderBy: { ref: 'asc' } })
  const prixRows = products.map(p => ({
    'Réf': p.ref,
    'Nom': p.name,
    'Prix HT': p.priceHt,
    'Unité': p.unit || '',
  }))
  const wsPrix = XLSX.utils.json_to_sheet(prixRows)
  wsPrix['!cols'] = [{ wch: 8 }, { wch: 35 }, { wch: 12 }, { wch: 10 }]
  XLSX.utils.book_append_sheet(wb, wsPrix, 'Recap prix')

  // 3. Recettes (recipe summary)
  const recipes = await prisma.recipe.findMany({ orderBy: { ref: 'asc' } })
  const recRows = recipes.map(r => ({
    'Réf': r.ref,
    'Nom': r.name,
    'Catégorie': r.category || '',
    'Portions': r.portions,
    'Temps MO (h)': r.laborTime,
    'Aléa %': r.aleaPercent,
    'Marge %': r.margin,
    'Coût/unité': r.costPerUnit != null ? Math.round(r.costPerUnit * 100) / 100 : null,
    'Prix vente': r.sellingPrice != null ? Math.round(r.sellingPrice * 100) / 100 : null,
  }))
  const wsRec = XLSX.utils.json_to_sheet(recRows)
  wsRec['!cols'] = [{ wch: 8 }, { wch: 35 }, { wch: 20 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }]
  XLSX.utils.book_append_sheet(wb, wsRec, 'Recettes')

  // 4. Monthly order sheets per restaurant
  const restaurants = await prisma.restaurant.findMany({ orderBy: { id: 'asc' } })
  const orders = await prisma.order.findMany({
    include: { items: { include: { product: true } } },
    orderBy: [{ year: 'asc' }, { month: 'asc' }],
  })

  for (const order of orders) {
    const restaurant = restaurants.find(r => r.id === order.restaurantId)
    if (!restaurant) continue

    // Build product×day grid
    const productMap = new Map<number, { ref: string; name: string; unit: string; days: Record<number, number>; unitPrice: number | null }>()
    for (const item of order.items) {
      let entry = productMap.get(item.productId)
      if (!entry) {
        entry = { ref: item.product.ref, name: item.product.name, unit: item.product.unit || '', days: {}, unitPrice: item.unitPrice }
        productMap.set(item.productId, entry)
      }
      entry.days[item.day] = (entry.days[item.day] || 0) + item.quantity
    }

    // Arrondissement number from code
    const arrNum = restaurant.code.replace('eme', '')
    const yearSuffix = String(order.year).slice(2)
    const sheetName = `${arrNum} ${MONTHS[order.month]} ${yearSuffix}`.substring(0, 31)

    const rows: Record<string, unknown>[] = []
    for (const [, p] of productMap) {
      const total = Object.values(p.days).reduce((s, v) => s + v, 0)
      if (total <= 0) continue
      const row: Record<string, unknown> = {
        'Réf': p.ref,
        'Nom': p.name,
        'Unité': p.unit,
        'Total': Math.round(total * 100) / 100,
      }
      for (let d = 1; d <= 31; d++) {
        row[`J${d}`] = p.days[d] || ''
      }
      rows.push(row)
    }

    if (rows.length > 0) {
      const wsOrder = XLSX.utils.json_to_sheet(rows)
      const cols = [{ wch: 8 }, { wch: 25 }, { wch: 8 }, { wch: 8 }]
      for (let d = 1; d <= 31; d++) cols.push({ wch: 5 })
      wsOrder['!cols'] = cols
      XLSX.utils.book_append_sheet(wb, wsOrder, sheetName)
    }
  }

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  const now = new Date()
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="yatai_complet_${dateStr}.xlsx"`,
    },
  })
}
