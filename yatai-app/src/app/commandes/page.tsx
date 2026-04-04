"use client"

import { useEffect, useState, useCallback } from "react"

type Restaurant = { id: number; code: string; name: string; arrondissement: string }
type Product = { id: number; ref: string; name: string; priceHt: number | null; unit: string | null }
type OcrEntry = { ref: string; name: string; quantity: number; confidence: string; productId: number | null }

const MONTHS = ["", "Janvier", "Fevrier", "Mars", "Avril", "Mai", "Juin", "Juillet", "Aout", "Septembre", "Octobre", "Novembre", "Decembre"]

export default function CommandesPage() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [restaurantId, setRestaurantId] = useState(0)
  const [year, setYear] = useState(2026)
  const [month, setMonth] = useState(3)
  const [day, setDay] = useState(1)
  const [grid, setGrid] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [priceGrid, setPriceGrid] = useState<Map<string, number | null>>(new Map())
  const [editingPrice, setEditingPrice] = useState<number | null>(null)
  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrResults, setOcrResults] = useState<OcrEntry[] | null>(null)
  const [ocrPhotos, setOcrPhotos] = useState<File[]>([])
  const [ocrProgress, setOcrProgress] = useState("")
  const [showOcr, setShowOcr] = useState(false)
  const [search, setSearch] = useState("")

  useEffect(() => {
    Promise.all([fetch("/api/restaurants").then(r => r.json()), fetch("/api/products").then(r => r.json())])
      .then(([r, p]) => { setRestaurants(r); setProducts(p); if (r.length > 0) setRestaurantId(r[0].id) })
  }, [])

  const loadData = useCallback(() => {
    if (!restaurantId) return
    setLoading(true)
    fetch(`/api/orders?restaurantId=${restaurantId}&year=${year}&month=${month}`).then(r => r.json()).then(orders => {
      const newGrid = new Map<string, number>()
      const newPrices = new Map<string, number | null>()
      if (orders.length > 0) for (const item of orders[0].items) {
        newGrid.set(`${item.productId}-${item.day}`, item.quantity)
        if (item.unitPrice != null) newPrices.set(`${item.productId}-${item.day}`, item.unitPrice)
      }
      setGrid(newGrid)
      setPriceGrid(newPrices)
      setDirty(new Set())
      setLoading(false)
    })
  }, [restaurantId, year, month])

  useEffect(() => { loadData() }, [loadData])

  const daysInMonth = new Date(year, month, 0).getDate()

  const setCell = (productId: number, value: number) => {
    const key = `${productId}-${day}`
    const newGrid = new Map(grid)
    if (value > 0) newGrid.set(key, value); else newGrid.delete(key)
    setGrid(newGrid)
    setDirty(prev => new Set(prev).add(key))
  }

  const setPrice = (productId: number, value: number | null) => {
    const key = `${productId}-${day}`
    const newPrices = new Map(priceGrid)
    if (value != null) newPrices.set(key, value); else newPrices.delete(key)
    setPriceGrid(newPrices)
    setDirty(prev => new Set(prev).add(key))
  }

  const save = async () => {
    setSaving(true)
    const entries: { productId: number; day: number; quantity: number; unitPrice?: number | null }[] = []
    for (const key of dirty) {
      const [pid, d] = key.split("-").map(Number)
      entries.push({ productId: pid, day: d, quantity: grid.get(key) || 0, unitPrice: priceGrid.get(key) ?? null })
    }
    await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restaurantId, year, month, entries }) })
    setDirty(new Set())
    setSaving(false)
  }

  // Multi-photo OCR
  const addOcrPhotos = (files: FileList) => {
    setOcrPhotos(prev => [...prev, ...Array.from(files)])
  }

  const processOcr = async () => {
    if (ocrPhotos.length === 0) return
    setOcrLoading(true); setOcrResults(null)
    const allEntries: OcrEntry[] = []

    for (let i = 0; i < ocrPhotos.length; i++) {
      setOcrProgress(`Analyse photo ${i + 1}/${ocrPhotos.length}...`)
      const formData = new FormData()
      formData.append("image", ocrPhotos[i]); formData.append("restaurantId", String(restaurantId))
      formData.append("year", String(year)); formData.append("month", String(month)); formData.append("day", String(day))
      try {
        const res = await fetch("/api/ocr", { method: "POST", body: formData })
        const data = await res.json()
        if (data.entries) {
          for (const entry of data.entries) {
            const existing = allEntries.find(e => e.ref === entry.ref)
            if (existing) existing.quantity += entry.quantity
            else allEntries.push(entry)
          }
        }
      } catch { /* continue with next photo */ }
    }

    setOcrResults(allEntries)
    setOcrProgress("")
    setOcrLoading(false)
  }

  const applyOcr = () => {
    if (!ocrResults) return
    const newGrid = new Map(grid); const newDirty = new Set(dirty)
    for (const entry of ocrResults) {
      if (entry.productId && entry.quantity > 0) { const key = `${entry.productId}-${day}`; newGrid.set(key, entry.quantity); newDirty.add(key) }
    }
    setGrid(newGrid); setDirty(newDirty); setOcrResults(null); setShowOcr(false); setOcrPhotos([])
  }

  const dayTotal = products.reduce((sum, p) => {
    const key = `${p.id}-${day}`
    const qty = grid.get(key) || 0
    const price = priceGrid.get(key) ?? p.priceHt ?? 0
    return sum + qty * price
  }, 0)

  const dayProducts = products.filter(p => {
    const hasQty = (grid.get(`${p.id}-${day}`) || 0) > 0
    if (search) return p.name.toLowerCase().includes(search.toLowerCase()) || p.ref.toLowerCase().includes(search.toLowerCase())
    return hasQty
  })
  const showAll = search.length > 0
  const displayProducts = showAll ? dayProducts : dayProducts.length > 0 ? dayProducts : products

  return (
    <div>
      <div className="mb-3">
        <h1 className="text-xl md:text-2xl font-bold text-gray-900">Commandes</h1>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <select value={restaurantId} onChange={e => setRestaurantId(Number(e.target.value))} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm flex-1 min-w-0">
          {restaurants.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <select value={month} onChange={e => setMonth(Number(e.target.value))} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
          {MONTHS.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
        </select>
        <select value={year} onChange={e => setYear(Number(e.target.value))} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
          {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      <div className="mb-3">
        <div className="flex gap-1 overflow-x-auto pb-2 scrollbar-hide">
          {Array.from({ length: daysInMonth }, (_, i) => {
            const d = i + 1
            const hasOrders = products.some(p => (grid.get(`${p.id}-${d}`) || 0) > 0)
            return (
              <button key={d} onClick={() => setDay(d)}
                className={`shrink-0 w-9 h-9 rounded-full text-sm font-medium transition-colors
                  ${day === d ? "bg-orange-500 text-white" : hasOrders ? "bg-orange-100 text-orange-700" : "bg-gray-100 text-gray-600"}`}>
                {d}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex gap-2 mb-3">
        <button onClick={() => setShowOcr(!showOcr)} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${showOcr ? "bg-purple-700 text-white" : "bg-purple-600 text-white"}`}>
          OCR {ocrPhotos.length > 0 && `(${ocrPhotos.length})`}
        </button>
        {dirty.size > 0 && <button onClick={save} disabled={saving} className="bg-orange-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50">{saving ? "..." : `Sauvegarder (${dirty.size})`}</button>}
        <div className="flex-1">
          <input type="text" placeholder="Ajouter un produit..." value={search} onChange={e => setSearch(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
        </div>
      </div>

      {/* OCR panel — multi-photo */}
      {showOcr && (
        <div className="bg-white rounded-xl shadow-sm border border-purple-200 p-4 mb-3">
          <h3 className="font-semibold text-sm text-gray-900 mb-2">Scanner des bons — Jour {day}</h3>

          {/* Photo upload area */}
          <div className="mb-3">
            <label className="block w-full border-2 border-dashed border-purple-300 rounded-xl p-4 text-center cursor-pointer hover:bg-purple-50 transition-colors">
              <span className="text-purple-600 text-sm font-medium">Ajouter des photos</span>
              <span className="block text-xs text-gray-500 mt-1">Appareil photo ou galerie</span>
              <input type="file" accept="image/*" multiple className="hidden"
                onChange={e => { if (e.target.files) addOcrPhotos(e.target.files) }} />
            </label>
          </div>

          {/* Photo thumbnails */}
          {ocrPhotos.length > 0 && (
            <div className="flex gap-2 overflow-x-auto mb-3 pb-1">
              {ocrPhotos.map((file, i) => (
                <div key={i} className="relative shrink-0">
                  <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden">
                    <img src={URL.createObjectURL(file)} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                  </div>
                  <button onClick={() => setOcrPhotos(prev => prev.filter((_, j) => j !== i))}
                    className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center">x</button>
                </div>
              ))}
            </div>
          )}

          {/* Process button */}
          {ocrPhotos.length > 0 && !ocrResults && (
            <button onClick={processOcr} disabled={ocrLoading}
              className="w-full py-2.5 bg-purple-600 text-white rounded-xl text-sm font-medium disabled:opacity-50 mb-2">
              {ocrLoading ? ocrProgress || "Analyse..." : `Analyser ${ocrPhotos.length} photo${ocrPhotos.length > 1 ? "s" : ""}`}
            </button>
          )}

          {/* Results */}
          {ocrResults && (
            <div>
              <p className="text-xs text-gray-500 mb-2">{ocrResults.length} produits detectes</p>
              {ocrResults.map((entry, i) => (
                <div key={i} className={`flex items-center justify-between py-1.5 border-b border-gray-100 ${entry.confidence === 'low' ? 'bg-red-50 px-2 rounded' : ''}`}>
                  <span className="text-sm truncate flex-1">{entry.ref} {entry.name}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <input type="number" value={entry.quantity} onChange={e => { const nr = [...ocrResults]; nr[i] = { ...entry, quantity: parseFloat(e.target.value) || 0 }; setOcrResults(nr) }}
                      className="w-16 text-right border rounded px-2 py-1 text-sm" />
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${entry.confidence === 'high' ? 'bg-green-100 text-green-700' : entry.confidence === 'medium' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>{entry.confidence}</span>
                  </div>
                </div>
              ))}
              <div className="flex gap-2 mt-3">
                <button onClick={applyOcr} className="flex-1 bg-green-600 text-white py-2 rounded-lg text-sm font-medium">Appliquer</button>
                <button onClick={() => { setOcrResults(null); setOcrPhotos([]) }} className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-lg text-sm">Annuler</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-2 mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-orange-800">Jour {day} — {MONTHS[month]}</span>
        <span className="text-lg font-bold text-orange-700">{dayTotal.toFixed(2)} € HT</span>
      </div>

      {loading ? (
        <div className="text-center text-gray-400 py-8">Chargement...</div>
      ) : (
        <div className="space-y-1.5">
          {displayProducts.map(product => {
            const key = `${product.id}-${day}`
            const qty = grid.get(key) || 0
            const overridePrice = priceGrid.get(key)
            const effectivePrice = overridePrice ?? product.priceHt ?? 0
            const amount = qty * effectivePrice
            const isEditing = editingPrice === product.id
            return (
              <div key={product.id} className="bg-white rounded-xl border border-gray-200 px-4 py-2.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono text-gray-400">{product.ref}</span>
                    <span className="text-sm font-medium truncate">{product.name}</span>
                  </div>
                  <div className="text-xs text-gray-500 flex items-center gap-1 flex-wrap">
                    {isEditing ? (
                      <span className="inline-flex items-center gap-1">
                        <input type="number" step="0.01" inputMode="decimal" autoFocus
                          defaultValue={effectivePrice || ""}
                          onBlur={e => { const v = parseFloat(e.target.value); setPrice(product.id, isNaN(v) ? null : v); setEditingPrice(null) }}
                          onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
                          className="w-20 border-2 border-blue-400 rounded px-2 py-1 text-sm text-right" />
                        <span>€/{product.unit || "u"}</span>
                      </span>
                    ) : (
                      <button onClick={() => setEditingPrice(product.id)} className={`py-1 px-1.5 -mx-1.5 rounded ${overridePrice != null ? "text-blue-600 font-medium bg-blue-50" : "active:bg-gray-100"}`}>
                        {effectivePrice.toFixed(2)} €/{product.unit || "u"} ✎
                      </button>
                    )}
                    {qty > 0 && amount > 0 && <span className="text-orange-600 font-medium">= {amount.toFixed(2)} €</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => setCell(product.id, Math.max(0, qty - 1))}
                    className="w-8 h-8 rounded-lg bg-gray-100 text-gray-600 text-lg font-bold flex items-center justify-center active:bg-gray-200">−</button>
                  <input type="number" min={0} value={qty || ""} onChange={e => setCell(product.id, parseFloat(e.target.value) || 0)}
                    className="w-14 h-8 text-center text-sm font-bold border border-gray-300 rounded-lg" />
                  <button onClick={() => setCell(product.id, qty + 1)}
                    className="w-8 h-8 rounded-lg bg-orange-100 text-orange-700 text-lg font-bold flex items-center justify-center active:bg-orange-200">+</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
