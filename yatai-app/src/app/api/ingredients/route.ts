import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

// Get SMIC hourly rate: mensuel × 12 / 11 / 151.67 (CP compris)
async function getSmicHourly(): Promise<number> {
  const smic = await prisma.smicConfig.findFirst()
  if (smic?.monthlyRate) return (smic.monthlyRate * 12) / 11 / 151.67
  return smic?.hourlyRate ?? 16.33
}

// Recalculate a recipe's costPerUnit, sellingPrice, and cascade to Product
async function recalcRecipe(recipeId: number, hourlyRate: number) {
  const recipe = await prisma.recipe.findUnique({
    where: { id: recipeId },
    include: { ingredients: true },
  })
  if (!recipe) return

  // F41 = SUM(amounts) — sous-total ingrédients
  const subtotal = recipe.ingredients.reduce((sum, ri) => sum + ri.amount, 0)
  // F42 = F41 × alea%
  const aleaAmount = subtotal * (recipe.aleaPercent ?? 0.02)
  // F43 = F41 + F42
  const totalWithAlea = subtotal + aleaAmount
  // D47 = SMIC × heures (laborTime is in hours)
  const laborCost = (recipe.laborTime ?? 0) * hourlyRate
  // D50 = (D47 + F43) / portions
  const portions = recipe.portions && recipe.portions > 0 ? recipe.portions : 1
  const costPerUnit = (laborCost + totalWithAlea) / portions
  // D52 = D50 × (1 + marge%)
  const marginRate = recipe.margin ?? 0
  const sellingPrice = costPerUnit * (1 + marginRate)

  await prisma.recipe.update({
    where: { id: recipeId },
    data: { costPerUnit, sellingPrice },
  })

  // Cascade to Product (Recap prix): Product.priceHt = D52
  await prisma.product.updateMany({
    where: { ref: recipe.ref },
    data: { priceHt: sellingPrice },
  })

  // Cascade to sub-recipe ingredients: if this recipe's costPerUnit is used
  // as netPriceKg of an ingredient in Mercurial (sous-recette pattern)
  // Update ingredient whose ref matches and has no direct price
  // This is handled by the sub-recipe link in the Mercurial

  return { costPerUnit, sellingPrice }
}

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

  // Recalculate derived prices (Excel Mercurial formulas)
  const priceTtc = data.priceTtc ?? null
  const weight = data.weight ?? null
  const lossPercent = data.lossPercent ?? 0

  // E = D / 1.055 (TTC → HT)
  let priceHt = data.priceHt ?? null
  if (!priceHt && priceTtc) {
    priceHt = priceTtc / 1.055
    data.priceHt = priceHt
  }

  // G = IFERROR(E / F, 0) — prix HT au kg
  let pricePerKg: number | null = null
  if (priceHt && weight && weight > 0) {
    pricePerKg = priceHt / weight
  }

  // I = G - H — prix net HT au kg (subtraction, per Excel formula)
  let netPriceKg: number | null = null
  if (pricePerKg !== null) {
    netPriceKg = pricePerKg - lossPercent
  }

  data.pricePerKg = pricePerKg
  data.netPriceKg = netPriceKg

  const ingredient = await prisma.ingredient.update({ where: { id }, data })

  // Cascade: update all RecipeIngredients using this ingredient
  // C12 = VLOOKUP(ref, Mercurial!B:I, 8) → netPriceKg
  // F12 = C12 × D12
  const recipeIngredients = await prisma.recipeIngredient.findMany({
    where: { ingredientId: id },
  })

  const affectedRecipeIds = new Set<number>()

  for (const ri of recipeIngredients) {
    const newUnitPrice = netPriceKg ?? 0
    const newAmount = ri.quantity * newUnitPrice
    await prisma.recipeIngredient.update({
      where: { id: ri.id },
      data: { unitPrice: newUnitPrice, amount: newAmount },
    })
    affectedRecipeIds.add(ri.recipeId)
  }

  // Cascade: recalculate costPerUnit, sellingPrice, and Product.priceHt
  const hourlyRate = await getSmicHourly()

  for (const recipeId of affectedRecipeIds) {
    await recalcRecipe(recipeId, hourlyRate)
  }

  return NextResponse.json({
    ...ingredient,
    _cascadeUpdated: affectedRecipeIds.size,
  })
}
