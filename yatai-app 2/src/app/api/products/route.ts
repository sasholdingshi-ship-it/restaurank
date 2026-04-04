import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams.get('search') || ''
  const products = await prisma.product.findMany({
    where: search ? { name: { contains: search } } : undefined,
    orderBy: { ref: 'asc' },
  })
  return NextResponse.json(products)
}

export async function PUT(req: NextRequest) {
  const body = await req.json()
  const { id, ...data } = body
  const product = await prisma.product.update({ where: { id }, data })
  return NextResponse.json(product)
}
