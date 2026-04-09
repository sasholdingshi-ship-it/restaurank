import { db } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

export async function GET() {
  const prisma = await db()
  const restaurants = await prisma.restaurant.findMany({ orderBy: { code: 'asc' } })
  return NextResponse.json(restaurants)
}

export async function POST(req: NextRequest) {
  const prisma = await db()
  const body = await req.json()
  const { code, name, arrondissement, siren, deliveryPrice, tvaRate } = body
  if (!code || !name || !arrondissement) return NextResponse.json({ error: 'Code, nom et arrondissement requis' }, { status: 400 })
  try {
    const restaurant = await prisma.restaurant.create({
      data: { code, name, arrondissement, siren: siren || null, deliveryPrice: deliveryPrice ?? 25, tvaRate: tvaRate ?? 0.055 },
    })
    return NextResponse.json(restaurant, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: `Code "${code}" deja utilise` }, { status: 409 })
  }
}

export async function PUT(req: NextRequest) {
  const prisma = await db()
  const body = await req.json()
  const { id, ...data } = body
  if (!id) return NextResponse.json({ error: 'ID requis' }, { status: 400 })
  const restaurant = await prisma.restaurant.update({ where: { id }, data })
  return NextResponse.json(restaurant)
}

export async function DELETE(req: NextRequest) {
  const prisma = await db()
  const id = parseInt(req.nextUrl.searchParams.get('id') || '0')
  if (!id) return NextResponse.json({ error: 'ID requis' }, { status: 400 })
  // Delete related orders first
  const orders = await prisma.order.findMany({ where: { restaurantId: id } })
  for (const o of orders) {
    await prisma.orderItem.deleteMany({ where: { orderId: o.id } })
  }
  await prisma.order.deleteMany({ where: { restaurantId: id } })
  await prisma.restaurant.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
