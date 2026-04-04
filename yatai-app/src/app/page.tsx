"use client"

import { useEffect, useState } from "react"

type Restaurant = { id: number; code: string; name: string; arrondissement: string; siren?: string }
type OrderItem = { quantity: number; productId: number; unitPrice: number | null; product: { priceHt: number | null; ref: string; name: string } }
type OrderExtra = { id: number; type: string; label: string; price: number; quantity: number }
type OrderSummary = {
  id: number; year: number; month: number; restaurant: Restaurant;
  stuartPrice: number; stuartQty: number; livraisonPrice: number; livraisonQty: number;
  extras: OrderExtra[];
  items: OrderItem[]
}

const MONTHS = ["", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"]

export default function Dashboard() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [selectedRestaurant, setSelectedRestaurant] = useState<number>(0)
  const [year, setYear] = useState(2026)
  const [month, setMonth] = useState(3)
  const [allOrders, setAllOrders] = useState<OrderSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/restaurants").then(r => r.json()).then(setRestaurants)
  }, [])

  const reload = () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (selectedRestaurant) params.set("restaurantId", String(selectedRestaurant))
    if (year) params.set("year", String(year))
    if (month) params.set("month", String(month))
    fetch(`/api/orders?${params}`).then(r => r.json()).then((orders: OrderSummary[]) => {
      setAllOrders(orders)
      setLoading(false)
    })
  }

  useEffect(() => { reload() }, [selectedRestaurant, year, month])

  // Extras panel state
  const [extrasOpen, setExtrasOpen] = useState<number | null>(null)
  const [newExtra, setNewExtra] = useState({ type: "stuart", price: 0, quantity: 0 })
  const [saving, setSaving] = useState(false)
  const [plUploading, setPlUploading] = useState<number | null>(null)
  const [plResult, setPlResult] = useState<Record<number, { success?: boolean; error?: string; invoiceId?: number; amount?: string }>>({})
  // Y Chateaudun (labo SIREN 913995627) is the issuer — cannot self-invoice
  const LABO_SIREN = '913995627'

  const uploadToPennylane = async (restaurantId: number) => {
    setPlUploading(restaurantId)
    setPlResult(prev => { const next = { ...prev }; delete next[restaurantId]; return next })
    try {
      const res = await fetch("/api/pennylane", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantId, year, month }),
      })
      const data = await res.json()
      if (res.ok) setPlResult(prev => ({ ...prev, [restaurantId]: { success: true, invoiceId: data.invoiceId, amount: data.amount } }))
      else setPlResult(prev => ({ ...prev, [restaurantId]: { error: data.error || "Erreur Pennylane" } }))
    } catch (e) {
      setPlResult(prev => ({ ...prev, [restaurantId]: { error: String(e) } }))
    }
    setPlUploading(null)
  }

  const addExtra = async (restaurantId: number) => {
    setSaving(true)
    await fetch("/api/orders/extras", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurantId, year, month, ...newExtra }),
    })
    setNewExtra({ type: "stuart", price: 0, quantity: 0 })
    setSaving(false)
    reload()
  }

  const deleteExtra = async (id: number) => {
    await fetch(`/api/orders/extras?id=${id}`, { method: "DELETE" })
    reload()
  }

  const restaurantSummary = allOrders.map(o => {
    const extras = o.extras || []
    const extrasTotal = extras.reduce((s, e) => s + e.price * e.quantity, 0)
    // Legacy fields fallback (for old orders without extras rows)
    const legacyStuart = (o.stuartPrice || 0) * (o.stuartQty || 0)
    const legacyLivr = (o.livraisonPrice || 0) * (o.livraisonQty || 0)
    const legacyTotal = extras.length > 0 ? 0 : legacyStuart + legacyLivr

    return {
      restaurant: o.restaurant,
      total: o.items.reduce((s, i) => s + i.quantity * (i.unitPrice ?? i.product.priceHt ?? 0), 0),
      extrasTotal: extrasTotal + legacyTotal,
      extras,
      items: o.items.reduce((s, i) => s + i.quantity, 0),
      uniqueProducts: new Set(o.items.map(i => i.productId)).size,
    }
  })

  const grandTotal = restaurantSummary.reduce((s, r) => s + r.total, 0)
  const grandExtras = restaurantSummary.reduce((s, r) => s + r.extrasTotal, 0)
  const grandItems = restaurantSummary.reduce((s, r) => s + r.items, 0)

  return (
    <div className="overflow-hidden">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-3">Dashboard</h1>
        <div className="flex flex-wrap gap-2">
          <select value={selectedRestaurant} onChange={e => setSelectedRestaurant(Number(e.target.value))} className="rounded-lg border border-gray-300 px-3 py-2 text-sm flex-1 min-w-0">
            <option value={0}>Tous les restaurants</option>
            {restaurants.map(r => <option key={r.id} value={r.id}>{r.name} ({r.arrondissement})</option>)}
          </select>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
            {MONTHS.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
            {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KPICard title="Montant total HT" value={`${(grandTotal + grandExtras).toFixed(2)} €`} color="blue" />
        <KPICard title="Quantités totales" value={String(Math.round(grandItems * 100) / 100)} color="green" />
        <KPICard title="Mois actifs" value={String(allOrders.length)} color="purple" />
        <KPICard title="Restaurants actifs" value={String(restaurantSummary.length)} color="orange" />
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-8">
        <div className="px-4 md:px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900 text-sm md:text-base">Résumé — {MONTHS[month]} {year}</h2>
          {selectedRestaurant > 0 && (
            <div className="flex gap-2">
              <a href={`/api/export?restaurantId=${selectedRestaurant}&year=${year}&month=${month}`}
                className="inline-flex items-center gap-2 bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-700">
                Excel
              </a>
              {restaurants.find(r => r.id === selectedRestaurant)?.siren !== LABO_SIREN && (
                <button onClick={() => uploadToPennylane(selectedRestaurant)} disabled={plUploading !== null}
                  className="inline-flex items-center gap-2 bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-indigo-700 disabled:opacity-50">
                  {plUploading === selectedRestaurant ? "..." : "Pennylane"}
                </button>
              )}
            </div>
          )}
        </div>
        {loading ? (
          <div className="p-8 text-center text-gray-400">Chargement...</div>
        ) : restaurantSummary.length === 0 ? (
          <div className="p-8 text-center text-gray-400">Aucune commande pour cette période</div>
        ) : (
          <div>
            {restaurantSummary.map(s => {
              const totalWithExtras = s.total + s.extrasTotal
              const isOpen = extrasOpen === s.restaurant.id
              return (
                <div key={s.restaurant.id} className="border-t border-gray-100">
                  <div className="px-4 md:px-6 py-3 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">{s.restaurant.name}</p>
                      <p className="text-xs text-gray-400">{s.restaurant.arrondissement} — {s.uniqueProducts} produits, {Math.round(s.items)} qté</p>
                    </div>
                    <div className="text-right flex items-center gap-2">
                      <span className="font-mono font-bold text-sm">{totalWithExtras.toFixed(0)} €</span>
                      <a href={`/api/export?restaurantId=${s.restaurant.id}&year=${year}&month=${month}`}
                         className="text-green-600 hover:text-green-800 text-xs font-medium">Excel</a>
                      {s.restaurant.siren !== LABO_SIREN && (
                        <button onClick={() => uploadToPennylane(s.restaurant.id)} disabled={plUploading === s.restaurant.id}
                          className="text-indigo-600 hover:text-indigo-800 text-xs font-medium disabled:opacity-50">
                          {plUploading === s.restaurant.id ? "..." : "PL"}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Pennylane result */}
                  {plResult[s.restaurant.id] && (
                    <div className={`px-4 md:px-6 py-1.5 text-[11px] ${plResult[s.restaurant.id].success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                      {plResult[s.restaurant.id].success
                        ? `Brouillon cree — ${plResult[s.restaurant.id].amount} €`
                        : plResult[s.restaurant.id].error}
                    </div>
                  )}

                  {/* Extras list */}
                  <div className="px-4 md:px-6 pb-3 flex flex-wrap gap-2 items-center">
                    {s.extras.map(e => (
                      <span key={e.id} className={`text-[11px] px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${e.type === 'stuart' ? 'bg-indigo-50 text-indigo-700' : 'bg-amber-50 text-amber-700'}`}>
                        {e.type === 'stuart' ? 'Stuart' : 'Livraison'}: {e.quantity} x {e.price.toFixed(2)} € = {(e.price * e.quantity).toFixed(2)} €
                        <button onClick={() => deleteExtra(e.id)} className="ml-1 text-red-400 hover:text-red-600 font-bold">×</button>
                      </span>
                    ))}
                    <button onClick={() => setExtrasOpen(isOpen ? null : s.restaurant.id)}
                      className="text-[11px] text-gray-400 hover:text-gray-600">
                      {isOpen ? "Fermer" : "+ Stuart / Livraison"}
                    </button>
                  </div>

                  {isOpen && (
                    <div className="px-4 md:px-6 pb-3">
                      <div className="bg-gray-50 rounded-xl p-3 space-y-3">
                        <div className="grid grid-cols-[1fr_auto_4rem] gap-2 items-center">
                          <select value={newExtra.type} onChange={e => setNewExtra({ ...newExtra, type: e.target.value })}
                            className="col-span-3 border rounded-lg px-2 py-1.5 text-sm">
                            <option value="stuart">Stuart</option>
                            <option value="livraison">Livraison</option>
                          </select>
                          <input type="number" step="0.01" placeholder="Tarif €"
                            value={newExtra.price || ""} onChange={e => { const v = parseFloat(e.target.value); setNewExtra({ ...newExtra, price: isNaN(v) ? 0 : v }) }}
                            className="border rounded-lg px-2 py-1.5 text-sm min-w-0" />
                          <span className="text-xs text-gray-400 text-center">×</span>
                          <input type="number" min="0" placeholder="Qté"
                            value={newExtra.quantity || ""} onChange={e => { const v = parseInt(e.target.value); setNewExtra({ ...newExtra, quantity: isNaN(v) ? 0 : v }) }}
                            className="border rounded-lg px-2 py-1.5 text-sm text-center" />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => addExtra(s.restaurant.id)} disabled={saving || !newExtra.price || !newExtra.quantity}
                            className="flex-1 bg-green-600 text-white py-2 rounded-lg text-xs font-medium disabled:opacity-50">
                            {saving ? "..." : "Ajouter"}
                          </button>
                          <button onClick={() => setExtrasOpen(null)} className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-lg text-xs">Fermer</button>
                        </div>
                        <p className="text-[10px] text-gray-400">TVA 20% appliquée dans l'export Pennylane</p>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
            <div className="border-t-2 border-gray-300 bg-gray-50 px-4 md:px-6 py-3 flex items-center justify-between font-bold">
              <span className="text-sm">Total</span>
              <span className="font-mono text-sm">{(grandTotal + grandExtras).toFixed(0)} €</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function KPICard({ title, value, color }: { title: string; value: string; color: string }) {
  const colors: Record<string, string> = {
    blue: "bg-blue-50 border-blue-200 text-blue-700",
    green: "bg-green-50 border-green-200 text-green-700",
    purple: "bg-purple-50 border-purple-200 text-purple-700",
    orange: "bg-orange-50 border-orange-200 text-orange-700",
  }
  return (
    <div className={`rounded-xl border p-3 md:p-5 overflow-hidden ${colors[color]}`}>
      <p className="text-[10px] md:text-xs font-medium opacity-70 uppercase truncate">{title}</p>
      <p className="text-base md:text-2xl font-bold mt-0.5 truncate">{value}</p>
    </div>
  )
}
