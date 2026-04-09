import { db } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

async function getSmicHourly(): Promise<number> {
  const prisma = await db()
  const smic = await prisma.smicConfig.findFirst()
  if (smic?.monthlyRate) return (smic.monthlyRate * 12) / 11 / 151.67
  return smic?.hourlyRate ?? 16.33
}

async function recalcRecipe(recipeId: number, hourlyRate: number) {
  const prisma = await db()
  const recipe = await prisma.recipe.findUnique({ where: { id: recipeId }, include: { ingredients: true } })
  if (!recipe) return
  const subtotal = recipe.ingredients.reduce((sum, ri) => sum + ri.amount, 0)
  const totalWithAlea = subtotal * (1 + (recipe.aleaPercent ?? 0.02))
  const laborCost = (recipe.laborTime ?? 0) * hourlyRate
  const portions = recipe.portions && recipe.portions > 0 ? recipe.portions : 1
  const costPerUnit = (laborCost + totalWithAlea) / portions
  const sellingPrice = costPerUnit * (1 + (recipe.margin ?? 0))
  await prisma.recipe.update({ where: { id: recipeId }, data: { costPerUnit, sellingPrice } })
  await prisma.product.updateMany({ where: { ref: recipe.ref }, data: { priceHt: sellingPrice } })
  return { costPerUnit, sellingPrice }
}

export async function GET(req: NextRequest) {
  const prisma = await db()
  const search = req.nextUrl.searchParams.get('search') || ''
  const ingredients = await prisma.ingredient.findMany({
    where: search ? { name: { contains: search } } : undefined,
    orderBy: { ref: 'asc' },
  })
  return NextResponse.json(ingredients)
}

export async function POST(req: NextRequest) {
  const prisma = await db()
  const body = await req.json()
  const ingredient = await prisma.ingredient.create({ data: body })
  return NextResponse.json(ingredient, { status: 201 })
}

export async function PUT(req: NextRequest) {
  const prisma = await db()
  const body = await req.json()
  const { id, ...data } = body
  const priceTtc = data.priceTtc ?? null
  const weight = data.weight ?? null
  const lossPercent = data.lossPercent ?? 0
  let priceHt = data.priceHt ?? null
  if (!priceHt && priceTtc) { priceHt = priceTtc / 1.055; data.priceHt = priceHt }
  let pricePerKg: number | null = null
  if (priceHt && weight && weight > 0) pricePerKg = priceHt / weight
  let netPriceKg: number | null = null
  if (pricePerKg !== null) netPriceKg = pricePerKg - lossPercent
  data.pricePerKg = pricePerKg
  data.netPriceKg = netPriceKg
  const ingredient = await prisma.ingredient.update({ where: { id }, data })
  const recipeIngredients = await prisma.recipeIngredient.findMany({ where: { ingredientId: id } })
  const affectedRecipeIds = new Set<number>()
  for (const ri of recipeIngredients) {
    const newUnitPrice = netPriceKg ?? 0
    await prisma.recipeIngredient.update({ where: { id: ri.id }, data: { unitPrice: newUnitPrice, amount: ri.quantity * newUnitPrice } })
    affectedRecipeIds.add(ri.recipeId)
  }
  const hourlyRate = await getSmicHourly()
  for (const recipeId of affectedRecipeIds) await recalcRecipe(recipeId, hourlyRate)
  return NextResponse.json({ ...ingredient, _cascadeUpdated: affectedRecipeIds.size })
}
