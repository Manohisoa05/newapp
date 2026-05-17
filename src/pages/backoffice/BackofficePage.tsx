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
    return {
      id,
      dateAdd: nodeText(item?.date_add),
      totalTtc: parseNumber(nodeText(item?.total_paid_tax_incl) || nodeText(item?.total_paid) || '0'),
      totalHt: parseNumber(nodeText(item?.total_paid_tax_excl) || '0'),
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

function parseOrderLines(order: any): OrderLine[] {
  const orderRows = toArray(order?.associations?.order_rows?.order_row)
  const lines: OrderLine[] = []

  for (const row of orderRows) {
    const reference = nodeText(row?.product_reference)
    const quantity = Number(nodeText(row?.product_quantity) || 0)
    const totalTtc = parseNumber(nodeText(row?.total_price_tax_incl) || nodeText(row?.unit_price_tax_incl) || '0')
    const totalHt = parseNumber(nodeText(row?.total_price_tax_excl) || nodeText(row?.unit_price_tax_excl) || '0')
    const purchaseUnit = PURCHASE_PRICE_BY_REFERENCE[reference] ?? 0

    lines.push({
      reference,
      quantity: Number.isFinite(quantity) ? quantity : 0,
      totalTtc,
      totalHt,
      purchaseCost: purchaseUnit * (Number.isFinite(quantity) ? quantity : 0),
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
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [carts, setCarts] = useState<CartListRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stats = useMemo(() => {
    const map = new Map<string, DayStat>()
    const paidTtc = orders.reduce((sum, order) => sum + order.totalTtc, 0)
    const paidHt = orders.reduce((sum, order) => sum + order.totalHt, 0)
    const cartTtc = carts.reduce((sum, cart) => sum + cart.totalTtc, 0)
    const cartHt = carts.reduce((sum, cart) => sum + cart.totalHt, 0)
    const totals: DashboardTotals = {
      paidCount: orders.length,
      unpaidCount: carts.length,
      totalCount: orders.length + carts.length,
      paidTtc,
      paidHt,
      cartTtc,
      cartHt,
      ensembleTtc: paidTtc + cartTtc,
      ensembleHt: paidHt + cartHt,
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

    }

    for (const cart of carts) {
      const date = cart.dateAdd.slice(0, 10) || 'unknown'
      const entry = map.get(date) ?? { date, count: 0, totalTtc: 0 }
      entry.count += 1
      entry.totalTtc += cart.totalTtc
      map.set(date, entry)
    }

    totals.profit = totals.paidHt - totals.purchaseCost

    const rows = Array.from(map.values()).sort((a, b) => (a.date < b.date ? 1 : -1))
    return { rows, totals }
  }, [orders, carts])

  const fallbackData = useMemo(() => buildFallbackStats(), [])

  function loadData() {
    setLoading(true)
    setError(null)

    const fallbackOrders = fallbackData.filter((row) => !row.isCart)
    const fallbackCarts = fallbackData.filter((row) => row.isCart)

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
    setLoading(false)
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
