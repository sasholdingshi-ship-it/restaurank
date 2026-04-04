import { db } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

export async function GET(req: NextRequest) {
  const restaurantId = parseInt(req.nextUrl.searchParams.get('restaurantId') || '0')
  const year = parseInt(req.nextUrl.searchParams.get('year') || '0')
  const month = parseInt(req.nextUrl.searchParams.get('month') || '0')

  if (!restaurantId || !year || !month) return NextResponse.json({ error: 'restaurantId, year, month required' }, { status: 400 })
  const prisma = await db()
  const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId } })
  if (!restaurant) return NextResponse.json({ error: 'Restaurant not found' }, { status: 404 })

  const order = await prisma.order.findUnique({
    where: { restaurantId_year_month: { restaurantId, year, month } },
    include: { items: { include: { product: true } }, extras: true },
  })
  if (!order) return NextResponse.json({ error: 'No order found' }, { status: 404 })

  // Aggregate quantities per product
  const productTotals = new Map<number, { product: typeof order.items[0]['product']; total: number }>()
  for (const item of order.items) {
    const existing = productTotals.get(item.productId)
    if (existing) existing.total += item.quantity
    else productTotals.set(item.productId, { product: item.product, total: item.quantity })
  }

  const monthNames = ['', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
  const dateStr = `${monthNames[month]} ${year}`

  const rows: Record<string, unknown>[] = []

  // OrderExtra rows (new system — multiple entries)
  const extras = order.extras || []
  for (const extra of extras) {
    if (extra.quantity > 0 && extra.price > 0) {
      const isStuart = extra.type === 'stuart'
      rows.push({
        'Raison sociale (optionnel)': restaurant.name,
        'SIREN': restaurant.siren || '',
        'Identifiant produit (recommandé)': isStuart ? 'STUART' : 'LIVR',
        'Nom du produit': isStuart ? 'Stuart' : 'Livraison',
        'Description (optionnel)': isStuart
          ? `Courses Stuart ${dateStr}${extra.label ? ' — ' + extra.label : ''}`
          : `${extra.quantity} livraisons ${dateStr}${extra.label ? ' — ' + extra.label : ''}`,
        'Quantité': extra.quantity,
        'Unité (liste déroulante)': isStuart ? 'Courses' : 'Livraisons',
        'Prix unitaire HT en euros': extra.price,
        'Taux TVA  (liste déroulante)': 0.2,
        'Type de produit': 'Prestations de services',
        "Date d'émission": dateStr,
      })
    }
  }

  // Legacy fallback: if no extras rows, use old fields on Order
  if (extras.length === 0) {
    if (order.stuartQty > 0 && order.stuartPrice > 0) {
      rows.push({
        'Raison sociale (optionnel)': restaurant.name,
        'SIREN': restaurant.siren || '',
        'Identifiant produit (recommandé)': 'STUART',
        'Nom du produit': 'Stuart',
        'Description (optionnel)': `Courses Stuart ${dateStr}`,
        'Quantité': order.stuartQty,
        'Unité (liste déroulante)': 'Courses',
        'Prix unitaire HT en euros': order.stuartPrice,
        'Taux TVA  (liste déroulante)': 0.2,
        'Type de produit': 'Prestations de services',
        "Date d'émission": dateStr,
      })
    }
    if (order.livraisonQty > 0 && order.livraisonPrice > 0) {
      rows.push({
        'Raison sociale (optionnel)': restaurant.name,
        'SIREN': restaurant.siren || '',
        'Identifiant produit (recommandé)': 'LIVR',
        'Nom du produit': 'Livraison',
        'Description (optionnel)': `${order.livraisonQty} livraisons ${dateStr}`,
        'Quantité': order.livraisonQty,
        'Unité (liste déroulante)': 'Livraisons',
        'Prix unitaire HT en euros': order.livraisonPrice,
        'Taux TVA  (liste déroulante)': 0.2,
        'Type de produit': 'Prestations de services',
        "Date d'émission": dateStr,
      })
    }
  }

  // Product rows
  for (const [, { product, total }] of productTotals) {
    if (total <= 0) continue
    rows.push({
      'Raison sociale (optionnel)': restaurant.name,
      'SIREN': restaurant.siren || '',
      'Identifiant produit (recommandé)': product.ref,
      'Nom du produit': product.name,
      'Description (optionnel)': '',
      'Quantité': total,
      'Unité (liste déroulante)': product.unit || '',
      'Prix unitaire HT en euros': product.priceHt || 0,
      'Taux TVA  (liste déroulante)': restaurant.tvaRate,
      'Type de produit': 'Ventes de marchandises',
      "Date d'émission": dateStr,
    })
  }

  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = [
    { wch: 20 }, { wch: 12 }, { wch: 10 }, { wch: 30 }, { wch: 30 },
    { wch: 10 }, { wch: 12 }, { wch: 15 }, { wch: 12 }, { wch: 22 }, { wch: 15 },
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, restaurant.code)
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="pennylane_${restaurant.code}_${month}_${year}.xlsx"`,
    },
  })
}
