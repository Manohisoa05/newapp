import { useEffect, useMemo, useState } from 'react'
import { useAppSelector } from '../../app/hooks'
import { wsRequest } from '../../shared/http/prestashopWebserviceClient'
import { extractItemsFromList, getFirstLanguageText } from '../../shared/http/prestashopResources'

const TARGET_STATE_LABELS = {
  cart: 'dans le panier',
  paid: 'paiement accepté',
  canceled: 'annulé',
}

type OrderListItem = {
  id: number
  reference: string
  dateAdd: string
  currentStateId: number
  totalPaid: number
  payment: string
}

type OrderState = {
  id: number
  name: string
  normalized: string
}

function normalizeLabel(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function nodeText(value: any): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'object') {
    if (typeof value['#text'] === 'string' || typeof value['#text'] === 'number') return String(value['#text'])
    if (typeof value[''] === 'string' || typeof value[''] === 'number') return String(value[''])
  }
  return ''
}

function parseOrderList(xml: string): OrderListItem[] {
  return extractItemsFromList(xml, 'orders', 'order', (item) => {
    const id = Number(item?.['@_id'] ?? item?.id)
    if (!Number.isFinite(id)) return null
    const currentStateId = Number(nodeText(item?.current_state))
    return {
      id,
      reference: nodeText(item?.reference),
      dateAdd: nodeText(item?.date_add),
      currentStateId: Number.isFinite(currentStateId) ? currentStateId : 0,
      totalPaid: Number(nodeText(item?.total_paid) || 0),
      payment: nodeText(item?.payment),
    }
  })
}

function parseOrderStates(xml: string): OrderState[] {
  return extractItemsFromList(xml, 'order_states', 'order_state', (item) => {
    const id = Number(item?.['@_id'] ?? item?.id)
    if (!Number.isFinite(id)) return null
    const name = getFirstLanguageText(item?.name)
    return { id, name, normalized: normalizeLabel(name) }
  })
}

export default function OrdersPage() {
  const wsConfig = useAppSelector((s) => s.auth.wsConfig)
  const [orders, setOrders] = useState<OrderListItem[]>([])
  const [states, setStates] = useState<OrderState[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<number | null>(null)

  const stateById = useMemo(() => {
    const map = new Map<number, OrderState>()
    for (const state of states) map.set(state.id, state)
    return map
  }, [states])

  const allowedStates = useMemo(() => {
    const wanted = [TARGET_STATE_LABELS.cart, TARGET_STATE_LABELS.paid, TARGET_STATE_LABELS.canceled]
    return wanted
      .map((label) => states.find((state) => state.normalized === normalizeLabel(label)))
      .filter((state): state is OrderState => Boolean(state))
  }, [states])

  async function loadData() {
    if (!wsConfig) return
    setLoading(true)
    setError(null)
    setNotice(null)

    try {
      const statesRes = await wsRequest(wsConfig, {
        method: 'GET',
        path: 'order_states',
        query: { display: '[id,name]' },
      })

      if (!statesRes.ok) {
        setError(`Impossible de charger les etats de commande (HTTP ${statesRes.status}).`)
        return
      }

      const parsedStates = parseOrderStates(statesRes.xml)
      setStates(parsedStates)

      const missing = Object.entries(TARGET_STATE_LABELS)
        .filter(([, label]) => !parsedStates.some((state) => state.normalized === normalizeLabel(label)))
        .map(([key]) => key)

      if (missing.length > 0) {
        setNotice(`Etats manquants: ${missing.join(', ')}. Certains choix seront desactives.`)
      }

      const ordersRes = await wsRequest(wsConfig, {
        method: 'GET',
        path: 'orders',
        query: { display: '[id,reference,date_add,current_state,total_paid,payment]', sort: '[id_DESC]', limit: '0,50' },
      })

      if (!ordersRes.ok) {
        setError(`Impossible de charger les commandes (HTTP ${ordersRes.status}).`)
        return
      }

      setOrders(parseOrderList(ordersRes.xml))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  }

  async function updateOrderState(orderId: number, stateId: number) {
    if (!wsConfig) return
    setUpdatingId(orderId)
    setError(null)

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop>
  <order_history>
    <id_order>${orderId}</id_order>
    <id_order_state>${stateId}</id_order_state>
  </order_history>
</prestashop>
`

    try {
      const res = await wsRequest(wsConfig, {
        method: 'POST',
        path: 'order_histories',
        xmlBody: xml,
      })

      if (!res.ok) {
        setError(`Echec mise a jour commande ${orderId} (HTTP ${res.status}).`)
        return
      }

      setOrders((prev) =>
        prev.map((order) => (order.id === orderId ? { ...order, currentStateId: stateId } : order)),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setUpdatingId(null)
    }
  }

  useEffect(() => {
    loadData()
  }, [wsConfig])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Commandes</h2>
          <p className="text-sm text-slate-500">Liste des commandes et modification de l etat.</p>
        </div>
        <button
          type="button"
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
          onClick={loadData}
          disabled={loading}
        >
          {loading ? 'Chargement...' : 'Recharger'}
        </button>
      </div>

      {notice ? (
        <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">{notice}</div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Paiement</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Etat</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {orders.map((order) => {
                const state = stateById.get(order.currentStateId)
                const selectedState = allowedStates.find((opt) => opt.id === state?.id)?.id ?? allowedStates[0]?.id ?? order.currentStateId

                return (
                  <tr key={order.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-semibold text-slate-900">{order.id}</td>
                    <td className="px-4 py-3 text-slate-700">{order.reference || '-'}</td>
                    <td className="px-4 py-3 text-slate-600">{order.dateAdd || '-'}</td>
                    <td className="px-4 py-3 text-slate-600">{state?.name || order.payment || '-'}</td>
                    <td className="px-4 py-3 text-slate-700">{order.totalPaid.toFixed(2)}</td>
                    <td className="px-4 py-3">
                      <select
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none focus:border-slate-400"
                        value={selectedState}
                        onChange={(e) => updateOrderState(order.id, Number(e.target.value))}
                        disabled={updatingId === order.id || loading}
                      >
                        {allowedStates.map((opt) => (
                          <option key={`${opt.id}-${opt.name}`} value={opt.id}>
                            {opt.name || `Etat ${opt.id}`}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                )
              })}
              {orders.length === 0 && !loading ? (
                <tr>
                  <td className="px-4 py-4 text-center text-sm text-slate-500" colSpan={6}>
                    Aucune commande trouvee.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
