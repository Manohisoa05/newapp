import { useMemo, useState } from 'react'
import { useAppSelector } from '../../app/hooks'
import { importAllFromCsv } from '../../features/admin/importWebservice'

type CsvRole =
  | 'products'
  | 'variants'
  | 'orders'
  | 'customers'
  | 'categories'
  | 'combinations'
  | 'suppliers'
  | 'addresses'
  | 'brands'
  | 'ignore'

type CsvFileItem = {
  id: string
  file: File
  role: CsvRole
  summary?: string
}

const ROLE_OPTIONS: Array<{ id: CsvRole; label: string }> = [
  { id: 'products', label: 'Produits' },
  { id: 'variants', label: 'Variantes' },
  { id: 'orders', label: 'Commandes' },
  { id: 'customers', label: 'Clients' },
  { id: 'categories', label: 'Categories' },
  { id: 'combinations', label: 'Declinaisons / Combinations' },
  { id: 'suppliers', label: 'Fournisseurs' },
  { id: 'addresses', label: 'Adresses' },
  { id: 'brands', label: 'Marques' },
  { id: 'ignore', label: 'Ignorer' },
]

const ORDER_CSV_HEADERS = ['date', 'nom', 'email', 'pwd', 'adresse', 'achat', 'etat']
const ORDER_CSV_EXAMPLE =
  '01/02/2026,Rakoto,rakoto1@yopmail.com,Pass123!,Analakely,"[(""T_01"";2;""M"")]",paiement accepté'


function detectDelimiter(sample: string): string {
  if (sample.includes('\t')) return '\t'
  if (sample.includes(';')) return ';'
  if (sample.includes(',')) return ','
  return '\t'
}

function parseCsvSummary(text: string): { rows: number; header: string[] } {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0)
  if (lines.length === 0) return { rows: 0, header: [] }
  const delimiter = detectDelimiter(lines[0])
  const header = lines[0].split(delimiter).map((cell) => cell.trim())
  return { rows: Math.max(lines.length - 1, 0), header }
}

export default function ImportDataPage() {
  const wsConfig = useAppSelector((s) => s.auth.wsConfig)
  const [csvFiles, setCsvFiles] = useState<CsvFileItem[]>([])
  const [imagesZip, setImagesZip] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[]>([])

  const canSubmit = useMemo(() => {
    const hasCsv = csvFiles.length > 0
    const hasZip = Boolean(imagesZip)
    return (hasCsv || hasZip) && !busy
  }, [csvFiles, imagesZip, busy])

  function guessRole(name: string): CsvRole {
    const lower = name.toLowerCase()
    if (lower.includes('fichier1')) return 'products'
    if (lower.includes('fichier2')) return 'variants'
    if (lower.includes('fichier3')) return 'orders'
    if (lower.includes('produit')) return 'products'
    if (lower.includes('variant')) return 'variants'
    if (lower.includes('commande') || lower.includes('order')) return 'orders'
    return 'ignore'
  }

  function handleCsvUpload(files: FileList | null) {
    if (!files) return
    const newItems: CsvFileItem[] = Array.from(files).map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}`,
      file,
      role: guessRole(file.name),
    }))
    setCsvFiles((prev) => [...prev, ...newItems])
  }

  function updateCsvRole(id: string, role: CsvRole) {
    setCsvFiles((prev) => prev.map((item) => (item.id === id ? { ...item, role } : item)))
  }

  function removeCsv(id: string) {
    setCsvFiles((prev) => prev.filter((item) => item.id !== id))
  }

  async function handleImport() {
    if (!canSubmit) return
    setBusy(true)
    setDone(false)
    setError(null)
    setLogs([])

    try {
      const updated = await Promise.all(
        csvFiles.map(async (item) => {
          const text = await item.file.text()
          const summary = parseCsvSummary(text)
          return {
            ...item,
            summary: `${summary.rows} lignes, colonnes: ${summary.header.join(' | ')}`,
          }
        }),
      )

      setCsvFiles(updated)

      if (!wsConfig) {
        setError('Configuration manquante. Reconnecte-toi.')
        return
      }

      const selected = new Map<CsvRole, File>()
      for (const item of updated) {
        if (item.role === 'ignore') continue
        if (!selected.has(item.role)) selected.set(item.role, item.file)
      }

      const files = {
        productsCsv: selected.get('products') ?? null,
        variantsCsv: selected.get('variants') ?? null,
        ordersCsv: selected.get('orders') ?? null,
        customersCsv: selected.get('customers') ?? null,
        categoriesCsv: selected.get('categories') ?? null,
        combinationsCsv: selected.get('combinations') ?? null,
        suppliersCsv: selected.get('suppliers') ?? null,
        addressesCsv: selected.get('addresses') ?? null,
        brandsCsv: selected.get('brands') ?? null,
        imagesZip,
      }

      const result = await importAllFromCsv(wsConfig, files)
      setLogs(result.logs.map((log) => `[${log.step}] ${log.message}`))
      if (result.hasErrors) {
        setError('Import annule: corrige les erreurs affichees dans les logs.')
        setDone(false)
        return
      }
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Importer les donnees</h2>
        <p className="text-sm text-slate-500">
          Import flexible: ajoute les fichiers disponibles.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-semibold text-slate-800">Template commandes CSV</div>
        <p className="mt-1 text-xs text-slate-500">Le fichier commandes doit suivre exactement ces 7 champs.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {ORDER_CSV_HEADERS.map((header) => (
            <span key={header} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
              {header}
            </span>
          ))}
        </div>
        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Exemple: {ORDER_CSV_EXAMPLE}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-semibold text-slate-800">CSV import-data-mai-26</div>
        <div className="mt-3 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-slate-500">Selection multiple possible</div>
            <input
              type="file"
              accept=".csv"
              multiple
              className="text-sm"
              onChange={(e) => handleCsvUpload(e.target.files)}
              disabled={busy}
            />
          </div>

          {csvFiles.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-xs text-slate-500">
              Aucun fichier ajoute.
            </div>
          ) : null}

          {csvFiles.map((item) => (
            <div key={item.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-slate-800">{item.file.name}</div>
                  <div className="text-xs text-slate-500">Taille: {item.file.size} octets</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                    value={item.role}
                    onChange={(e) => updateCsvRole(item.id, e.target.value as CsvRole)}
                    disabled={busy}
                  >
                    {ROLE_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-600"
                    onClick={() => removeCsv(item.id)}
                    disabled={busy}
                  >
                    Supprimer
                  </button>
                </div>
              </div>
              {item.summary ? (
                <div className="mt-2 text-xs text-emerald-700">{item.summary}</div>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-semibold text-slate-800">Images ZIP</div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-slate-500">Attendu: images.zip (pas utilise pour l instant)</div>
          <input
            type="file"
            accept=".zip"
            className="text-sm"
            onChange={(e) => setImagesZip(e.target.files?.[0] ?? null)}
            disabled={busy}
          />
        </div>
        {imagesZip ? (
          <div className="mt-2 text-xs text-slate-600">Selection: {imagesZip.name}</div>
        ) : null}
      </div>

      <button
        type="button"
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
        onClick={handleImport}
        disabled={!canSubmit}
      >
        {busy ? 'Import en cours...' : 'Importer maintenant'}
      </button>

      {done ? (
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          Import termine. Verifie dans PrestaShop.
        </div>
      ) : null}

      {logs.length > 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700">
          <div className="mb-2 text-sm font-semibold">Logs</div>
          <pre className="whitespace-pre-wrap">{logs.join('\n')}</pre>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}
    </div>
  )
}
