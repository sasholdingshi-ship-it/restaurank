import { db } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

const PL_BASE = 'https://app.pennylane.com/api/external/v2'
const PL_TOKEN = process.env.PENNYLANE_API_TOKEN || ''

/** Customer IDs for vente annexe on Pennylane */
const VENTE_CLIENTS: Record<string, number> = {
  'SAS KS': 187414997,
  'RAMEN 13': 208661042,
  'KIOKO': 260864471,
  'HB LA DEFENSE': 209640195,
  'SOLA RAMEN': 215142804,
  'ASIE GOURMET': 253843076,
  'MOJY': 198911738,
}

/** GET — Sum customer invoices (HT) from Pennylane for a given month */
export async function GET(req: NextRequest) {
  if (!PL_TOKEN) return NextResponse.json({ error: 'PENNYLANE_API_TOKEN not configured' }, { status: 500 })

  const year = parseInt(req.nextUrl.searchParams.get('year') || '0')
  const month = parseInt(req.nextUrl.searchParams.get('month') || '0')
  if (!year || !month) return NextResponse.json({ error: 'year, month required' }, { status: 400 })

  const mm = String(month).padStart(2, '0')
  const dateFrom = `${year}-${mm}-01`
  const dateTo = `${year}-${mm}-31`

  const results: { client: string; total: number; invoiceCount: number }[] = []
  let grandTotal = 0

  for (const [name, customerId] of Object.entries(VENTE_CLIENTS)) {
    const filter = JSON.stringify([
      { field: 'customer_id', operator: 'eq', value: String(customerId) },
      { field: 'date', operator: 'gteq', value: dateFrom },
      { field: 'date', operator: 'lteq', value: dateTo },
    ])

    let clientTotal = 0
    let invoiceCount = 0
    let hasMore = true
    let cursor: string | null = null

    while (hasMore) {
      const fetchUrl: string = cursor
        ? `${PL_BASE}/customer_invoices?filter=${encodeURIComponent(filter)}&per_page=50&cursor=${cursor}`
        : `${PL_BASE}/customer_invoices?filter=${encodeURIComponent(filter)}&per_page=50`

      const res = await fetch(fetchUrl, { headers: { Authorization: `Bearer ${PL_TOKEN}` } })
      if (!res.ok) break

      const data = await res.json()
      for (const inv of data.items || []) {
        const amt = parseFloat(inv.currency_amount_before_tax || inv.currency_amount || '0')
        clientTotal += amt
        invoiceCount++
      }

      hasMore = data.has_more === true
      cursor = data.next_cursor || null
    }

    grandTotal += clientTotal
    results.push({ client: name, total: Math.round(clientTotal * 100) / 100, invoiceCount })
  }

  const save = req.nextUrl.searchParams.get('save') === '1'
  if (save && grandTotal > 0) {
    const prisma = await db()
    const existing = await prisma.monthlyExpense.findUnique({
      where: { year_month_type: { year, month, type: 'vente_annexe' } },
    })
    if (existing) {
      await prisma.monthlyExpense.update({ where: { id: existing.id }, data: { amount: Math.round(grandTotal * 100) / 100 } })
    } else {
      await prisma.monthlyExpense.create({ data: { year, month, type: 'vente_annexe', amount: Math.round(grandTotal * 100) / 100 } })
    }
  }

  return NextResponse.json({
    year, month,
    clientCount: results.length,
    totalHT: Math.round(grandTotal * 100) / 100,
    saved: save && grandTotal > 0,
    clients: results,
  })
}
