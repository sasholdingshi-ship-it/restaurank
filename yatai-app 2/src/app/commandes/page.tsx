"use client"

import { useEffect, useState, useCallback } from "react"

type Restaurant = { id: number; code: string; name: string; arrondissement: string }
type Product = { id: number; ref: string; name: string; priceHt: number | null; unit: string | null }
type OrderItem = { productId: number; day: number; quantity: number }
type Stat = { productId: number; ref: string; name: string; avg: number; min: number; max: number }
type OcrEntry = { ref: string; name: string; quantity: number; confidence: string; productId: number | null; priceHt: number | null; unit: string | null }

const MONTHS = ["", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"]

export default function CommandesPage() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [restaurantId, setRestaurantId] = useState(0)
  const [year, setYear] = useState(2026)
  const [month, setMonth] = useState(3)
  const [grid, setGrid] = useState<Map<string, number>>(new Map()) // "productId-day" → quantity
  const [stats, setStats] = useState<Map<number, Stat>>(new Map())
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [ocrDay, setOcrDay] = useState(1)
  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrResults, setOcrResults] = useState<OcrEntry[] | null>(null)
  const [ocrNotes, setOcrNotes] = useState("")
  const [showOcr, setShowOcr] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch("/api/restaurants").then(r => r.json()),
      fetch("/api/products").then(r => r.json()),
    ]).then(([r, p]) => {
      setRestaurants(r)
      setProducts(p)
      if (r.length > 0) setRestaurantId(r[0].id)
    })
  }, [])

  const loadData = useCallback(() => {
    if (!restaurantId) return
    setLoading(true)

    Promise.all([
      fetch(`/api/orders?restaurantId=${restaurantId}&year=${year}&month=${month}`).then(r => r.json()),
      fetch(`/api/stats?restaurantId=${restaurantId}`).then(r => r.json()),
    ]).then(([orders, statsData]) => {
      const newGrid = new Map<string, number>()
      if (orders.length > 0) {
        for (const item of orders[0].items) {
          newGrid.set(`${item.productId}-${item.day}`, item.quantity)
        }
      }
      setGrid(newGrid)

      const newStats = new Map<number, Stat>()
      for (const s of statsData) newStats.set(s.productId, s)
      setStats(newStats)

      setDirty(new Set())
      setLoading(false)
    })
  }, [restaurantId, year, month])

  useEffect(() => { loadData() }, [loadData])

  const daysInMonth = new Date(year, month, 0).getDate()

  const setCell = (productId: number, day: number, value: number) => {
    const key = `${productId}-${day}`
    const newGrid = new Map(grid)
    if (value > 0) newGrid.set(key, value)
    else newGrid.delete(key)
    setGrid(newGrid)
    setDirty(prev => new Set(prev).add(key))
  }

  const save = async () => {
    setSaving(true)
    const entries: { productId: number; day: number; quantity: number }[] = []
    for (const key of dirty) {
      const [pid, d] = key.split("-").map(Number)
      entries.push({ productId: pid, day: d, quantity: grid.get(key) || 0 })
    }
    await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurantId, year, month, entries }),
    })
    setDirty(new Set())
    setSaving(false)
  }

  const handleOcrUpload = async (file: File) => {
    setOcrLoading(true)
    setOcrResults(null)
    const formData = new FormData()
    formData.append("image", file)
    formData.append("restaurantId", String(restaurantId))
    formData.append("year", String(year))
    formData.append("month", String(month))
    formData.append("day", String(ocrDay))
    try {
      const res = await fetch("/api/ocr", { method: "POST", body: formData })
      const data = await res.json()
      if (data.entries) {
        setOcrResults(data.entries)
        setOcrNotes(data.notes || "")
      } else {
        setOcrNotes(data.error || "Erreur OCR")
      }
    } catch (e) {
      setOcrNotes("Erreur réseau")
    }
    setOcrLoading(false)
  }

  const applyOcr = () => {
    if (!ocrResults) return
    const newGrid = new Map(grid)
    const newDirty = new Set(dirty)
    for (const entry of ocrResults) {
      if (entry.productId && entry.quantity > 0) {
        const key = `${entry.productId}-${ocrDay}`
        newGrid.set(key, entry.quantity)
        newDirty.add(key)
      }
    }
    setGrid(newGrid)
    setDirty(newDirty)
    setOcrResults(null)
    setShowOcr(false)
  }

  // Get product total for the month
  const getProductTotal = (productId: number) => {
    let total = 0
    for (let d = 1; d <= daysInMonth; d++) {
      total += grid.get(`${productId}-${d}`) || 0
    }
    return total
  }

  // Anomaly detection
  const getAnomaly = (productId: number, value: number): string => {
    const stat = stats.get(productId)
    if (!stat || !value || stat.avg === 0) return ""
    if (value > stat.avg * 3) return "bg-red-100 text-red-800"
    if (value > stat.avg * 2) return "bg-orange-100 text-orange-800"
    return ""
  }

  // Filter products that have any data this month
  const activeProducts = products.filter(p => {
    for (let d = 1; d <= daysInMonth; d++) {
      if (grid.has(`${p.id}-${d}`)) return true
    }
    return false
  })

  const displayProducts = activeProducts.length > 0 ? activeProducts : products.slice(0, 20)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Saisie Commandes</h1>
        <div className="flex gap-3 items-center">
          <select value={restaurantId} onChange={e => setRestaurantId(Number(e.target.value))} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
            {restaurants.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
            {MONTHS.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
            {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={() => setShowOcr(!showOcr)} className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-700">
            OCR Photo
          </button>
          {dirty.size > 0 && (
            <button onClick={save} disabled={saving} className="bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-orange-600 disabled:opacity-50">
              {saving ? "Sauvegarde..." : `Sauvegarder (${dirty.size})`}
            </button>
          )}
        </div>
      </div>

      {/* OCR Panel */}
      {showOcr && (
        <div className="bg-white rounded-xl shadow-sm border border-purple-200 p-5 mb-6">
          <h3 className="font-semibold text-gray-900 mb-3">Scanner un bon de commande</h3>
          <div className="flex gap-4 items-end mb-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Jour</label>
              <select value={ocrDay} onChange={e => setOcrDay(Number(e.target.value))} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
                {Array.from({ length: daysInMonth }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Photo du bon</label>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={e => { if (e.target.files?.[0]) handleOcrUpload(e.target.files[0]) }}
                className="text-sm"
              />
            </div>
            {ocrLoading && <span className="text-sm text-purple-600 animate-pulse">Analyse en cours...</span>}
          </div>

          {ocrNotes && <p className="text-xs text-gray-500 mb-3">{ocrNotes}</p>}

          {ocrResults && (
            <div>
              <table className="w-full text-sm mb-3">
                <thead>
                  <tr className="text-xs text-gray-500 uppercase border-b">
                    <th className="py-2 text-left">Réf</th>
                    <th className="py-2 text-left">Produit</th>
                    <th className="py-2 text-right">Quantité</th>
                    <th className="py-2 text-center">Confiance</th>
                  </tr>
                </thead>
                <tbody>
                  {ocrResults.map((entry, i) => (
                    <tr key={i} className={`border-t ${entry.confidence === 'low' ? 'bg-red-50' : entry.confidence === 'medium' ? 'bg-yellow-50' : ''}`}>
                      <td className="py-1.5 font-mono text-gray-400">{entry.ref}</td>
                      <td className="py-1.5">{entry.name}</td>
                      <td className="py-1.5 text-right">
                        <input
                          type="number"
                          value={entry.quantity}
                          onChange={e => {
                            const newResults = [...ocrResults]
                            newResults[i] = { ...entry, quantity: parseFloat(e.target.value) || 0 }
                            setOcrResults(newResults)
                          }}
                          className="w-20 text-right border rounded px-2 py-1 text-sm"
                        />
                      </td>
                      <td className="py-1.5 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          entry.confidence === 'high' ? 'bg-green-100 text-green-700' :
                          entry.confidence === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-red-100 text-red-700'
                        }`}>{entry.confidence}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex gap-3">
                <button onClick={applyOcr} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700">
                  Appliquer au jour {ocrDay}
                </button>
                <button onClick={() => { setOcrResults(null); setShowOcr(false) }} className="text-gray-500 px-4 py-2 rounded-lg text-sm hover:bg-gray-100">
                  Annuler
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="text-center text-gray-400 py-12">Chargement...</div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-auto">
          <table className="text-xs">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-2 py-2 text-left sticky left-0 bg-gray-50 z-10 min-w-[140px]">Produit</th>
                <th className="px-1 py-2 text-right min-w-[50px]">Prix</th>
                {Array.from({ length: daysInMonth }, (_, i) => (
                  <th key={i} className="px-1 py-2 text-center min-w-[36px]">{i + 1}</th>
                ))}
                <th className="px-2 py-2 text-right bg-gray-100 min-w-[50px]">Total</th>
                <th className="px-2 py-2 text-right bg-gray-100 min-w-[60px]">Montant</th>
                <th className="px-2 py-2 text-right bg-blue-50 min-w-[40px]">Moy</th>
                <th className="px-2 py-2 text-right bg-green-50 min-w-[40px]">Min</th>
                <th className="px-2 py-2 text-right bg-red-50 min-w-[40px]">Max</th>
              </tr>
            </thead>
            <tbody>
              {displayProducts.map(product => {
                const total = getProductTotal(product.id)
                const stat = stats.get(product.id)
                return (
                  <tr key={product.id} className="border-t border-gray-100 hover:bg-gray-50/50">
                    <td className="px-2 py-1 sticky left-0 bg-white font-medium truncate max-w-[140px]" title={product.name}>
                      <span className="text-gray-400 mr-1">{product.ref}</span>
                      {product.name}
                    </td>
                    <td className="px-1 py-1 text-right font-mono text-gray-500">{product.priceHt?.toFixed(1) ?? "—"}</td>
                    {Array.from({ length: daysInMonth }, (_, i) => {
                      const day = i + 1
                      const val = grid.get(`${product.id}-${day}`) || 0
                      const anomaly = getAnomaly(product.id, val)
                      return (
                        <td key={day} className={`px-0 py-0 text-center ${anomaly}`}>
                          <input
                            type="number"
                            min={0}
                            step="any"
                            value={val || ""}
                            onChange={e => setCell(product.id, day, parseFloat(e.target.value) || 0)}
                            className={`w-full h-full text-center text-xs py-1 border-0 bg-transparent focus:bg-blue-50 focus:outline-none ${anomaly}`}
                            placeholder=""
                          />
                        </td>
                      )
                    })}
                    <td className="px-2 py-1 text-right font-bold bg-gray-50">{total || ""}</td>
                    <td className="px-2 py-1 text-right font-mono bg-gray-50">{total && product.priceHt ? (total * product.priceHt).toFixed(1) : ""}</td>
                    <td className="px-2 py-1 text-right bg-blue-50/50">{stat?.avg?.toFixed(1) ?? ""}</td>
                    <td className="px-2 py-1 text-right bg-green-50/50">{stat?.min ?? ""}</td>
                    <td className="px-2 py-1 text-right bg-red-50/50">{stat?.max ?? ""}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div className="flex gap-4 mt-4 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-100 border border-orange-300"></span> 2-3x moyenne</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-100 border border-red-300"></span> &gt;3x moyenne</span>
      </div>
    </div>
  )
}
