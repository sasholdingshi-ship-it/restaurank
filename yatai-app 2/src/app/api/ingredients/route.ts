import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams.get('search') || ''
  const ingredients = await prisma.ingredient.findMany({
    where: search ? { name: { contains: search } } : undefined,
    orderBy: { ref: 'asc' },
  })
  return NextResponse.json(ingredients)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const ingredient = await prisma.ingredient.create({ data: body })
  return NextResponse.json(ingredient, { status: 201 })
}

export async function PUT(req: NextRequest) {
  const body = await req.json()
  const { id, ...data } = body
  const ingredient = await prisma.ingredient.update({ where: { id }, data })
  return NextResponse.json(ingredient)
}
