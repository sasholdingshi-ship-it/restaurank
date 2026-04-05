import { db } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

const PL_BASE = 'https://app.pennylane.com/api/external/v2'
const PL_TOKEN = process.env.PENNYLANE_API_TOKEN || ''

/** Employee supplier IDs on Pennylane */
const STAFF: Record<string, number> = {
  'BHANDARI Arun': 107064549,
  'TAMANG To Maya': 105684484,
  'LIU Sha': 105683887,
  'DALIM Hussain Mohammed': 129029160,
  'BHUKYA Sivaji': 116320554,
  'SUSHIL Dahal': 144680017,
  'Tseten SHERPA': 232803481,
  'GURUNG Sidhartha': 119014755,
}

/** Extract "Total versé" from payslip PDF text (Mensuel line, second-to-last number) */
function extractTotalVerse(text: string): number | null {
  for (const line of text.split('\n')) {
    if (line.trim().startsWith('Mensuel')) {
      const nums = [...line.matchAll(/[\d ]+\.\d{2}/g)].map(m => parseFloat(m[0].replace(/ /g, '')))
      if (nums.length >= 3) return nums[nums.length - 2]
    }
  }
  return null
}

/** GET — Fetch staff cost from Pennylane payslips for a given month */
export async function GET(req: NextRequest) {
  if (!PL_TOKEN) return NextResponse.json({ error: 'PENNYLANE_API_TOKEN not configured' }, { status: 500 })

  const year = parseInt(req.nextUrl.searchParams.get('year') || '0')
  const month = parseInt(req.nextUrl.searchParams.get('month') || '0')
  if (!year || !month) return NextResponse.json({ error: 'year, month required' }, { status: 400 })

  const mm = String(month).padStart(2, '0')
  const filenamePattern = `_${mm}_${year}_`

  const results: { name: string; supplierId: number; net: number | null; totalVerse: number | null; filename: string | null; error?: string }[] = []
  let grandTotal = 0

  for (const [name, supplierId] of Object.entries(STAFF)) {
    try {
      // Search supplier invoices — try date filter first, then fallback to all invoices with filename match
      const dateFilter = JSON.stringify([
        { field: 'supplier_id', operator: 'eq', value: String(supplierId) },
        { field: 'date', operator: 'gteq', value: `${year}-${mm}-01` },
        { field: 'date', operator: 'lteq', value: `${year}-${mm}-31` },
      ])
      let res = await fetch(`${PL_BASE}/supplier_invoices?filter=${encodeURIComponent(dateFilter)}&per_page=10`, {
        headers: { Authorization: `Bearer ${PL_TOKEN}` },
      })
      let data = await res.json()
      let invoices = data.items || []

      // Fallback: search all recent invoices if date filter missed (wrong date like Tseten)
      if (invoices.length === 0) {
        const allFilter = JSON.stringify([
          { field: 'supplier_id', operator: 'eq', value: String(supplierId) },
        ])
        res = await fetch(`${PL_BASE}/supplier_invoices?filter=${encodeURIComponent(allFilter)}&per_page=20`, {
          headers: { Authorization: `Bearer ${PL_TOKEN}` },
        })
        data = await res.json()
        invoices = (data.items || []).filter((inv: { filename?: string }) =>
          (inv.filename || '').includes(filenamePattern)
        )
      }

      if (invoices.length === 0) {
        results.push({ name, supplierId, net: null, totalVerse: null, filename: null, error: 'no payslip found' })
        continue
      }

      const inv = invoices[0]
      const net = parseFloat(inv.currency_amount || '0')
      const pdfUrl = inv.public_file_url

      if (!pdfUrl) {
        results.push({ name, supplierId, net, totalVerse: null, filename: inv.filename, error: 'no PDF URL' })
        grandTotal += net // fallback to net if no PDF
        continue
      }

      // Download and parse PDF
      const pdfRes = await fetch(pdfUrl)
      const buffer = Buffer.from(await pdfRes.arrayBuffer())

      // Dynamic import for pdf-parse (ESM compat)
      const pdfParse = (await import('pdf-parse')).default
      const parsed = await pdfParse(buffer)
      const totalVerse = extractTotalVerse(parsed.text)

      if (totalVerse) {
        grandTotal += totalVerse
        results.push({ name, supplierId, net, totalVerse, filename: inv.filename })
      } else {
        grandTotal += net // fallback
        results.push({ name, supplierId, net, totalVerse: null, filename: inv.filename, error: 'could not parse Total versé from PDF' })
      }
    } catch (e) {
      results.push({ name, supplierId, net: null, totalVerse: null, filename: null, error: String(e) })
    }
  }

  // Auto-save option
  const save = req.nextUrl.searchParams.get('save') === '1'
  if (save && grandTotal > 0) {
    const prisma = await db()
    const existing = await prisma.monthlyExpense.findUnique({
      where: { year_month_type: { year, month, type: 'staff_reel' } },
    })
    if (existing) {
      await prisma.monthlyExpense.update({ where: { id: existing.id }, data: { amount: grandTotal } })
    } else {
      await prisma.monthlyExpense.create({ data: { year, month, type: 'staff_reel', amount: grandTotal } })
    }
  }

  return NextResponse.json({
    year, month,
    staffCount: results.length,
    totalVerse: Math.round(grandTotal * 100) / 100,
    saved: save && grandTotal > 0,
    employees: results,
  })
}
