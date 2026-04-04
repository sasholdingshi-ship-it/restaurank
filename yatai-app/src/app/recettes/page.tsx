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
  aleaPercent: number; margin: number | null; costPerUnit: number | null; sellingPrice: number | null
  ingredients: RecipeIngredient[]
}

const CATEGORIES = [
  "BOUILLONS", "TARE & ASSAISONNEMENTS", "SAUCES", "HUILES & CONDIMENTS",
  "VIANDES & POISSONS", "MARINADES", "GYOZAS", "TOPPINGS & LEGUMES",
  "PICKLES & VINAIGRETTES", "NOUILLES & PATES", "DESSERTS", "SIROPS & BOISSONS", "AUTRES"
]

export default function RecettesPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [category, setCategory] = useState("")
  const [expanded, setExpanded] = useState<number | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [editData, setEditData] = useState<Partial<Recipe>>({})

  const load = () => {
    const params = category ? `?category=${encodeURIComponent(category)}` : ""
    fetch(`/api/recipes${params}`).then(r => r.json()).then(setRecipes)
  }
  useEffect(load, [category])

  const saveEdit = async () => {
    if (!editing) return
    await fetch("/api/recipes", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editing, margin: editData.margin, aleaPercent: editData.aleaPercent, laborTime: editData.laborTime, portions: editData.portions }),
    })
    setEditing(null); load()
  }

  const grouped = recipes.reduce((acc, r) => {
    const cat = r.category || "AUTRES"
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(r)
    return acc
  }, {} as Record<string, Recipe[]>)

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Fiches Techniques</h1>
          <p className="text-xs text-gray-500">{recipes.length} recettes</p>
        </div>
      </div>
      <select value={category} onChange={e => setCategory(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm mb-4">
        <option value="">Toutes les categories</option>
        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
      </select>

      {Object.entries(grouped).map(([cat, recs]) => (
        <div key={cat} className="mb-6">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{cat} ({recs.length})</h2>
          <div className="space-y-2 md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-4 md:space-y-0">
            {recs.map(recipe => (
              <div key={recipe.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 cursor-pointer" onClick={() => { setExpanded(expanded === recipe.id ? null : recipe.id); setEditing(null) }}>
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <span className="text-[10px] font-mono text-gray-400 mr-1">{recipe.ref}</span>
                      <span className="font-semibold text-sm text-gray-900">{recipe.name}</span>
                    </div>
                    {recipe.sellingPrice ? <span className="text-base font-bold text-green-700 ml-2">{recipe.sellingPrice.toFixed(2)} €</span> : <span className="text-sm text-gray-400 ml-2">—</span>}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[11px] text-gray-500">
                    {recipe.portions != null && <span>{recipe.portions} portions</span>}
                    {recipe.laborTime != null && <span>MO: {recipe.laborTime}h</span>}
                    {recipe.costPerUnit != null && <span className="text-orange-600 font-medium">Cout: {recipe.costPerUnit.toFixed(2)} €</span>}
                    {recipe.margin != null && <span>Marge: {(recipe.margin * 100).toFixed(0)}%</span>}
                  </div>
                </div>

                {expanded === recipe.id && (
                  <div className="border-t border-gray-100">
                    {/* Editable params */}
                    <div className="px-4 py-2 bg-gray-50">
                      {editing === recipe.id ? (
                        <div className="space-y-2">
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <label>Portions: <input type="number" step="0.1" className="border rounded px-2 py-1 w-full mt-0.5" value={editData.portions ?? ""} onChange={e => setEditData({ ...editData, portions: parseFloat(e.target.value) || null })} /></label>
                            <label>MO (h): <input type="number" step="0.1" className="border rounded px-2 py-1 w-full mt-0.5" value={editData.laborTime ?? ""} onChange={e => setEditData({ ...editData, laborTime: parseFloat(e.target.value) || null })} /></label>
                            <label>Alea %: <input type="number" step="0.01" className="border rounded px-2 py-1 w-full mt-0.5" value={editData.aleaPercent ?? 0.02} onChange={e => setEditData({ ...editData, aleaPercent: parseFloat(e.target.value) || 0 })} /></label>
                            <label>Marge %: <input type="number" step="0.01" className="border rounded px-2 py-1 w-full mt-0.5" value={editData.margin ?? 0} onChange={e => setEditData({ ...editData, margin: parseFloat(e.target.value) || 0 })} /></label>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={saveEdit} className="flex-1 bg-green-600 text-white py-1.5 rounded-lg text-xs font-medium">OK</button>
                            <button onClick={() => setEditing(null)} className="flex-1 bg-gray-200 text-gray-700 py-1.5 rounded-lg text-xs">Annuler</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between text-xs text-gray-600">
                          <div className="flex flex-wrap gap-x-3">
                            <span>Portions: {recipe.portions ?? "—"}</span>
                            <span>MO: {recipe.laborTime ?? "—"}h</span>
                            <span>Alea: {((recipe.aleaPercent ?? 0.02) * 100).toFixed(0)}%</span>
                            <span>Marge: {recipe.margin != null ? `${(recipe.margin * 100).toFixed(0)}%` : "—"}</span>
                          </div>
                          <button onClick={(e) => { e.stopPropagation(); setEditing(recipe.id); setEditData(recipe) }} className="text-blue-600 font-medium text-xs">Modifier</button>
                        </div>
                      )}
                    </div>

                    {/* Cost breakdown */}
                    {recipe.costPerUnit != null && (
                      <div className="px-4 py-2 bg-orange-50 text-[11px] flex flex-wrap gap-x-3 gap-y-0.5">
                        <span>Ingredients: <strong>{recipe.ingredients.reduce((s, ri) => s + ri.amount, 0).toFixed(2)} €</strong></span>
                        <span>+ Alea {((recipe.aleaPercent ?? 0.02) * 100).toFixed(0)}%</span>
                        <span>+ MO: <strong>{((recipe.laborTime ?? 0) * 16.33).toFixed(2)} €</strong></span>
                        <span>÷ {recipe.portions ?? 1} port.</span>
                        <span>= <strong className="text-orange-700">{recipe.costPerUnit.toFixed(2)} €/u</strong></span>
                        {recipe.sellingPrice != null && <span className="text-green-700 font-bold">PV: {recipe.sellingPrice.toFixed(2)} €</span>}
                      </div>
                    )}

                    {/* Ingredients */}
                    {recipe.ingredients.length > 0 && (
                      <div className="px-4 py-2">
                        {recipe.ingredients.map(ri => (
                          <div key={ri.id} className="flex items-center justify-between py-1 border-b border-gray-50 text-xs">
                            <span className="text-gray-700">{ri.ingredient?.name || `Ref ${ri.ingredientRef}`}</span>
                            <div className="flex gap-3 text-gray-500">
                              <span>{ri.quantity} {ri.unit}</span>
                              <span className="font-mono">{ri.amount.toFixed(2)} €</span>
                            </div>
                          </div>
                        ))}
                        <div className="flex items-center justify-between py-1.5 font-bold text-xs">
                          <span>Sous-total</span>
                          <span className="font-mono">{recipe.ingredients.reduce((s, ri) => s + ri.amount, 0).toFixed(2)} €</span>
                        </div>
                      </div>
                    )}
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
