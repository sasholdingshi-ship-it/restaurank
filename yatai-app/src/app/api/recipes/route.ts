import { db } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const prisma = await db()
  const category = req.nextUrl.searchParams.get('category')
  const recipes = await prisma.recipe.findMany({
    where: category ? { category } : undefined,
    include: { ingredients: { include: { ingredient: true } } },
    orderBy: { ref: 'asc' },
  })
  return NextResponse.json(recipes)
}

export async function PUT(req: NextRequest) {
  const prisma = await db()
  const body = await req.json()
  const { id, margin, aleaPercent, laborTime, portions } = body
  const recipe = await prisma.recipe.findUnique({ where: { id }, include: { ingredients: true } })
  if (!recipe) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const subtotal = recipe.ingredients.reduce((s, ri) => s + ri.amount, 0)
  const newAlea = aleaPercent ?? recipe.aleaPercent ?? 0.02
  const newLabor = laborTime ?? recipe.laborTime ?? 0
  const newPortions = portions ?? recipe.portions ?? 1
  const newMargin = margin ?? recipe.margin ?? 0
  const smic = await prisma.smicConfig.findFirst()
  const hourlyRate = smic?.monthlyRate ? (smic.monthlyRate * 12) / 11 / 151.67 : smic?.hourlyRate ?? 16.33
  const costPerUnit = (newLabor * hourlyRate + subtotal * (1 + newAlea)) / (newPortions || 1)
  const sellingPrice = costPerUnit * (1 + newMargin)
  const updated = await prisma.recipe.update({
    where: { id }, data: { margin: newMargin, aleaPercent: newAlea, laborTime: newLabor, portions: newPortions, costPerUnit, sellingPrice },
  })
  await prisma.product.updateMany({ where: { ref: recipe.ref }, data: { priceHt: sellingPrice } })
  return NextResponse.json(updated)
}
