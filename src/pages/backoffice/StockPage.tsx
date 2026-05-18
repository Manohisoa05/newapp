import { useEffect, useMemo, useState } from 'react'
import { useAppSelector } from '../../app/hooks'
import { wsRequest } from '../../shared/http/prestashopWebserviceClient'
import { extractItemsFromList, getFirstLanguageText } from '../../shared/http/prestashopResources'
import { addStockMovement } from '../../shared/stock/stockMovements'

type ProductItem = {
  id: number
  name: string
  reference: string
  active: boolean
}

type StockItem = {
  id: number
  idProductAttribute: number
  quantity: number
  idShop: number
  idShopGroup: number
}

type CombinationItem = {
  id: number
  valueIds: number[]
}

type OptionValueItem = {
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

function parseProducts(xml: string): ProductItem[] {
  return extractItemsFromList(xml, 'products', 'product', (item: any) => {
    const id = Number(item?.['@_id'] ?? item?.id)
    if (!Number.isFinite(id)) return null
    return {
      id,
      name: getFirstLanguageText(item?.name) || nodeText(item?.name) || '(sans nom)',
      reference: nodeText(item?.reference),
      active: nodeText(item?.active) === '1',
    }
  })
}

function parseStock(xml: string): StockItem[] {
  return extractItemsFromList(xml, 'stock_availables', 'stock_available', (item: any) => {
    const id = Number(item?.['@_id'] ?? item?.id)
    const idProductAttribute = Number(nodeText(item?.id_product_attribute) || 0)
    const quantity = Number(nodeText(item?.quantity) || 0)
    const idShop = Number(nodeText(item?.id_shop) || 0)
    const idShopGroup = Number(nodeText(item?.id_shop_group) || 0)
    if (!Number.isFinite(id)) return null
    return {
      id,
      idProductAttribute: Number.isFinite(idProductAttribute) ? idProductAttribute : 0,
      quantity: Number.isFinite(quantity) ? quantity : 0,
      idShop: Number.isFinite(idShop) ? idShop : 1,
      idShopGroup: Number.isFinite(idShopGroup) ? idShopGroup : 1,
    }
  })
}

function parseCombinations(xml: string): CombinationItem[] {
  return extractItemsFromList(xml, 'combinations', 'combination', (item: any) => {
    const id = Number(item?.['@_id'] ?? item?.id)
    if (!Number.isFinite(id)) return null
    const valuesNode = item?.associations?.product_option_values?.product_option_value
    const valuesArray = Array.isArray(valuesNode) ? valuesNode : valuesNode ? [valuesNode] : []
    const valueIds = valuesArray
      .map((value: any) => Number(value?.['@_id'] ?? value?.id))
      .filter((valueId: number) => Number.isFinite(valueId))
    return {
      id,
      valueIds,
    }
  })
}

function parseOptionValues(xml: string): OptionValueItem[] {
  return extractItemsFromList(xml, 'product_option_values', 'product_option_value', (item: any) => {
    const id = Number(item?.['@_id'] ?? item?.id)
    if (!Number.isFinite(id)) return null
    return {
      id,
      name: getFirstLanguageText(item?.name) || nodeText(item?.name) || `Valeur ${id}`,
    }
  })
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

function buildStockXml(
  productId: number,
  idProductAttribute: number,
  quantity: number,
  idShop = 1,
  idShopGroup = 1,
  stockId?: number,
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<prestashop>
  <stock_available>
    ${stockId !== undefined ? `<id>${stockId}</id>` : ''}
    <id_product>${productId}</id_product>
    <id_product_attribute>${idProductAttribute}</id_product_attribute>
    <id_shop>${idShop}</id_shop>
    <id_shop_group>${idShopGroup}</id_shop_group>
    <quantity>${quantity}</quantity>
    <depends_on_stock>0</depends_on_stock>
    <out_of_stock>2</out_of_stock>
  </stock_available>
</prestashop>
`
}

export default function StockPage() {
  const wsConfig = useAppSelector((s) => s.auth.wsConfig)
  const [products, setProducts] = useState<ProductItem[]>([])
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null)
  const [stockRows, setStockRows] = useState<StockItem[]>([])
  const [combinations, setCombinations] = useState<CombinationItem[]>([])
  const [optionValues, setOptionValues] = useState<OptionValueItem[]>([])
  const [query, setQuery] = useState('')
  const [selectedStockKey, setSelectedStockKey] = useState('0')
  const [addQty, setAddQty] = useState(1)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[]>([])

  const filteredProducts = useMemo(() => {
    const q = normalize(query)
    if (!q) return products.slice(0, 100)
    return products.filter((product) => {
      const haystack = normalize(`${product.reference} ${product.name} ${product.id}`)
      return haystack.includes(q)
    })
  }, [products, query])

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId) ?? null,
    [products, selectedProductId],
  )

  const hasVariants = combinations.length > 0
  const comboById = useMemo(() => new Map(combinations.map((combo) => [combo.id, combo])), [combinations])
  const optionValueById = useMemo(() => new Map(optionValues.map((value) => [value.id, value])), [optionValues])

  function buildVariantLabel(combo: CombinationItem | undefined, fallbackId: number): string {
    if (!combo) return `Variante ${fallbackId}`
    const names = combo.valueIds
      .map((valueId) => optionValueById.get(valueId)?.name)
      .filter((name): name is string => Boolean(name && name.trim()))
    if (names.length > 0) return names.join(' / ')
    return `Variante ${fallbackId}`
  }

  const stockOptions = useMemo(() => {
    return stockRows
      .filter((row) => !hasVariants || row.idProductAttribute !== 0)
      .map((row) => ({
        key: String(row.idProductAttribute),
        label:
          row.idProductAttribute === 0
            ? `Stock principal (${row.quantity})`
            : `${buildVariantLabel(comboById.get(row.idProductAttribute), row.idProductAttribute)} (${row.quantity})`,
      }))
  }, [comboById, hasVariants, optionValueById, stockRows])

  async function loadProducts() {
    if (!wsConfig) return
    setLoading(true)
    setError(null)

    try {
      const res = await wsRequest(wsConfig, {
        method: 'GET',
        path: 'products',
        query: {
          display: '[id,name,reference,active]',
          limit: '0,1000',
        },
      })

      if (!res.ok) {
        setError(`Impossible de charger les produits (HTTP ${res.status}).`)
        return
      }

      setProducts(parseProducts(res.xml))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  }

  async function loadProductDetails(productId: number) {
    if (!wsConfig) return

    const [stockRes, comboRes, optionValuesRes] = await Promise.all([
      wsRequest(wsConfig, {
        method: 'GET',
        path: 'stock_availables',
        query: {
          display: '[id,quantity,id_product_attribute,id_shop,id_shop_group]',
          'filter[id_product]': `[${productId}]`,
          limit: '0,200',
        },
      }),
      wsRequest(wsConfig, {
        method: 'GET',
        path: 'combinations',
        query: {
          display: 'full',
          'filter[id_product]': `[${productId}]`,
          limit: '0,200',
        },
      }),
      wsRequest(wsConfig, {
        method: 'GET',
        path: 'product_option_values',
        query: {
          display: '[id,name,id_attribute_group]',
          limit: '0,500',
        },
      }),
    ])

    if (stockRes.ok) {
      const rows = parseStock(stockRes.xml)
      setStockRows(rows)
      const defaultRow = rows.find((row) => row.idProductAttribute !== 0) ?? rows.find((row) => row.idProductAttribute === 0) ?? rows[0] ?? null
      setSelectedStockKey(defaultRow ? String(defaultRow.idProductAttribute) : '0')
    } else {
      setStockRows([])
      setSelectedStockKey('0')
    }

    if (comboRes.ok) setCombinations(parseCombinations(comboRes.xml))
    else setCombinations([])

    if (optionValuesRes.ok) setOptionValues(parseOptionValues(optionValuesRes.xml))
    else setOptionValues([])
  }

  async function handleSelectProduct(product: ProductItem) {
    setSelectedProductId(product.id)
    setDone(false)
    setError(null)
    setLogs([])
    await loadProductDetails(product.id)
  }

  async function handleAddStock() {
    if (!wsConfig || !selectedProduct) return
    if (!Number.isFinite(addQty) || addQty <= 0) {
      setError('La quantite doit etre positive.')
      return
    }

    setSaving(true)
    setDone(false)
    setError(null)
    setLogs([])

    try {
      const idProductAttribute = Number(selectedStockKey)
      const currentRow = stockRows.find((row) => row.idProductAttribute === idProductAttribute)
      const currentQty = currentRow?.quantity ?? 0
      const idShop = currentRow?.idShop ?? 1
      const idShopGroup = currentRow?.idShopGroup ?? 1
      const nextQty = currentQty + addQty

      if (currentRow) {
        const updateRes = await wsRequest(wsConfig, {
          method: 'PUT',
          path: `stock_availables/${currentRow.id}`,
          xmlBody: buildStockXml(selectedProduct.id, idProductAttribute, nextQty, idShop, idShopGroup, currentRow.id),
        })

        if (!updateRes.ok) {
          setError(`Impossible de mettre a jour le stock (HTTP ${updateRes.status}).`)
          setLogs([updateRes.xml || 'Reponse vide'])
          return
        }
      } else {
        const createRes = await wsRequest(wsConfig, {
          method: 'POST',
          path: 'stock_availables',
          xmlBody: buildStockXml(selectedProduct.id, idProductAttribute, nextQty, 1, 1),
        })

        if (!createRes.ok) {
          setError(`Impossible de creer le stock (HTTP ${createRes.status}).`)
          setLogs([createRes.xml || 'Reponse vide'])
          return
        }
      }

      addStockMovement({
        productId: selectedProduct.id,
        productAttributeId: idProductAttribute,
        qty: addQty,
        type: 'entree',
        date: new Date().toISOString(),
        source: 'manual',
      })

      setLogs([
        `Produit: ${selectedProduct.reference || selectedProduct.name}`,
        `Stock ajoute: +${addQty}`,
        `Nouveau total: ${nextQty}`,
      ])
      setDone(true)
      await loadProductDetails(selectedProduct.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    loadProducts()
  }, [wsConfig])

  return (
    <div className="space-y-6 bg-[radial-gradient(circle_at_top,_rgba(15,23,42,0.06),_transparent_38%),linear-gradient(180deg,_#ffffff_0%,_#f8fafc_100%)] p-1 sm:p-0">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-3xl border border-slate-200/80 bg-white/80 px-5 py-5 shadow-sm backdrop-blur">
        <div className="space-y-1">
          <div className="inline-flex items-center rounded-full bg-slate-900 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-white">
            Backoffice
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-900">Ajouter du stock</h2>
          <p className="max-w-2xl text-sm text-slate-500">
            Rechercher un produit, consulter son stock actuel et ajouter rapidement une quantité.
          </p>
        </div>
        <button
          type="button"
          className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-slate-900/10 transition-all hover:-translate-y-0.5 hover:bg-slate-800 disabled:opacity-60"
          onClick={loadProducts}
          disabled={loading}
        >
          {loading ? 'Chargement...' : 'Recharger'}
        </button>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700 shadow-sm">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-800">Catalogue produits</div>
              <div className="text-xs text-slate-500">Filtre par référence, nom ou identifiant</div>
            </div>
            <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
              {filteredProducts.length} résultat(s)
            </div>
          </div>

          <div className="relative">
          <label className="text-sm font-semibold text-slate-800">Recherche produit</label>
          <input
            type="text"
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:bg-white"
            placeholder="Reference, nom ou id"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          </div>

          <div className="mt-4 max-h-[32rem] overflow-auto rounded-2xl border border-slate-200/80 bg-slate-50/60">
            {filteredProducts.map((product) => (
              <button
                key={product.id}
                type="button"
                className={`flex w-full items-center justify-between gap-4 border-b border-slate-100 px-4 py-4 text-left text-sm last:border-b-0 transition-colors hover:bg-slate-100/80 ${selectedProductId === product.id ? 'bg-slate-100' : 'bg-transparent'}`}
                onClick={() => handleSelectProduct(product)}
              >
                <div className="min-w-0">
                  <div className="truncate font-semibold text-slate-900">{product.name}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="rounded-full bg-white px-2 py-0.5 ring-1 ring-slate-200">Ref: {product.reference || '—'}</span>
                    <span className="rounded-full bg-white px-2 py-0.5 ring-1 ring-slate-200">ID: {product.id}</span>
                  </div>
                </div>
                <div className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${product.active ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100' : 'bg-rose-50 text-rose-600 ring-1 ring-rose-100'}`}>
                  {product.active ? 'Actif' : 'Inactif'}
                </div>
              </button>
            ))}
            {filteredProducts.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-500">Aucun produit trouvé.</div>
            ) : null}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm">
          <div className="text-sm font-semibold text-slate-800">Action stock</div>
          <div className="mt-1 text-xs text-slate-500">Ajuste le stock du produit sélectionné.</div>

          {selectedProduct ? (
            <div className="mt-4 space-y-4">
              <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200/80">
                <div className="text-sm font-semibold text-slate-900">{selectedProduct.name}</div>
                <div className="mt-1 text-xs text-slate-500">
                  Référence: {selectedProduct.reference || '—'} · ID: {selectedProduct.id}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-semibold text-slate-800">Stock cible</label>
                  <select
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:bg-white"
                    value={selectedStockKey}
                    onChange={(e) => setSelectedStockKey(e.target.value)}
                  >
                    {stockOptions.length > 0 ? (
                      stockOptions.map((option) => (
                        <option key={option.key} value={option.key}>
                          {option.label}
                        </option>
                      ))
                    ) : (
                      <option value="0">{hasVariants ? 'Aucune variante disponible' : 'Stock principal (nouveau)'}</option>
                    )}
                  </select>
                </div>

                <div>
                  <label className="text-sm font-semibold text-slate-800">Quantité à ajouter</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:bg-white"
                    value={addQty}
                    onChange={(e) => setAddQty(Number(e.target.value))}
                  />
                </div>
              </div>

              <button
                type="button"
                className="inline-flex items-center justify-center rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition-all hover:-translate-y-0.5 hover:bg-emerald-500 disabled:opacity-60"
                onClick={handleAddStock}
                disabled={saving}
              >
                {saving ? 'Mise à jour...' : 'Ajouter au stock'}
              </button>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700">
                <div className="mb-2 text-sm font-semibold text-slate-800">Stock actuel</div>
                {stockRows.length > 0 ? (
                  <ul className="space-y-2">
                    {stockRows.map((row) => {
                      const combo = combinations.find((item) => item.id === row.idProductAttribute)
                      return (
                        <li key={row.id} className="flex items-center justify-between rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
                          <span className="text-slate-600">
                            {row.idProductAttribute === 0
                              ? 'Principal'
                              : buildVariantLabel(combo, row.idProductAttribute)}
                          </span>
                          <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
                            {row.quantity}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <div className="text-slate-500">Aucun stock trouvé.</div>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
              Sélectionne un produit pour gérer son stock.
            </div>
          )}
        </div>
      </div>

      {done ? (
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 shadow-sm">
          Stock mis a jour.
        </div>
      ) : null}

      {logs.length > 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700 shadow-sm">
          <div className="mb-2 text-sm font-semibold text-slate-800">Logs</div>
          <pre className="whitespace-pre-wrap leading-6">{logs.join('\n')}</pre>
        </div>
      ) : null}
    </div>
  )
}
