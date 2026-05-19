import { useEffect, useState } from 'react'
import { useAppSelector } from '../../app/hooks'
import { wsRequest } from '../../shared/http/prestashopWebserviceClient'
import { extractItemsFromList } from '../../shared/http/prestashopResources'
import { parseXml } from '../../shared/xml/xml'

type OrderListRow = {
  id: number
  currentStateId: number
}

type OrderLine = {
  productId: number
  reference: string
  quantity: number
  totalHt: number
  purchaseCost: number
}

type CategoryStat = {
  category: string
  totalHt: number
  purchaseCost: number
  profit: number
}

type CategoryStockStat = {
  category: string
  physicalQty: number
  reservedQty: number
  availableQty: number
}

type Summary = {
  totalVentesHt: number
  totalAchatHt: number
  totalBenefice: number
  categoryStats: CategoryStat[]
  categoryStockStats: CategoryStockStat[]
}

type ProductInfo = {
  id: number
  reference: string
  category: string
  wholesalePrice: number
}

type StockRow = {
  idProduct: number
  quantity: number
}

function normalizeLabel(value: string): string {
  return String(value ?? '')
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
    if (typeof value.id === 'string' || typeof value.id === 'number') return String(value.id)
    if (typeof value['@_id'] === 'string' || typeof value['@_id'] === 'number') return String(value['@_id'])
  }
  return ''
}

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function parseNumber(value: string): number {
  const normalized = String(value ?? '').trim().replace(',', '.').replace('%', '')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function parseOrderList(xml: string): OrderListRow[] {
  return extractItemsFromList(xml, 'orders', 'order', (item) => {
    const id = Number(item?.['@_id'] ?? item?.id)
    if (!Number.isFinite(id)) return null
    const currentStateId = Number(nodeText(item?.current_state))
    return {
      id,
      currentStateId: Number.isFinite(currentStateId) ? currentStateId : 0,
    }
  })
}

function parseCategories(xml: string): Map<number, string> {
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

function parseOrderLines(xml: string): OrderLine[] {
  const parsed = parseXml<any>(xml)
  const rows = parsed?.prestashop?.order?.associations?.order_rows?.order_row
  const arr = toArray(rows)
  const out: OrderLine[] = []

  for (const row of arr) {
    const productId = Number(nodeText(row?.product_id) || 0)
    const reference = nodeText(row?.product_reference)
    const quantity = Number(nodeText(row?.product_quantity) || 0)
    if (!Number.isFinite(quantity) || quantity <= 0) continue

    const totalHtRaw = nodeText(row?.total_price_tax_excl)
    const unitHtRaw = nodeText(row?.unit_price_tax_excl)
    let totalHt = 0
    if (totalHtRaw) totalHt = parseNumber(totalHtRaw)
    else if (unitHtRaw) totalHt = parseNumber(unitHtRaw) * quantity

    out.push({
      productId: Number.isFinite(productId) ? productId : 0,
      reference,
      quantity,
      totalHt,
      purchaseCost: 0,
    })
  }

  return out
}

function parseStockRows(xml: string): StockRow[] {
  const parsed = parseXml<any>(xml)
  const rows = parsed?.prestashop?.stock_availables?.stock_available
  const arr = toArray(rows)
  const out: StockRow[] = []

  for (const row of arr) {
    const idProduct = Number(nodeText(row?.id_product) || 0)
    const quantity = Number(nodeText(row?.quantity) || 0)
    if (!Number.isFinite(idProduct) || idProduct <= 0) continue
    if (!Number.isFinite(quantity)) continue
    out.push({
      idProduct,
      quantity,
    })
  }

  return out
}

function buildStockSummary(stockRows: StockRow[], products: ProductInfo[], orderRows: OrderListRow[], orderDetails: Map<number, OrderLine[]>): CategoryStockStat[] {
  const productById = new Map<number, ProductInfo>()
  for (const product of products) {
    productById.set(product.id, product)
  }

  const physicalByCategory = new Map<string, number>()
  for (const stockRow of stockRows) {
    const product = productById.get(stockRow.idProduct)
    if (!product) continue
    physicalByCategory.set(product.category, (physicalByCategory.get(product.category) ?? 0) + stockRow.quantity)
  }

  const reservedByCategory = new Map<string, number>()
  for (const order of orderRows) {
    const lines = orderDetails.get(order.id) ?? []
    for (const line of lines) {
      const product = (line.productId > 0 ? productById.get(line.productId) : undefined) ?? products.find((item) => item.reference === line.reference)
      if (!product) continue
      reservedByCategory.set(product.category, (reservedByCategory.get(product.category) ?? 0) + line.quantity)
    }
  }

  return Array.from(new Set([...physicalByCategory.keys(), ...reservedByCategory.keys(), ...products.map((product) => product.category)]))
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
    .sort((a, b) => a.category.localeCompare(b.category))
}

function buildSummary(orderRows: OrderListRow[], products: ProductInfo[], orderDetails: Map<number, OrderLine[]>): Summary {
  const productByReference = new Map<string, ProductInfo>()
  const productById = new Map<number, ProductInfo>()
  for (const product of products) {
    productByReference.set(product.reference, product)
    productById.set(product.id, product)
  }

  const categoryMap = new Map<string, { totalHt: number; purchaseCost: number }>()
  let totalVentesHt = 0
  let totalAchatHt = 0

  for (const order of orderRows) {
    const lines = orderDetails.get(order.id) ?? []
    for (const line of lines) {
      const product = (line.productId > 0 ? productById.get(line.productId) : undefined) ?? productByReference.get(line.reference)
      if (!product) continue

      const purchaseCost = product.wholesalePrice * line.quantity
      totalVentesHt += line.totalHt
      totalAchatHt += purchaseCost

      const current = categoryMap.get(product.category) ?? { totalHt: 0, purchaseCost: 0 }
      current.totalHt += line.totalHt
      current.purchaseCost += purchaseCost
      categoryMap.set(product.category, current)
    }
  }

  const categoryStats = Array.from(categoryMap.entries())
    .map(([category, values]) => ({
      category,
      totalHt: values.totalHt,
      purchaseCost: values.purchaseCost,
      profit: Math.max(0, values.totalHt - values.purchaseCost),
    }))
    .sort((a, b) => a.category.localeCompare(b.category))

  return {
    totalVentesHt,
    totalAchatHt,
    totalBenefice: Math.max(0, totalVentesHt - totalAchatHt),
    categoryStats,
    categoryStockStats: [],
  }
}

export default function StatisticsPage() {
  const wsConfig = useAppSelector((s) => s.auth.wsConfig)
  const [summary, setSummary] = useState<Summary>({
    totalVentesHt: 0,
    totalAchatHt: 0,
    totalBenefice: 0,
    categoryStats: [],
    categoryStockStats: [],
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadData() {
    if (!wsConfig) {
      setError('Configuration webservice manquante. Connecte-toi au backoffice.')
      setSummary({ totalVentesHt: 0, totalAchatHt: 0, totalBenefice: 0, categoryStats: [], categoryStockStats: [] })
      return
    }

    setLoading(true)
    setError(null)

    try {
      const [stateRes, ordersRes, productsRes, categoriesRes, stockRes] = await Promise.all([
        wsRequest(wsConfig, { method: 'GET', path: 'order_states', query: { display: '[id,name]' } }),
        wsRequest(wsConfig, {
          method: 'GET',
          path: 'orders',
          query: {
            display: '[id,current_state,total_paid_tax_excl]',
            sort: '[id_DESC]',
            limit: '0,1000',
          },
        }),
        wsRequest(wsConfig, {
          method: 'GET',
          path: 'products',
          query: { display: '[id]', limit: '0,1000' },
        }),
        wsRequest(wsConfig, {
          method: 'GET',
          path: 'categories',
          query: { display: '[id,name]', limit: '0,1000' },
        }),
        wsRequest(wsConfig, {
          method: 'GET',
          path: 'stock_availables',
          query: { display: '[id_product,quantity]', limit: '0,1000' },
        }),
      ])

      if (!ordersRes.ok) throw new Error(`Impossible de charger les commandes (HTTP ${ordersRes.status}).`)
      if (!productsRes.ok) throw new Error(`Impossible de charger les produits (HTTP ${productsRes.status}).`)
      if (!categoriesRes.ok) throw new Error(`Impossible de charger les categories (HTTP ${categoriesRes.status}).`)

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

      const paidOnlyLabels = new Set([
        'paiement accepte',
        'paiement effectue',
        'payement effectue',
      ])

      const deliveredLabels = new Set([
        'livree',
        'livre',
        'livraison effectuee',
        'commande livree',
      ])

      const allOrders = parseOrderList(ordersRes.xml)
      // salesOrders: includes paid orders and delivered orders (used for revenue totals)
      const salesOrders = allOrders.filter((order) => {
        const label = stateById.get(order.currentStateId) ?? ''
        return paidOnlyLabels.has(label) || deliveredLabels.has(label)
      })
      // reservedOrders: only paid (not delivered)
      const reservedOrders = allOrders.filter((order) => paidOnlyLabels.has(stateById.get(order.currentStateId) ?? ''))
      const categoryNames = parseCategories(categoriesRes.xml)
      const stockRows = stockRes.ok ? parseStockRows(stockRes.xml) : []
      const productIds = extractItemsFromList(productsRes.xml, 'products', 'product', (item) => {
        const id = Number(item?.['@_id'] ?? item?.id)
        return Number.isFinite(id) ? id : null
      })

      const liveProducts: ProductInfo[] = []
      for (const productId of productIds) {
        // eslint-disable-next-line no-await-in-loop
        const productRes = await wsRequest(wsConfig, { method: 'GET', path: `products/${productId}` })
        if (!productRes.ok) continue
        const parsedProduct = parseXml<any>(productRes.xml)
        const product = parsedProduct?.prestashop?.product
        const reference = nodeText(product?.reference)
        const categoryId = Number(nodeText(product?.id_category_default) || 0)

        liveProducts.push({
          id: productId,
          reference,
          wholesalePrice: parseNumber(nodeText(product?.wholesale_price) || '0'),
          category: categoryNames.get(categoryId) ?? 'Autre',
        })
      }

      const orderDetails = new Map<number, OrderLine[]>()
      for (const order of salesOrders) {
        // eslint-disable-next-line no-await-in-loop
        const detailRes = await wsRequest(wsConfig, { method: 'GET', path: `orders/${order.id}` })
        if (!detailRes.ok) continue
        orderDetails.set(order.id, parseOrderLines(detailRes.xml))
      }

      const salesSummary = buildSummary(salesOrders, liveProducts, orderDetails)
      setSummary({
        ...salesSummary,
        categoryStockStats: buildStockSummary(stockRows, liveProducts, reservedOrders, orderDetails),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
      setSummary({ totalVentesHt: 0, totalAchatHt: 0, totalBenefice: 0, categoryStats: [], categoryStockStats: [] })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [wsConfig])

  return (
    <div className="space-y-8 font-['Space_Grotesk',ui-sans-serif,system-ui] text-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Backoffice</div>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Statistiques par categorie (HT)</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Les chiffres sont lus depuis les données importées dans PrestaShop. Ventes HT = commandes payées ou livrées.
          </p>
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

      {error ? <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Total ventes HT</div>
          <div className="mt-3 text-4xl font-bold tracking-tight text-slate-950">{formatMoney(summary.totalVentesHt)} €</div>
        </div>
        <div className="rounded-[28px] border border-slate-200 bg-white p-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Total achat HT</div>
          <div className="mt-3 text-4xl font-bold tracking-tight text-slate-950">{formatMoney(summary.totalAchatHt)} €</div>
        </div>
        <div className="rounded-[28px] border border-slate-200 bg-white p-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Benefice</div>
          <div className="mt-3 text-4xl font-bold tracking-tight text-emerald-700">{formatMoney(summary.totalBenefice)} €</div>
        </div>
      </div>

      <div className="rounded-[28px] border border-slate-200 bg-white shadow-[0_1px_0_rgba(15,23,42,0.02)]">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">Stock par categorie</div>
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
              {summary.categoryStockStats.map((row) => (
                <tr key={row.category} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-semibold text-slate-900">{row.category}</td>
                  <td className="px-4 py-3 text-slate-700">{row.physicalQty}</td>
                  <td className="px-4 py-3 text-slate-700">{row.reservedQty}</td>
                  <td className="px-4 py-3 text-slate-700">{row.availableQty}</td>
                </tr>
              ))}
              {summary.categoryStockStats.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500" colSpan={4}>
                    Aucun stock.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
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
              {summary.categoryStats.map((row) => (
                <tr key={row.category} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-semibold text-slate-900">{row.category}</td>
                  <td className="px-4 py-3 text-slate-700">{formatMoney(row.totalHt)} €</td>
                  <td className="px-4 py-3 text-slate-700">{formatMoney(row.purchaseCost)} €</td>
                  <td className="px-4 py-3 text-slate-700">{formatMoney(row.profit)} €</td>
                </tr>
              ))}
              {summary.categoryStats.length === 0 ? (
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
    </div>
  )
}
