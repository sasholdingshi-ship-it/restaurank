import { db } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

const ZELTY_BASE = 'https://api.zelty.fr/2.7'
const ZELTY_TOKEN = process.env.ZELTY_API_TOKEN || ''

/** Map Zelty restaurant ID → Yatai DB Restaurant.id */
const ZELTY_TO_YATAI: Record<number, number> = {
  4734: 1, // Yatai Choiseul → 2ème
  7041: 2, // Yatai Saint Honoré → 8ème
  6837: 3, // Yatai Chateaudun → 9ème (labo)
  7356: 4, // Yatai Bastille → 11ème
  // 14ème: pas de Zelty
}

type ZeltyOrder = {
  id: number
  id_restaurant: number
  created_at: string
  closed_at: string | null
  status: string
  mode: string // eat_in | delivery | takeaway
  price: { final_amount_inc_tax: number; final_amount_exc_tax: number } | null
}

type Aggregate = {
  zeltyId: number
  restaurantId: number
  totalHT: number
  totalTTC: number
  ordersCount: number
  eatInTTC: number
  takeawayTTC: number
  deliveryTTC: number
}

/** Fetch all orders for a date range, paginated, with retry on 429 */
async function fetchAllOrders(from: string, to: string): Promise<ZeltyOrder[]> {
  const all: ZeltyOrder[] = []
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
      throw new Error(`Zelty API ${res.status}: ${txt.slice(0, 200)}`)
    }
    const data = await res.json()
    const orders: ZeltyOrder[] = data.orders || []
    all.push(...orders)
    if (orders.length < limit) break
    offset += limit
    if (offset > 50000) break // safety cap
    // Throttle to avoid rate limit
    await new Promise(r => setTimeout(r, 300))
  }
  return all
}

/** GET — Sync Zelty sales for a given month */
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
    const orders = await fetchAllOrders(from, to)

    // Filter to closed orders only (don't count cancelled/draft) and orders we have a mapping for
    const aggs = new Map<number, Aggregate>()
    for (const o of orders) {
      if (o.status !== 'closed') continue
      const yataiId = ZELTY_TO_YATAI[o.id_restaurant]
      if (!yataiId) continue
      if (!o.price) continue

      // Filter by created_at month (Zelty 'from'/'to' uses created_at)
      const created = new Date(o.created_at)
      if (created.getFullYear() !== year || (created.getMonth() + 1) !== month) continue

      let agg = aggs.get(o.id_restaurant)
      if (!agg) {
        agg = {
          zeltyId: o.id_restaurant, restaurantId: yataiId,
          totalHT: 0, totalTTC: 0, ordersCount: 0,
          eatInTTC: 0, takeawayTTC: 0, deliveryTTC: 0,
        }
        aggs.set(o.id_restaurant, agg)
      }

      // Zelty amounts are in cents
      const ttc = (o.price.final_amount_inc_tax || 0) / 100
      const ht = (o.price.final_amount_exc_tax || 0) / 100
      agg.totalTTC += ttc
      agg.totalHT += ht
      agg.ordersCount += 1
      if (o.mode === 'eat_in') agg.eatInTTC += ttc
      else if (o.mode === 'delivery') agg.deliveryTTC += ttc
      else if (o.mode === 'takeaway') agg.takeawayTTC += ttc
    }

    const aggregates = Array.from(aggs.values()).map(a => ({
      ...a,
      totalHT: Math.round(a.totalHT * 100) / 100,
      totalTTC: Math.round(a.totalTTC * 100) / 100,
      eatInTTC: Math.round(a.eatInTTC * 100) / 100,
      takeawayTTC: Math.round(a.takeawayTTC * 100) / 100,
      deliveryTTC: Math.round(a.deliveryTTC * 100) / 100,
    }))

    let saved = false
    if (save && aggregates.length > 0) {
      const prisma = await db()
      for (const a of aggregates) {
        await prisma.zeltySale.upsert({
          where: { year_month_restaurantId: { year, month, restaurantId: a.restaurantId } },
          create: {
            year, month, restaurantId: a.restaurantId, zeltyId: a.zeltyId,
            totalHT: a.totalHT, totalTTC: a.totalTTC, ordersCount: a.ordersCount,
            eatInTTC: a.eatInTTC, takeawayTTC: a.takeawayTTC, deliveryTTC: a.deliveryTTC,
            syncedAt: new Date(),
          },
          update: {
            zeltyId: a.zeltyId, totalHT: a.totalHT, totalTTC: a.totalTTC, ordersCount: a.ordersCount,
            eatInTTC: a.eatInTTC, takeawayTTC: a.takeawayTTC, deliveryTTC: a.deliveryTTC,
            syncedAt: new Date(),
          },
        })
      }
      saved = true
    }

    const totalHT = aggregates.reduce((s, a) => s + a.totalHT, 0)
    const totalTTC = aggregates.reduce((s, a) => s + a.totalTTC, 0)
    const ordersCount = aggregates.reduce((s, a) => s + a.ordersCount, 0)

    return NextResponse.json({
      year, month, from, to,
      totalHT: Math.round(totalHT * 100) / 100,
      totalTTC: Math.round(totalTTC * 100) / 100,
      ordersCount,
      restaurantsCount: aggregates.length,
      restaurants: aggregates,
      saved,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
