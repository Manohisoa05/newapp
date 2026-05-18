import { useEffect, useMemo, useState } from 'react'
import { useAppSelector } from '../../app/hooks'
import { parseCsv } from '../../shared/csv/csv'
import { wsRequest } from '../../shared/http/prestashopWebserviceClient'
import { extractItemsFromList } from '../../shared/http/prestashopResources'
import { parseXml } from '../../shared/xml/xml'
import productsCsvText from '../../../100-lignes/100 lignes/produits.csv?raw'
import variantsCsvText from '../../../100-lignes/100 lignes/declinaisons.csv?raw'
import ordersCsvText from '../../../100-lignes/100 lignes/commandes.csv?raw'

const PURCHASE_PRICE_BY_REFERENCE: Record<string, number> = {
  T_01: 8.5,
  P_01: 14.33,
  C_03: 2,
  M_02: 40,
  S_01: 30.5,
  CH_01: 55.2,
  P_02: 22.8,
  C_04: 12.5,
  L_01: 55,
  PO_01: 30,
  CH_02: 32.5,
  S_02: 15.2,
  V_01: 65,
  G_01: 8.5,
  E_01: 18.5,
  CH_03: 12,
  B_01: 85,
  SA_01: 25.5,
  R_01: 45,
  J_01: 29.5,
}

let TAX_RATE_BY_REFERENCE: Map<string, number> | null = null

function getTaxRateByReference(reference: string): number {
  if (!TAX_RATE_BY_REFERENCE) {
    TAX_RATE_BY_REFERENCE = new Map<string, number>()
    const rows = parseCsv(productsCsvText).rows
    for (const row of rows) {
      const ref = String(row.reference ?? '').trim()
      if (!ref) continue
      const rate = parseCsvNumber(String(row.Taxe ?? '').replace('%', ''))
      TAX_RATE_BY_REFERENCE.set(ref, rate)
    }
  }
  return TAX_RATE_BY_REFERENCE.get(reference) ?? 0
}

type OrderLine = {
  reference: string
  quantity: number
  totalTtc: number
  totalHt: number
  purchaseCost: number
}

type OrderRow = {
  id: number
  dateAdd: string
  totalTtc: number
  totalHt: number
  lines: OrderLine[]
}

type OrderListRow = {
  id: number
  dateAdd: string
  totalTtc: number
  totalHt: number
  currentStateId: number
  cartId: number
}

type CartListRow = {
  id: number
  dateAdd: string
  totalTtc: number
  totalHt: number
}

type DayStat = {
  date: string
  count: number
  totalTtc: number
}

type DashboardTotals = {
  paidCount: number
  unpaidCount: number
  totalCount: number
  paidTtc: number
  paidHt: number
  cartTtc: number
  cartHt: number
  ensembleTtc: number
  ensembleHt: number
  purchaseCost: number
  profit: number
}

type CategoryQuantity = {
  category: string
  physicalQty: number
  reservedQty: number
  availableQty: number
}

type ProductInfo = {
  id: number
  reference: string
  categoryId: number
  category: string
}

type CartDetailRow = {
  idProduct: number
  quantity: number
}

type ProductStockRow = {
  idProduct: number
  quantity: number
}

function nodeText(value: any): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'object') {
    if (typeof value['#text'] === 'string' || typeof value['#text'] === 'number') return String(value['#text'])
    if (typeof value[''] === 'string' || typeof value[''] === 'number') return String(value[''])
    if (typeof value.id === 'string' || typeof value.id === 'number') return String(value.id)
    if (typeof value['@_id'] === 'string' || typeof value['@_id'] === 'number') return String(value['@_id'])
  }
  return ''
}

