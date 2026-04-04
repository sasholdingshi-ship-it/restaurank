import { db } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

export async function GET() {
  const prisma = await db()
  const smic = await prisma.smicConfig.findFirst()
  return NextResponse.json(smic || { hourlyRate: 16.33, monthlyRate: null })
}

export async function PUT(req: NextRequest) {
  const prisma = await db()
  const body = await req.json()
  const { hourlyRate, monthlyRate } = body
  const existing = await prisma.smicConfig.findFirst()
  let smic
  if (existing) {
    smic = await prisma.smicConfig.update({ where: { id: existing.id }, data: { hourlyRate: hourlyRate ?? existing.hourlyRate, monthlyRate: monthlyRate ?? null } })
  } else {
    smic = await prisma.smicConfig.create({ data: { hourlyRate: hourlyRate ?? 16.33, monthlyRate: monthlyRate ?? null } })
  }
  return NextResponse.json(smic)
}
