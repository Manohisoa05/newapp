import { useMemo, useState } from 'react'
import { useAppSelector } from '../../app/hooks'
import { deleteAllForResource } from '../../features/admin/resetWebservice'

const MODULE_OPTIONS = [
  { id: 'products', label: 'Produits' },
  { id: 'combinations', label: 'Declinaisons' },
  { id: 'stock_availables', label: 'Stock' },
  { id: 'product_options', label: 'Attributs (groupes)' },
  { id: 'product_option_values', label: 'Attributs (valeurs)' },
  { id: 'customers', label: 'Clients' },
  { id: 'addresses', label: 'Adresses' },
  { id: 'carts', label: 'Paniers' },
  { id: 'order_histories', label: 'Historique commandes' },
  { id: 'orders', label: 'Commandes' },
  { id: 'categories', label: 'Categories' },
  { id: 'brands', label: 'Marques' },
] as const

type ModuleId = (typeof MODULE_OPTIONS)[number]['id']

export default function ResetDataPage() {
  const wsConfig = useAppSelector((s) => s.auth.wsConfig)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [selected, setSelected] = useState<ModuleId[]>(['products'])
  const [force, setForce] = useState(true)

  const canSubmit = useMemo(() => selected.length > 0 && !busy, [selected, busy])

  function toggleModule(moduleId: ModuleId) {
    setSelected((prev) =>
      prev.includes(moduleId) ? prev.filter((id) => id !== moduleId) : [...prev, moduleId],
    )
  }

  async function handleReset() {
    if (selected.length === 0) return
    if (!wsConfig) {
      setError('Configuration manquante. Reconnecte-toi au backoffice.')
      return
    }
    const confirmed = window.confirm(
      `Confirmer la reinitialisation pour: ${selected.join(', ')} ? Cette action est irreversible.${force ? ' (Mode FORCE activé)' : ''}`,
    )
    if (!confirmed) return
    setBusy(true)
    setDone(false)
    setError(null)
    setLogs([])

    try {
      const targetMap: Record<ModuleId, Parameters<typeof deleteAllForResource>[1] | null> = {
        products: 'products',
        combinations: 'combinations',
        stock_availables: 'stock_availables',
        product_options: 'product_options',
        product_option_values: 'product_option_values',
        customers: 'customers',
        addresses: 'addresses',
        carts: 'carts',
        order_histories: 'order_histories',
        orders: 'orders',
        categories: 'categories',
        brands: 'manufacturers',
      }

      const priority: Array<Parameters<typeof deleteAllForResource>[1]> = [
        'order_histories',
        'orders',
        'carts',
        'addresses',
        'customers',
        'stock_availables',
        'combinations',
        'product_option_values',
        'product_options',
        'products',
        'categories',
        'manufacturers',
      ]

      // Ensure dependent resources are also removed when deleting products
      const expandedSelected = new Set(selected)
      if (selected.includes('products')) {
        expandedSelected.add('combinations')
        expandedSelected.add('stock_availables')
        expandedSelected.add('product_option_values')
        expandedSelected.add('product_options')
      }

      const targets = Array.from(expandedSelected)
        .map((moduleId) => targetMap[moduleId as ModuleId])
        .filter((target): target is Parameters<typeof deleteAllForResource>[1] => Boolean(target))
        .sort((a, b) => priority.indexOf(a) - priority.indexOf(b))

      for (const target of targets) {
        const result = await deleteAllForResource(wsConfig, target, { limit: 5000, force })
        setLogs((prev) => [...prev, `${target}: ${result.deleted} supprimes`])
      }

      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Reinitialiser les donnees</h2>
        <p className="text-sm text-slate-500">
          Choisissez les modules a reinitialiser. Cette action sera reliee a l API PrestaShop.
        </p>
      </div>

      <div className="rounded-xl border border-rose-100 bg-rose-50 p-4 text-sm text-rose-700">
        Warning: this action will delete and rebuild data once connected.
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-semibold text-slate-800">Modules</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {MODULE_OPTIONS.map((option) => (
            <label
              key={option.id}
              className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <input
                type="checkbox"
                className="h-4 w-4 accent-rose-600"
                checked={selected.includes(option.id)}
                onChange={() => toggleModule(option.id)}
                disabled={busy}
              />
              {option.label}
            </label>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <input
            id="force"
            type="checkbox"
            className="h-4 w-4 accent-rose-600"
            checked={force}
            onChange={(e) => setForce(e.target.checked)}
            disabled={busy}
          />
          <label htmlFor="force" className="text-sm text-slate-700">
            Forcer la suppression (ignore les erreurs et tente des fallbacks destructifs)
          </label>
        </div>
      </div>

      <button
        type="button"
        className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-rose-500 disabled:opacity-60"
        onClick={handleReset}
        disabled={!canSubmit}
      >
        {busy ? 'Reinitialisation...' : 'Reinitialiser maintenant'}
      </button>

      {done ? (
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          Reinitialisation terminee.
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
