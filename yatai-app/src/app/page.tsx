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
type Correlation = {
  restaurantId: number; name: string; arrondissement: string
  rekkiHT: number; rekkiFoodCost: number
  zeltyHT: number; zeltyTTC: number; zeltyOrders: number
  zeltyEatIn: number; zeltyTakeaway: number; zeltyDelivery: number
  foodCostRatio: number; rekkiRatio: number
}
type ProductCorrelation = {
  yataiName: string; yataiQty: number; yataiRekkiHT: number
  matchedZelty: { name: string; qty: number; score: number }[]
  totalZeltyQty: number
  ratio: number | null
}
type ProductCorrelationData = {
  yataiProductsTotal: number; zeltyDishesTotal: number
  matchedCount: number; unmatchedCount: number
  correlations: ProductCorrelation[]
  unmatchedZelty: { name: string; qty: number }[]
}
type RecipeRow = {
  recipe: string; category: string; portionsSold: number
  matchedZeltyDishes: { name: string; qty: number }[]
  unmappedZelty: boolean
}
type RecipeProductRow = {
  yataiProduct: string
  actualQty: number; actualHT: number
  expectedQty: number
  ratio: number | null
  contributingIngredients: { name: string; expected: number }[]
}
type RecipeCorrelationData = {
  recipesTotal: number; recipesMatched: number
  recipesUnmapped: string[]
  recipes: RecipeRow[]
  products: RecipeProductRow[]
  unmatchedZelty: { name: string; qty: number }[]
  unmatchedYatai: { name: string; qty: number; rekkiHT: number }[]
}
type CostsData = {
  revenue: number; foodCost: number; foodCostPercent: number; foodCostReel: number | null
  staffCostTheo: number; staffCostTheoPercent: number; staffCostReel: number | null
  venteDarkKitchen: number | null; venteAnnexe: number | null
  loyer: number; electricite: number; logistiqueCamion: number; logistiqueEssence: number
  charges: number; internet: number; nettoyage: number
  matchedItems: number; unmatchedItems: number; hourlyRate: number
  zeltyHT: number; zeltyTTC: number; zeltyOrdersCount: number
  correlation: Correlation[]
}

const MONTHS = ["", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"]

export default function Dashboard() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [selectedRestaurant, setSelectedRestaurant] = useState<number>(0)
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [month, setMonth] = useState(() => new Date().getMonth() + 1)
  const [allOrders, setAllOrders] = useState<OrderSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [costs, setCosts] = useState<CostsData | null>(null)
  const [staffReel, setStaffReel] = useState<string>("")
  const [foodCostReel, setFoodCostReel] = useState<string>("")
  const [darkKitchen, setDarkKitchen] = useState<string>("")
  const [venteAnnexe, setVenteAnnexe] = useState<string>("")
  const [savingExpense, setSavingExpense] = useState(false)
  const [productCorr, setProductCorr] = useState<ProductCorrelationData | null>(null)
  const [recipeCorr, setRecipeCorr] = useState<RecipeCorrelationData | null>(null)

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
    // Fetch P&L costs
    fetch(`/api/costs?year=${year}&month=${month}`).then(r => r.json()).then((data: CostsData) => {
      setCosts(data)
      setDarkKitchen(data.venteDarkKitchen != null ? String(data.venteDarkKitchen) : "")
      // Auto-fetch vente annexe from Pennylane customer invoices
      if (data.venteAnnexe != null && data.venteAnnexe > 0) {
        setVenteAnnexe(String(data.venteAnnexe))
      } else {
        fetch(`/api/vente-annexe?year=${year}&month=${month}&save=1`).then(r => r.json()).then(va => {
          if (va.totalHT > 0) setVenteAnnexe(String(va.totalHT))
        }).catch(() => {})
      }
      // Auto-fetch food cost from Pennylane supplier invoices
      if (data.foodCostReel != null && data.foodCostReel > 0) {
        setFoodCostReel(String(data.foodCostReel))
      } else {
        fetch(`/api/food-cost?year=${year}&month=${month}&save=1`).then(r => r.json()).then(fc => {
          if (fc.totalHT > 0) setFoodCostReel(String(fc.totalHT))
        }).catch(() => {})
      }
      // Auto-fetch staff cost from Pennylane payslips
      if (data.staffCostReel != null && data.staffCostReel > 0) {
        setStaffReel(String(data.staffCostReel))
      } else {
        fetch(`/api/staff-cost?year=${year}&month=${month}&save=1`).then(r => r.json()).then(sc => {
          if (sc.totalVerse > 0) setStaffReel(String(sc.totalVerse))
        }).catch(() => {})
      }
      // Auto-sync Zelty POS sales if missing for this month
      if (!data.zeltyTTC || data.zeltyTTC === 0) {
        fetch(`/api/zelty/sync?year=${year}&month=${month}&save=1`).then(r => r.json()).then(() => {
          // Refetch costs to pick up the synced Zelty data
          fetch(`/api/costs?year=${year}&month=${month}`).then(r => r.json()).then((d: CostsData) => setCosts(d))
        }).catch(() => {})
      }
    })
    // Fetch per-product correlation (fuzzy)
    setProductCorr(null)
    const corrParams = new URLSearchParams({ year: String(year), month: String(month) })
    if (selectedRestaurant) corrParams.set('restaurantId', String(selectedRestaurant))
    fetch(`/api/correlation/products?${corrParams}`).then(r => r.json()).then((pc: ProductCorrelationData) => {
      setProductCorr(pc)
    }).catch(() => {})
    // Fetch recipe-based correlation (BOM)
    setRecipeCorr(null)
    fetch(`/api/correlation/recipes?${corrParams}`).then(r => r.json()).then((rc: RecipeCorrelationData) => {
      setRecipeCorr(rc)
    }).catch(() => {})
  }

  const saveExpense = async (type: string, amount: number) => {
    setSavingExpense(true)
    await fetch("/api/expenses", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year, month, type, amount }),
    })
    setSavingExpense(false)
    reload()
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

  const restaurantSummary = allOrders.filter(o => o.restaurant.siren !== LABO_SIREN).map(o => {
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
            {restaurants.filter(r => r.siren !== LABO_SIREN).map(r => <option key={r.id} value={r.id}>{r.name} ({r.arrondissement})</option>)}
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
      {/* P&L Section */}
      {costs && !loading && (grandTotal + grandExtras) > 0 && (
        <PLSection costs={costs} grandTotal={grandTotal + grandExtras}
          staffReel={staffReel} setStaffReel={setStaffReel}
          foodCostReel={foodCostReel} setFoodCostReel={setFoodCostReel}
          darkKitchen={darkKitchen} setDarkKitchen={setDarkKitchen}
          venteAnnexe={venteAnnexe} setVenteAnnexe={setVenteAnnexe}
          savingExpense={savingExpense} saveExpense={saveExpense} />
      )}

      {/* Zelty POS section + correlation */}
      {costs && !loading && costs.correlation && costs.correlation.length > 0 && (
        <ZeltySection costs={costs} />
      )}

      {/* Recipe-based correlation (BOM × Zelty sales → expected vs actual Rekki) */}
      {recipeCorr && recipeCorr.products.length > 0 && (
        <RecipeCorrelationSection data={recipeCorr} onAfterRestore={reload} />
      )}

      {/* Per-product correlation (fuzzy fallback — kept for products without BOM mapping) */}
      {productCorr && productCorr.correlations.length > 0 && (
        <ProductCorrelationSection data={productCorr} />
      )}
    </div>
  )
}

