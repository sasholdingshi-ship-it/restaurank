import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

// Full cascade recalculation: Mercurial → Fiches techniques → Recap prix
// Reproduces all Excel formulas in the correct order
export async function POST() {
  const smic = await prisma.smicConfig.findFirst()
  const hourlyRate = smic?.monthlyRate
    ? (smic.monthlyRate * 12) / 11 / 151.67
    : smic?.hourlyRate ?? 16.33

  // Step 1: Recalculate all ingredient derived prices
  const ingredients = await prisma.ingredient.findMany()
  let ingredientCount = 0
  for (const ing of ingredients) {
    const priceTtc = ing.priceTtc
    let priceHt = ing.priceHt
    if (!priceHt && priceTtc) priceHt = priceTtc / 1.055

    let pricePerKg: number | null = null
    if (priceHt && ing.weight && ing.weight > 0) pricePerKg = priceHt / ing.weight

    let netPriceKg: number | null = null
    if (pricePerKg !== null) netPriceKg = pricePerKg - (ing.lossPercent ?? 0)

    await prisma.ingredient.update({
      where: { id: ing.id },
      data: { priceHt, pricePerKg, netPriceKg },
    })
    ingredientCount++
  }

  // Step 2: Recalculate all RecipeIngredient unitPrice and amount
  const recipeIngredients = await prisma.recipeIngredient.findMany({
    include: { ingredient: true },
  })
  let riCount = 0
  for (const ri of recipeIngredients) {
    const newUnitPrice = ri.ingredient?.netPriceKg ?? ri.unitPrice
    const newAmount = ri.quantity * newUnitPrice
    await prisma.recipeIngredient.update({
      where: { id: ri.id },
      data: { unitPrice: newUnitPrice, amount: newAmount },
    })
    riCount++
  }

  // Step 3: Recalculate all recipes costPerUnit and sellingPrice
  const recipes = await prisma.recipe.findMany({ include: { ingredients: true } })
  let recipeCount = 0
  for (const recipe of recipes) {
    const subtotal = recipe.ingredients.reduce((sum, ri) => sum + ri.amount, 0)
    const aleaAmount = subtotal * (recipe.aleaPercent ?? 0.02)
    const totalWithAlea = subtotal + aleaAmount
    const laborCost = (recipe.laborTime ?? 0) * hourlyRate
    const portions = recipe.portions && recipe.portions > 0 ? recipe.portions : 1
    const costPerUnit = (laborCost + totalWithAlea) / portions
    const marginRate = recipe.margin ?? 0
    const sellingPrice = costPerUnit * (1 + marginRate)

    await prisma.recipe.update({
      where: { id: recipe.id },
      data: { costPerUnit, sellingPrice },
    })

    // Update linked Product
    await prisma.product.updateMany({
      where: { ref: recipe.ref },
      data: { priceHt: sellingPrice },
    })
    recipeCount++
  }

  // Step 4: Handle sub-recipe ingredients (Mercurial col I = D50 of another recipe)
  // These are ingredients whose netPriceKg should be the costPerUnit of a linked recipe
  // Re-fetch updated recipes
  const updatedRecipes = await prisma.recipe.findMany()
  const recipeCostByRef = new Map(updatedRecipes.map(r => [r.ref, r.costPerUnit]))

  // Find ingredients that match recipe refs (sub-recipe pattern)
  const allIngredients = await prisma.ingredient.findMany()
  let subRecipeCount = 0
  for (const ing of allIngredients) {
    // Check if any recipe has a ref that matches this ingredient's name pattern
    const matchingRef = updatedRecipes.find(r =>
      ing.name.toLowerCase().includes(r.name.toLowerCase()) ||
      r.name.toLowerCase().includes(ing.name.toLowerCase())
    )
    if (matchingRef && matchingRef.costPerUnit !== null) {
      await prisma.ingredient.update({
        where: { id: ing.id },
        data: { netPriceKg: matchingRef.costPerUnit },
      })
      subRecipeCount++
    }
  }

  return NextResponse.json({
    ingredients: ingredientCount,
    recipeIngredients: riCount,
    recipes: recipeCount,
    subRecipes: subRecipeCount,
    smicHourly: hourlyRate,
  })
}
