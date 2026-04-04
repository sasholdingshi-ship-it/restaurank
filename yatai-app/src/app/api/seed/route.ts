import { NextResponse } from 'next/server'
import { db } from '@/lib/prisma'

export async function GET() {
  try {
    const prisma = await db()
    const restaurants = await prisma.restaurant.findMany()
    const ingredients = await prisma.ingredient.findMany({ take: 3 })
    const products = await prisma.product.findMany({ take: 3 })
    return NextResponse.json({
      restaurants: restaurants.length,
      ingredients: ingredients.length,
      products: products.length,
      sample: restaurants.map(r => r.name),
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
