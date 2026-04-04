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
