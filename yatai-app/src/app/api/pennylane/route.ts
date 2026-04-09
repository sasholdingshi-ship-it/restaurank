import { db } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

const PL_BASE = 'https://app.pennylane.com/api/external/v2'
const PL_TOKEN = process.env.PENNYLANE_API_TOKEN || ''

// Hardcoded fallback — used if API search fails
const CUSTOMER_MAP: Record<string, number> = {
  '901471367': 102381901,  // YATAI CHOISEUL
  '887615516': 102378499,  // FSH PARIS
  '930307012': 137794252,  // YATAI BASTILLE
  '984606426': 151267557,  // CDR
  '949234272': 273622715,  // KEOPI (23 VERDEAU)
}

/** Search Pennylane customer by SIREN (reg_no field), fallback to hardcoded map */
async function findCustomerId(siren: string): Promise<number | null> {
  // Try hardcoded first (fast path)
  if (CUSTOMER_MAP[siren]) return CUSTOMER_MAP[siren]
  // Search via Pennylane API — paginate through all customers
  try {
    let cursor: string | null = null
    for (let page = 0; page < 10; page++) {
      const searchUrl: string = cursor
        ? `${PL_BASE}/customers?per_page=50&cursor=${cursor}`
        : `${PL_BASE}/customers?per_page=50`
      const res = await fetch(searchUrl, { headers: { 'Authorization': `Bearer ${PL_TOKEN}` } })
      if (!res.ok) break
      const data = await res.json()
      const items = data.items || []
      for (const c of items) {
        if (c.reg_no === siren) {
          CUSTOMER_MAP[siren] = c.id // cache
          return c.id
        }
      }
      if (!data.has_more) break
      cursor = data.next_cursor
    }
  } catch {
    // API error — fall through to null
  }
  return null
}

