import { useEffect, useMemo, useState } from 'react'
import { useAppSelector } from '../../app/hooks'
import { wsRequest } from '../../shared/http/prestashopWebserviceClient'
import { extractItemsFromList, getFirstLanguageText } from '../../shared/http/prestashopResources'

type ProductItem = { id: number; name: string; reference: string }
type StockRow = { id: number }
type StockMovementRow = { date: string; quantity: number }
type StockAvailableRow = { quantity: number }

function nodeText(value: any): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'object') {
    if (typeof value['#text'] === 'string' || typeof value['#text'] === 'number') return String(value['#text'])
    if (typeof value[''] === 'string' || typeof value[''] === 'number') return String(value[''])
  }
  return ''
}

function parseStocks(xml: string): StockRow[] {
  return extractItemsFromList(xml, 'stocks', 'stock', (item: any) => {
    const id = Number(item?.['@_id'] ?? item?.id)
    if (!Number.isFinite(id)) return null
    return { id }
  })
}

function parseStockMovements(xml: string): StockMovementRow[] {
  return extractItemsFromList(xml, 'stock_movements', 'stock_movement', (item: any) => {
    const dateRaw = nodeText(item?.date_add)
    const date = dateRaw.slice(0, 10)
    const quantityRaw = nodeText(item?.physical_quantity) || nodeText(item?.quantity)
    const quantity = Number(quantityRaw)
    if (!date || !Number.isFinite(quantity)) return null
    return { date, quantity }
  })
}

function parseStockAvailables(xml: string): StockAvailableRow[] {
  return extractItemsFromList(xml, 'stock_availables', 'stock_available', (item: any) => {
    const quantity = Number(nodeText(item?.quantity))
    if (!Number.isFinite(quantity)) return null
    return { quantity }
  })
}

export default function StockHistoryPage() {
  const wsConfig = useAppSelector((s) => s.auth.wsConfig)
  const [products, setProducts] = useState<ProductItem[]>([])
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null)
  const [movementRows, setMovementRows] = useState<StockMovementRow[]>([])
  const [movementSource, setMovementSource] = useState<'stock' | 'snapshot' | 'none'>('none')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    async function loadProducts() {
      if (!wsConfig) return
      try {
        const res = await wsRequest(wsConfig, {
          method: 'GET',
          path: 'products',
          query: { display: '[id,name,reference]', limit: '0,1000' },
        })
        if (!res.ok) {
          setError(`Impossible de charger les produits (HTTP ${res.status})`)
          return
        }
        const parsed = extractItemsFromList(res.xml, 'products', 'product', (item: any) => {
          const id = Number(item?.['@_id'] ?? item?.id)
          if (!Number.isFinite(id)) return null
          return { id, name: getFirstLanguageText(item?.name) || '', reference: String(item?.reference ?? '') }
        })
        setProducts(parsed)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }
    loadProducts()
  }, [wsConfig])

  async function loadMovements(productId: number) {
    if (!wsConfig) return
    setError(null)
    setLoading(true)
    setMovementRows([])
    setMovementSource('none')
    try {
      const stocksRes = await wsRequest(wsConfig, {
        method: 'GET',
        path: 'stocks',
        query: { display: '[id,id_product]', ['filter[id_product]']: `[${productId}]`, limit: '0,500' },
      })
      if (!stocksRes.ok) {
        setError(`Impossible de charger les stocks (HTTP ${stocksRes.status})`)
        return
      }
      const stockIds = parseStocks(stocksRes.xml).map((r) => r.id)
      if (stockIds.length > 0) {
        const movementsRes = await wsRequest(wsConfig, {
          method: 'GET',
          path: 'stock_movements',
          query: { display: 'full', ['filter[id_stock]']: `[${stockIds.join('|')}]`, limit: '0,1000', sort: '[date_add_DESC]' },
        })
        if (movementsRes.ok) {
          const rows = parseStockMovements(movementsRes.xml)
          if (rows.length > 0) {
            setMovementRows(rows)
            setMovementSource('stock')
            return
          }
        }
      }
      // fallback: snapshot from stock_availables
      const availRes = await wsRequest(wsConfig, {
        method: 'GET',
        path: 'stock_availables',
        query: { display: '[quantity,id_product]', ['filter[id_product]']: `[${productId}]`, limit: '0,500' },
      })
      if (!availRes.ok) {
        setError(`Impossible de charger stock_availables (HTTP ${availRes.status})`)
        return
      }
      const avail = parseStockAvailables(availRes.xml)
      if (avail.length > 0) {
        const total = avail.reduce((s, r) => s + r.quantity, 0)
        const today = new Date().toISOString().slice(0, 10)
        setMovementRows([{ date: today, quantity: total }])
        setMovementSource('snapshot')
      } else {
        setMovementRows([])
        setMovementSource('none')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const aggregated = useMemo(() => {
    if (movementRows.length === 0) return [] as { date: string; total: number; count: number }[]
    const map = new Map<string, { total: number; count: number }>()
    for (const r of movementRows) {
      const cur = map.get(r.date) ?? { total: 0, count: 0 }
      cur.total += r.quantity
      cur.count += 1
      map.set(r.date, cur)
    }
    return Array.from(map.entries()).map(([date, v]) => ({ date, total: v.total, count: v.count })).sort((a, b) => (a.date < b.date ? 1 : -1))
  }, [movementRows])



  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Historique journalier du stock</h2>
          <p className="text-sm text-slate-500">Voir l'évolution quotidienne des mouvements de stock d'un produit.</p>
        </div>
      </div>

      {error ? <div className="rounded-md bg-rose-50 p-3 text-rose-700">{error}</div> : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border p-4">
          <div className="text-sm font-semibold">Produit</div>
          <div className="mt-2">
            <select
              className="w-full rounded-lg border px-3 py-2"
              value={selectedProductId ?? ''}
              onChange={(e) => {
                const id = Number(e.target.value || 0)
                setSelectedProductId(id || null)
                if (id) loadMovements(id)
              }}
            >
              <option value="">-- Choisir un produit --</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.reference || p.name} · {p.id}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="col-span-2 rounded-2xl border p-4">
          <div className="text-sm font-semibold">Evolution journalière</div>
          <div className="mt-3">
            {loading ? (
              <div>Chargement...</div>
            ) : aggregated.length === 0 ? (
              <div className="text-sm text-slate-500">Aucun mouvement disponible.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-xs text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Mouvements</th>
                      <th className="px-3 py-2">Variation totale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aggregated.map((r) => (
                      <tr key={r.date} className="border-t">
                        <td className="px-3 py-2 font-semibold">{r.date}</td>
                        <td className="px-3 py-2">{r.count}</td>
                        <td className="px-3 py-2">{r.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="mt-3 text-xs text-slate-500">
            {movementSource === 'stock' ? 'Source: mouvements de stock PrestaShop.' : movementSource === 'snapshot' ? 'Source: snapshot (stock_availables)' : 'Aucune donnée.'}
          </div>
        </div>
      </div>
    </div>
  )
}
