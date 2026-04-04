"use client"

import { useEffect, useState } from "react"

type Product = { id: number; ref: string; name: string; priceHt: number | null; unit: string | null }

export default function ProduitsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [search, setSearch] = useState("")
  const [editing, setEditing] = useState<number | null>(null)
  const [editData, setEditData] = useState<Partial<Product>>({})

  useEffect(() => {
    fetch("/api/products").then(r => r.json()).then(setProducts)
  }, [])

  const saveEdit = async () => {
    await fetch("/api/products", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editData),
    })
    setEditing(null)
    fetch("/api/products").then(r => r.json()).then(setProducts)
  }

  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.ref.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Recap Prix</h1>
          <p className="text-sm text-gray-500">{products.length} produits — Prix de revente aux franchisés</p>
        </div>
        <input
          type="text"
          placeholder="Rechercher un produit..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm w-64"
        />
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
              <th className="px-6 py-3 text-left">Réf</th>
              <th className="px-6 py-3 text-left">Nom</th>
              <th className="px-6 py-3 text-right">Prix HT</th>
              <th className="px-6 py-3 text-left">Unité</th>
              <th className="px-6 py-3 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => (
              <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50">
                {editing === p.id ? (
                  <>
                    <td className="px-6 py-2 font-mono text-gray-400">{p.ref}</td>
                    <td className="px-6 py-2">
                      <input className="border rounded px-2 py-1 text-sm w-full" value={editData.name || ""} onChange={e => setEditData({ ...editData, name: e.target.value })} />
                    </td>
                    <td className="px-6 py-2">
                      <input type="number" step="0.01" className="border rounded px-2 py-1 text-sm w-24 text-right" value={editData.priceHt ?? ""} onChange={e => setEditData({ ...editData, priceHt: parseFloat(e.target.value) || null })} />
                    </td>
                    <td className="px-6 py-2">
                      <input className="border rounded px-2 py-1 text-sm w-24" value={editData.unit || ""} onChange={e => setEditData({ ...editData, unit: e.target.value })} />
                    </td>
                    <td className="px-6 py-2 text-center">
                      <button onClick={saveEdit} className="text-green-600 hover:text-green-800 text-xs font-medium mr-2">OK</button>
                      <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-600 text-xs">Annuler</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-6 py-2 font-mono text-gray-400">{p.ref}</td>
                    <td className="px-6 py-2 font-medium">{p.name}</td>
                    <td className="px-6 py-2 text-right font-mono">{p.priceHt?.toFixed(2) ?? <span className="text-red-400">—</span>}</td>
                    <td className="px-6 py-2 text-gray-500">{p.unit || "—"}</td>
                    <td className="px-6 py-2 text-center">
                      <button onClick={() => { setEditing(p.id); setEditData(p) }} className="text-blue-600 hover:text-blue-800 text-xs font-medium">Modifier</button>
                    </td>
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
