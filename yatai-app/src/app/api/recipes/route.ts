import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const category = req.nextUrl.searchParams.get('category')
  const recipes = await prisma.recipe.findMany({
    where: category ? { category } : undefined,
    include: { ingredients: { include: { ingredient: true } } },
    orderBy: { ref: 'asc' },
  })
  return NextResponse.json(recipes)
}

export async function PUT(req: NextRequest) {
  const body = await req.json()
  const { id, ...data } = body

  // Update recipe fields
  const recipe = await prisma.recipe.update({
    where: { id },
    data,
    include: { ingredients: true },
  })

  // Recalculate costPerUnit and sellingPrice
  const smic = await prisma.smicConfig.findFirst()
  const hourlyRate = smic?.monthlyRate
    ? (smic.monthlyRate * 12) / 11 / 151.67
    : smic?.hourlyRate ?? 16.33

  const subtotal = recipe.ingredients.reduce((sum, ri) => sum + ri.amount, 0)
  const aleaAmount = subtotal * (recipe.aleaPercent ?? 0.02)
  const totalWithAlea = subtotal + aleaAmount
  const laborCost = (recipe.laborTime ?? 0) * hourlyRate
  const portions = recipe.portions && recipe.portions > 0 ? recipe.portions : 1
  const costPerUnit = (laborCost + totalWithAlea) / portions
  const marginRate = recipe.margin ?? 0
  const sellingPrice = costPerUnit * (1 + marginRate)

  const updated = await prisma.recipe.update({
    where: { id },
    data: { costPerUnit, sellingPrice },
    include: { ingredients: { include: { ingredient: true } } },
  })

  // Cascade to Product.priceHt
  await prisma.product.updateMany({
    where: { ref: recipe.ref },
    data: { priceHt: sellingPrice },
  })

  return NextResponse.json(updated)
}
