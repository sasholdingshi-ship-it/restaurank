import { PrismaClient } from '@prisma/client'

// Central definition of snapshot-able entities.
// Each entity knows how to dump itself to JSON and restore from JSON.
export type SnapshotEntity = 'DishBom'

type DishBomDump = {
  name: string
  category: string
  zeltyKeywords: string
  isALaCarte: boolean
  ingredients: {
    name: string
    qtyPerPortion: number
    unit: string | null
    yataiProductKeywords: string
  }[]
}

/** Dump all rows of an entity to a JSON string suitable for storage. */
export async function dumpEntity(prisma: PrismaClient, entity: SnapshotEntity): Promise<string> {
  if (entity === 'DishBom') {
    const rows = await prisma.dishBom.findMany({ include: { ingredients: true } })
    const dump: DishBomDump[] = rows.map(r => ({
      name: r.name,
      category: r.category,
      zeltyKeywords: r.zeltyKeywords,
      isALaCarte: r.isALaCarte,
      ingredients: r.ingredients.map(i => ({
        name: i.name,
        qtyPerPortion: i.qtyPerPortion,
        unit: i.unit,
        yataiProductKeywords: i.yataiProductKeywords,
      })),
    }))
    return JSON.stringify(dump)
  }
  throw new Error(`Unknown entity: ${entity}`)
}

/** Restore all rows of an entity from a JSON string (destructive: replaces existing data). */
export async function restoreEntity(prisma: PrismaClient, entity: SnapshotEntity, data: string): Promise<number> {
  if (entity === 'DishBom') {
    const parsed = JSON.parse(data) as DishBomDump[]
    // Wipe existing (cascade deletes ingredients)
    await prisma.dishBomIngredient.deleteMany()
    await prisma.dishBom.deleteMany()
    // Recreate
    let n = 0
    for (const d of parsed) {
      await prisma.dishBom.create({
        data: {
          name: d.name,
          category: d.category,
          zeltyKeywords: d.zeltyKeywords,
          isALaCarte: d.isALaCarte,
          ingredients: {
            create: d.ingredients.map(i => ({
              name: i.name,
              qtyPerPortion: i.qtyPerPortion,
              unit: i.unit,
              yataiProductKeywords: i.yataiProductKeywords,
            })),
          },
        },
      })
      n++
    }
    return n
  }
  throw new Error(`Unknown entity: ${entity}`)
}

/** Create a snapshot for an entity with a label. Returns the new snapshot id. */
export async function createSnapshot(prisma: PrismaClient, entity: SnapshotEntity, label: string): Promise<number> {
  const data = await dumpEntity(prisma, entity)
  const snap = await prisma.snapshot.create({ data: { entity, label, data } })
  // Prune: keep last 20 snapshots per entity to avoid bloat
  const all = await prisma.snapshot.findMany({
    where: { entity },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  const toDelete = all.slice(20).map(s => s.id)
  if (toDelete.length > 0) {
    await prisma.snapshot.deleteMany({ where: { id: { in: toDelete } } })
  }
  return snap.id
}
