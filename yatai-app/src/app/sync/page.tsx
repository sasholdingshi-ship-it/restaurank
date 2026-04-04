"use client"

import { useRef, useState } from "react"

type SyncResult = Record<string, { updated: number; created: number; errors: string[] }>

export default function SyncPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<SyncResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const handleImport = async (file: File) => {
    setImporting(true)
    setResult(null)
    setError(null)
    try {
      const form = new FormData()
      form.append("file", file)
      const res = await fetch("/api/sync/import", { method: "POST", body: form })
      const data = await res.json()
      if (res.ok) setResult(data.results)
      else setError(data.error || "Erreur import")
    } catch (e) {
      setError(String(e))
    }
    setImporting(false)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file && (file.name.endsWith(".xlsx") || file.name.endsWith(".xls"))) handleImport(file)
    else setError("Fichier .xlsx requis")
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleImport(file)
  }

  const totalUpdated = result ? Object.values(result).reduce((s, r) => s + r.updated, 0) : 0
  const totalCreated = result ? Object.values(result).reduce((s, r) => s + r.created, 0) : 0
  const totalErrors = result ? Object.values(result).reduce((s, r) => s + r.errors.length, 0) : 0

  return (
    <div className="overflow-hidden">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Sync Excel</h1>
      <p className="text-sm text-gray-500 mb-6">Synchronisation bidirectionnelle entre l'app et votre fichier Excel</p>

      {/* Export */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-4">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-green-50 flex items-center justify-center text-2xl shrink-0">📥</div>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-gray-900">Exporter vers Excel</h2>
            <p className="text-sm text-gray-500 mt-0.5">Télécharge toutes les données (mercurial, produits, recettes, commandes) en un seul fichier Excel.</p>
            <a href="/api/sync/export" className="inline-flex items-center gap-2 mt-3 bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 active:bg-green-800 transition-colors">
              Télécharger Excel
            </a>
          </div>
        </div>
      </div>

      {/* Import */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-4">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center text-2xl shrink-0">📤</div>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-gray-900">Importer depuis Excel</h2>
            <p className="text-sm text-gray-500 mt-0.5">Upload un fichier Excel modifié pour mettre à jour la base de données. Les données existantes sont mises à jour, les nouvelles sont créées.</p>

            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              className={`mt-3 border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                dragOver ? "border-blue-400 bg-blue-50" : "border-gray-300 hover:border-gray-400 hover:bg-gray-50"
              }`}
            >
              <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={onFileChange} className="hidden" />
              {importing ? (
                <div className="text-blue-600 font-medium">Import en cours...</div>
              ) : (
                <>
                  <div className="text-3xl mb-2">📁</div>
                  <p className="text-sm text-gray-600">Glisser-déposer ou cliquer pour sélectionner</p>
                  <p className="text-xs text-gray-400 mt-1">Format : .xlsx (même structure que l'export)</p>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
          <p className="text-sm text-red-700 font-medium">Erreur</p>
          <p className="text-sm text-red-600 mt-1">{error}</p>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-3">Résultat de l'import</h3>

          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-blue-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-blue-700">{totalUpdated}</p>
              <p className="text-xs text-blue-600">Mis à jour</p>
            </div>
            <div className="bg-green-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-green-700">{totalCreated}</p>
              <p className="text-xs text-green-600">Créés</p>
            </div>
            <div className={`rounded-lg p-3 text-center ${totalErrors > 0 ? "bg-red-50" : "bg-gray-50"}`}>
              <p className={`text-2xl font-bold ${totalErrors > 0 ? "text-red-700" : "text-gray-400"}`}>{totalErrors}</p>
              <p className={`text-xs ${totalErrors > 0 ? "text-red-600" : "text-gray-400"}`}>Erreurs</p>
            </div>
          </div>

          <div className="space-y-1.5">
            {Object.entries(result).map(([sheet, stats]) => (
              <div key={sheet} className="flex items-center justify-between text-sm py-1.5 border-b border-gray-100 last:border-0">
                <span className="text-gray-700 font-medium truncate">{sheet}</span>
                <div className="flex gap-3 text-xs shrink-0">
                  {stats.updated > 0 && <span className="text-blue-600">{stats.updated} maj</span>}
                  {stats.created > 0 && <span className="text-green-600">{stats.created} new</span>}
                  {stats.errors.length > 0 && <span className="text-red-600">{stats.errors.length} err</span>}
                  {stats.updated === 0 && stats.created === 0 && stats.errors.length === 0 && <span className="text-gray-400">aucun changement</span>}
                </div>
              </div>
            ))}
          </div>

          {totalErrors > 0 && (
            <details className="mt-3">
              <summary className="text-xs text-red-600 cursor-pointer">Voir les erreurs</summary>
              <div className="mt-2 text-xs text-red-600 space-y-1 max-h-40 overflow-auto">
                {Object.entries(result).flatMap(([sheet, stats]) =>
                  stats.errors.map((err, i) => <div key={`${sheet}-${i}`}>{sheet}: {err}</div>)
                )}
              </div>
            </details>
          )}
        </div>
      )}

      {/* Instructions */}
      <div className="mt-6 bg-amber-50 border border-amber-200 rounded-xl p-4">
        <h3 className="font-semibold text-amber-800 text-sm mb-2">Comment ça marche</h3>
        <ol className="text-xs text-amber-700 space-y-1.5 list-decimal list-inside">
          <li><strong>Exporter</strong> — Téléchargez le fichier Excel complet depuis l'app</li>
          <li><strong>Modifier</strong> — Éditez les prix, quantités, noms dans Excel</li>
          <li><strong>Importer</strong> — Re-uploadez le fichier modifié ici</li>
          <li>Les données sont mises à jour automatiquement dans les deux sens</li>
        </ol>
        <div className="mt-3 text-xs text-amber-600">
          <strong>Feuilles reconnues :</strong> Mercurial (ingrédients), Recap prix (produits), Recettes, et les feuilles mensuelles (ex: "2 mars 26")
        </div>
      </div>
    </div>
  )
}
