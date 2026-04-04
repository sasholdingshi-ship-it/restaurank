import { db } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

export async function PUT(req: NextRequest) {
  const prisma = await db()
  const { restaurantId, year, month, stuartPrice, stuartQty, livraisonPrice, livraisonQty } = await req.json()
  if (!restaurantId || !year || !month) return NextResponse.json({ error: 'restaurantId, year, month required' }, { status: 400 })

  const order = await prisma.order.upsert({
    where: { restaurantId_year_month: { restaurantId, year, month } },
    create: { restaurantId, year, month, stuartPrice: stuartPrice ?? 0, stuartQty: stuartQty ?? 0, livraisonPrice: livraisonPrice ?? 0, livraisonQty: livraisonQty ?? 0 },
    update: { stuartPrice: stuartPrice ?? 0, stuartQty: stuartQty ?? 0, livraisonPrice: livraisonPrice ?? 0, livraisonQty: livraisonQty ?? 0 },
  })

  return NextResponse.json(order)
}
