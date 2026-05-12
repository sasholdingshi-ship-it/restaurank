import { db } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

// v2.6 returns `contents[]` (dish-level) inside each order — v2.7 only aggregates
const ZELTY_BASE = 'https://api.zelty.fr/2.6'
const ZELTY_TOKEN = process.env.ZELTY_API_TOKEN || ''

/** Map Zelty restaurant ID → Yatai DB Restaurant.id */
const ZELTY_TO_YATAI: Record<number, number> = {
  4734: 1, // Yatai Choiseul → 2ème
  7041: 2, // Yatai Saint Honoré → 8ème
  6837: 3, // Yatai Chateaudun → 9ème (labo)
  7356: 4, // Yatai Bastille → 11ème
}

// v2.6 status: 255 = closed
const STATUS_CLOSED = 255

type ZeltyContent = {
  id: number
  name: string
  type: string       // "dish" | "menu" | "option_value" | ...
  item_id: number
  contents?: ZeltyContent[]
}

type ZeltyOrderV26 = {
  id: number
  id_restaurant: number
  created_at: string
  status: number
  mode: number
  price: number
  contents?: ZeltyContent[]
}

/** Fetch all orders for a date range from v2.6 (with retry on 429) */
async function fetchAllOrdersV26(from: string, to: string): Promise<ZeltyOrderV26[]> {
  const all: ZeltyOrderV26[] = []
  let offset = 0
  const limit = 200
  while (true) {
    const url = `${ZELTY_BASE}/orders?from=${from}&to=${to}&limit=${limit}&offset=${offset}`
    let retries = 0
    let res: Response
    while (true) {
      res = await fetch(url, { headers: { Authorization: `Bearer ${ZELTY_TOKEN}` } })
      if (res.status !== 429 || retries >= 5) break
      retries++
      await new Promise(r => setTimeout(r, 1500 * retries))
    }
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(`Zelty v2.6 API ${res.status}: ${txt.slice(0, 200)}`)
    }
    const data = await res.json()
    const orders: ZeltyOrderV26[] = data.orders || []
    all.push(...orders)
    if (orders.length < limit) break
    offset += limit
    if (offset > 50000) break
    await new Promise(r => setTimeout(r, 300))
  }
  return all
}

/** Walk contents recursively, collecting only dishes (not modifiers/options) */
function collectDishes(contents: ZeltyContent[] | undefined, out: Map<number, { name: string; qty: number }>) {
  if (!contents) return
  for (const c of contents) {
    if (c.type === 'dish' && c.item_id) {
      const prev = out.get(c.item_id)
      if (prev) prev.qty += 1
      else out.set(c.item_id, { name: c.name, qty: 1 })
    }
    // Recurse into nested contents (menus contain dishes)
    if (c.contents && c.contents.length) collectDishes(c.contents, out)
  }
}

/** GET — Sync Zelty dish-level sales for a given month */
export async function GET(req: NextRequest) {
  if (!ZELTY_TOKEN) return NextResponse.json({ error: 'ZELTY_API_TOKEN not set' }, { status: 500 })

  const year = parseInt(req.nextUrl.searchParams.get('year') || '0')
  const month = parseInt(req.nextUrl.searchParams.get('month') || '0')
  const save = req.nextUrl.searchParams.get('save') === '1'
  if (!year || !month) return NextResponse.json({ error: 'year, month required' }, { status: 400 })

  const mm = String(month).padStart(2, '0')
  const lastDay = new Date(year, month, 0).getDate()
  const from = `${year}-${mm}-01`
  const to = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`

  try {
    const orders = await fetchAllOrdersV26(from, to)

    // Aggregate dishes per restaurant
    // Map: restaurantId → Map<itemId, {name, qty}>
    const byRestaurant = new Map<number, Map<number, { name: string; qty: number }>>()
    let totalDishes = 0
    let ordersWithContents = 0
    let ordersClosed = 0

    for (const o of orders) {
      if (o.status !== STATUS_CLOSED) continue
      ordersClosed++
      const yataiId = ZELTY_TO_YATAI[o.id_restaurant]
      if (!yataiId) continue

      // Filter by created_at month
      const created = new Date(o.created_at)
      if (created.getFullYear() !== year || (created.getMonth() + 1) !== month) continue

      if (!o.contents || o.contents.length === 0) continue
      ordersWithContents++

      let bucket = byRestaurant.get(yataiId)
      if (!bucket) {
        bucket = new Map()
        byRestaurant.set(yataiId, bucket)
      }
      const before = bucket.size
      collectDishes(o.contents, bucket)
      totalDishes += bucket.size - before
    }

    // Build flat list for response + persistence
    const result: Array<{ restaurantId: number; itemId: number; name: string; qty: number }> = []
    for (const [restaurantId, bucket] of byRestaurant.entries()) {
      for (const [itemId, info] of bucket.entries()) {
        result.push({ restaurantId, itemId, name: info.name, qty: info.qty })
      }
    }

    let saved = false
    if (save && result.length > 0) {
      const prisma = await db()
      // Wipe existing data for this period (so we don't accumulate stale dishes)
      await prisma.zeltyDishSale.deleteMany({ where: { year, month } })
      // Batch insert
      const now = new Date()
      for (const r of result) {
        await prisma.zeltyDishSale.upsert({
          where: { year_month_restaurantId_zeltyItemId: { year, month, restaurantId: r.restaurantId, zeltyItemId: r.itemId } },
          create: { year, month, restaurantId: r.restaurantId, zeltyItemId: r.itemId, name: r.name, quantity: r.qty, syncedAt: now },
          update: { name: r.name, quantity: r.qty, syncedAt: now },
        })
      }
      saved = true
    }

    const totalQty = result.reduce((s, r) => s + r.qty, 0)
    return NextResponse.json({
      year, month, from, to,
      ordersFetched: orders.length,
      ordersClosed,
      ordersWithContents,
      uniqueDishes: result.length,
      totalDishesSold: totalQty,
      restaurantsCount: byRestaurant.size,
      saved,
      // Top 20 dishes for quick inspection
      sample: result.sort((a, b) => b.qty - a.qty).slice(0, 20),
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
