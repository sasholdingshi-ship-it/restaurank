"use client"

import { useEffect, useState } from "react"

type Restaurant = { id: number; code: string; name: string; arrondissement: string; siren: string | null; deliveryPrice: number; tvaRate: number }
type Tab = "restaurants" | "ingredients" | "products" | "config"

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("restaurants")
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [editing, setEditing] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<Partial<Restaurant>>({})
  const [msg, setMsg] = useState<string | null>(null)

  const loadRestaurants = () => fetch("/api/admin/restaurants").then(r => r.json()).then(setRestaurants)
  useEffect(() => { loadRestaurants() }, [])

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 3000) }

  const saveRestaurant = async () => {
    const method = creating ? "POST" : "PUT"
    const res = await fetch("/api/admin/restaurants", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) })
    if (res.ok) { flash(creating ? "Restaurant cree" : "Restaurant modifie"); setEditing(null); setCreating(false); loadRestaurants() }
    else flash("Erreur: " + (await res.json()).error)
  }

  const deleteRestaurant = async (id: number) => {
    if (!confirm("Supprimer ce restaurant ?")) return
    const res = await fetch(`/api/admin/restaurants?id=${id}`, { method: "DELETE" })
    if (res.ok) { flash("Supprime"); loadRestaurants() }
  }

  const startCreate = () => {
    setCreating(true); setEditing(null)
    setForm({ code: "", name: "", arrondissement: "", siren: "", deliveryPrice: 25, tvaRate: 0.055 })
  }

  const startEdit = (r: Restaurant) => { setEditing(r.id); setCreating(false); setForm(r) }

  const tabs: { key: Tab; label: string }[] = [
    { key: "restaurants", label: "Restaurants" },
    { key: "ingredients", label: "Ingredients" },
    { key: "products", label: "Produits" },
    { key: "config", label: "Config" },
  ]

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl md:text-2xl font-bold text-gray-900">Back Office</h1>
        <p className="text-xs text-gray-500">Gestion des donnees</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t.key ? "bg-white shadow text-gray-900" : "text-gray-500"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {msg && <div className="mb-3 px-3 py-2 bg-green-50 border border-green-200 text-green-700 rounded-lg text-xs">{msg}</div>}

      {/* Restaurants tab */}
      {tab === "restaurants" && (
        <div>
          <button onClick={startCreate} className="w-full mb-3 py-2.5 bg-orange-500 text-white rounded-xl text-sm font-medium active:bg-orange-600">
            + Nouveau restaurant
          </button>

          {(creating || editing) && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-3">
              <h3 className="font-semibold text-sm mb-3">{creating ? "Nouveau restaurant" : "Modifier"}</h3>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[10px] text-gray-500 uppercase">Code</span>
                    <input className="w-full border rounded-lg px-2 py-1.5 text-sm" placeholder="YM" value={form.code || ""} onChange={e => setForm({ ...form, code: e.target.value })} />
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-gray-500 uppercase">Arrondissement</span>
                    <input className="w-full border rounded-lg px-2 py-1.5 text-sm" placeholder="2e" value={form.arrondissement || ""} onChange={e => setForm({ ...form, arrondissement: e.target.value })} />
                  </label>
                </div>
                <label className="block">
                  <span className="text-[10px] text-gray-500 uppercase">Nom</span>
                  <input className="w-full border rounded-lg px-2 py-1.5 text-sm" placeholder="Yatai Montorgueil" value={form.name || ""} onChange={e => setForm({ ...form, name: e.target.value })} />
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <label className="block">
                    <span className="text-[10px] text-gray-500 uppercase">SIREN</span>
                    <input className="w-full border rounded-lg px-2 py-1.5 text-sm" value={form.siren || ""} onChange={e => setForm({ ...form, siren: e.target.value })} />
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-gray-500 uppercase">Livraison €</span>
                    <input type="number" step="0.5" className="w-full border rounded-lg px-2 py-1.5 text-sm" value={form.deliveryPrice ?? ""} onChange={e => { const v = parseFloat(e.target.value); setForm({ ...form, deliveryPrice: isNaN(v) ? 0 : v }) }} />
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-gray-500 uppercase">TVA</span>
                    <input type="number" step="0.005" className="w-full border rounded-lg px-2 py-1.5 text-sm" value={form.tvaRate ?? ""} onChange={e => { const v = parseFloat(e.target.value); setForm({ ...form, tvaRate: isNaN(v) ? 0 : v }) }} />
                  </label>
                </div>
                <div className="flex gap-2 pt-1">
                  <button onClick={saveRestaurant} className="flex-1 bg-green-600 text-white py-2 rounded-lg text-sm font-medium">{creating ? "Creer" : "Sauvegarder"}</button>
                  <button onClick={() => { setCreating(false); setEditing(null) }} className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-lg text-sm">Annuler</button>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {restaurants.map(r => (
              <div key={r.id} className="bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">{r.code}</span>
                      <span className="font-medium text-sm">{r.name}</span>
                    </div>
                    <div className="flex gap-3 mt-1 text-xs text-gray-500">
                      <span>{r.arrondissement}</span>
                      {r.siren && <span>SIREN: {r.siren}</span>}
                      <span>Livr: {r.deliveryPrice}€</span>
                      <span>TVA: {(r.tvaRate * 100).toFixed(1)}%</span>
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => startEdit(r)} className="text-blue-600 text-xs font-medium">Modifier</button>
                    <button onClick={() => deleteRestaurant(r.id)} className="text-red-500 text-xs font-medium">Suppr</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ingredients tab */}
      {tab === "ingredients" && <AdminIngredients />}

      {/* Products tab */}
      {tab === "products" && <AdminProducts />}

      {/* Config tab */}
      {tab === "config" && <AdminConfig onFlash={flash} />}
    </div>
  )
}

