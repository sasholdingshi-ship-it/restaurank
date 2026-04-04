import { db } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const file = formData.get('image') as File
  const restaurantId = parseInt(formData.get('restaurantId') as string || '0')
  const year = parseInt(formData.get('year') as string || '0')
  const month = parseInt(formData.get('month') as string || '0')
  const day = parseInt(formData.get('day') as string || '0')

  if (!file || !restaurantId || !year || !month || !day) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const prisma = await db()
  const products = await prisma.product.findMany({ orderBy: { ref: 'asc' } })
  const productList = products.map(p => `${p.ref}: ${p.name} (${p.unit || 'unité'})`).join('\n')

  const bytes = await file.arrayBuffer()
  const base64 = Buffer.from(bytes).toString('base64')
  const mimeType = file.type || 'image/jpeg'

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514', max_tokens: 4096,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
        { type: 'text', text: `Analyse cette photo de bon de commande manuscrit pour un restaurant japonais Yatai.\n\nExtrais chaque ligne: nom du produit et quantité commandée.\n\nVoici la liste de tous les produits possibles (réf: nom):\n${productList}\n\nIMPORTANT:\n- L'écriture manuscrite peut être difficile à lire. Sois attentif aux confusions courantes: 1↔7, 3↔8, 0↔6, etc.\n- Associe chaque produit trouvé à sa référence (P001, P002, etc.)\n- Si tu n'es pas sûr d'une quantité, indique-le\n\nRéponds UNIQUEMENT en JSON:\n{\n  "entries": [\n    {"ref": "P012", "name": "Bouillon porc", "quantity": 50, "confidence": "high"}\n  ],\n  "notes": "remarques éventuelles"\n}` },
      ]}],
    }),
  })

  if (!response.ok) return NextResponse.json({ error: `Claude API error: ${await response.text()}` }, { status: 500 })

  const result = await response.json()
  const textContent = result.content?.find((c: { type: string }) => c.type === 'text')?.text || ''

  try {
    const jsonMatch = textContent.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return NextResponse.json({ error: 'Could not parse OCR result', raw: textContent }, { status: 500 })
    const parsed = JSON.parse(jsonMatch[0])
    const productByRef = new Map(products.map(p => [p.ref, p]))
    const enriched = parsed.entries.map((entry: { ref: string; name: string; quantity: number; confidence: string }) => {
      const product = productByRef.get(entry.ref)
      return { ...entry, productId: product?.id || null, priceHt: product?.priceHt || null, unit: product?.unit || null }
    })
    return NextResponse.json({ entries: enriched, notes: parsed.notes, day, restaurantId, year, month })
  } catch {
    return NextResponse.json({ error: 'JSON parse error', raw: textContent }, { status: 500 })
  }
}
