import { prisma } from '@/lib/prisma'
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

  // Get all products for context
  const products = await prisma.product.findMany({ orderBy: { ref: 'asc' } })
  const productList = products.map(p => `${p.ref}: ${p.name} (${p.unit || 'unité'})`).join('\n')

  // Convert image to base64
  const bytes = await file.arrayBuffer()
  const base64 = Buffer.from(bytes).toString('base64')
  const mimeType = file.type || 'image/jpeg'

  // Call Claude API for OCR
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: base64 },
          },
          {
            type: 'text',
            text: `Analyse cette photo de bon de commande manuscrit pour un restaurant japonais Yatai.

Extrais chaque ligne: nom du produit et quantité commandée.

Voici la liste de tous les produits possibles (réf: nom):
${productList}

IMPORTANT:
- L'écriture manuscrite peut être difficile à lire. Sois attentif aux confusions courantes: 1↔7, 3↔8, 0↔6, etc.
- Associe chaque produit trouvé à sa référence (P001, P002, etc.) dans la liste ci-dessus
- Si tu n'es pas sûr d'une quantité, indique-le

Réponds UNIQUEMENT en JSON avec ce format:
{
  "entries": [
    {"ref": "P012", "name": "Bouillon porc", "quantity": 50, "confidence": "high"},
    {"ref": "P030", "name": "Gyoza porc", "quantity": 160, "confidence": "medium"}
  ],
  "notes": "remarques éventuelles sur la lisibilité"
}`,
          },
        ],
      }],
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    return NextResponse.json({ error: `Claude API error: ${errorText}` }, { status: 500 })
  }

  const result = await response.json()
  const textContent = result.content?.find((c: { type: string }) => c.type === 'text')?.text || ''

  // Parse JSON from response
  try {
    const jsonMatch = textContent.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Could not parse OCR result', raw: textContent }, { status: 500 })
    }
    const parsed = JSON.parse(jsonMatch[0])

    // Enrich with product IDs
    const productByRef = new Map(products.map(p => [p.ref, p]))
    const enriched = parsed.entries.map((entry: { ref: string; name: string; quantity: number; confidence: string }) => {
      const product = productByRef.get(entry.ref)
      return {
        ...entry,
        productId: product?.id || null,
        priceHt: product?.priceHt || null,
        unit: product?.unit || null,
      }
    })

    return NextResponse.json({
      entries: enriched,
      notes: parsed.notes,
      day,
      restaurantId,
      year,
      month,
    })
  } catch {
    return NextResponse.json({ error: 'JSON parse error', raw: textContent }, { status: 500 })
  }
}
