import { db } from '@/lib/prisma'
import { NextResponse } from 'next/server'

/** Recalculate all recipe costs and selling prices, cascade to products */
export async function POST() {
  const prisma = await db()
  const smic = await prisma.smicConfig.findFirst()
  const hourlyRate = smic?.monthlyRate ? (smic.monthlyRate * 12) / 11 / 151.67 : smic?.hourlyRate ?? 16.33
  const recipes = await prisma.recipe.findMany({ include: { ingredients: true } })
  let updated = 0
  for (const r of recipes) {
    const subtotal = r.ingredients.reduce((s, ri) => s + ri.amount, 0)
    const costPerUnit = ((r.laborTime ?? 0) * hourlyRate + subtotal * (1 + (r.aleaPercent ?? 0.02))) / ((r.portions ?? 1) || 1)
    const sellingPrice = costPerUnit * (1 + (r.margin ?? 0))
    await prisma.recipe.update({ where: { id: r.id }, data: { costPerUnit, sellingPrice } })
    await prisma.product.updateMany({ where: { ref: r.ref }, data: { priceHt: sellingPrice } })
    updated++
  }
  return NextResponse.json({ updated, hourlyRate })
}
