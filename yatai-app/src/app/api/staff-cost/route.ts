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

type EmployeeResult = { name: string; supplierId: number; net: number | null; totalVerse: number | null; filename: string | null; error?: string }

/** Fetch one employee's payslip and extract Total versé */
async function fetchEmployee(name: string, supplierId: number, year: number, mm: string, filenamePattern: string): Promise<EmployeeResult> {
  try {
    const dateFilter = JSON.stringify([
      { field: 'supplier_id', operator: 'eq', value: String(supplierId) },
      { field: 'date', operator: 'gteq', value: `${year}-${mm}-01` },
      { field: 'date', operator: 'lteq', value: `${year}-${mm}-${String(new Date(year, parseInt(mm), 0).getDate()).padStart(2, '0')}` },
    ])
    let res = await fetch(`${PL_BASE}/supplier_invoices?filter=${encodeURIComponent(dateFilter)}&per_page=10`, {
      headers: { Authorization: `Bearer ${PL_TOKEN}` },
    })
    let data = await res.json()
    let invoices = data.items || []

    // Fallback: filename match when Pennylane date is wrong
    if (invoices.length === 0) {
      const allFilter = JSON.stringify([{ field: 'supplier_id', operator: 'eq', value: String(supplierId) }])
      res = await fetch(`${PL_BASE}/supplier_invoices?filter=${encodeURIComponent(allFilter)}&per_page=20`, {
        headers: { Authorization: `Bearer ${PL_TOKEN}` },
      })
      data = await res.json()
      invoices = (data.items || []).filter((inv: { filename?: string }) =>
        (inv.filename || '').includes(filenamePattern)
      )
    }

    if (invoices.length === 0) return { name, supplierId, net: null, totalVerse: null, filename: null, error: 'no payslip found' }

    const inv = invoices[0]
    const net = parseFloat(inv.currency_amount || '0')
    const pdfUrl = inv.public_file_url

    if (!pdfUrl) return { name, supplierId, net, totalVerse: null, filename: inv.filename, error: 'no PDF URL' }

    // Download and parse PDF
    const pdfRes = await fetch(pdfUrl)
    const buffer = Buffer.from(await pdfRes.arrayBuffer())
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: new Uint8Array(buffer) })
    const textResult = await parser.getText()
    const fullText = textResult.pages.map(p => p.text).join('\n')
    const totalVerse = extractTotalVerse(fullText)

    if (totalVerse) return { name, supplierId, net, totalVerse, filename: inv.filename }
    return { name, supplierId, net, totalVerse: null, filename: inv.filename, error: 'PDF parse failed' }
  } catch (e) {
    return { name, supplierId, net: null, totalVerse: null, filename: null, error: String(e) }
  }
}

/** GET — Fetch staff cost from Pennylane payslips (parallel) */
export async function GET(req: NextRequest) {
  if (!PL_TOKEN) return NextResponse.json({ error: 'PENNYLANE_API_TOKEN not configured' }, { status: 500 })

  const year = parseInt(req.nextUrl.searchParams.get('year') || '0')
  const month = parseInt(req.nextUrl.searchParams.get('month') || '0')
  if (!year || !month) return NextResponse.json({ error: 'year, month required' }, { status: 400 })

  const mm = String(month).padStart(2, '0')
  const filenamePattern = `_${mm}_${year}_`

  // Fetch all employees in parallel
  const results = await Promise.all(
    Object.entries(STAFF).map(([name, sid]) => fetchEmployee(name, sid, year, mm, filenamePattern))
  )

  let grandTotal = 0
  for (const r of results) {
    grandTotal += r.totalVerse ?? r.net ?? 0
  }

  const save = req.nextUrl.searchParams.get('save') === '1'
  if (save && grandTotal > 0) {
    const prisma = await db()
    const existing = await prisma.monthlyExpense.findUnique({
      where: { year_month_type: { year, month, type: 'staff_reel' } },
    })
    if (existing) {
      await prisma.monthlyExpense.update({ where: { id: existing.id }, data: { amount: Math.round(grandTotal * 100) / 100 } })
    } else {
      await prisma.monthlyExpense.create({ data: { year, month, type: 'staff_reel', amount: Math.round(grandTotal * 100) / 100 } })
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
