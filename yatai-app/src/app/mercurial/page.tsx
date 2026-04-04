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
  const [expanded, setExpanded] = useState<number | null>(null)
  const [editData, setEditData] = useState<Partial<Ingredient>>({})
  const [cascadeMsg, setCascadeMsg] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/ingredients?search=${search}`).then(r => r.json()).then(setIngredients)
  }, [search])

  const startEdit = (ing: Ingredient) => { setEditing(ing.id); setEditData(ing) }

  const updateEditField = (field: string, value: number | string | null) => {
    const next = { ...editData, [field]: value }
    const priceHt = next.priceHt ?? null
    const weight = next.weight ?? null
    const lossPercent = next.lossPercent ?? 0
    let pricePerKg: number | null = null
    if (priceHt && weight && weight > 0) pricePerKg = priceHt / weight
    next.pricePerKg = pricePerKg
    next.netPriceKg = pricePerKg !== null ? pricePerKg - Math.abs(lossPercent) : null
    setEditData(next)
  }

  const saveEdit = async () => {
    if (!editing) return
    const res = await fetch("/api/ingredients", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editData) })
    const result = await res.json()
    if (result._cascadeUpdated > 0) {
      setCascadeMsg(`${result._cascadeUpdated} recette(s) mise(s) a jour`)
      setTimeout(() => setCascadeMsg(null), 3000)
    }
    setEditing(null); setExpanded(null)
    fetch(`/api/ingredients?search=${search}`).then(r => r.json()).then(setIngredients)
  }

  const filtered = ingredients.filter(i =>
    i.name.toLowerCase().includes(search.toLowerCase()) ||
    (i.supplier && i.supplier.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl md:text-2xl font-bold text-gray-900">Mercurial</h1>
        <p className="text-xs text-gray-500">{ingredients.length} ingredients</p>
      </div>
      <input type="text" placeholder="Rechercher..." value={search} onChange={e => setSearch(e.target.value)}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm mb-3" />
      {cascadeMsg && <div className="mb-3 px-3 py-2 bg-green-50 border border-green-200 text-green-700 rounded-lg text-xs">{cascadeMsg}</div>}

      {/* Mobile: cards */}
      <div className="md:hidden space-y-2">
        {filtered.map(ing => (
          <div key={ing.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 flex items-center justify-between" onClick={() => { setExpanded(expanded === ing.id ? null : ing.id); setEditing(null) }}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-gray-400">{ing.ref}</span>
                  <span className="font-medium text-sm truncate">{ing.name}</span>
                </div>
                <div className="flex gap-3 mt-1 text-xs text-gray-500">
                  {ing.supplier && <span>{ing.supplier}</span>}
                  <span className="font-mono text-gray-900">{ing.netPriceKg?.toFixed(2) ?? "—"} €/kg</span>
                </div>
              </div>
              <span className="text-gray-400 text-xs ml-2">{expanded === ing.id ? "▲" : "▼"}</span>
            </div>

            {expanded === ing.id && (
              <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
                {editing === ing.id ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="text-[10px] text-gray-500 uppercase">Nom</span>
                        <input className="w-full border rounded-lg px-2 py-1.5 text-sm" value={editData.name || ""} onChange={e => updateEditField("name", e.target.value)} />
                      </label>
                      <label className="block">
                        <span className="text-[10px] text-gray-500 uppercase">Fournisseur</span>
                        <input className="w-full border rounded-lg px-2 py-1.5 text-sm" value={editData.supplier || ""} onChange={e => updateEditField("supplier", e.target.value)} />
                      </label>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <label className="block">
                        <span className="text-[10px] text-gray-500 uppercase">Prix HT</span>
                        <input type="number" step="0.01" className="w-full border rounded-lg px-2 py-1.5 text-sm text-right" value={editData.priceHt ?? ""} onChange={e => updateEditField("priceHt", parseFloat(e.target.value) || null)} />
                      </label>
                      <label className="block">
                        <span className="text-[10px] text-gray-500 uppercase">Poids (kg)</span>
                        <input type="number" step="0.001" className="w-full border rounded-lg px-2 py-1.5 text-sm text-right" value={editData.weight ?? ""} onChange={e => updateEditField("weight", parseFloat(e.target.value) || null)} />
                      </label>
                      <label className="block">
                        <span className="text-[10px] text-gray-500 uppercase">Perte</span>
                        <input type="number" step="0.01" className="w-full border rounded-lg px-2 py-1.5 text-sm text-right" value={editData.lossPercent ?? 0} onChange={e => updateEditField("lossPercent", parseFloat(e.target.value) || 0)} />
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
                      <span>Prix/kg: <strong className="text-gray-900">{editData.pricePerKg?.toFixed(2) ?? "—"}</strong></span>
                      <span>Net/kg: <strong className="text-gray-900">{editData.netPriceKg?.toFixed(2) ?? "—"}</strong></span>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={saveEdit} className="flex-1 bg-green-600 text-white py-2 rounded-lg text-sm font-medium">Sauvegarder</button>
                      <button onClick={() => setEditing(null)} className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-lg text-sm">Annuler</button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="grid grid-cols-2 gap-y-2 text-xs mb-3">
                      <span className="text-gray-500">Prix TTC</span><span className="text-right font-mono">{ing.priceTtc?.toFixed(2) ?? "—"} €</span>
                      <span className="text-gray-500">Prix HT</span><span className="text-right font-mono">{ing.priceHt?.toFixed(2) ?? "—"} €</span>
                      <span className="text-gray-500">Poids</span><span className="text-right">{ing.weight ?? "—"} kg</span>
                      <span className="text-gray-500">Prix/kg</span><span className="text-right font-mono">{ing.pricePerKg?.toFixed(2) ?? "—"} €</span>
                      <span className="text-gray-500">Perte</span><span className="text-right">{ing.lossPercent ? `${(ing.lossPercent * 100).toFixed(0)}%` : "0%"}</span>
                      <span className="text-gray-500">Net/kg</span><span className="text-right font-mono font-bold">{ing.netPriceKg?.toFixed(2) ?? "—"} €</span>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); startEdit(ing) }} className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium">Modifier</button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Desktop: table */}
      <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-200 overflow-auto">
        <table className="w-full text-sm">
          <thead><tr className="bg-gray-50 text-xs text-gray-500 uppercase">
            <th className="px-4 py-3 text-left">Ref</th><th className="px-4 py-3 text-left">Ingredient</th><th className="px-4 py-3 text-left">Fournisseur</th>
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
