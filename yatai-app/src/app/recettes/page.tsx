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
  "VIANDES & POISSONS", "MARINADES", "GYOZAS", "TOPPINGS & LÉGUMES",
  "PICKLES & VINAIGRETTES", "NOUILLES & PÂTES", "DESSERTS", "SIROPS & BOISSONS", "AUTRES"
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
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editing, margin: editData.margin, aleaPercent: editData.aleaPercent, laborTime: editData.laborTime, portions: editData.portions }),
    })
    setEditing(null)
    load()
  }

  const grouped = recipes.reduce((acc, r) => {
    const cat = r.category || "AUTRES"
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(r)
    return acc
  }, {} as Record<string, Recipe[]>)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-2xl font-bold text-gray-900">Fiches Techniques</h1><p className="text-sm text-gray-500">{recipes.length} recettes</p></div>
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
                <div className="px-5 py-4 cursor-pointer hover:bg-gray-50" onClick={() => { setExpanded(expanded === recipe.id ? null : recipe.id); setEditing(null) }}>
                  <div className="flex items-center justify-between">
                    <div><span className="text-xs font-mono text-gray-400 mr-2">{recipe.ref}</span><span className="font-semibold text-gray-900">{recipe.name}</span></div>
                    <div className="text-right">
                      {recipe.sellingPrice ? <span className="text-lg font-bold text-green-700">{recipe.sellingPrice.toFixed(2)} €</span> : <span className="text-sm text-gray-400">—</span>}
                    </div>
                  </div>
                  <div className="flex gap-4 mt-2 text-xs text-gray-500">
                    {recipe.portions && <span>Portions: {recipe.portions}</span>}
                    {recipe.unit && <span>Unité: {recipe.unit}</span>}
                    {recipe.laborTime != null && <span>MO: {recipe.laborTime}h</span>}
                    {recipe.costPerUnit != null && <span className="text-orange-600 font-medium">Coût: {recipe.costPerUnit.toFixed(2)} €</span>}
                    {recipe.margin != null && <span>Marge: {(recipe.margin * 100).toFixed(0)}%</span>}
                  </div>
                </div>
                {expanded === recipe.id && (
                  <div className="border-t border-gray-100">
                    {/* Editable params */}
                    <div className="px-5 py-3 bg-gray-50 flex gap-4 items-center text-xs">
                      {editing === recipe.id ? (
                        <>
                          <label>Portions: <input type="number" step="0.1" className="border rounded px-1 py-0.5 w-16 text-right" value={editData.portions ?? ""} onChange={e => setEditData({ ...editData, portions: parseFloat(e.target.value) || null })} /></label>
                          <label>MO (h): <input type="number" step="0.1" className="border rounded px-1 py-0.5 w-16 text-right" value={editData.laborTime ?? ""} onChange={e => setEditData({ ...editData, laborTime: parseFloat(e.target.value) || null })} /></label>
                          <label>Aléa %: <input type="number" step="0.01" className="border rounded px-1 py-0.5 w-16 text-right" value={editData.aleaPercent ?? 0.02} onChange={e => setEditData({ ...editData, aleaPercent: parseFloat(e.target.value) || 0 })} /></label>
                          <label>Marge %: <input type="number" step="0.01" className="border rounded px-1 py-0.5 w-16 text-right" value={editData.margin ?? 0} onChange={e => setEditData({ ...editData, margin: parseFloat(e.target.value) || 0 })} /></label>
                          <button onClick={saveEdit} className="text-green-600 font-medium">OK</button>
                          <button onClick={() => setEditing(null)} className="text-gray-400">Annuler</button>
                        </>
                      ) : (
                        <>
                          <span>Portions: {recipe.portions ?? "—"}</span>
                          <span>MO: {recipe.laborTime ?? "—"}h</span>
                          <span>Aléa: {((recipe.aleaPercent ?? 0.02) * 100).toFixed(0)}%</span>
                          <span>Marge: {recipe.margin != null ? `${(recipe.margin * 100).toFixed(0)}%` : "—"}</span>
                          <button onClick={() => { setEditing(recipe.id); setEditData(recipe) }} className="text-blue-600 font-medium ml-auto">Modifier</button>
                        </>
                      )}
                    </div>
                    {/* Cost breakdown */}
                    {recipe.costPerUnit != null && (
                      <div className="px-5 py-2 bg-orange-50 text-xs flex gap-6">
                        <span>Sous-total ingrédients: <strong>{recipe.ingredients.reduce((s, ri) => s + ri.amount, 0).toFixed(2)} €</strong></span>
                        <span>+ Aléa ({((recipe.aleaPercent ?? 0.02) * 100).toFixed(0)}%)</span>
                        <span>+ MO: <strong>{((recipe.laborTime ?? 0) * 16.33).toFixed(2)} €</strong></span>
                        <span>÷ {recipe.portions ?? 1} portions</span>
                        <span>= <strong className="text-orange-700">{recipe.costPerUnit.toFixed(2)} €/u</strong></span>
                        {recipe.sellingPrice != null && <span>→ PV: <strong className="text-green-700">{recipe.sellingPrice.toFixed(2)} €</strong></span>}
                      </div>
                    )}
                    {/* Ingredients table */}
                    {recipe.ingredients.length > 0 && (
                      <div className="px-5 py-3">
                        <table className="w-full text-xs">
                          <thead><tr className="text-gray-400"><th className="text-left py-1">Ingrédient</th><th className="text-right py-1">Qté</th><th className="text-right py-1">PU (€/kg)</th><th className="text-right py-1">Montant</th></tr></thead>
                          <tbody>
                            {recipe.ingredients.map(ri => (
                              <tr key={ri.id} className="border-t border-gray-50">
                                <td className="py-1">{ri.ingredient?.name || `Réf ${ri.ingredientRef}`}</td>
                                <td className="text-right py-1">{ri.quantity} {ri.unit}</td>
                                <td className="text-right py-1 font-mono">{ri.unitPrice.toFixed(2)}</td>
                                <td className="text-right py-1 font-mono">{ri.amount.toFixed(2)}</td>
                              </tr>
                            ))}
                            <tr className="border-t-2 border-gray-200 font-bold">
                              <td className="py-1" colSpan={3}>Sous-total</td>
                              <td className="text-right py-1 font-mono">{recipe.ingredients.reduce((s, ri) => s + ri.amount, 0).toFixed(2)} €</td>
                            </tr>
                          </tbody>
                        </table>
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
