import { useEffect, useMemo, useState } from 'react'
import { useAppSelector } from '../../app/hooks'
import { wsRequest } from '../../shared/http/prestashopWebserviceClient'
import { extractItemsFromList, getFirstLanguageText } from '../../shared/http/prestashopResources'
import { parseXml } from '../../shared/xml/xml'
import type { WsConfig } from '../../shared/http/prestashopWebserviceClient'
import { addStockMovement } from '../../shared/stock/stockMovements'

const TARGET_STATE_LABELS = {
  cart: 'dans le panier',
  paid: 'paiement accepté',
  delivered: 'livrée',
  canceled: 'annulé',
}

const DELIVERED_ALIASES = ['livree', 'livrée', 'delivered']

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

const FALLBACK_DELIVERED: OrderState = {
  id: 4,
  name: 'livree',
  normalized: 'livree',
}

type OrderRow = {
  idProduct: number
  idProductAttribute: number
  qty: number
  reference: string
  productName: string
}

type CombinationItem = {
  id: number
  valueIds: number[]
}

const combinationCache = new Map<number, CombinationItem[]>()
const optionValueCache = new Map<number, string>()

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

function parseOrderRows(xml: string): OrderRow[] {
  const parsed = parseXml<any>(xml)
  const rows = parsed?.prestashop?.order?.associations?.order_rows?.order_row
  const arr = Array.isArray(rows) ? rows : rows ? [rows] : []
  const out: OrderRow[] = []

  for (const row of arr) {
    const idProduct = Number(nodeText(row?.product_id))
    const idProductAttribute = Number(nodeText(row?.product_attribute_id))
    const qty = Number(nodeText(row?.product_quantity) || 0)
    const reference = nodeText(row?.product_reference)
    const productName = nodeText(row?.product_name)
    if (!Number.isFinite(idProduct) || !Number.isFinite(qty) || qty <= 0) continue
    out.push({
      idProduct,
      idProductAttribute: Number.isFinite(idProductAttribute) ? idProductAttribute : 0,
      qty,
      reference,
      productName,
    })
  }

  return out
}

