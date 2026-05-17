import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAppSelector } from '../../app/hooks'
import { authService } from '../../features/auth/authService'
import { wsRequest } from '../../shared/http/prestashopWebserviceClient'
import { extractItemsFromList, getFirstLanguageText } from '../../shared/http/prestashopResources'

type OrderItem = {
  id: number
  reference: string
  dateAdd: string
  totalPaid: number
  currentStateId: number
}

type OrderState = {
  id: number
  name: string
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

function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return value.toFixed(2)
}

function parseOrders(xml: string): OrderItem[] {
  return extractItemsFromList(xml, 'orders', 'order', (item) => {
    const id = Number(item?.['@_id'] ?? item?.id)
    if (!Number.isFinite(id)) return null
    const currentStateId = Number(nodeText(item?.current_state))
    return {
      id,
      reference: nodeText(item?.reference),
      dateAdd: nodeText(item?.date_add),
      totalPaid: Number(nodeText(item?.total_paid) || 0),
      currentStateId: Number.isFinite(currentStateId) ? currentStateId : 0,
    }
  })
}

function parseOrderStates(xml: string): OrderState[] {
  return extractItemsFromList(xml, 'order_states', 'order_state', (item) => {
    const id = Number(item?.['@_id'] ?? item?.id)
    if (!Number.isFinite(id)) return null
    const name = getFirstLanguageText(item?.name)
    return { id, name }
  })
}

export default function MyOrdersPage() {
  const wsConfig = useAppSelector((s) => s.auth.wsConfig)
  const [connectedUserName, setConnectedUserName] = useState('')
  const [orders, setOrders] = useState<OrderItem[]>([])
  const [states, setStates] = useState<OrderState[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stateById = useMemo(() => {
    const map = new Map<number, OrderState>()
    for (const state of states) map.set(state.id, state)
    return map
  }, [states])

  async function loadMyOrders() {
    if (!wsConfig) {
      setError('Cle webservice manquante. Ouvre le backoffice pour configurer l acces API.')
      return
    }

    const customer = authService.getStoredCustomerUser()
    const customerId = Number(customer?.id)
    if (!Number.isFinite(customerId) || customerId <= 0) {
      setError('Utilisateur frontoffice non connecte. Merci de vous reconnecter.')
      return
    }

    const fullName = `${String(customer?.firstname ?? '').trim()} ${String(customer?.lastname ?? '').trim()}`.trim()
    setConnectedUserName(fullName || String(customer?.email ?? ''))

    setLoading(true)
    setError(null)
    setOrders([])

    try {
      const stateRes = await wsRequest(wsConfig, {
        method: 'GET',
        path: 'order_states',
        query: { display: '[id,name]' },
      })

      if (stateRes.ok) {
        setStates(parseOrderStates(stateRes.xml))
      }

      const ordersRes = await wsRequest(wsConfig, {
        method: 'GET',
        path: 'orders',
        query: {
          display: '[id,reference,date_add,total_paid,current_state]',
          'filter[id_customer]': `[${customerId}]`,
          sort: '[id_DESC]',
        },
      })

      if (!ordersRes.ok) {
        setError(`Impossible de charger les commandes (HTTP ${ordersRes.status}).`)
        return
      }

      setOrders(parseOrders(ordersRes.xml))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadMyOrders()
  }, [wsConfig])

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#fff1d6,_#f6f7fb_45%,_#e7eefc_100%)] text-slate-900 font-['Space_Grotesk',ui-sans-serif,system-ui]">
      <header className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-lg font-bold text-amber-200 shadow-lg">
            FO
          </div>
          <div>
            <div className="text-lg font-bold tracking-tight">Mes commandes</div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Boutique</div>
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm font-semibold">
          <Link className="rounded-full border border-slate-300 px-4 py-2 text-slate-700 transition-colors hover:bg-white" to="/products">
            Accueil
          </Link>
          <Link className="rounded-full border border-slate-300 px-4 py-2 text-slate-700 transition-colors hover:bg-white" to="/cart">
            Panier
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-6 pb-16">
        <section className="rounded-[32px] border border-white/70 bg-white/80 p-8 shadow-xl backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">Suivi des commandes</h1>
              <p className="text-sm text-slate-600">
                {connectedUserName
                  ? `Commandes de ${connectedUserName}`
                  : 'Affichage des commandes de l utilisateur connecte.'}
              </p>
            </div>
            <button
              type="button"
              onClick={loadMyOrders}
              className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-slate-900/20"
              disabled={loading}
            >
              {loading ? 'Actualisation...' : 'Actualiser'}
            </button>
          </div>

          {error ? (
            <div className="mt-4 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          <div className="mt-6 grid gap-4">
            {orders.map((order) => (
              <div key={order.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Commande #{order.id}</div>
                    <div className="text-xs text-slate-500">Ref {order.reference || '-'} · {order.dateAdd || '-'}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-slate-900">{formatPrice(order.totalPaid)}</div>
                    <div className="text-xs text-slate-500">
                      {stateById.get(order.currentStateId)?.name || 'Etat inconnu'}
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {orders.length === 0 && !loading && !error ? (
              <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500">
                Aucune commande a afficher.
              </div>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  )
}
