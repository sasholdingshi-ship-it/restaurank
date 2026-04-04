import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

// Export Pennylane format
export async function GET(req: NextRequest) {
  const restaurantId = parseInt(req.nextUrl.searchParams.get('restaurantId') || '0')
  const year = parseInt(req.nextUrl.searchParams.get('year') || '0')
  const month = parseInt(req.nextUrl.searchParams.get('month') || '0')

  if (!restaurantId || !year || !month) {
    return NextResponse.json({ error: 'restaurantId, year, month required' }, { status: 400 })
  }

  const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId } })
  if (!restaurant) {
    return NextResponse.json({ error: 'Restaurant not found' }, { status: 404 })
  }

  const order = await prisma.order.findUnique({
    where: { restaurantId_year_month: { restaurantId, year, month } },
    include: {
      items: { include: { product: true } },
    },
  })

  if (!order) {
    return NextResponse.json({ error: 'No order found for this period' }, { status: 404 })
  }

  // Aggregate quantities by product
  const productTotals = new Map<number, { product: typeof order.items[0]['product']; total: number }>()
  for (const item of order.items) {
    const existing = productTotals.get(item.productId)
    if (existing) {
      existing.total += item.quantity
    } else {
      productTotals.set(item.productId, { product: item.product, total: item.quantity })
    }
  }

  // Count passages (unique days with any order)
  const uniqueDays = new Set(order.items.map(i => i.day))
  const nbPassages = uniqueDays.size

  // Build Pennylane rows
  const monthNames = ['', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
  const dateStr = `${monthNames[month]} ${year}`

  const rows: Record<string, unknown>[] = []

  // First row: Livraison
  rows.push({
    'Raison sociale (optionnel)': restaurant.name,
    'SIREN': restaurant.siren || '',
    'Identifiant produit (recommandé)': '',
    'Nom du produit': 'Livraison',
    'Description (optionnel)': '',
    'Quantité': nbPassages,
    'Unité (liste déroulante)': 'Passages',
    'Prix unitaire HT en euros': restaurant.deliveryPrice,
    'Taux TVA  (liste déroulante)': 0.2,
    'Type de produit': 'Prestations de services',
    "Date d'émission": dateStr,
  })

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

  // Generate Excel
  const ws = XLSX.utils.json_to_sheet(rows)
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
