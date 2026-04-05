import { db } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

const PL_BASE = 'https://app.pennylane.com/api/external/v2'
const PL_TOKEN = process.env.PENNYLANE_API_TOKEN || ''

/** Food supplier IDs on Pennylane (all entries per supplier) */
const FOOD_SUPPLIERS: Record<string, number[]> = {
  'ASIE GOURMET': [103704891],
  'MING HAI': [211735967, 139783626],
  'EUROPE CHINA': [163222254],
  'PANDAGOLD': [198084530],
  'KIOKO': [104793994],
  'GILLES MATIGNON': [107052679, 105703277, 105703276, 101702037],
  'BEAUGRAIN': [103990389],
  'BELLORR PARIS': [116590867],
  'TANG FRERES': [225341999],
  'METRO': [105733895, 104750109],
}

/** GET — Sum food supplier invoices from Pennylane for a given month */
export async function GET(req: NextRequest) {
  if (!PL_TOKEN) return NextResponse.json({ error: 'PENNYLANE_API_TOKEN not configured' }, { status: 500 })

  const year = parseInt(req.nextUrl.searchParams.get('year') || '0')
  const month = parseInt(req.nextUrl.searchParams.get('month') || '0')
  if (!year || !month) return NextResponse.json({ error: 'year, month required' }, { status: 400 })

  const mm = String(month).padStart(2, '0')
  const dateFrom = `${year}-${mm}-01`
  const dateTo = `${year}-${mm}-31`

  const results: { supplier: string; total: number; invoiceCount: number; invoices: { date: string; amount: number; label: string }[] }[] = []
  let grandTotal = 0

  for (const [name, ids] of Object.entries(FOOD_SUPPLIERS)) {
    let supplierTotal = 0
    const allInvoices: { date: string; amount: number; label: string }[] = []

    for (const supplierId of ids) {
      const filter = JSON.stringify([
        { field: 'supplier_id', operator: 'eq', value: String(supplierId) },
        { field: 'date', operator: 'gteq', value: dateFrom },
        { field: 'date', operator: 'lteq', value: dateTo },
      ])

      let hasMore = true
      let cursor: string | null = null

      while (hasMore) {
        const fetchUrl: string = cursor
          ? `${PL_BASE}/supplier_invoices?filter=${encodeURIComponent(filter)}&per_page=50&cursor=${cursor}`
          : `${PL_BASE}/supplier_invoices?filter=${encodeURIComponent(filter)}&per_page=50`

        const res = await fetch(fetchUrl, { headers: { Authorization: `Bearer ${PL_TOKEN}` } })
        if (!res.ok) break

        const data = await res.json()
        const items = data.items || []

        for (const inv of items) {
          const amount = parseFloat(inv.currency_amount || '0')
          supplierTotal += amount
          allInvoices.push({
            date: inv.date,
            amount,
            label: (inv.label || inv.filename || '').slice(0, 80),
          })
        }

        hasMore = data.has_more === true
        cursor = data.next_cursor || null
      }
    }

    grandTotal += supplierTotal
    results.push({ supplier: name, total: Math.round(supplierTotal * 100) / 100, invoiceCount: allInvoices.length, invoices: allInvoices })
  }

  // Auto-save option
  const save = req.nextUrl.searchParams.get('save') === '1'
  if (save && grandTotal > 0) {
    const prisma = await db()
    const existing = await prisma.monthlyExpense.findUnique({
      where: { year_month_type: { year, month, type: 'food_cost_reel' } },
    })
    if (existing) {
      await prisma.monthlyExpense.update({ where: { id: existing.id }, data: { amount: Math.round(grandTotal * 100) / 100 } })
    } else {
      await prisma.monthlyExpense.create({ data: { year, month, type: 'food_cost_reel', amount: Math.round(grandTotal * 100) / 100 } })
    }
  }

  return NextResponse.json({
    year, month,
    supplierCount: results.length,
    totalHT: Math.round(grandTotal * 100) / 100,
    saved: save && grandTotal > 0,
    suppliers: results,
  })
}
