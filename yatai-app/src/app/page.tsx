"use client"

import { useEffect, useState } from "react"

type Restaurant = { id: number; code: string; name: string; arrondissement: string }
type OrderItem = { quantity: number; productId: number; product: { priceHt: number | null; ref: string; name: string } }
type OrderSummary = {
  id: number; year: number; month: number; restaurant: Restaurant;
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

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (selectedRestaurant) params.set("restaurantId", String(selectedRestaurant))
    if (year) params.set("year", String(year))
    if (month) params.set("month", String(month))
    fetch(`/api/orders?${params}`).then(r => r.json()).then((orders: OrderSummary[]) => {
      setAllOrders(orders)
      setLoading(false)
    })
  }, [selectedRestaurant, year, month])

  const restaurantSummary = allOrders.map(o => ({
    restaurant: o.restaurant,
    total: o.items.reduce((s, i) => s + i.quantity * (i.product.priceHt || 0), 0),
    items: o.items.reduce((s, i) => s + i.quantity, 0),
    uniqueProducts: new Set(o.items.map(i => i.productId)).size,
  }))

  const grandTotal = restaurantSummary.reduce((s, r) => s + r.total, 0)
  const grandItems = restaurantSummary.reduce((s, r) => s + r.items, 0)

  return (
    <div>
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
        <KPICard title="Montant total HT" value={`${grandTotal.toFixed(2)} €`} color="blue" />
        <KPICard title="Quantités totales" value={String(Math.round(grandItems * 100) / 100)} color="green" />
        <KPICard title="Mois actifs" value={String(allOrders.length)} color="purple" />
        <KPICard title="Restaurants actifs" value={String(restaurantSummary.length)} color="orange" />
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-8">
        <div className="px-4 md:px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900 text-sm md:text-base">Résumé — {MONTHS[month]} {year}</h2>
          {selectedRestaurant > 0 && (
            <a href={`/api/export?restaurantId=${selectedRestaurant}&year=${year}&month=${month}`}
              className="inline-flex items-center gap-2 bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-700">
              Pennylane
            </a>
          )}
        </div>
        {loading ? (
          <div className="p-8 text-center text-gray-400">Chargement...</div>
        ) : restaurantSummary.length === 0 ? (
          <div className="p-8 text-center text-gray-400">Aucune commande pour cette période</div>
        ) : (
          <div>
            {restaurantSummary.map(s => (
              <div key={s.restaurant.id} className="border-t border-gray-100 px-4 md:px-6 py-3 flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">{s.restaurant.name}</p>
                  <p className="text-xs text-gray-400">{s.restaurant.arrondissement} — {s.uniqueProducts} produits, {Math.round(s.items)} qté</p>
                </div>
                <div className="text-right flex items-center gap-3">
                  <span className="font-mono font-bold text-sm">{s.total.toFixed(0)} €</span>
                  <a href={`/api/export?restaurantId=${s.restaurant.id}&year=${year}&month=${month}`}
                     className="text-green-600 hover:text-green-800 text-xs font-medium">Export</a>
                </div>
              </div>
            ))}
            <div className="border-t-2 border-gray-300 bg-gray-50 px-4 md:px-6 py-3 flex items-center justify-between font-bold">
              <span className="text-sm">Total</span>
              <span className="font-mono text-sm">{grandTotal.toFixed(0)} €</span>
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
    <div className={`rounded-xl border p-3 md:p-5 ${colors[color]}`}>
      <p className="text-[10px] md:text-xs font-medium opacity-70 uppercase">{title}</p>
      <p className="text-lg md:text-2xl font-bold mt-0.5">{value}</p>
    </div>
  )
}
