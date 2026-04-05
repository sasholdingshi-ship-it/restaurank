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
type CostsData = {
  revenue: number; foodCost: number; foodCostPercent: number; foodCostReel: number | null
  staffCostTheo: number; staffCostTheoPercent: number; staffCostReel: number | null
  venteDarkKitchen: number | null; venteAnnexe: number | null
  loyer: number; electricite: number; logistiqueCamion: number; logistiqueEssence: number
  charges: number; internet: number; nettoyage: number
  matchedItems: number; unmatchedItems: number; hourlyRate: number
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
      setStaffReel(data.staffCostReel != null ? String(data.staffCostReel) : "")
      setFoodCostReel(data.foodCostReel != null ? String(data.foodCostReel) : "")
      setDarkKitchen(data.venteDarkKitchen != null ? String(data.venteDarkKitchen) : "")
      setVenteAnnexe(data.venteAnnexe != null ? String(data.venteAnnexe) : "")
    })
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
