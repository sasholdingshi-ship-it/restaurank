import { db } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const CRON_SECRET = process.env.CRON_SECRET || ''

function auth(req: NextRequest): boolean {
  return !!CRON_SECRET && req.headers.get('x-cron-secret') === CRON_SECRET
}

// GET — référentiel pour l'agent OCR : restaurants (mapping par arrondissement) + produits (refs P0xx)
// GET ?year=&month= — couverture de la grille (pour l'agent de vérification) : items/jour par resto
export async function GET(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const prisma = await db()

  const yearQ = req.nextUrl.searchParams.get('year')
  const monthQ = req.nextUrl.searchParams.get('month')
  if (yearQ && monthQ) {
    const year = parseInt(yearQ), month = parseInt(monthQ)
    if (year < 2024 || year > 2035 || month < 1 || month > 12) {
      return NextResponse.json({ error: 'year/month hors bornes' }, { status: 400 })
    }
    const detail = req.nextUrl.searchParams.get('detail') === '1'
    const orders = await prisma.order.findMany({
      where: { year, month },
      include: {
        restaurant: { select: { id: true, name: true } },
        items: detail
          ? { select: { day: true, quantity: true, product: { select: { ref: true } } } }
          : { select: { day: true, quantity: true } },
      },
    })
    const grid = orders.map(o => {
      const days: Record<number, { items: number; totalQty: number }> = {}
      const lines: Record<number, { ref: string; quantity: number }[]> = {}
      for (const it of o.items) {
        const d = (days[it.day] ||= { items: 0, totalQty: 0 })
        d.items++
        d.totalQty = Math.round((d.totalQty + it.quantity) * 1000) / 1000
        if (detail && 'product' in it) {
          ;(lines[it.day] ||= []).push({ ref: (it as { product: { ref: string } }).product.ref, quantity: it.quantity })
        }
      }
      return detail
        ? { restaurantId: o.restaurantId, restaurant: o.restaurant.name, days, lines }
        : { restaurantId: o.restaurantId, restaurant: o.restaurant.name, days }
    })
    return NextResponse.json({ year, month, grid })
  }

  const [restaurants, products] = await Promise.all([
    prisma.restaurant.findMany({ select: { id: true, name: true, arrondissement: true } }),
    prisma.product.findMany({ select: { id: true, ref: true, name: true, unit: true }, orderBy: { ref: 'asc' } }),
  ])
  return NextResponse.json({ restaurants, products })
}

type Entry = { ref?: string; productId?: number; quantity: number }

// POST — remplit la grille commandes depuis un bon OCRisé. Par défaut : ne touche JAMAIS
// une cellule déjà remplie (status 'conflict'), ne supprime jamais, dryRun possible.
export async function POST(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null) as {
    restaurantId?: number; date?: string; entries?: Entry[]
    dryRun?: boolean; overwrite?: boolean; source?: string
  } | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  const { restaurantId, date, entries, dryRun = false, overwrite = false, source = '' } = body
  if (!restaurantId || !date || !Array.isArray(entries) || entries.length === 0) {
    return NextResponse.json({ error: 'restaurantId, date (YYYY-MM-DD) et entries[] requis' }, { status: 400 })
  }

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return NextResponse.json({ error: `date invalide: ${date}` }, { status: 400 })
  const year = parseInt(m[1]), month = parseInt(m[2]), day = parseInt(m[3])
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (year < 2024 || year > 2035 || month < 1 || month > 12 || day < 1 || day > daysInMonth) {
    return NextResponse.json({ error: `date hors bornes: ${date}` }, { status: 400 })
  }

  const prisma = await db()
  const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId } })
  if (!restaurant) return NextResponse.json({ error: `restaurant ${restaurantId} inconnu` }, { status: 400 })

  const products = await prisma.product.findMany()
  const byRef = new Map(products.map(p => [p.ref, p]))
  const byId = new Map(products.map(p => [p.id, p]))

  const existingOrder = await prisma.order.findUnique({
    where: { restaurantId_year_month: { restaurantId, year, month } },
    include: { items: { where: { day } } },
  })
  const existingByProduct = new Map((existingOrder?.items || []).map(i => [i.productId, i]))

  const results: { ref: string; productId: number | null; quantity: number; status: string; existingQty?: number }[] = []
  const toWrite: { productId: number; quantity: number }[] = []

  for (const e of entries) {
    const product = e.productId != null ? byId.get(e.productId) : (e.ref ? byRef.get(e.ref.toUpperCase().trim()) : undefined)
    const refLabel = e.ref || (product?.ref ?? String(e.productId ?? '?'))
    if (!product) {
      results.push({ ref: refLabel, productId: null, quantity: e.quantity, status: 'unknown_product' })
      continue
    }
    if (typeof e.quantity !== 'number' || !isFinite(e.quantity) || e.quantity <= 0 || e.quantity > 10000) {
      results.push({ ref: product.ref, productId: product.id, quantity: e.quantity, status: 'invalid_quantity' })
      continue
    }
    const existing = existingByProduct.get(product.id)
    if (existing) {
      if (Math.abs(existing.quantity - e.quantity) < 1e-9) {
        results.push({ ref: product.ref, productId: product.id, quantity: e.quantity, status: 'unchanged', existingQty: existing.quantity })
      } else if (overwrite) {
        toWrite.push({ productId: product.id, quantity: e.quantity })
        results.push({ ref: product.ref, productId: product.id, quantity: e.quantity, status: dryRun ? 'would_update' : 'updated', existingQty: existing.quantity })
      } else {
        results.push({ ref: product.ref, productId: product.id, quantity: e.quantity, status: 'conflict', existingQty: existing.quantity })
      }
    } else {
      toWrite.push({ productId: product.id, quantity: e.quantity })
      results.push({ ref: product.ref, productId: product.id, quantity: e.quantity, status: dryRun ? 'would_create' : 'created' })
    }
  }

  if (!dryRun && toWrite.length > 0) {
    const order = existingOrder || await prisma.order.upsert({
      where: { restaurantId_year_month: { restaurantId, year, month } },
      create: { restaurantId, year, month }, update: {},
    })
    for (const w of toWrite) {
      await prisma.orderItem.upsert({
        where: { orderId_productId_day: { orderId: order.id, productId: w.productId, day } },
        create: { orderId: order.id, productId: w.productId, day, quantity: w.quantity, unitPrice: null },
        update: { quantity: w.quantity },
      })
    }
  }

  const counts: Record<string, number> = {}
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1
  return NextResponse.json({ restaurant: restaurant.name, restaurantId, date, dryRun, source, counts, results })
}
