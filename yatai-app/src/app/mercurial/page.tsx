"use client"

import { useEffect, useState } from "react"

type Ingredient = {
  id: number; ref: number; name: string; supplier: string | null
  priceTtc: number | null; priceHt: number | null; weight: number | null
  pricePerKg: number | null; lossPercent: number; netPriceKg: number | null
}

export default function MercurialPage() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [search, setSearch] = useState("")
  const [editing, setEditing] = useState<number | null>(null)
  const [editData, setEditData] = useState<Partial<Ingredient>>({})
  const [cascadeMsg, setCascadeMsg] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/ingredients?search=${search}`).then(r => r.json()).then(setIngredients)
  }, [search])

  const startEdit = (ing: Ingredient) => { setEditing(ing.id); setEditData(ing) }

  // Recalculate derived fields live during editing
  const updateEditField = (field: string, value: any) => {
    const next = { ...editData, [field]: value }
    const priceHt = next.priceHt ?? null
    const priceTtc = next.priceTtc ?? null
    const weight = next.weight ?? null
    const lossPercent = next.lossPercent ?? 0
    let pricePerKg: number | null = null
    if (priceHt && weight && weight > 0) pricePerKg = priceHt / weight
    else if (priceTtc && weight && weight > 0) pricePerKg = (priceTtc / 1.055) / weight
    next.pricePerKg = pricePerKg
    next.netPriceKg = pricePerKg !== null ? pricePerKg / (1 + Math.abs(lossPercent)) : null
    setEditData(next)
  }

  const saveEdit = async () => {
    if (!editing) return
    const res = await fetch("/api/ingredients", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editData) })
    const result = await res.json()
    if (result._cascadeUpdated > 0) {
      setCascadeMsg(`${result._cascadeUpdated} recette(s) mise(s) à jour`)
      setTimeout(() => setCascadeMsg(null), 3000)
    }
    setEditing(null)
    fetch(`/api/ingredients?search=${search}`).then(r => r.json()).then(setIngredients)
  }

  const filtered = ingredients.filter(i => i.name.toLowerCase().includes(search.toLowerCase()) || (i.supplier && i.supplier.toLowerCase().includes(search.toLowerCase())))

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-2xl font-bold text-gray-900">Mercurial</h1><p className="text-sm text-gray-500">{ingredients.length} ingrédients</p></div>
        <input type="text" placeholder="Rechercher un ingrédient..." value={search} onChange={e => setSearch(e.target.value)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm w-64" />
      </div>
      {cascadeMsg && <div className="mb-4 px-4 py-2 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">{cascadeMsg}</div>}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-auto">
        <table className="w-full text-sm">
          <thead><tr className="bg-gray-50 text-xs text-gray-500 uppercase">
            <th className="px-4 py-3 text-left">Réf</th><th className="px-4 py-3 text-left">Ingrédient</th><th className="px-4 py-3 text-left">Fournisseur</th>
            <th className="px-4 py-3 text-right">Prix TTC</th><th className="px-4 py-3 text-right">Prix HT</th><th className="px-4 py-3 text-right">Poids</th>
            <th className="px-4 py-3 text-right">Prix/kg</th><th className="px-4 py-3 text-right">Perte %</th><th className="px-4 py-3 text-right">Prix net/kg</th>
            <th className="px-4 py-3 text-center">Actions</th>
          </tr></thead>
          <tbody>
            {filtered.map(ing => (
              <tr key={ing.id} className="border-t border-gray-100 hover:bg-gray-50">
                {editing === ing.id ? (
                  <>
                    <td className="px-4 py-2 font-mono text-gray-400">{ing.ref}</td>
                    <td className="px-4 py-2"><input className="border rounded px-2 py-1 text-sm w-full" value={editData.name || ""} onChange={e => updateEditField("name", e.target.value)} /></td>
                    <td className="px-4 py-2"><input className="border rounded px-2 py-1 text-sm w-full" value={editData.supplier || ""} onChange={e => updateEditField("supplier", e.target.value)} /></td>
                    <td className="px-4 py-2"><input type="number" step="0.01" className="border rounded px-2 py-1 text-sm w-20 text-right" value={editData.priceTtc ?? ""} onChange={e => updateEditField("priceTtc", parseFloat(e.target.value) || null)} /></td>
                    <td className="px-4 py-2"><input type="number" step="0.01" className="border rounded px-2 py-1 text-sm w-20 text-right" value={editData.priceHt ?? ""} onChange={e => updateEditField("priceHt", parseFloat(e.target.value) || null)} /></td>
                    <td className="px-4 py-2"><input type="number" step="0.001" className="border rounded px-2 py-1 text-sm w-16 text-right" value={editData.weight ?? ""} onChange={e => updateEditField("weight", parseFloat(e.target.value) || null)} /></td>
                    <td className="px-4 py-2 text-right font-mono">{editData.pricePerKg?.toFixed(2) ?? "—"}</td>
                    <td className="px-4 py-2"><input type="number" step="0.01" className="border rounded px-2 py-1 text-sm w-16 text-right" value={editData.lossPercent ?? 0} onChange={e => updateEditField("lossPercent", parseFloat(e.target.value) || 0)} /></td>
                    <td className="px-4 py-2 text-right font-mono">{editData.netPriceKg?.toFixed(2) ?? "—"}</td>
                    <td className="px-4 py-2 text-center">
                      <button onClick={saveEdit} className="text-green-600 hover:text-green-800 text-xs font-medium mr-2">OK</button>
                      <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-600 text-xs">Annuler</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-4 py-2 font-mono text-gray-400">{ing.ref}</td>
                    <td className="px-4 py-2 font-medium">{ing.name}</td>
                    <td className="px-4 py-2 text-gray-500">{ing.supplier || "—"}</td>
                    <td className="px-4 py-2 text-right font-mono">{ing.priceTtc?.toFixed(2) ?? "—"}</td>
                    <td className="px-4 py-2 text-right font-mono">{ing.priceHt?.toFixed(2) ?? "—"}</td>
                    <td className="px-4 py-2 text-right">{ing.weight ?? "—"}</td>
                    <td className="px-4 py-2 text-right font-mono">{ing.pricePerKg?.toFixed(2) ?? "—"}</td>
                    <td className="px-4 py-2 text-right">{ing.lossPercent ? `${(ing.lossPercent * 100).toFixed(0)}%` : "0%"}</td>
                    <td className="px-4 py-2 text-right font-mono">{ing.netPriceKg?.toFixed(2) ?? "—"}</td>
                    <td className="px-4 py-2 text-center"><button onClick={() => startEdit(ing)} className="text-blue-600 hover:text-blue-800 text-xs font-medium">Modifier</button></td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