const MONTHS = ['', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

function tvaToCode(rate: number): string {
  if (rate === 0.2 || rate === 0.20) return 'FR_200'
  if (rate === 0.1 || rate === 0.10) return 'FR_100'
  if (rate === 0.055) return 'FR_55'
  if (rate === 0.021) return 'FR_21'
  return 'FR_55' // default for food
}

/** GET — List Pennylane customers or search by SIREN */
export async function GET(req: NextRequest) {
  if (!PL_TOKEN) return NextResponse.json({ error: 'PENNYLANE_API_TOKEN not configured' }, { status: 500 })
  const siren = req.nextUrl.searchParams.get('siren')
  const url = siren
    ? `${PL_BASE}/customers?filter=[{"field":"registration_number","operator":"eq","value":"${siren}"}]`
    : `${PL_BASE}/customers?page=1&per_page=50`
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${PL_TOKEN}` } })
  const data = await res.json()
  return NextResponse.json(data)
}

/** POST — Create a draft invoice on Pennylane */
export async function POST(req: NextRequest) {
  if (!PL_TOKEN) return NextResponse.json({ error: 'PENNYLANE_API_TOKEN not configured' }, { status: 500 })

  const { restaurantId, year, month } = await req.json()
  if (!restaurantId || !year || !month) return NextResponse.json({ error: 'restaurantId, year, month required' }, { status: 400 })

  const prisma = await db()
  const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId } })
  if (!restaurant) return NextResponse.json({ error: 'Restaurant not found' }, { status: 404 })

  if (!restaurant.siren) return NextResponse.json({ error: 'Restaurant has no SIREN' }, { status: 400 })
  const customerId = await findCustomerId(restaurant.siren)
  if (!customerId) return NextResponse.json({ error: `No Pennylane customer found for SIREN ${restaurant.siren}. Vérifiez que le client existe dans Pennylane avec ce SIREN.` }, { status: 400 })

  const order = await prisma.order.findUnique({
    where: { restaurantId_year_month: { restaurantId, year, month } },
    include: { items: { include: { product: true } }, extras: true },
  })
  if (!order) return NextResponse.json({ error: 'No order found for this period' }, { status: 404 })

  // Build invoice lines
  const invoiceLines: Record<string, unknown>[] = []
  const dateStr = `${MONTHS[month]} ${year}`

  // Extras (Stuart / Livraison) — TVA 20%
  const extras = order.extras || []
  for (const extra of extras) {
    if (extra.quantity > 0 && extra.price > 0) {
      const isStuart = extra.type === 'stuart'
      invoiceLines.push({
        label: isStuart ? 'Stuart' : 'Livraison',
        description: isStuart
          ? `Courses Stuart ${dateStr}${extra.label ? ' — ' + extra.label : ''}`
          : `${extra.quantity} livraisons ${dateStr}${extra.label ? ' — ' + extra.label : ''}`,
        quantity: extra.quantity,
        unit: isStuart ? 'piece' : 'piece',
        raw_currency_unit_price: extra.price.toFixed(2),
        vat_rate: 'FR_200',
      })
    }
  }

  // Legacy extras fallback
  if (extras.length === 0) {
    if (order.stuartQty > 0 && order.stuartPrice > 0) {
      invoiceLines.push({
        label: 'Stuart',
        description: `Courses Stuart ${dateStr}`,
        quantity: order.stuartQty,
        unit: 'piece',
        raw_currency_unit_price: order.stuartPrice.toFixed(2),
        vat_rate: 'FR_200',
      })
    }
    if (order.livraisonQty > 0 && order.livraisonPrice > 0) {
      invoiceLines.push({
        label: 'Livraison',
        description: `${order.livraisonQty} livraisons ${dateStr}`,
        quantity: order.livraisonQty,
        unit: 'piece',
        raw_currency_unit_price: order.livraisonPrice.toFixed(2),
        vat_rate: 'FR_200',
      })
    }
  }

  // Aggregate product quantities (same logic as export)
  const productTotals = new Map<string, { product: typeof order.items[0]['product']; total: number; price: number | null }>()
  for (const item of order.items) {
    const priceKey = item.unitPrice != null ? item.unitPrice.toFixed(4) : 'default'
    const key = `${item.productId}-${priceKey}`
    const existing = productTotals.get(key)
    if (existing) existing.total += item.quantity
    else productTotals.set(key, { product: item.product, total: item.quantity, price: item.unitPrice ?? null })
  }

  for (const [, { product, total, price }] of productTotals) {
    if (total <= 0) continue
    const unitPrice = price ?? product.priceHt ?? 0
    invoiceLines.push({
      label: product.name,
      description: price != null ? `Prix manuel: ${price.toFixed(2)} €` : '',
      quantity: total,
      unit: product.unit === 'kg' || product.unit === 'kilogram' ? 'kilogram' : 'piece',
      raw_currency_unit_price: unitPrice.toFixed(6),
      vat_rate: tvaToCode(restaurant.tvaRate),
    })
  }

  if (invoiceLines.length === 0) return NextResponse.json({ error: 'No items to invoice' }, { status: 400 })

  // Compute dates
  const invoiceDate = `${year}-${String(month).padStart(2, '0')}-01`
  const deadlineDate = new Date(year, month, 0) // last day of month
  const deadline = `${year}-${String(month).padStart(2, '0')}-${String(deadlineDate.getDate()).padStart(2, '0')}`

  const payload = {
    customer_id: customerId,
    date: invoiceDate,
    deadline,
    draft: true,
    currency: 'EUR',
    language: 'fr_FR',
    pdf_invoice_subject: `Ft Marchandise ${restaurant.arrondissement} ${String(month).padStart(2, '0')} ${year}`,
    invoice_lines: invoiceLines,
  }

  // Call Pennylane API
  const response = await fetch(`${PL_BASE}/customer_invoices`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${PL_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const result = await response.json()

  if (!response.ok) {
    return NextResponse.json({
      error: 'Pennylane API error',
      status: response.status,
      details: result,
    }, { status: response.status })
  }

  return NextResponse.json({
    success: true,
    invoiceId: result.id,
    invoiceNumber: result.invoice_number,
    status: result.status,
    amount: result.currency_amount,
    amountHt: result.currency_amount_before_tax,
    tax: result.currency_tax,
    lines: invoiceLines.length,
    customer: restaurant.name,
  })
}