function AdminIngredients() {
  const [count, setCount] = useState(0)
  const [recalculating, setRecalculating] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  useEffect(() => { fetch("/api/ingredients").then(r => r.json()).then(d => setCount(d.length)) }, [])

  const recalc = async () => {
    setRecalculating(true)
    const res = await fetch("/api/recalculate", { method: "POST" })
    const data = await res.json()
    setResult(`${data.ingredients} ingredients, ${data.recipes} recettes, ${data.recipeIngredients} liens recalcules`)
    setRecalculating(false)
  }

  return (
    <div>
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-3">
        <p className="text-sm"><strong>{count}</strong> ingredients en base</p>
        <p className="text-xs text-gray-500 mt-1">Modifiez les prix dans l'onglet Mercurial. La cascade se fait automatiquement.</p>
      </div>
      <button onClick={recalc} disabled={recalculating}
        className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium disabled:opacity-50 active:bg-blue-700">
        {recalculating ? "Recalcul en cours..." : "Recalculer toute la cascade"}
      </button>
      {result && <div className="mt-3 px-3 py-2 bg-blue-50 border border-blue-200 text-blue-700 rounded-lg text-xs">{result}</div>}
    </div>
  )
}

function AdminConfig({ onFlash }: { onFlash: (m: string) => void }) {
  const [hourlyRate, setHourlyRate] = useState("")
  const [monthlyRate, setMonthlyRate] = useState("")
  const [saving, setSaving] = useState(false)
  const [computedHourly, setComputedHourly] = useState<number | null>(null)

  useEffect(() => {
    fetch("/api/admin/smic").then(r => r.json()).then(data => {
      setHourlyRate(String(data.hourlyRate ?? ""))
      setMonthlyRate(String(data.monthlyRate ?? ""))
      if (data.monthlyRate) setComputedHourly((data.monthlyRate * 12) / 11 / 151.67)
    })
  }, [])

  useEffect(() => {
    const m = parseFloat(monthlyRate)
    if (m > 0) setComputedHourly((m * 12) / 11 / 151.67)
    else setComputedHourly(null)
  }, [monthlyRate])

  const save = async () => {
    setSaving(true)
    const res = await fetch("/api/admin/smic", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hourlyRate: parseFloat(hourlyRate) || 16.33, monthlyRate: parseFloat(monthlyRate) || null }),
    })
    if (res.ok) onFlash("SMIC mis a jour")
    setSaving(false)
  }

  return (
    <div>
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-3">
        <h3 className="font-semibold text-sm mb-3">SMIC — Cout main d'oeuvre</h3>
        <p className="text-xs text-gray-500 mb-3">Le taux horaire est utilise pour calculer le cout de la main d'oeuvre dans les fiches techniques.</p>
        <div className="space-y-3">
          <label className="block">
            <span className="text-[10px] text-gray-500 uppercase">SMIC mensuel brut (€)</span>
            <input type="number" step="0.01" className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="1801.80" value={monthlyRate} onChange={e => setMonthlyRate(e.target.value)} />
            <span className="text-[10px] text-gray-400 mt-0.5 block">Formule: mensuel x 12 / 11 / 151.67h</span>
          </label>
          {computedHourly && (
            <div className="px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
              Taux horaire calcule: <strong>{computedHourly.toFixed(2)} €/h</strong>
            </div>
          )}
          <label className="block">
            <span className="text-[10px] text-gray-500 uppercase">Taux horaire direct (€/h)</span>
            <input type="number" step="0.01" className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="16.33" value={hourlyRate} onChange={e => setHourlyRate(e.target.value)} />
            <span className="text-[10px] text-gray-400 mt-0.5 block">Utilise si le mensuel n'est pas renseigne</span>
          </label>
          <button onClick={save} disabled={saving} className="w-full py-2.5 bg-orange-500 text-white rounded-xl text-sm font-medium disabled:opacity-50">
            {saving ? "..." : "Sauvegarder"}
          </button>
        </div>
      </div>
      <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-xs text-yellow-800">
        Apres modification, pensez a <strong>recalculer la cascade</strong> (onglet Ingredients) pour mettre a jour toutes les fiches techniques.
      </div>
    </div>
  )
}

function AdminProducts() {
  const [count, setCount] = useState(0)
  useEffect(() => { fetch("/api/products").then(r => r.json()).then(d => setCount(d.length)) }, [])

  return (
    <div>
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-sm"><strong>{count}</strong> produits en base</p>
        <p className="text-xs text-gray-500 mt-1">Les prix sont calcules automatiquement depuis les fiches techniques (recettes).</p>
        <p className="text-xs text-gray-500 mt-1">Modifiez les prix manuellement dans l'onglet Produits.</p>
      </div>
    </div>
  )
}
