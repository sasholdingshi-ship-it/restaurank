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

export async function POST(req: NextRequest) {
  const prisma = await db()
  const body = await req.json()
  const { ref, name, category, unit, portions, laborTime, aleaPercent, margin, ingredients: ingList } = body
  if (!ref || !name) return NextResponse.json({ error: 'ref and name required' }, { status: 400 })
  const recipe = await prisma.recipe.create({
    data: { ref, name, category: category || null, unit: unit || null, portions: portions || null, laborTime: laborTime || null, aleaPercent: aleaPercent ?? 0.02, margin: margin || null },
  })
  // Create recipe ingredients if provided
  if (ingList && Array.isArray(ingList)) {
    for (const ri of ingList) {
      await prisma.recipeIngredient.create({
        data: { recipeId: recipe.id, ingredientId: ri.ingredientId || null, ingredientRef: ri.ingredientRef || null, quantity: ri.quantity || 0, unitPrice: ri.unitPrice || 0, amount: ri.amount || 0, unit: ri.unit || null },
      })
    }
  }
  // Recalculate cost
  const smic = await prisma.smicConfig.findFirst()
  const hourlyRate = smic?.monthlyRate ? (smic.monthlyRate * 12) / 11 / 151.67 : smic?.hourlyRate ?? 16.33
  const recipeWithIngs = await prisma.recipe.findUnique({ where: { id: recipe.id }, include: { ingredients: true } })
  if (recipeWithIngs) {
    const subtotal = recipeWithIngs.ingredients.reduce((s, ri) => s + ri.amount, 0)
    const costPerUnit = ((recipeWithIngs.laborTime ?? 0) * hourlyRate + subtotal * (1 + (recipeWithIngs.aleaPercent ?? 0.02))) / ((recipeWithIngs.portions ?? 1) || 1)
    const sellingPrice = costPerUnit * (1 + (recipeWithIngs.margin ?? 0))
    await prisma.recipe.update({ where: { id: recipe.id }, data: { costPerUnit, sellingPrice } })
    // Create matching product
    await prisma.product.create({ data: { ref, name, priceHt: sellingPrice, unit: unit || null } }).catch(() => {})
  }
  return NextResponse.json(recipe, { status: 201 })
}

export async function PUT(req: NextRequest) {
  const prisma = await db()
  const body = await req.json()
  const { id, name, margin, aleaPercent, laborTime, portions, sellingPrice: manualPrice } = body
  const recipe = await prisma.recipe.findUnique({ where: { id }, include: { ingredients: true } })
  if (!recipe) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const subtotal = recipe.ingredients.reduce((s, ri) => s + ri.amount, 0)
  const newAlea = aleaPercent ?? recipe.aleaPercent ?? 0.02
  const newLabor = laborTime ?? recipe.laborTime ?? 0
  const newPortions = portions ?? recipe.portions ?? 1
  const newMargin = margin ?? recipe.margin ?? 0
  const newName = name ?? recipe.name
  const smic = await prisma.smicConfig.findFirst()
  const hourlyRate = smic?.monthlyRate ? (smic.monthlyRate * 12) / 11 / 151.67 : smic?.hourlyRate ?? 16.33
  const costPerUnit = (newLabor * hourlyRate + subtotal * (1 + newAlea)) / (newPortions || 1)
  // Manual selling price override — if provided, use it; otherwise compute from formula
  const sellingPrice = manualPrice != null ? manualPrice : costPerUnit * (1 + newMargin)
  const updated = await prisma.recipe.update({
    where: { id }, data: { name: newName, margin: newMargin, aleaPercent: newAlea, laborTime: newLabor, portions: newPortions, costPerUnit, sellingPrice },
  })
  // Cascade to matching product (by ref)
  const productUpdate: Record<string, unknown> = { priceHt: sellingPrice }
  if (name && name !== recipe.name) productUpdate.name = newName
  await prisma.product.updateMany({ where: { ref: recipe.ref }, data: productUpdate })
  return NextResponse.json(updated)
}