async function getFirstLanguageId(config: WsConfig): Promise<number> {
  const res = await wsRequest(config, {
    method: 'GET',
    path: 'languages',
    query: { display: '[id]', limit: '0,1' },
  })

  if (!res.ok) return 1
  const ids = extractItemsFromList(res.xml, 'languages', 'language', (item) => {
    const raw = item?.['@_id'] ?? item?.id
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  })

  return ids[0] ?? 1
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function loadOptionValues(config: WsConfig): Promise<Map<number, string>> {
  if (optionValueCache.size > 0) return optionValueCache
  const res = await wsRequest(config, {
    method: 'GET',
    path: 'product_option_values',
    query: { display: '[id,name]', limit: '0,500' },
  })
  if (!res.ok) return optionValueCache

  const parsed = extractItemsFromList(res.xml, 'product_option_values', 'product_option_value', (item) => {
    const id = Number(item?.['@_id'] ?? item?.id)
    if (!Number.isFinite(id)) return null
    const name = getFirstLanguageText(item?.name)
    return { id, name }
  })

  for (const row of parsed) {
    optionValueCache.set(row.id, String(row.name || '').trim())
  }
  return optionValueCache
}

async function loadCombinations(config: WsConfig, productId: number): Promise<CombinationItem[]> {
  const cached = combinationCache.get(productId)
  if (cached) return cached

  const res = await wsRequest(config, {
    method: 'GET',
    path: 'combinations',
    query: { display: 'full', 'filter[id_product]': `[${productId}]`, limit: '0,200' },
  })

  if (!res.ok) return []

  const combos = extractItemsFromList(res.xml, 'combinations', 'combination', (item) => {
    const id = Number(item?.['@_id'] ?? item?.id)
    if (!Number.isFinite(id)) return null
    const valuesNode = item?.associations?.product_option_values?.product_option_value
    const valuesArray = Array.isArray(valuesNode) ? valuesNode : valuesNode ? [valuesNode] : []
    const valueIds = valuesArray
      .map((value: any) => Number(value?.['@_id'] ?? value?.id))
      .filter((valueId: number) => Number.isFinite(valueId))
    return { id, valueIds }
  })

  combinationCache.set(productId, combos)
  return combos
}

async function resolveCombinationByName(config: WsConfig, row: OrderRow): Promise<number | null> {
  const name = normalizeName(row.productName)
  if (!name) return null

  const optionValues = await loadOptionValues(config)
  const combos = await loadCombinations(config, row.idProduct)
  for (const combo of combos) {
    const labels = combo.valueIds
      .map((valueId) => optionValues.get(valueId))
      .filter((label): label is string => Boolean(label && label.trim()))
      .map((label) => normalizeName(label))

    if (labels.length > 0 && labels.every((label) => name.includes(label))) {
      return combo.id
    }
  }

  return null
}

async function ensureDeliveredState(config: WsConfig): Promise<OrderState | null> {
  const langId = await getFirstLanguageId(config)
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop>
  <order_state>
    <name>
      <language id="${langId}">livree</language>
    </name>
    <color>#32cd32</color>
    <send_email>0</send_email>
    <hidden>0</hidden>
    <delivery>1</delivery>
    <logable>1</logable>
    <invoice>1</invoice>
    <paid>1</paid>
    <template>delivery</template>
  </order_state>
</prestashop>
`

  const res = await wsRequest(config, {
    method: 'POST',
    path: 'order_states',
    xmlBody: xml,
  })

  if (!res.ok) return null
  const parsed = parseXml<any>(res.xml)
  const id = Number(parsed?.prestashop?.order_state?.id ?? parsed?.prestashop?.order_state?.['id'])
  if (!Number.isFinite(id)) return null
  return { id, name: 'livree', normalized: 'livree' }
}

async function decrementStockAvailable(
  config: WsConfig,
  row: OrderRow,
) {
  if (!config) return false
  let targetAttributeId = row.idProductAttribute

  if (targetAttributeId === 0 && row.reference) {
    const comboRes = await wsRequest(config, {
      method: 'GET',
      path: 'combinations',
      query: {
        display: '[id,reference]',
        'filter[id_product]': `[${row.idProduct}]`,
        'filter[reference]': `[${row.reference}]`,
        limit: '0,1',
      },
    })

    if (comboRes.ok) {
      const parsedCombo = parseXml<any>(comboRes.xml)
      const combo = parsedCombo?.prestashop?.combinations?.combination
      const comboNode = Array.isArray(combo) ? combo[0] : combo
      const comboId = Number(comboNode?.id ?? comboNode?.['@_id'] ?? 0)
      if (Number.isFinite(comboId) && comboId > 0) {
        targetAttributeId = comboId
      }
    }
  }

  if (targetAttributeId === 0 && row.productName) {
    const resolved = await resolveCombinationByName(config, row)
    if (resolved) targetAttributeId = resolved
  }

  const getRes = await wsRequest(config, {
    method: 'GET',
    path: 'stock_availables',
    query: {
      display: '[id,id_product,id_product_attribute,quantity,id_shop,id_shop_group]',
      'filter[id_product]': `[${row.idProduct}]`,
      'filter[id_product_attribute]': `[${targetAttributeId}]`,
      limit: '0,1',
    },
  })

  let parsed = getRes.ok ? parseXml<any>(getRes.xml) : null
  let list = parsed?.prestashop?.stock_availables?.stock_available
  let arr = Array.isArray(list) ? list : list ? [list] : []

  if (arr.length === 0 && targetAttributeId !== 0) {
    const fallbackRes = await wsRequest(config, {
      method: 'GET',
      path: 'stock_availables',
      query: {
        display: '[id,id_product,id_product_attribute,quantity,id_shop,id_shop_group]',
        'filter[id_product]': `[${row.idProduct}]`,
        'filter[id_product_attribute]': '[0]',
        limit: '0,1',
      },
    })
    if (fallbackRes.ok) {
      parsed = parseXml<any>(fallbackRes.xml)
      list = parsed?.prestashop?.stock_availables?.stock_available
      arr = Array.isArray(list) ? list : list ? [list] : []
    }
  }

  if (arr.length === 0) {
    const anyRes = await wsRequest(config, {
      method: 'GET',
      path: 'stock_availables',
      query: {
        display: '[id,id_product,id_product_attribute,quantity,id_shop,id_shop_group]',
        'filter[id_product]': `[${row.idProduct}]`,
        limit: '0,1',
      },
    })
    if (!anyRes.ok) return false
    parsed = parseXml<any>(anyRes.xml)
    list = parsed?.prestashop?.stock_availables?.stock_available
    arr = Array.isArray(list) ? list : list ? [list] : []
  }

  if (arr.length === 0) {
    const createXml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop>
  <stock_available>
    <id_product>${row.idProduct}</id_product>
    <id_product_attribute>${targetAttributeId}</id_product_attribute>
    <id_shop>1</id_shop>
    <id_shop_group>1</id_shop_group>
    <quantity>0</quantity>
    <depends_on_stock>0</depends_on_stock>
    <out_of_stock>2</out_of_stock>
  </stock_available>
</prestashop>
`
    const createRes = await wsRequest(config, {
      method: 'POST',
      path: 'stock_availables',
      xmlBody: createXml,
    })
    return createRes.ok
  }

  const stockNode = arr[0]
  const stockId = Number(stockNode?.id ?? stockNode?.['@_id'] ?? 0)
  const currentQty = Number(stockNode?.quantity ?? stockNode?.['quantity'] ?? 0)
  const idShop = Number(stockNode?.id_shop ?? stockNode?.['id_shop'] ?? 1) || 1
  const idShopGroup = Number(stockNode?.id_shop_group ?? stockNode?.['id_shop_group'] ?? 1) || 1
  if (!Number.isFinite(stockId)) return false

  const newQty = Math.max(0, (Number.isFinite(currentQty) ? currentQty : 0) - row.qty)
  const putXml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop>
  <stock_available>
    <id>${stockId}</id>
    <id_product>${row.idProduct}</id_product>
    <id_product_attribute>${targetAttributeId}</id_product_attribute>
    <id_shop>${idShop}</id_shop>
    <id_shop_group>${idShopGroup}</id_shop_group>
    <quantity>${newQty}</quantity>
    <depends_on_stock>0</depends_on_stock>
    <out_of_stock>2</out_of_stock>
  </stock_available>
</prestashop>
`

  const putRes = await wsRequest(config, {
    method: 'PUT',
    path: `stock_availables/${stockId}`,
    xmlBody: putXml,
  })

  return putRes.ok
}

async function decrementAnyStockAvailable(config: WsConfig, row: OrderRow): Promise<boolean> {
  const anyRes = await wsRequest(config, {
    method: 'GET',
    path: 'stock_availables',
    query: {
      display: '[id,id_product,id_product_attribute,quantity,id_shop,id_shop_group]',
      'filter[id_product]': `[${row.idProduct}]`,
      limit: '0,1',
    },
  })

  if (!anyRes.ok) return false
  const parsed = parseXml<any>(anyRes.xml)
  const list = parsed?.prestashop?.stock_availables?.stock_available
  const arr = Array.isArray(list) ? list : list ? [list] : []
  if (arr.length === 0) return false

  const stockNode = arr[0]
  const stockId = Number(stockNode?.id ?? stockNode?.['@_id'] ?? 0)
  const currentQty = Number(stockNode?.quantity ?? stockNode?.['quantity'] ?? 0)
  const idShop = Number(stockNode?.id_shop ?? stockNode?.['id_shop'] ?? 1) || 1
  const idShopGroup = Number(stockNode?.id_shop_group ?? stockNode?.['id_shop_group'] ?? 1) || 1
  const idProductAttribute = Number(stockNode?.id_product_attribute ?? stockNode?.['id_product_attribute'] ?? 0) || 0
  if (!Number.isFinite(stockId)) return false

  const newQty = Math.max(0, (Number.isFinite(currentQty) ? currentQty : 0) - row.qty)
  const putXml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop>
  <stock_available>
    <id>${stockId}</id>
    <id_product>${row.idProduct}</id_product>
    <id_product_attribute>${idProductAttribute}</id_product_attribute>
    <id_shop>${idShop}</id_shop>
    <id_shop_group>${idShopGroup}</id_shop_group>
    <quantity>${newQty}</quantity>
    <depends_on_stock>0</depends_on_stock>
    <out_of_stock>2</out_of_stock>
  </stock_available>
</prestashop>
`

  const putRes = await wsRequest(config, {
    method: 'PUT',
    path: `stock_availables/${stockId}`,
    xmlBody: putXml,
  })

  return putRes.ok
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
    const deliveredState = states.find((state) => DELIVERED_ALIASES.includes(state.normalized))
    const baseStates = wanted
      .map((label) => states.find((state) => state.normalized === normalizeLabel(label)))
      .filter((state): state is OrderState => Boolean(state))
    return (deliveredState ? baseStates.concat(deliveredState) : baseStates).concat(
      deliveredState ? [] : [FALLBACK_DELIVERED],
    )
  }, [states])

  const deliveredStateId = useMemo(() => {
    const state = allowedStates.find((s) => s.normalized === normalizeLabel(TARGET_STATE_LABELS.delivered))
    return state?.id ?? null
  }, [allowedStates])

  const canceledStateId = useMemo(() => {
    const state = allowedStates.find((s) => s.normalized === normalizeLabel(TARGET_STATE_LABELS.canceled))
    return state?.id ?? null
  }, [allowedStates])

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
      const hasDelivered = parsedStates.some((state) => DELIVERED_ALIASES.includes(state.normalized))
      if (!hasDelivered) {
        const created = await ensureDeliveredState(wsConfig)
        if (created) parsedStates.push(created)
      }
      setStates(parsedStates)

      const missing = Object.entries(TARGET_STATE_LABELS)
        .filter(([key, label]) => {
          if (key === 'delivered') {
            return !parsedStates.some((state) => DELIVERED_ALIASES.includes(state.normalized))
          }
          return !parsedStates.some((state) => state.normalized === normalizeLabel(label))
        })
        .filter(([key]) => key !== 'delivered')
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

  async function applyDeliveredStockMovement(orderId: number) {
    if (!wsConfig) return
    try {
      const detailRes = await wsRequest(wsConfig, {
        method: 'GET',
        path: `orders/${orderId}`,
      })
      if (!detailRes.ok) {
        setError(`Impossible de lire la commande ${orderId} pour le stock (HTTP ${detailRes.status}).`)
        return
      }

      const rows = parseOrderRows(detailRes.xml)
      for (const row of rows) {
        let ok = await decrementStockAvailable(wsConfig, row)
        if (!ok) {
          ok = await decrementAnyStockAvailable(wsConfig, row)
        }
        if (!ok) {
          setNotice(`Stock non modifie pour ${row.reference || row.idProduct} (commande ${orderId}). Verifie que la declinaison existe dans PrestaShop.`)
        } else {
          addStockMovement({
            productId: row.idProduct,
            productAttributeId: row.idProductAttribute,
            qty: row.qty,
            type: 'sortie',
            date: new Date().toISOString(),
            source: 'delivery',
          })
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
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
        const retryRes = await wsRequest(wsConfig, {
          method: 'POST',
          path: 'order_histories',
          xmlBody: xml,
        })

        if (!retryRes.ok) {
          // Fallback: try to update the order directly if history endpoint fails.
          const detailRes = await wsRequest(wsConfig, {
            method: 'GET',
            path: `orders/${orderId}`,
          })
          if (detailRes.ok) {
            let orderXml = detailRes.xml
            if (/<current_state>[\s\S]*?<\/current_state>/i.test(orderXml)) {
              orderXml = orderXml.replace(/<current_state>[\s\S]*?<\/current_state>/i, `<current_state>${stateId}</current_state>`)
            } else {
              orderXml = orderXml.replace(/<\/order>/i, `  <current_state>${stateId}</current_state>\n</order>`)
            }

            const putRes = await wsRequest(wsConfig, {
              method: 'PUT',
              path: `orders/${orderId}`,
              xmlBody: orderXml,
            })

            if (!putRes.ok) {
              setError(`Echec mise a jour commande ${orderId} (HTTP ${putRes.status}).`)
              setNotice(putRes.xml || 'Reponse vide')
              return
            }
          } else {
            setError(`Echec mise a jour commande ${orderId} (HTTP ${retryRes.status}).`)
            setNotice(retryRes.xml || 'Reponse vide')
            return
          }
        }
      }

      setOrders((prev) =>
        prev.map((order) => (order.id === orderId ? { ...order, currentStateId: stateId } : order)),
      )

      const deliveredState = allowedStates.find(
        (state) => state.normalized === normalizeLabel(TARGET_STATE_LABELS.delivered),
      )
      if (deliveredState && deliveredState.id === stateId) {
        await applyDeliveredStockMovement(orderId)
      }
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
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {orders.map((order) => {
                const state = stateById.get(order.currentStateId)
                const selectedState =
                  allowedStates.find((opt) => opt.id === state?.id)?.id ?? allowedStates[0]?.id ?? order.currentStateId
                const selectedOption = allowedStates.find((opt) => opt.id === selectedState)
                const paymentLabel = selectedOption?.name || state?.name || order.payment || '-'

                return (
                  <tr key={order.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-semibold text-slate-900">{order.id}</td>
                    <td className="px-4 py-3 text-slate-700">{order.reference || '-'}</td>
                    <td className="px-4 py-3 text-slate-600">{order.dateAdd || '-'}</td>
                    <td className="px-4 py-3 text-slate-600">{paymentLabel}</td>
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
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                          onClick={() => canceledStateId && updateOrderState(order.id, canceledStateId)}
                          disabled={!canceledStateId || updatingId === order.id || loading}
                        >
                          Annuler
                        </button>
                        <button
                          type="button"
                          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                          onClick={() => deliveredStateId && updateOrderState(order.id, deliveredStateId)}
                          disabled={!deliveredStateId || updatingId === order.id || loading}
                        >
                          Livrer
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {orders.length === 0 && !loading ? (
                <tr>
                  <td className="px-4 py-4 text-center text-sm text-slate-500" colSpan={7}>
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
