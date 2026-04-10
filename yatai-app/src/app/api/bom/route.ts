import { db } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { createSnapshot } from '@/lib/snapshots'

type IngredientInput = {
  name: string
  qtyPerPortion: number
  unit?: string | null
  yataiProductKeywords?: string[]
}

// GET /api/bom → list all DishBoms with their ingredients
// GET /api/bom?id=1 → single DishBom
export async function GET(req: NextRequest) {
  const prisma = await db()
  const idParam = req.nextUrl.searchParams.get('id')
  if (idParam) {
    const bom = await prisma.dishBom.findUnique({
      where: { id: parseInt(idParam) },
      include: { ingredients: true },
    })
    if (!bom) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({
      ...bom,
      zeltyKeywords: JSON.parse(bom.zeltyKeywords),
      ingredients: bom.ingredients.map(i => ({
        ...i,
        yataiProductKeywords: JSON.parse(i.yataiProductKeywords),
      })),
    })
  }
  const boms = await prisma.dishBom.findMany({
    include: { ingredients: true },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  })
  return NextResponse.json(
    boms.map(b => ({
      ...b,
      zeltyKeywords: JSON.parse(b.zeltyKeywords),
      ingredients: b.ingredients.map(i => ({
        ...i,
        yataiProductKeywords: JSON.parse(i.yataiProductKeywords),
      })),
    })),
  )
}

// POST /api/bom { name, category, zeltyKeywords[], isALaCarte, ingredients[] }
export async function POST(req: NextRequest) {
  const prisma = await db()
  const body = await req.json()
  const { name, category, zeltyKeywords, isALaCarte, ingredients } = body
  if (!name || !category) {
    return NextResponse.json({ error: 'name and category required' }, { status: 400 })
  }
  await createSnapshot(prisma, 'DishBom', `Auto-save avant création "${name}"`)
  const bom = await prisma.dishBom.create({
    data: {
      name,
      category,
      zeltyKeywords: JSON.stringify(Array.isArray(zeltyKeywords) ? zeltyKeywords : []),
      isALaCarte: Boolean(isALaCarte),
    },
  })
  if (Array.isArray(ingredients)) {
    for (const ing of ingredients as IngredientInput[]) {
      await prisma.dishBomIngredient.create({
        data: {
          dishBomId: bom.id,
          name: ing.name,
          qtyPerPortion: ing.qtyPerPortion || 0,
          unit: ing.unit || null,
          yataiProductKeywords: JSON.stringify(
            Array.isArray(ing.yataiProductKeywords) ? ing.yataiProductKeywords : [],
          ),
        },
      })
    }
  }
  return NextResponse.json({ id: bom.id }, { status: 201 })
}

// PUT /api/bom { id, name?, category?, zeltyKeywords?, isALaCarte?, ingredients? }
// If ingredients is provided, all existing ingredients are replaced.
export async function PUT(req: NextRequest) {
  const prisma = await db()
  const body = await req.json()
  const { id, name, category, zeltyKeywords, isALaCarte, ingredients } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const existing = await prisma.dishBom.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await createSnapshot(prisma, 'DishBom', `Auto-save avant édition "${existing.name}"`)

  const data: {
    name?: string
    category?: string
    zeltyKeywords?: string
    isALaCarte?: boolean
  } = {}
  if (name !== undefined) data.name = name
  if (category !== undefined) data.category = category
  if (zeltyKeywords !== undefined) data.zeltyKeywords = JSON.stringify(Array.isArray(zeltyKeywords) ? zeltyKeywords : [])
  if (isALaCarte !== undefined) data.isALaCarte = Boolean(isALaCarte)

  await prisma.dishBom.update({ where: { id }, data })

  if (Array.isArray(ingredients)) {
    await prisma.dishBomIngredient.deleteMany({ where: { dishBomId: id } })
    for (const ing of ingredients as IngredientInput[]) {
      await prisma.dishBomIngredient.create({
        data: {
          dishBomId: id,
          name: ing.name,
          qtyPerPortion: ing.qtyPerPortion || 0,
          unit: ing.unit || null,
          yataiProductKeywords: JSON.stringify(
            Array.isArray(ing.yataiProductKeywords) ? ing.yataiProductKeywords : [],
          ),
        },
      })
    }
  }
  return NextResponse.json({ ok: true })
}

// DELETE /api/bom?id=1
export async function DELETE(req: NextRequest) {
  const prisma = await db()
  const idParam = req.nextUrl.searchParams.get('id')
  if (!idParam) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const id = parseInt(idParam)
  const existing = await prisma.dishBom.findUnique({ where: { id } })
  if (existing) {
    await createSnapshot(prisma, 'DishBom', `Auto-save avant suppression "${existing.name}"`)
  }
  await prisma.dishBom.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