function PLSection({ costs, grandTotal, staffReel, setStaffReel, foodCostReel, setFoodCostReel,
  darkKitchen, setDarkKitchen, venteAnnexe, setVenteAnnexe, savingExpense, saveExpense }: {
  costs: CostsData; grandTotal: number
  staffReel: string; setStaffReel: (v: string) => void
  foodCostReel: string; setFoodCostReel: (v: string) => void
  darkKitchen: string; setDarkKitchen: (v: string) => void
  venteAnnexe: string; setVenteAnnexe: (v: string) => void
  savingExpense: boolean; saveExpense: (type: string, amount: number) => Promise<void>
}) {
  const fixedTotal = costs.loyer + costs.electricite + costs.logistiqueCamion + costs.logistiqueEssence + costs.charges + costs.internet + costs.nettoyage
  const staffReelNum = staffReel ? parseFloat(staffReel) : 0
  const foodCostReelNum = foodCostReel ? parseFloat(foodCostReel) : 0
  const darkKitchenNum = darkKitchen ? parseFloat(darkKitchen) : 0
  const venteAnnexeNum = venteAnnexe ? parseFloat(venteAnnexe) : 0
  const caTotal = grandTotal + darkKitchenNum + venteAnnexeNum
  const foodCostUsed = foodCostReelNum || costs.foodCost
  const totalCharges = foodCostUsed + (staffReelNum || costs.staffCostTheo) + fixedTotal
  const resultat = caTotal - totalCharges
  const resultatPercent = caTotal > 0 ? (resultat / caTotal * 100) : 0
  const pct = (v: number) => caTotal > 0 ? (v / caTotal * 100).toFixed(1) : "0"

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-8">
      <div className="px-4 md:px-6 py-4 border-b border-gray-100">
        <h2 className="font-semibold text-gray-900 text-sm md:text-base">Compte de résultat</h2>
      </div>
      <div className="divide-y divide-gray-100">
        {/* Revenue section */}
        <PLRow label="Chiffre d'affaires HT (commandes)" value={grandTotal} pct={pct(grandTotal)} bold accent="text-gray-900" />

        {/* Vente Dark Kitchen — editable */}
        <EditableRow label="Vente Dark Kitchen" value={darkKitchen} onChange={setDarkKitchen}
          onSave={() => saveExpense("vente_dark_kitchen", parseFloat(darkKitchen) || 0)}
          saving={savingExpense} pct={darkKitchenNum > 0 ? pct(darkKitchenNum) : undefined} color="blue" />

        {/* Vente Annexe — editable */}
        <EditableRow label="Vente annexe" value={venteAnnexe} onChange={setVenteAnnexe}
          onSave={() => saveExpense("vente_annexe", parseFloat(venteAnnexe) || 0)}
          saving={savingExpense} pct={venteAnnexeNum > 0 ? pct(venteAnnexeNum) : undefined} color="blue" />

        {/* CA Total — toujours affiché */}
        <div className="px-4 md:px-6 py-3 flex items-center justify-between bg-blue-50">
          <p className="text-sm font-bold text-blue-900">CA Total</p>
          <span className="font-mono font-bold text-sm text-blue-900">{fmt(caTotal)} €</span>
        </div>

        {/* Separator — Charges */}
        <div className="px-4 md:px-6 py-2 bg-gray-50">
          <p className="text-xs font-semibold text-gray-500 uppercase">Charges variables</p>
        </div>

        {/* Food cost — réel remplace théo si renseigné */}
        {foodCostReelNum > 0 ? (<>
          <PLRow label="Food Cost (réel)" value={foodCostReelNum} pct={pct(foodCostReelNum)} accent="text-red-600" bold />
          <div className="px-4 md:px-6 py-2 flex items-center justify-between opacity-40">
            <p className="text-xs text-gray-400 line-through">Food Cost théorique : {fmt(costs.foodCost)} € ({pct(costs.foodCost)}%) — {costs.matchedItems}/{costs.matchedItems + costs.unmatchedItems} produits</p>
          </div>
          <EditableRow label="Modifier Food Cost réel" value={foodCostReel} onChange={setFoodCostReel}
            onSave={() => saveExpense("food_cost_reel", parseFloat(foodCostReel) || 0)}
            saving={savingExpense} color="red" />
        </>) : (<>
          <PLRow label="Food Cost (théorique)" sublabel={`${costs.matchedItems} produits / ${costs.matchedItems + costs.unmatchedItems} total`}
            value={costs.foodCost} pct={pct(costs.foodCost)} accent="text-red-600" />
          <EditableRow label="Food Cost (réel)" value={foodCostReel} onChange={setFoodCostReel}
            onSave={() => saveExpense("food_cost_reel", parseFloat(foodCostReel) || 0)}
            saving={savingExpense} color="red" />
        </>)}

        {/* Staff cost — réel remplace théo si renseigné */}
        {staffReelNum > 0 ? (<>
          <PLRow label="Staff Cost (réel)" value={staffReelNum} pct={pct(staffReelNum)} accent="text-orange-600" bold />
          <div className="px-4 md:px-6 py-2 flex items-center justify-between opacity-40">
            <p className="text-xs text-gray-400 line-through">Staff Cost théorique : {fmt(costs.staffCostTheo)} € ({pct(costs.staffCostTheo)}%) — SMIC {costs.hourlyRate} €/h</p>
          </div>
          <EditableRow label="Modifier Staff Cost réel" value={staffReel} onChange={setStaffReel}
            onSave={() => saveExpense("staff_reel", parseFloat(staffReel) || 0)}
            saving={savingExpense} color="orange" />
        </>) : (<>
          <PLRow label="Staff Cost (théorique)" sublabel={`SMIC chargé ${costs.hourlyRate} €/h`}
            value={costs.staffCostTheo} pct={pct(costs.staffCostTheo)} accent="text-orange-600" />
          <EditableRow label="Staff Cost (réel)" value={staffReel} onChange={setStaffReel}
            onSave={() => saveExpense("staff_reel", parseFloat(staffReel) || 0)}
            saving={savingExpense} color="orange" />
        </>)}

        {/* Separator */}
        <div className="px-4 md:px-6 py-2 bg-gray-50">
          <p className="text-xs font-semibold text-gray-500 uppercase">Charges fixes mensuelles</p>
        </div>

        {/* Fixed costs */}
        <PLRow label="Loyer" value={costs.loyer} pct={pct(costs.loyer)} accent="text-gray-600" />
        <PLRow label="Électricité" value={costs.electricite} pct={pct(costs.electricite)} accent="text-gray-600" />
        <PLRow label="Logistique — location camion" value={costs.logistiqueCamion} pct={pct(costs.logistiqueCamion)} accent="text-gray-600" />
        <PLRow label="Logistique — essence" value={costs.logistiqueEssence} pct={pct(costs.logistiqueEssence)} accent="text-gray-600" />
        <PLRow label="Charges bailleur" value={costs.charges} pct={pct(costs.charges)} accent="text-gray-600" />
        <PLRow label="Box internet" value={costs.internet} pct={pct(costs.internet)} accent="text-gray-600" />
        <PLRow label="Nettoyage" value={costs.nettoyage} pct={pct(costs.nettoyage)} accent="text-gray-600" />

        {/* Total charges */}
        <div className="px-4 md:px-6 py-3 flex items-center justify-between bg-red-50">
          <p className="text-sm font-bold text-red-800">Total charges</p>
          <div className="text-right">
            <span className="font-mono font-bold text-sm text-red-800">{fmt(totalCharges)} €</span>
            <span className="text-xs text-red-500 ml-2">{pct(totalCharges)}%</span>
          </div>
        </div>

        {/* Résultat */}
        <div className={`px-4 md:px-6 py-4 flex items-center justify-between ${resultat >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
          <p className={`text-sm font-bold ${resultat >= 0 ? 'text-green-800' : 'text-red-800'}`}>Résultat net</p>
          <div className="text-right">
            <span className={`font-mono font-bold text-base ${resultat >= 0 ? 'text-green-800' : 'text-red-800'}`}>{fmt(resultat)} €</span>
            <span className={`text-xs ml-2 ${resultat >= 0 ? 'text-green-600' : 'text-red-600'}`}>{resultatPercent.toFixed(1)}%</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function PLRow({ label, sublabel, value, pct, bold, accent }: {
  label: string; sublabel?: string; value: number; pct: string; bold?: boolean; accent?: string
}) {
  return (
    <div className="px-4 md:px-6 py-3 flex items-center justify-between">
      <div>
        <p className={`text-sm ${bold ? 'font-bold' : 'font-medium'} ${accent || 'text-gray-700'}`}>{label}</p>
        {sublabel && <p className="text-[11px] text-gray-400">{sublabel}</p>}
      </div>
      <div className="text-right">
        <span className={`font-mono text-sm ${bold ? 'font-bold' : ''} ${accent || ''}`}>{fmt(value)} €</span>
        <span className="text-xs text-gray-400 ml-2">{pct}%</span>
      </div>
    </div>
  )
}

function EditableRow({ label, value, onChange, onSave, saving, pct, color }: {
  label: string; value: string; onChange: (v: string) => void; onSave: () => void
  saving: boolean; pct?: string; color: string
}) {
  const colors: Record<string, { border: string; focus: string; btn: string; text: string }> = {
    orange: { border: "border-orange-200", focus: "focus:border-orange-400", btn: "bg-orange-600", text: "text-orange-500" },
    red: { border: "border-red-200", focus: "focus:border-red-400", btn: "bg-red-600", text: "text-red-500" },
    blue: { border: "border-blue-200", focus: "focus:border-blue-400", btn: "bg-blue-600", text: "text-blue-500" },
  }
  const c = colors[color] || colors.orange
  return (
    <div className="px-4 md:px-6 py-3 flex items-center justify-between">
      <p className={`text-sm font-medium ${c.text}`}>{label}</p>
      <div className="flex items-center gap-2">
        <input type="number" inputMode="decimal" step="0.01" placeholder="Montant"
          value={value} onChange={e => onChange(e.target.value)}
          className={`w-28 border-2 ${c.border} rounded-lg px-2 py-1.5 text-sm text-right font-mono ${c.focus} focus:outline-none`} />
        <span className="text-xs text-gray-400">€</span>
        <button onClick={onSave} disabled={saving || !value}
          className={`${c.btn} text-white px-2 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50`}>
          {saving ? "..." : "OK"}
        </button>
        {pct && <span className={`text-xs ${c.text} font-medium`}>{pct}%</span>}
      </div>
    </div>
  )
}

function ZeltySection({ costs }: { costs: CostsData }) {
  const totalRekkiHT = costs.correlation.reduce((s, c) => s + c.rekkiHT, 0)
  const totalRekkiFoodCost = costs.correlation.reduce((s, c) => s + c.rekkiFoodCost, 0)
  const globalFoodCostRatio = costs.zeltyHT > 0 ? (totalRekkiFoodCost / costs.zeltyHT * 100) : 0
  const globalRekkiRatio = costs.zeltyHT > 0 ? (totalRekkiHT / costs.zeltyHT * 100) : 0

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-8">
      <div className="px-4 md:px-6 py-4 border-b border-gray-100">
        <h2 className="font-semibold text-gray-900 text-sm md:text-base">Vente POS Zelty — Corrélation Rekki</h2>
        <p className="text-[11px] text-gray-400 mt-1">CA en aval (clients restaurants) vs commandes Rekki (livraisons labo → restaurants)</p>
      </div>

      {/* Global Zelty KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 md:p-6 bg-purple-50 border-b border-gray-100">
        <div>
          <p className="text-[10px] uppercase font-semibold text-purple-600">CA Zelty TTC</p>
          <p className="text-base md:text-xl font-bold text-purple-900 mt-0.5">{fmt(costs.zeltyTTC)} €</p>
        </div>
        <div>
          <p className="text-[10px] uppercase font-semibold text-purple-600">CA Zelty HT</p>
          <p className="text-base md:text-xl font-bold text-purple-900 mt-0.5">{fmt(costs.zeltyHT)} €</p>
        </div>
        <div>
          <p className="text-[10px] uppercase font-semibold text-purple-600">Commandes</p>
          <p className="text-base md:text-xl font-bold text-purple-900 mt-0.5">{costs.zeltyOrdersCount}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase font-semibold text-purple-600">Panier moyen</p>
          <p className="text-base md:text-xl font-bold text-purple-900 mt-0.5">
            {costs.zeltyOrdersCount > 0 ? (costs.zeltyTTC / costs.zeltyOrdersCount).toFixed(2) : "0"} €
          </p>
        </div>
      </div>

      {/* Per-restaurant correlation table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs md:text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="px-3 md:px-6 py-2 text-left font-semibold text-gray-600">Restaurant</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-600">Rekki HT</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-600">Food Cost</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-600">Zelty HT</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-600">Rekki/Zelty</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-600">FC/Zelty</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {costs.correlation.map(c => (
              <tr key={c.restaurantId} className="hover:bg-gray-50">
                <td className="px-3 md:px-6 py-2.5">
                  <p className="font-medium text-gray-900">{c.name}</p>
                  <p className="text-[10px] text-gray-400">{c.arrondissement} — {c.zeltyOrders} cmds</p>
                </td>
                <td className="px-3 py-2.5 text-right font-mono">{fmt(c.rekkiHT)} €</td>
                <td className="px-3 py-2.5 text-right font-mono text-red-600">{fmt(c.rekkiFoodCost)} €</td>
                <td className="px-3 py-2.5 text-right font-mono text-purple-700">
                  {c.zeltyHT > 0 ? `${fmt(c.zeltyHT)} €` : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-3 py-2.5 text-right font-mono">
                  {c.rekkiRatio > 0 ? `${c.rekkiRatio.toFixed(1)}%` : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-3 py-2.5 text-right font-mono">
                  {c.foodCostRatio > 0 ? `${c.foodCostRatio.toFixed(1)}%` : <span className="text-gray-300">—</span>}
                </td>
              </tr>
            ))}
            {/* Total row */}
            <tr className="bg-gray-50 font-bold">
              <td className="px-3 md:px-6 py-2.5">Total (hors labo)</td>
              <td className="px-3 py-2.5 text-right font-mono">{fmt(totalRekkiHT)} €</td>
              <td className="px-3 py-2.5 text-right font-mono text-red-600">{fmt(totalRekkiFoodCost)} €</td>
              <td className="px-3 py-2.5 text-right font-mono text-purple-700">{fmt(costs.zeltyHT)} €</td>
              <td className="px-3 py-2.5 text-right font-mono">{globalRekkiRatio.toFixed(1)}%</td>
              <td className="px-3 py-2.5 text-right font-mono">{globalFoodCostRatio.toFixed(1)}%</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Note on multi-day deliveries */}
      <div className="px-4 md:px-6 py-3 bg-amber-50 border-t border-amber-100">
        <p className="text-[11px] text-amber-800">
          <strong>Note :</strong> Les livraisons Rekki couvrent souvent plusieurs jours de stock. Le ratio mensuel reste indicatif —
          une livraison fin de mois alimente les ventes du mois suivant. Pour une corrélation précise, comparer sur 2-3 mois glissants.
        </p>
      </div>
    </div>
  )
}

function ProductCorrelationSection({ data }: { data: ProductCorrelationData }) {
  const [showUnmatched, setShowUnmatched] = useState(false)
  const matched = data.correlations.filter(c => c.matchedZelty.length > 0)
  const unmatched = data.correlations.filter(c => c.matchedZelty.length === 0)

  const ratioColor = (r: number | null) => {
    if (r === null) return 'text-gray-300'
    if (r >= 0.8 && r <= 1.3) return 'text-green-600'
    if (r >= 0.5 && r <= 2.0) return 'text-amber-600'
    return 'text-red-600'
  }
  const ratioBg = (r: number | null) => {
    if (r === null) return ''
    if (r >= 0.8 && r <= 1.3) return 'bg-green-50'
    if (r >= 0.5 && r <= 2.0) return 'bg-amber-50'
    return 'bg-red-50'
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-8">
      <div className="px-4 md:px-6 py-4 border-b border-gray-100">
        <h2 className="font-semibold text-gray-900 text-sm md:text-base">Corrélation par produit — Rekki vs Zelty</h2>
        <p className="text-[11px] text-gray-400 mt-1">
          {data.matchedCount} produits matchés sur {data.yataiProductsTotal} • {data.zeltyDishesTotal} dishes Zelty •
          Vert: ratio 0.8-1.3 ✓ • Orange: 0.5-2.0 ⚠ • Rouge: hors plage 🚨
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs md:text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="px-3 md:px-6 py-2 text-left font-semibold text-gray-600">Produit Yatai</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-600">Qté Rekki</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-600">Coût HT</th>
              <th className="px-3 py-2 text-left font-semibold text-gray-600">Dish Zelty matché</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-600">Qté Zelty</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-600">Ratio</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {matched.map((c, i) => (
              <tr key={`m-${i}`} className={`hover:bg-gray-50 ${ratioBg(c.ratio)}`}>
                <td className="px-3 md:px-6 py-2.5 font-medium text-gray-900">{c.yataiName}</td>
                <td className="px-3 py-2.5 text-right font-mono">{fmt(c.yataiQty)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-red-600">{fmt(c.yataiRekkiHT)} €</td>
                <td className="px-3 py-2.5">
                  {c.matchedZelty.map((m, j) => (
                    <div key={j} className="text-[11px] text-purple-700">
                      {m.name} <span className="text-gray-400">({m.score})</span>
                    </div>
                  ))}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-purple-700">{fmt(c.totalZeltyQty)}</td>
                <td className={`px-3 py-2.5 text-right font-mono font-bold ${ratioColor(c.ratio)}`}>
                  {c.ratio !== null ? c.ratio.toFixed(2) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Unmatched section toggle */}
      {(unmatched.length > 0 || data.unmatchedZelty.length > 0) && (
        <div className="border-t border-gray-100">
          <button onClick={() => setShowUnmatched(!showUnmatched)}
            className="w-full px-4 md:px-6 py-3 text-left text-xs font-medium text-gray-500 hover:bg-gray-50 flex items-center justify-between">
            <span>{showUnmatched ? '▼' : '▶'} Produits non matchés ({unmatched.length} Yatai • {data.unmatchedZelty.length} Zelty)</span>
            <span className="text-[10px] text-gray-400">sub-components & ramens assemblés</span>
          </button>
          {showUnmatched && (
            <div className="grid md:grid-cols-2 gap-4 px-4 md:px-6 pb-4">
              {/* Unmatched Yatai products (sub-components) */}
              <div>
                <p className="text-[11px] font-semibold text-gray-500 uppercase mb-1.5">Yatai — pas de dish Zelty</p>
                <div className="bg-gray-50 rounded-lg p-2 max-h-64 overflow-y-auto">
                  {unmatched.slice(0, 30).map((c, i) => (
                    <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-gray-200 last:border-0">
                      <span className="text-gray-700">{c.yataiName}</span>
                      <span className="font-mono text-gray-500">{fmt(c.yataiQty)}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Unmatched Zelty dishes (assembled ramens, drinks) */}
              <div>
                <p className="text-[11px] font-semibold text-gray-500 uppercase mb-1.5">Zelty — pas de produit Yatai</p>
                <div className="bg-gray-50 rounded-lg p-2 max-h-64 overflow-y-auto">
                  {data.unmatchedZelty.slice(0, 30).map((u, i) => (
                    <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-gray-200 last:border-0">
                      <span className="text-gray-700 truncate pr-2">{u.name}</span>
                      <span className="font-mono text-purple-700">{fmt(u.qty)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Note */}
      <div className="px-4 md:px-6 py-3 bg-amber-50 border-t border-amber-100">
        <p className="text-[11px] text-amber-800">
          <strong>Lecture :</strong> Le ratio = Qté Rekki / Qté Zelty.
          Un ratio &gt; 1 = sur-livraison (waste, sur-stockage). Un ratio &lt; 1 = stock préexistant ou sub-component partagé.
          Les produits comme &quot;Bouillon&quot;, &quot;Tare&quot;, &quot;Œuf mariné&quot; sont des sub-components qui alimentent plusieurs dishes — ils ne matchent pas directement.
        </p>
      </div>
    </div>
  )
}

type SnapshotRow = { id: number; entity: string; label: string; createdAt: string }

function RecipeCorrelationSection({ data, onAfterRestore }: { data: RecipeCorrelationData; onAfterRestore?: () => void }) {
  const [tab, setTab] = useState<'products' | 'recipes' | 'unmatched'>('products')
  const [showSnapshots, setShowSnapshots] = useState(false)
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([])
  const [snapBusy, setSnapBusy] = useState(false)
  const [snapMsg, setSnapMsg] = useState<string | null>(null)

  const loadSnapshots = async () => {
    const r = await fetch('/api/snapshots?entity=DishBom')
    if (r.ok) setSnapshots(await r.json())
  }
  const openSnapshots = async () => {
    setShowSnapshots(true)
    setSnapMsg(null)
    await loadSnapshots()
  }
  const createManualSnapshot = async () => {
    setSnapBusy(true)
    setSnapMsg(null)
    const label = prompt('Nom de la sauvegarde ?', `Manuel ${new Date().toLocaleString('fr-FR')}`)
    if (!label) { setSnapBusy(false); return }
    const r = await fetch('/api/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity: 'DishBom', label }),
    })
    if (r.ok) { setSnapMsg('✓ Sauvegarde créée'); await loadSnapshots() }
    else setSnapMsg('✗ Erreur')
    setSnapBusy(false)
  }
  const restoreSnapshot = async (s: SnapshotRow) => {
    if (!confirm(`Restaurer "${s.label}" ?\n\nUne sauvegarde automatique de l'état actuel sera créée avant.`)) return
    setSnapBusy(true)
    setSnapMsg(null)
    const r = await fetch(`/api/snapshots/${s.id}/restore`, { method: 'POST' })
    if (r.ok) {
      const res = await r.json()
      setSnapMsg(`✓ Restauré ${res.restored} recettes`)
      await loadSnapshots()
      onAfterRestore?.()
    } else setSnapMsg('✗ Erreur restauration')
    setSnapBusy(false)
  }
  const deleteSnapshot = async (s: SnapshotRow) => {
    if (!confirm(`Supprimer "${s.label}" ?`)) return
    setSnapBusy(true)
    await fetch(`/api/snapshots/${s.id}`, { method: 'DELETE' })
    await loadSnapshots()
    setSnapBusy(false)
  }

  const ratioColor = (r: number | null) => {
    if (r === null) return 'text-gray-300'
    if (r >= 0.85 && r <= 1.20) return 'text-green-600'
    if (r >= 0.6 && r <= 1.6) return 'text-amber-600'
    return 'text-red-600'
  }
  const ratioBg = (r: number | null) => {
    if (r === null) return ''
    if (r >= 0.85 && r <= 1.20) return 'bg-green-50'
    if (r >= 0.6 && r <= 1.6) return 'bg-amber-50'
    return 'bg-red-50'
  }
  const fmt2 = (n: number) => n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d|\.))/g, ' ')

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-8">
      <div className="px-4 md:px-6 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-gray-900 text-sm md:text-base">Corrélation par recette — BOM × Ventes</h2>
          <p className="text-[11px] text-gray-400 mt-1">
            {data.recipesMatched} recettes matchées sur {data.recipesTotal} • {data.products.length} produits Yatai analysés •
            Vert: ratio 0.85-1.20 ✓ • Orange: 0.6-1.6 ⚠ • Rouge: hors plage 🚨
          </p>
        </div>
        <button
          onClick={openSnapshots}
          className="shrink-0 text-[11px] font-medium px-3 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition"
          title="Gérer les sauvegardes BOM (restaurer une version antérieure)"
        >
          ⏱ Sauvegardes
        </button>
      </div>

      {/* Tabs */}
      <div className="px-4 md:px-6 pt-3 border-b border-gray-100 flex gap-1 text-xs font-medium">
        {(['products', 'recipes', 'unmatched'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-t-md transition ${
              tab === t ? 'bg-blue-50 text-blue-700 border-x border-t border-blue-200' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {t === 'products' && `Produits (${data.products.length})`}
            {t === 'recipes' && `Recettes (${data.recipesMatched}/${data.recipesTotal})`}
            {t === 'unmatched' && `Non matchés (${data.unmatchedYatai.length} Y • ${data.unmatchedZelty.length} Z)`}
          </button>
        ))}
      </div>

      {/* Tab: Products (the main view — actual vs expected per Yatai product) */}
      {tab === 'products' && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs md:text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-3 md:px-6 py-2 text-left font-semibold text-gray-600">Produit Yatai (Rekki)</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-600">Coût HT</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-600">Réel livré</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-600">Théorique (BOM)</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-600">Ratio</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600">Ingrédients BOM</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.products.map((p, i) => (
                <tr key={i} className={`hover:bg-gray-50 ${ratioBg(p.ratio)}`}>
                  <td className="px-3 md:px-6 py-2.5 font-medium text-gray-900">{p.yataiProduct}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-red-600">{fmt2(p.actualHT)} €</td>
                  <td className="px-3 py-2.5 text-right font-mono">{fmt2(p.actualQty)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-purple-700">{fmt2(p.expectedQty)}</td>
                  <td className={`px-3 py-2.5 text-right font-mono font-bold ${ratioColor(p.ratio)}`}>
                    {p.ratio !== null ? p.ratio.toFixed(2) : '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    {p.contributingIngredients.slice(0, 3).map((ing, j) => (
                      <div key={j} className="text-[10px] text-gray-500">
                        {ing.name} <span className="text-gray-400">({fmt2(ing.expected)})</span>
                      </div>
                    ))}
                    {p.contributingIngredients.length > 3 && (
                      <div className="text-[10px] text-gray-400">+{p.contributingIngredients.length - 3} autre(s)</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab: Recipes (which BOM recipes were sold and how much) */}
      {tab === 'recipes' && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs md:text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-3 md:px-6 py-2 text-left font-semibold text-gray-600">Recette (BOM)</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600">Catégorie</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-600">Portions vendues</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600">Plat(s) Zelty matché(s)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.recipes.map((r, i) => (
                <tr key={i} className={`hover:bg-gray-50 ${r.portionsSold === 0 ? 'opacity-50' : ''}`}>
                  <td className="px-3 md:px-6 py-2.5 font-medium text-gray-900">{r.recipe}</td>
                  <td className="px-3 py-2.5">
                    <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                      {r.category}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono font-bold text-purple-700">{fmt(r.portionsSold)}</td>
                  <td className="px-3 py-2.5">
                    {r.matchedZeltyDishes.length > 0 ? (
                      r.matchedZeltyDishes.map((d, j) => (
                        <div key={j} className="text-[11px] text-gray-700">
                          {d.name} <span className="text-gray-400">({fmt(d.qty)})</span>
                        </div>
                      ))
                    ) : (
                      <span className="text-[11px] text-gray-300 italic">aucun plat Zelty trouvé</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab: Unmatched */}
      {tab === 'unmatched' && (
        <div className="grid md:grid-cols-2 gap-4 px-4 md:px-6 py-4">
          <div>
            <p className="text-[11px] font-semibold text-gray-500 uppercase mb-2">
              Yatai — non couvert par BOM ({data.unmatchedYatai.length})
            </p>
            <p className="text-[10px] text-gray-400 mb-2">
              Produits livrés par labo sans recette correspondante (consommables, boissons, sub-components non listés)
            </p>
            <div className="bg-gray-50 rounded-lg p-2 max-h-96 overflow-y-auto">
              {data.unmatchedYatai.map((y, i) => (
                <div key={i} className="flex items-center justify-between text-xs py-1.5 border-b border-gray-200 last:border-0">
                  <span className="text-gray-700 truncate pr-2">{y.name}</span>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-mono text-gray-500">{fmt2(y.qty)}</span>
                    <span className="font-mono text-red-600 w-20 text-right">{fmt2(y.rekkiHT)} €</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-gray-500 uppercase mb-2">
              Zelty — non lié à BOM ({data.unmatchedZelty.length})
            </p>
            <p className="text-[10px] text-gray-400 mb-2">
              Plats vendus sans recette dans le BOM (boissons, alcools, plats hors carte fixe)
            </p>
            <div className="bg-gray-50 rounded-lg p-2 max-h-96 overflow-y-auto">
              {data.unmatchedZelty.map((z, i) => (
                <div key={i} className="flex items-center justify-between text-xs py-1.5 border-b border-gray-200 last:border-0">
                  <span className="text-gray-700 truncate pr-2">{z.name}</span>
                  <span className="font-mono text-purple-700 shrink-0">{fmt(z.qty)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Note */}
      <div className="px-4 md:px-6 py-3 bg-blue-50 border-t border-blue-100">
        <p className="text-[11px] text-blue-800">
          <strong>Lecture :</strong> Le ratio = <strong>Réel livré (Rekki) / Théorique (BOM × Ventes Zelty)</strong>.
          Le théorique est calculé en multipliant chaque vente Zelty par les ingrédients de la recette du BOM (Excel Coût Plat).
          Un ratio <strong>{`>`} 1</strong> = sur-livraison (waste, sur-stockage). Un ratio <strong>{`<`} 1</strong> = sous-livré, stock préexistant, ou recette incomplète.
          Les bouillons concentrés sont dilués au restaurant — le ratio peut sembler élevé.
        </p>
      </div>

      {/* Snapshots modal */}
      {showSnapshots && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
             onClick={() => setShowSnapshots(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col"
               onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">Sauvegardes BOM</h3>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  Chaque modification crée automatiquement une sauvegarde. Max 20 conservées.
                </p>
              </div>
              <button onClick={() => setShowSnapshots(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
            </div>

            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between bg-gray-50">
              <button
                onClick={createManualSnapshot}
                disabled={snapBusy}
                className="text-[11px] font-medium px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition"
              >
                + Créer sauvegarde manuelle
              </button>
              {snapMsg && <span className="text-[11px] font-medium text-gray-600">{snapMsg}</span>}
            </div>

            <div className="flex-1 overflow-y-auto">
              {snapshots.length === 0 ? (
                <p className="px-5 py-8 text-center text-xs text-gray-400">Aucune sauvegarde</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-100 sticky top-0">
                    <tr>
                      <th className="px-5 py-2 text-left font-semibold text-gray-600">Label</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-600">Date</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {snapshots.map(s => (
                      <tr key={s.id} className="hover:bg-gray-50">
                        <td className="px-5 py-2.5 text-gray-900 truncate max-w-xs" title={s.label}>{s.label}</td>
                        <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">
                          {new Date(s.createdAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          <button
                            onClick={() => restoreSnapshot(s)}
                            disabled={snapBusy}
                            className="text-[11px] font-medium px-2 py-1 rounded bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 disabled:opacity-50"
                          >
                            ↻ Restaurer
                          </button>
                          <button
                            onClick={() => deleteSnapshot(s)}
                            disabled={snapBusy}
                            className="ml-1.5 text-[11px] font-medium px-2 py-1 rounded text-gray-400 hover:text-red-600 disabled:opacity-50"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function fmt(n: number) {
  return n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
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
