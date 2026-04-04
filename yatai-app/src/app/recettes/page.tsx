"use client"

import { useEffect, useState } from "react"

type IngredientOption = { id: number; ref: number; name: string; netPriceKg: number | null }
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
type NewRecipeIngredient = { ingredientId: number; ingredientRef: number; name: string; quantity: number; unitPrice: number; amount: number; unit: string }

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
  const [allIngredients, setAllIngredients] = useState<IngredientOption[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [addSaving, setAddSaving] = useState(false)
  const [newRecipe, setNewRecipe] = useState({ ref: "", name: "", category: "", unit: "portion", portions: "1", laborTime: "0", aleaPercent: "0.02", margin: "0" })
  const [newIngredients, setNewIngredients] = useState<NewRecipeIngredient[]>([])
  const [ingSearch, setIngSearch] = useState("")

  const [smicHourly, setSmicHourly] = useState(16.33)

  const load = () => {
    const params = category ? `?category=${encodeURIComponent(category)}` : ""
    fetch(`/api/recipes${params}`).then(r => r.json()).then(setRecipes)
  }
  useEffect(load, [category])
  useEffect(() => {
    fetch("/api/ingredients").then(r => r.json()).then(setAllIngredients)
    fetch("/api/admin/smic").then(r => r.json()).then(data => {
      setSmicHourly(data.monthlyRate ? (data.monthlyRate * 12) / 11 / 151.67 : data.hourlyRate ?? 16.33)
    })
  }, [])

  const addIngToRecipe = (ing: IngredientOption) => {
    if (newIngredients.find(ni => ni.ingredientId === ing.id)) return
    setNewIngredients(prev => [...prev, { ingredientId: ing.id, ingredientRef: ing.ref, name: ing.name, quantity: 1, unitPrice: ing.netPriceKg ?? 0, amount: ing.netPriceKg ?? 0, unit: "kg" }])
    setIngSearch("")
  }

  const updateNewIng = (idx: number, field: string, value: number | string) => {
    setNewIngredients(prev => prev.map((ni, i) => {
      if (i !== idx) return ni
      const updated = { ...ni, [field]: value }
      if (field === "quantity" || field === "unitPrice") updated.amount = (updated.quantity || 0) * (updated.unitPrice || 0)
      return updated
    }))
  }

  const removeNewIng = (idx: number) => setNewIngredients(prev => prev.filter((_, i) => i !== idx))

  const createRecipe = async () => {
    if (!newRecipe.ref || !newRecipe.name) return
    setAddSaving(true)
    await fetch("/api/recipes", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ref: newRecipe.ref, name: newRecipe.name, category: newRecipe.category || null,
        unit: newRecipe.unit || null, portions: parseFloat(newRecipe.portions) || 1,
        laborTime: parseFloat(newRecipe.laborTime) || 0, aleaPercent: parseFloat(newRecipe.aleaPercent) || 0.02,
        margin: parseFloat(newRecipe.margin) || 0,
        ingredients: newIngredients.map(ni => ({ ingredientId: ni.ingredientId, ingredientRef: ni.ingredientRef, quantity: ni.quantity, unitPrice: ni.unitPrice, amount: ni.amount, unit: ni.unit })),
      }),
    })
    setNewRecipe({ ref: "", name: "", category: "", unit: "portion", portions: "1", laborTime: "0", aleaPercent: "0.02", margin: "0" })
    setNewIngredients([]); setShowAdd(false); setAddSaving(false)
    load()
  }

  const newSubtotal = newIngredients.reduce((s, ni) => s + ni.amount, 0)

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
      <div className="flex gap-2 mb-4">
        <select value={category} onChange={e => setCategory(e.target.value)} className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="">Toutes les categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button onClick={() => setShowAdd(!showAdd)} className={`px-3 py-2 rounded-lg text-xs font-medium shrink-0 ${showAdd ? "bg-red-100 text-red-700" : "bg-green-600 text-white"}`}>
          {showAdd ? "Annuler" : "+ Nouvelle"}
        </button>
      </div>

      {showAdd && (
        <div className="bg-white rounded-xl border border-green-200 shadow-sm p-4 mb-4">
          <h3 className="font-semibold text-sm text-gray-900 mb-3">Nouvelle recette</h3>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <label className="block">
              <span className="text-[10px] text-gray-500 uppercase">Ref *</span>
              <input className="w-full border rounded-lg px-2 py-1.5 text-sm" value={newRecipe.ref} onChange={e => setNewRecipe({ ...newRecipe, ref: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-[10px] text-gray-500 uppercase">Nom *</span>
              <input className="w-full border rounded-lg px-2 py-1.5 text-sm" value={newRecipe.name} onChange={e => setNewRecipe({ ...newRecipe, name: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-[10px] text-gray-500 uppercase">Categorie</span>
              <select className="w-full border rounded-lg px-2 py-1.5 text-sm" value={newRecipe.category} onChange={e => setNewRecipe({ ...newRecipe, category: e.target.value })}>
                <option value="">—</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] text-gray-500 uppercase">Unite</span>
              <input className="w-full border rounded-lg px-2 py-1.5 text-sm" value={newRecipe.unit} onChange={e => setNewRecipe({ ...newRecipe, unit: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-[10px] text-gray-500 uppercase">Portions</span>
              <input type="number" step="0.1" className="w-full border rounded-lg px-2 py-1.5 text-sm text-right" value={newRecipe.portions} onChange={e => setNewRecipe({ ...newRecipe, portions: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-[10px] text-gray-500 uppercase">MO (h)</span>
              <input type="number" step="0.1" className="w-full border rounded-lg px-2 py-1.5 text-sm text-right" value={newRecipe.laborTime} onChange={e => setNewRecipe({ ...newRecipe, laborTime: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-[10px] text-gray-500 uppercase">Alea %</span>
              <input type="number" step="0.01" className="w-full border rounded-lg px-2 py-1.5 text-sm text-right" value={newRecipe.aleaPercent} onChange={e => setNewRecipe({ ...newRecipe, aleaPercent: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-[10px] text-gray-500 uppercase">Marge %</span>
              <input type="number" step="0.01" className="w-full border rounded-lg px-2 py-1.5 text-sm text-right" value={newRecipe.margin} onChange={e => setNewRecipe({ ...newRecipe, margin: e.target.value })} />
            </label>
          </div>

          {/* Ingredient picker */}
          <div className="border-t border-gray-100 pt-3 mb-3">
            <h4 className="text-xs font-bold text-gray-600 uppercase mb-2">Ingredients ({newIngredients.length})</h4>
            <div className="relative mb-2">
              <input type="text" placeholder="Rechercher un ingredient..." value={ingSearch} onChange={e => setIngSearch(e.target.value)}
                className="w-full border rounded-lg px-2 py-1.5 text-sm" />
              {ingSearch.length > 1 && (
                <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {allIngredients.filter(ing => ing.name.toLowerCase().includes(ingSearch.toLowerCase()) || String(ing.ref).includes(ingSearch)).slice(0, 10).map(ing => (
                    <div key={ing.id} onClick={() => addIngToRecipe(ing)} className="px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm flex justify-between">
                      <span><span className="text-gray-400 font-mono text-xs mr-1">{ing.ref}</span> {ing.name}</span>
                      <span className="text-gray-500 text-xs">{ing.netPriceKg?.toFixed(2) ?? "—"} €/kg</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {newIngredients.map((ni, idx) => (
              <div key={idx} className="flex items-center gap-2 mb-1.5">
                <span className="text-xs text-gray-700 flex-1 truncate">{ni.name}</span>
                <input type="number" step="0.01" value={ni.quantity} onChange={e => updateNewIng(idx, "quantity", parseFloat(e.target.value) || 0)}
                  className="w-16 border rounded px-1.5 py-1 text-xs text-right" />
                <select value={ni.unit} onChange={e => updateNewIng(idx, "unit", e.target.value)} className="border rounded px-1 py-1 text-xs">
                  <option value="kg">kg</option><option value="L">L</option><option value="u">u</option><option value="g">g</option>
                </select>
                <span className="text-xs font-mono text-gray-500 w-14 text-right">{ni.amount.toFixed(2)} €</span>
                <button onClick={() => removeNewIng(idx)} className="text-red-500 text-xs font-bold">x</button>
              </div>
            ))}
            {newIngredients.length > 0 && (
              <div className="text-xs text-right font-bold text-orange-700 mt-1">Sous-total: {newSubtotal.toFixed(2)} €</div>
            )}
          </div>

          <button onClick={createRecipe} disabled={addSaving || !newRecipe.ref || !newRecipe.name}
            className="w-full bg-green-600 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50">
            {addSaving ? "Enregistrement..." : "Creer la recette"}
          </button>
        </div>
      )}

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
                        <span>+ MO: <strong>{((recipe.laborTime ?? 0) * smicHourly).toFixed(2)} €</strong></span>
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