function normalizeLabel(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function parseNumber(value: string): number {
  const normalized = value.trim().replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function getStatDate(order: OrderRow): string {
  return order.dateAdd.slice(0, 10) || 'unknown'
}

function parseOrderList(xml: string): OrderListRow[] {
  return extractItemsFromList(xml, 'orders', 'order', (item) => {
    const id = Number(item?.['@_id'] ?? item?.id)
    if (!Number.isFinite(id)) return null
    const currentStateId = Number(nodeText(item?.current_state))
    const cartId = Number(nodeText(item?.id_cart))
    return {
      id,
      dateAdd: nodeText(item?.date_add),
      totalTtc: parseNumber(nodeText(item?.total_paid_tax_incl) || nodeText(item?.total_paid) || '0'),
      totalHt: parseNumber(nodeText(item?.total_paid_tax_excl) || '0'),
      currentStateId: Number.isFinite(currentStateId) ? currentStateId : 0,
      cartId: Number.isFinite(cartId) ? cartId : 0,
    }
  })
}

function parseCartList(xml: string): CartListRow[] {
  return extractItemsFromList(xml, 'carts', 'cart', (item) => {
    const id = Number(item?.['@_id'] ?? item?.id)
    if (!Number.isFinite(id)) return null
    return {
      id,
      dateAdd: nodeText(item?.date_add),
      totalTtc: parseNumber(nodeText(item?.total_products_wt) || nodeText(item?.total_paid_tax_incl) || nodeText(item?.total_paid) || '0'),
      totalHt: parseNumber(nodeText(item?.total_products) || nodeText(item?.total_paid_tax_excl) || '0'),
    }
  })
}

function parseProductsForDashboard(xml: string): ProductInfo[] {
  return extractItemsFromList(xml, 'products', 'product', (item) => {
    const id = Number(item?.['@_id'] ?? item?.id)
    if (!Number.isFinite(id)) return null
    const reference = nodeText(item?.reference)
    const categoryId = Number(nodeText(item?.id_category_default) || 0)
    return {
      id,
      reference,
      categoryId: Number.isFinite(categoryId) ? categoryId : 0,
      category: 'Autre',
    }
  })
}

function parseCategoryNameMap(xml: string): Map<number, string> {
  const parsed = parseXml<any>(xml)
  const categories = parsed?.prestashop?.categories?.category
  const arr = Array.isArray(categories) ? categories : categories ? [categories] : []
  const map = new Map<number, string>()

  for (const category of arr) {
    const id = Number(category?.id)
    if (!Number.isFinite(id)) continue
    const name = nodeText(category?.name?.language ?? category?.name)
    map.set(id, name || `Categorie ${id}`)
  }

  return map
}

function parseProductStockRows(xml: string): ProductStockRow[] {
  return extractItemsFromList(xml, 'stock_availables', 'stock_available', (item) => {
    const idProduct = Number(nodeText(item?.id_product))
    const quantity = Number(nodeText(item?.quantity) || 0)
    if (!Number.isFinite(idProduct) || !Number.isFinite(quantity)) return null
    return { idProduct, quantity }
  })
}

function parseCartDetails(xml: string): CartDetailRow[] {
  const parsed = parseXml<any>(xml)
  const cart = parsed?.prestashop?.cart
  const rows = cart?.associations?.cart_rows?.cart_row
  const arr = Array.isArray(rows) ? rows : rows ? [rows] : []
  const out: CartDetailRow[] = []

  for (const row of arr) {
    const idProduct = Number(nodeText(row?.id_product))
    const quantity = Number(nodeText(row?.quantity) || 0)
    if (!Number.isFinite(idProduct) || !Number.isFinite(quantity) || quantity <= 0) continue
    out.push({ idProduct, quantity })
  }

  return out
}

function parseOrderLines(order: any): OrderLine[] {
  const orderRows = toArray(order?.associations?.order_rows?.order_row)
  const lines: OrderLine[] = []

  for (const row of orderRows) {
    const reference = nodeText(row?.product_reference)
    const quantity = Number(nodeText(row?.product_quantity) || 0)
    // Ensure we compute per-line totals (unit price × quantity) when only unit price is provided
    const unitTtcRaw = nodeText(row?.unit_price_tax_incl)
    const totalTtcRaw = nodeText(row?.total_price_tax_incl)
    const unitHtRaw = nodeText(row?.unit_price_tax_excl)
    const totalHtRaw = nodeText(row?.total_price_tax_excl)

    let totalTtc = 0
    if (totalTtcRaw) totalTtc = parseNumber(totalTtcRaw)
    else if (unitTtcRaw) totalTtc = parseNumber(unitTtcRaw) * (Number.isFinite(quantity) ? quantity : 0)

    let totalHt = 0
    if (totalHtRaw) totalHt = parseNumber(totalHtRaw)
    else if (unitHtRaw) totalHt = parseNumber(unitHtRaw) * (Number.isFinite(quantity) ? quantity : 0)

    if (totalHt === 0 && totalTtc > 0) {
      const taxRate = getTaxRateByReference(reference)
      totalHt = taxRate > 0 ? totalTtc / (1 + taxRate / 100) : totalTtc
    }

    const purchaseUnit = PURCHASE_PRICE_BY_REFERENCE[reference] ?? 0
    const qty = Number.isFinite(quantity) ? quantity : 0

    lines.push({
      reference,
      quantity: qty,
      totalTtc,
      totalHt,
      purchaseCost: purchaseUnit * qty,
    })
  }

  return lines
}

function parseOrderDetail(xml: string): OrderRow | null {
  const parsed = parseXml<any>(xml)
  const order = parsed?.prestashop?.order
  const id = Number(order?.id)
  if (!Number.isFinite(id)) return null
  const totalTtc = parseNumber(nodeText(order?.total_products_wt) || nodeText(order?.total_paid_tax_incl) || nodeText(order?.total_paid) || '0')
  const totalHt = parseNumber(nodeText(order?.total_products) || nodeText(order?.total_paid_tax_excl) || '0')
  return {
    id,
    dateAdd: nodeText(order?.date_add),
    totalTtc,
    totalHt,
    lines: parseOrderLines(order),
  }
}

type CsvOrderLine = {
  reference: string
  quantity: number
  variant: string
}

function parseCsvNumber(value: string): number {
  const normalized = value.trim().replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseAchat(value: string): CsvOrderLine[] {
  return Array.from(value.matchAll(/\(\s*"([^"]+)"\s*;\s*(\d+)\s*;\s*"([^"]*)"\s*\)/g)).map((match) => ({
    reference: match[1],
    quantity: Number(match[2]),
    variant: match[3],
  }))
}

function buildFallbackStats() {
  const products = parseCsv(productsCsvText).rows
  const variants = parseCsv(variantsCsvText).rows
  const orders = parseCsv(ordersCsvText).rows

  const productByReference = new Map<string, { priceTtc: number; purchasePrice: number; taxRate: number }>()
  for (const row of products) {
    productByReference.set(String(row.reference).trim(), {
      priceTtc: parseCsvNumber(row.prix_ttc),
      purchasePrice: parseCsvNumber(row.prix_achat),
      taxRate: parseCsvNumber(row.Taxe.replace('%', '')),
    })
  }

  const variantByKey = new Map<string, number>()
  for (const row of variants) {
    const reference = String(row.reference).trim()
    const value = String(row.karazany).trim()
    const price = parseCsvNumber(row.prix_vente_ttc)
    if (reference && value) variantByKey.set(`${reference}:${value}`, price)
  }

  const orderRows = orders.map((row, index) => {
    const date = String(row.date).trim()
    const status = String(row.etat).trim()
    const lines = parseAchat(String(row.achat ?? ''))
    let totalTtc = 0
    let totalHt = 0
    let purchaseCost = 0

    for (const line of lines) {
      const product = productByReference.get(line.reference)
      if (!product) continue
      const variantPrice = variantByKey.get(`${line.reference}:${line.variant}`)
      const unitTtc = variantPrice && variantPrice > 0 ? variantPrice : product.priceTtc
      const unitHt = product.taxRate > 0 ? unitTtc / (1 + product.taxRate / 100) : unitTtc
      totalTtc += unitTtc * line.quantity
      totalHt += unitHt * line.quantity
      purchaseCost += product.purchasePrice * line.quantity
    }

    return {
      id: index + 1,
      dateAdd: date ? `${date.slice(6, 10)}-${date.slice(3, 5)}-${date.slice(0, 2)}` : 'unknown',
      totalTtc,
      totalHt,
      purchaseCost,
      isCart: normalizeLabel(status) !== 'paiement accepte' && normalizeLabel(status) !== 'paiement effectue' && normalizeLabel(status) !== 'payement effectue',
    }
  })

  return orderRows
}

export default function BackofficePage() {
  const wsConfig = useAppSelector((s) => s.auth.wsConfig)
  const resetDashboardKey = 'newapp.dashboard.resetCsv'
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [carts, setCarts] = useState<CartListRow[]>([])
  const [categoryQuantities, setCategoryQuantities] = useState<CategoryQuantity[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stats = useMemo(() => {
    const categoryByReference = new Map<string, string>()
    const productCategoryFallbackByReference = new Map<string, string>()
    for (const row of parseCsv(productsCsvText).rows) {
      const reference = String(row.reference ?? '').trim()
      const category = String(row.categorie ?? '').trim() || 'Autre'
      if (reference) {
        categoryByReference.set(reference, category)
        productCategoryFallbackByReference.set(reference, category)
      }
    }

    const categoryMap = new Map<string, { totalHt: number; purchaseCost: number }>()
    const map = new Map<string, DayStat>()
    const paidTtc = orders.reduce((sum, order) => sum + order.totalTtc, 0)
    const paidHt = orders.reduce((sum, order) => sum + order.totalHt, 0)
    const cartTtc = carts.reduce((sum, cart) => sum + cart.totalTtc, 0)
    const cartHt = carts.reduce((sum, cart) => sum + cart.totalHt, 0)
    const totals: DashboardTotals = {
      paidCount: orders.length,
      unpaidCount: carts.length,
      totalCount: orders.length,
      paidTtc,
      paidHt,
      cartTtc,
      cartHt,
      ensembleTtc: paidTtc,
      ensembleHt: paidHt,
      purchaseCost: 0,
      profit: 0,
    }

    for (const order of orders) {
      const date = getStatDate(order)
      const entry = map.get(date) ?? { date, count: 0, totalTtc: 0 }
      entry.count += 1
      entry.totalTtc += order.totalTtc
      map.set(date, entry)

      totals.purchaseCost += order.lines.reduce((sum, line) => sum + line.purchaseCost, 0)

      for (const line of order.lines) {
        const category = categoryByReference.get(line.reference) ?? 'Autre'
        const cur = categoryMap.get(category) ?? { totalHt: 0, purchaseCost: 0 }
        cur.totalHt += line.totalHt
        cur.purchaseCost += line.purchaseCost
        categoryMap.set(category, cur)
      }

    }

    // Do not allow negative profit (akanjo must not be negative)
    totals.profit = Math.max(0, totals.paidHt - totals.purchaseCost)

    const rows = Array.from(map.values()).sort((a, b) => (a.date < b.date ? 1 : -1))
    const categoryStats = Array.from(categoryMap.entries())
      .map(([category, values]) => ({
        category,
        totalHt: values.totalHt,
        purchaseCost: values.purchaseCost,
        profit: Math.max(0, values.totalHt - values.purchaseCost),
      }))
      .sort((a, b) => b.profit - a.profit)

    return { rows, totals, categoryStats }
  }, [orders, carts])

  const fallbackData = useMemo(() => buildFallbackStats(), [])

  async function loadData() {
    if (!wsConfig) {
      setError('Configuration webservice manquante. Connecte-toi au backoffice.')
      setOrders([])
      setCarts([])
      setCategoryQuantities([])
      return
    }

    setLoading(true)
    setError(null)

    try {
      const [stateRes, productsRes, categoriesRes, stockRes] = await Promise.all([
        wsRequest(wsConfig, {
          method: 'GET',
          path: 'order_states',
          query: { display: '[id,name]' },
        }),
        wsRequest(wsConfig, {
          method: 'GET',
          path: 'products',
          query: { display: '[id,reference,id_category_default]', limit: '0,1000' },
        }),
        wsRequest(wsConfig, {
          method: 'GET',
          path: 'categories',
          query: { display: '[id,name]', limit: '0,1000' },
        }),
        wsRequest(wsConfig, {
          method: 'GET',
          path: 'stock_availables',
          query: { display: '[id_product,id_product_attribute,quantity]', limit: '0,1000' },
        }),
      ])

      const stateById = new Map<number, string>()
      if (stateRes.ok) {
        const parsed = parseXml<any>(stateRes.xml)
        const list = parsed?.prestashop?.order_states?.order_state
        const arr = Array.isArray(list) ? list : list ? [list] : []
        for (const state of arr) {
          const id = Number(state?.id ?? state?.['@_id'])
          const name = typeof state?.name === 'object'
            ? String(state?.name?.language?.['#text'] ?? state?.name?.language ?? '')
            : String(state?.name ?? '')
          if (Number.isFinite(id)) stateById.set(id, normalizeLabel(name))
        }
      }

      const canceledLabels = ['annule', 'annulé']
      const cartLabels = ['dans le panier']

      const ordersRes = await wsRequest(wsConfig, {
        method: 'GET',
        path: 'orders',
        query: {
          display: '[id,date_add,total_paid_tax_incl,total_paid_tax_excl,current_state,id_cart]',
          limit: '0,1000',
          sort: '[id_DESC]'
        },
      })

      if (!ordersRes.ok) {
        throw new Error(`Impossible de charger les commandes (HTTP ${ordersRes.status}).`)
      }

      const orderList = parseOrderList(ordersRes.xml)
      const activeOrders = orderList.filter((order) => {
        const label = stateById.get(order.currentStateId) ?? ''
        return !canceledLabels.includes(label) && !cartLabels.includes(label)
      })
      const cartLikeOrders = orderList.filter((order) => cartLabels.includes(stateById.get(order.currentStateId) ?? ''))
      const canceledOrders = new Set(
        orderList
          .filter((order) => canceledLabels.includes(stateById.get(order.currentStateId) ?? ''))
          .map((order) => order.id),
      )

      const orderLines: OrderRow[] = []
      for (const order of activeOrders) {
        const detailRes = await wsRequest(wsConfig, {
          method: 'GET',
          path: `orders/${order.id}`,
        })

        if (!detailRes.ok) continue
        const detail = parseOrderDetail(detailRes.xml)
        if (detail) orderLines.push(detail)
      }

      const cartsRes = await wsRequest(wsConfig, {
        method: 'GET',
        path: 'carts',
        query: {
          display: '[id,date_add,total_products_wt,total_products]',
          limit: '0,1000',
          sort: '[id_DESC]'
        },
      })

      const orderCartIds = new Set(orderList.map((order) => order.cartId).filter((id) => id > 0))
      const cartsList = cartsRes.ok ? parseCartList(cartsRes.xml) : []
      const filteredCarts = cartsList.filter((cart) => !orderCartIds.has(cart.id))
      const cartsFromOrders = cartLikeOrders.map((order) => ({
        id: order.id,
        dateAdd: order.dateAdd,
        totalTtc: order.totalTtc,
        totalHt: order.totalHt,
      }))

      const categoryNameById = categoriesRes.ok ? parseCategoryNameMap(categoriesRes.xml) : new Map<number, string>()
      const productCatalogue = productsRes.ok ? parseProductsForDashboard(productsRes.xml) : []
      const productById = new Map<number, ProductInfo>()
      for (const product of productCatalogue) {
        productById.set(product.id, {
          ...product,
          category: categoryNameById.get(product.categoryId) ?? 'Autre',
        })
      }

      const physicalByCategory = new Map<string, number>()
      if (stockRes.ok) {
        for (const stock of parseProductStockRows(stockRes.xml)) {
          const product = productById.get(stock.idProduct)
          if (!product) continue
          physicalByCategory.set(product.category, (physicalByCategory.get(product.category) ?? 0) + stock.quantity)
        }
      }

      const cartDetailRows: CartDetailRow[] = []
      for (const cart of filteredCarts) {
        // best-effort fetch of cart contents so reserved stock is based on the actual open carts.
        // eslint-disable-next-line no-await-in-loop
        const cartRes = await wsRequest(wsConfig, {
          method: 'GET',
          path: `carts/${cart.id}`,
        })
        if (!cartRes.ok) continue
        cartDetailRows.push(...parseCartDetails(cartRes.xml))
      }

      const reservedByCategory = new Map<string, number>()
      for (const row of cartDetailRows) {
        const product = productById.get(row.idProduct)
        if (!product) continue
        reservedByCategory.set(product.category, (reservedByCategory.get(product.category) ?? 0) + row.quantity)
      }

      const allCategories = new Set<string>([...physicalByCategory.keys(), ...reservedByCategory.keys()])
      setCategoryQuantities(
        Array.from(allCategories)
          .map((category) => {
            const physicalQty = physicalByCategory.get(category) ?? 0
            const reservedQty = reservedByCategory.get(category) ?? 0
            return {
              category,
              physicalQty,
              reservedQty,
              availableQty: physicalQty - reservedQty,
            }
          })
          .sort((a, b) => a.category.localeCompare(b.category)),
      )

      const resetAtRaw = localStorage.getItem(resetDashboardKey)
      const resetAt = resetAtRaw ? Date.parse(resetAtRaw) : NaN
      const hasReset = Number.isFinite(resetAt)
      const fallbackOrders = hasReset
        ? []
        : fallbackData.filter((row) => !row.isCart)
      const fallbackCarts = hasReset
        ? []
        : fallbackData.filter((row) => row.isCart)

      const mergedOrders = orderLines.concat(
        fallbackOrders.map((row) => ({
          id: row.id,
          dateAdd: row.dateAdd,
          totalTtc: row.totalTtc,
          totalHt: row.totalHt,
          lines: [
            {
              reference: 'CSV',
              quantity: 1,
              totalTtc: row.totalTtc,
              totalHt: row.totalHt,
              purchaseCost: row.purchaseCost,
            },
          ],
        })),
      )

      const mergedCarts = filteredCarts.concat(cartsFromOrders).concat(
        fallbackCarts.map((row) => ({
          id: row.id,
          dateAdd: row.dateAdd,
          totalTtc: row.totalTtc,
          totalHt: row.totalHt,
        })),
      )

      setOrders(mergedOrders)
      setCarts(mergedCarts)

      if (!cartsRes.ok) {
        console.warn(`Impossible de charger les paniers (HTTP ${cartsRes.status}).`, cartsRes.xml)
      }

      if (canceledOrders.size > 0) {
        console.warn(`Commandes annulees ignorees: ${Array.from(canceledOrders).slice(0, 5).join(', ')}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')

      const resetAtRaw = localStorage.getItem(resetDashboardKey)
      const resetAt = resetAtRaw ? Date.parse(resetAtRaw) : NaN
      const hasReset = Number.isFinite(resetAt)
      const fallbackOrders = hasReset
        ? []
        : fallbackData.filter((row) => !row.isCart)
      const fallbackCarts = hasReset
        ? []
        : fallbackData.filter((row) => row.isCart)
      setOrders(
        fallbackOrders.map((row) => ({
          id: row.id,
          dateAdd: row.dateAdd,
          totalTtc: row.totalTtc,
          totalHt: row.totalHt,
          lines: [
            {
              reference: 'CSV',
              quantity: 1,
              totalTtc: row.totalTtc,
              totalHt: row.totalHt,
              purchaseCost: row.purchaseCost,
            },
          ],
        })),
      )
      setCarts(
        fallbackCarts.map((row) => ({
          id: row.id,
          dateAdd: row.dateAdd,
          totalTtc: row.totalTtc,
          totalHt: row.totalHt,
        })),
      )
      setCategoryQuantities([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [fallbackData])

  return (
    <div className="space-y-8 font-['Space_Grotesk',ui-sans-serif,system-ui] text-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Dashboard</div>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Stats commandes par jour.</h2>
        </div>
        <button
          type="button"
          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-60"
          onClick={loadData}
          disabled={loading}
        >
          {loading ? 'Chargement...' : 'Recharger'}
        </button>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_1px_0_rgba(15,23,42,0.02)]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Commandes</div>
          <div className="mt-3 text-4xl font-bold tracking-tight text-slate-950">{stats.totals.paidCount}</div>
        </div>
        <div className="rounded-[28px] border border-amber-100 bg-amber-50 p-5 shadow-[0_1px_0_rgba(15,23,42,0.02)]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-900/70">Paniers TTC (Période)</div>
          <div className="mt-3 text-4xl font-bold tracking-tight text-slate-950">{formatMoney(stats.totals.cartTtc)} €</div>
        </div>
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_1px_0_rgba(15,23,42,0.02)]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Ensemble TTC (Période)</div>
          <div className="mt-3 text-4xl font-bold tracking-tight text-slate-950">{formatMoney(stats.totals.ensembleTtc)} €</div>
        </div>
      </div>

      <div className="text-center text-sm text-slate-600">
        Bénéfice net = Ventes ({formatMoney(stats.totals.paidHt)} €) - Coût d&apos;achat ({formatMoney(stats.totals.purchaseCost)} €) - Dépenses (0,00 €) ={' '}
        <span className="font-semibold text-emerald-700">{formatMoney(stats.totals.profit)} €</span>
      </div>

      <section className="space-y-4">
        <div className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Totaux généraux</div>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4">
            <div className="rounded-[26px] border border-slate-200 bg-white p-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Commandes (General)</div>
              <div className="mt-4 text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Total HT (General)</div>
              <div className="mt-2 text-4xl font-bold tracking-tight text-slate-950">{formatMoney(stats.totals.paidHt)} €</div>
            </div>
            <div className="rounded-[26px] border border-slate-200 bg-white p-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Commandes (General)</div>
              <div className="mt-4 text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Total TTC (General)</div>
              <div className="mt-2 text-4xl font-bold tracking-tight text-slate-950">{formatMoney(stats.totals.paidTtc)} €</div>
            </div>
            <div className="rounded-[26px] border border-slate-200 bg-white p-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Commandes (General)</div>
              <div className="mt-4 text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Commandes (General)</div>
              <div className="mt-2 text-4xl font-bold tracking-tight text-slate-950">{stats.totals.paidCount}</div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-[26px] border border-slate-200 bg-white p-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Paniers non commandés</div>
              <div className="mt-4 text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Nombre (General)</div>
              <div className="mt-2 text-4xl font-bold tracking-tight text-slate-950">{stats.totals.unpaidCount}</div>
            </div>
            <div className="rounded-[26px] border border-slate-200 bg-white p-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Paniers non commandés</div>
              <div className="mt-4 text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Paniers HT (General)</div>
              <div className="mt-2 text-4xl font-bold tracking-tight text-slate-950">{formatMoney(stats.totals.cartHt)} €</div>
            </div>
            <div className="rounded-[26px] border border-slate-200 bg-white p-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Paniers non commandés</div>
              <div className="mt-4 text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Paniers TTC (General)</div>
              <div className="mt-2 text-4xl font-bold tracking-tight text-slate-950">{formatMoney(stats.totals.cartTtc)} €</div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-[26px] border border-slate-200 bg-white p-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Ensemble</div>
              <div className="mt-4 text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Commandes + Paniers</div>
              <div className="mt-2 text-4xl font-bold tracking-tight text-slate-950">{stats.totals.totalCount}</div>
            </div>
            <div className="rounded-[26px] border border-slate-200 bg-white p-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Ensemble</div>
              <div className="mt-4 text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Ensemble HT (General)</div>
              <div className="mt-2 text-4xl font-bold tracking-tight text-slate-950">{formatMoney(stats.totals.ensembleHt)} €</div>
            </div>
            <div className="rounded-[26px] border border-slate-200 bg-white p-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Ensemble</div>
              <div className="mt-4 text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Ensemble TTC (General)</div>
              <div className="mt-2 text-4xl font-bold tracking-tight text-slate-950">{formatMoney(stats.totals.ensembleTtc)} €</div>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
          Statistiques par categorie (HT)
        </div>
        <div className="rounded-[28px] border border-slate-200 bg-white shadow-[0_1px_0_rgba(15,23,42,0.02)]">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Categorie</th>
                  <th className="px-4 py-3">Ventes HT</th>
                  <th className="px-4 py-3">Achats HT</th>
                  <th className="px-4 py-3">Benefice</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {stats.categoryStats.map((row) => (
                  <tr key={row.category} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-semibold text-slate-900">{row.category}</td>
                    <td className="px-4 py-3 text-slate-700">{formatMoney(row.totalHt)} €</td>
                    <td className="px-4 py-3 text-slate-700">{formatMoney(row.purchaseCost)} €</td>
                    <td className="px-4 py-3 text-slate-700">{formatMoney(row.profit)} €</td>
                  </tr>
                ))}
                {stats.categoryStats.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-center text-slate-500" colSpan={4}>
                      Aucune vente.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
          Stocks par categorie
        </div>
        <div className="rounded-[28px] border border-slate-200 bg-white shadow-[0_1px_0_rgba(15,23,42,0.02)]">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Categorie</th>
                  <th className="px-4 py-3">Qte physique</th>
                  <th className="px-4 py-3">Qte reserve</th>
                  <th className="px-4 py-3">Qte disponible</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {categoryQuantities.map((row) => (
                  <tr key={row.category} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-semibold text-slate-900">{row.category}</td>
                    <td className="px-4 py-3 text-slate-700">{row.physicalQty}</td>
                    <td className="px-4 py-3 text-slate-700">{row.reservedQty}</td>
                    <td className="px-4 py-3 text-slate-700">{row.availableQty}</td>
                  </tr>
                ))}
                {categoryQuantities.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-center text-slate-500" colSpan={4}>
                      Aucune donnee.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <a
          href="/backoffice/stock"
          className="rounded-[28px] border border-emerald-100 bg-emerald-50 p-5 transition-colors hover:bg-emerald-100/70"
        >
          <div className="text-sm font-semibold text-emerald-900">Ajouter du stock</div>
          <div className="mt-1 text-sm text-emerald-800">Rechercher un produit et incrémenter son stock disponible.</div>
        </a>
        <a
          href="/backoffice/stock-history"
          className="rounded-[28px] border border-slate-200 bg-white p-5 transition-colors hover:bg-slate-50"
        >
          <div className="text-sm font-semibold text-slate-900">Historique du stock</div>
          <div className="mt-1 text-sm text-slate-500">Consulter les mouvements journaliers d’un produit.</div>
        </a>
      </div>

      <div className="rounded-[28px] border border-slate-200 bg-white shadow-[0_1px_0_rgba(15,23,42,0.02)]">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Nb commandes</th>
                <th className="px-4 py-3">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {stats.rows.map((row) => (
                <tr key={row.date} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-semibold text-slate-900">{row.date}</td>
                  <td className="px-4 py-3 text-slate-700">{row.count}</td>
                  <td className="px-4 py-3 text-slate-700">{formatMoney(row.totalTtc)} €</td>
                </tr>
              ))}
              {stats.rows.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500" colSpan={3}>
                    Aucune commande.
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
