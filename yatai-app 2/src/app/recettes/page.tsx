"use client"

import { useEffect, useState } from "react"

type RecipeIngredient = {
  id: number; quantity: number; unitPrice: number; amount: number; unit: string | null
  ingredientRef: number | null
  ingredient: { name: string; ref: number } | null
}
type Recipe = {
  id: number; ref: string; name: string; category: string | null
  unit: string | null; portions: number | null; laborTime: number | null
  margin: number | null; sellingPrice: number | null
  ingredients: RecipeIngredient[]
}

const CATEGORIES = [
  "BOUILLONS", "TARE & ASSAISONNEMENTS", "SAUCES", "HUILES & CONDIMENTS",
  "VIANDES & POISSONS", "MARINADES", "GYOZAS", "TOPPINGS & LÉGUMES",
  "PICKLES & VINAIGRETTES", "NOUILLES & PÂTES", "DESSERTS", "SIROPS & BOISSONS", "AUTRES"
]

export default function RecettesPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [category, setCategory] = useState("")
  const [expanded, setExpanded] = useState<number | null>(null)

  useEffect(() => {
    const params = category ? `?category=${encodeURIComponent(category)}` : ""
    fetch(`/api/recipes${params}`).then(r => r.json()).then(setRecipes)
  }, [category])

  const grouped = recipes.reduce((acc, r) => {
    const cat = r.category || "AUTRES"
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(r)
    return acc
  }, {} as Record<string, Recipe[]>)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Fiches Techniques</h1>
          <p className="text-sm text-gray-500">{recipes.length} recettes</p>
        </div>
        <select value={category} onChange={e => setCategory(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="">Toutes les catégories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {Object.entries(grouped).map(([cat, recs]) => (
        <div key={cat} className="mb-8">
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">{cat} ({recs.length})</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {recs.map(recipe => (
              <div key={recipe.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div
                  className="px-5 py-4 cursor-pointer hover:bg-gray-50"
                  onClick={() => setExpanded(expanded === recipe.id ? null : recipe.id)}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-mono text-gray-400 mr-2">{recipe.ref}</span>
                      <span className="font-semibold text-gray-900">{recipe.name}</span>
                    </div>
                    <div className="text-right">
                      {recipe.sellingPrice ? (
                        <span className="text-lg font-bold text-green-700">{recipe.sellingPrice.toFixed(2)} €</span>
                      ) : (
                        <span className="text-sm text-gray-400">—</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-4 mt-2 text-xs text-gray-500">
                    {recipe.portions && <span>Portions: {recipe.portions}</span>}
                    {recipe.unit && <span>Unité: {recipe.unit}</span>}
                    {recipe.laborTime && <span>MO: {recipe.laborTime}h</span>}
                    {recipe.margin && <span>Marge: {(recipe.margin * 100).toFixed(0)}%</span>}
                  </div>
                </div>

                {expanded === recipe.id && recipe.ingredients.length > 0 && (
                  <div className="border-t border-gray-100 px-5 py-3">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-400">
                          <th className="text-left py-1">Ingrédient</th>
                          <th className="text-right py-1">Qté</th>
                          <th className="text-right py-1">PU</th>
                          <th className="text-right py-1">Montant</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recipe.ingredients.map(ri => (
                          <tr key={ri.id} className="border-t border-gray-50">
                            <td className="py-1">{ri.ingredient?.name || `Réf ${ri.ingredientRef}`}</td>
                            <td className="text-right py-1">{ri.quantity} {ri.unit}</td>
                            <td className="text-right py-1 font-mono">{ri.unitPrice.toFixed(2)}</td>
                            <td className="text-right py-1 font-mono">{ri.amount.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
