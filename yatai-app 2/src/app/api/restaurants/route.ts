import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export async function GET() {
  const restaurants = await prisma.restaurant.findMany({ orderBy: { code: 'asc' } })
  return NextResponse.json(restaurants)
}
