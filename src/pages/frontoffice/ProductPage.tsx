import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../../app/hooks'
import { addItem } from '../../features/shop/cartSlice'
import { wsRequest } from '../../shared/http/prestashopWebserviceClient'
import { extractItemsFromList, getFirstLanguageText } from '../../shared/http/prestashopResources'
import { parseXml } from '../../shared/xml/xml'

type ProductDetail = {
  id: number
  name: string
  reference: string
  price: number
  description: string
  descriptionShort: string
  images: number[]
  taxRate: number
  dateAdd?: string
}

type StockItem = {
  idProductAttribute: number
  quantity: number
}

type CombinationItem = {
  id: number
  reference: string
  priceImpact: number
}

function normalizeBaseUrl(url: string) {
  return url.replace(/\/+$/, '')
}

function detectShopBaseUrlFromLocation(): string {
  const origin = window.location.origin
  const path = window.location.pathname
  const adminMatch = path.match(/\/admin[^/]*\//)
  if (adminMatch?.index !== undefined) {
    const basePath = path.slice(0, adminMatch.index)
    return `${origin}${basePath}`
  }
  return origin
}

function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return value.toFixed(2)
}

function getProductBadge(dateAdd?: string): { label: string; color: string } | null {
  if (!dateAdd) return null

  const productDate = new Date(dateAdd)
  const now = new Date()
  const diffMs = now.getTime() - productDate.getTime()
  const diffDays = diffMs / (1000 * 60 * 60 * 24)

  if (diffDays < 1) {
    return { label: 'HOT', color: 'bg-red-500' }
  } else if (diffDays < 7) {
    return { label: 'NEW', color: 'bg-blue-500' }
  }

  return null
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

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function extractProductImageIds(productNode: any): number[] {
  const imagesNode = productNode?.associations?.images?.image
  const images = toArray(imagesNode)
  const ids: number[] = []

  for (const image of images) {
    const raw = image?.id ?? image?.['@_id']
    const value = Number(nodeText(raw))
    if (Number.isFinite(value)) ids.push(value)
  }

  return ids
}

function parseProduct(xml: string, taxRates: Map<number, number>): ProductDetail | null {
  const parsed = parseXml<any>(xml)
  const product = parsed?.prestashop?.product
  if (!product) return null

  const id = Number(product?.id)
  if (!Number.isFinite(id)) return null

  const name = getFirstLanguageText(product?.name)
  const description = getFirstLanguageText(product?.description)
  const descriptionShort = getFirstLanguageText(product?.description_short)
  const price = Number(nodeText(product?.price) || 0)
  const reference = nodeText(product?.reference)
  const dateAdd = nodeText(product?.date_add)
  const taxGroupId = Number(nodeText(product?.id_tax_rules_group))
  const taxRate = taxRates.get(taxGroupId) ?? 0
  const images = extractProductImageIds(product)

  return {
    id,
    name: name || `Produit ${id}`,
    reference,
    // store base price as-is (price from PrestaShop, usually tax excluded)
    price: Number.isFinite(price) ? price : 0,
    description,
    descriptionShort,
    images,
    taxRate,
    dateAdd,
  }
}

function parseStock(xml: string): StockItem[] {
  return extractItemsFromList(xml, 'stock_availables', 'stock_available', (item) => {
    const quantity = Number(nodeText(item?.quantity) || 0)
    const idProductAttribute = Number(nodeText(item?.id_product_attribute) || 0)
    return {
      idProductAttribute: Number.isFinite(idProductAttribute) ? idProductAttribute : 0,
      quantity: Number.isFinite(quantity) ? quantity : 0,
    }
  })
}

function parseCombinations(xml: string): CombinationItem[] {
  return extractItemsFromList(xml, 'combinations', 'combination', (item) => {
    const id = Number(item?.['@_id'] ?? item?.id)
    if (!Number.isFinite(id)) return null
    const reference = nodeText(item?.reference)
    // combination.price is the price impact (in same unit as product.price)
    const priceImpact = Number(nodeText(item?.price) || 0)
    return {
      id,
      reference: reference || `Variante ${id}`,
      priceImpact: Number.isFinite(priceImpact) ? priceImpact : 0,
    }
  })
}

async function fetchTaxRates(config: { shopBaseUrl: string; wsKey: string }) {
  const taxesRes = await wsRequest(config, {
    method: 'GET',
    path: 'taxes',
    query: { display: '[id,rate]' },
  })

  const rulesRes = await wsRequest(config, {
    method: 'GET',
    path: 'tax_rules',
    query: { display: '[id_tax_rules_group,id_tax]' },
  })

  if (!taxesRes.ok || !rulesRes.ok) return new Map<number, number>()

  const taxesParsed = parseXml<any>(taxesRes.xml)
  const taxList = taxesParsed?.prestashop?.taxes?.tax
  const taxArray = Array.isArray(taxList) ? taxList : taxList ? [taxList] : []
  const taxRateById = new Map<number, number>()
  for (const tax of taxArray) {
    const id = Number(nodeText(tax?.id ?? tax?.['@_id']))
    const rate = Number(nodeText(tax?.rate))
    if (Number.isFinite(id) && Number.isFinite(rate)) {
      taxRateById.set(id, rate)
    }
  }

  const rulesParsed = parseXml<any>(rulesRes.xml)
  const ruleList = rulesParsed?.prestashop?.tax_rules?.tax_rule
  const ruleArray = Array.isArray(ruleList) ? ruleList : ruleList ? [ruleList] : []
  const groupRate = new Map<number, number>()
  for (const rule of ruleArray) {
    const groupId = Number(nodeText(rule?.id_tax_rules_group))
    const taxId = Number(nodeText(rule?.id_tax))
    const rate = taxRateById.get(taxId)
    if (Number.isFinite(groupId) && rate !== undefined) {
      groupRate.set(groupId, rate)
    }
  }

  return groupRate
}

export default function ProductPage() {
  const { id } = useParams()
  const productId = Number(id)
  const dispatch = useAppDispatch()
  const wsConfig = useAppSelector((s) => s.auth.wsConfig)
  const cartCount = useAppSelector((s) => s.cart.items.reduce((sum, item) => sum + item.qty, 0))
  const [product, setProduct] = useState<ProductDetail | null>(null)
  const [stock, setStock] = useState<StockItem[]>([])
  const [combinations, setCombinations] = useState<CombinationItem[]>([])
  const [selectedCombinationId, setSelectedCombinationId] = useState<number | null>(null)
  const [activeImage, setActiveImage] = useState(0)
  const [qty, setQty] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const baseUrl = useMemo(() => {
    if (wsConfig?.shopBaseUrl) return wsConfig.shopBaseUrl
    return detectShopBaseUrlFromLocation()
  }, [wsConfig?.shopBaseUrl])

  const imageUrls = useMemo(() => {
    if (!product) return []
    const base = normalizeBaseUrl(baseUrl)
    const wsKey = wsConfig?.wsKey?.trim() ?? ''
    return product.images.map((imageId) => {
      const url = new URL(`${base}/api/images/products/${product.id}/${imageId}`)
      if (wsKey) url.searchParams.set('ws_key', wsKey)
      return url.toString()
    })
  }, [baseUrl, product, wsConfig?.wsKey])

  const totalStock = useMemo(() => {
    return stock.reduce((sum, item) => sum + item.quantity, 0)
  }, [stock])

  useEffect(() => {
    async function loadProduct() {
      if (!Number.isFinite(productId)) {
        setError('Produit introuvable.')
        return
      }

      const wsKey = wsConfig?.wsKey?.trim() ?? ''
      if (!wsKey) {
        setError('Cle webservice manquante. Ouvre le backoffice pour configurer l acces API.')
        return
      }

      setLoading(true)
      setError(null)

      try {
        const taxRates = await fetchTaxRates({ shopBaseUrl: baseUrl, wsKey })

        const productRes = await wsRequest(
          { shopBaseUrl: baseUrl, wsKey },
          {
            method: 'GET',
            path: `products/${productId}`,
          },
        )

        if (!productRes.ok) {
          setError(`Impossible de charger le produit (HTTP ${productRes.status}).`)
          return
        }

        const parsedProduct = parseProduct(productRes.xml, taxRates)
        setProduct(parsedProduct)

        const stockRes = await wsRequest(
          { shopBaseUrl: baseUrl, wsKey },
          {
            method: 'GET',
            path: 'stock_availables',
            query: {
              display: '[id,quantity,id_product_attribute]',
              'filter[id_product]': `[${productId}]`,
              limit: '0,200',
            },
          },
        )

        if (stockRes.ok) {
          setStock(parseStock(stockRes.xml))
        }

        const comboRes = await wsRequest(
          { shopBaseUrl: baseUrl, wsKey },
          {
            method: 'GET',
            path: 'combinations',
            query: {
              display: '[id,reference,price]',
              'filter[id_product]': `[${productId}]`,
              limit: '0,200',
            },
          },
        )

        if (comboRes.ok) {
          setCombinations(parseCombinations(comboRes.xml))
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erreur inconnue')
      } finally {
        setLoading(false)
      }
    }

    loadProduct()
  }, [baseUrl, productId, wsConfig?.wsKey])

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#fef3c7,_#f8fafc_45%,_#e2e8f0_100%)] text-slate-900 font-['Space_Grotesk',ui-sans-serif,system-ui]">
      <header className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-lg font-bold text-amber-200 shadow-lg">
            FO
          </div>
          <div>
            <div className="text-lg font-bold tracking-tight">Fiche produit</div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Boutique
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm font-semibold">
          <Link
            className="rounded-full border border-slate-300 px-4 py-2 text-slate-700 transition-colors hover:bg-white"
            to="/products"
          >
            Retour
          </Link>
          <Link
            className="rounded-full border border-slate-300 px-4 py-2 text-slate-700 transition-colors hover:bg-white"
            to="/cart"
          >
            Panier ({cartCount})
          </Link>
          <Link
            className="rounded-full border border-slate-300 px-4 py-2 text-slate-700 transition-colors hover:bg-white"
            to="/login"
          >
            Backoffice
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-6 pb-16">
        {error ? (
          <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <section className="grid gap-10 rounded-[32px] border border-white/70 bg-white/80 p-8 shadow-xl backdrop-blur lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-5">
            <div className="rounded-3xl border border-slate-200/70 bg-slate-50 p-4">
              <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl bg-white">
                {imageUrls.length > 0 ? (
                  <img
                    src={imageUrls[Math.min(activeImage, imageUrls.length - 1)]}
                    alt={product?.name ?? 'Produit'}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-sm text-slate-400">
                    Aucune image disponible
                  </div>
                )}
              </div>
              {imageUrls.length > 1 ? (
                <div className="mt-4 grid grid-cols-4 gap-3">
                  {imageUrls.map((url, index) => (
                    <button
                      key={url}
                      type="button"
                      className={`overflow-hidden rounded-xl border ${
                        index === activeImage ? 'border-slate-900' : 'border-slate-200'
                      }`}
                      onClick={() => setActiveImage(index)}
                    >
                      <img src={url} alt="Miniature" className="h-20 w-full object-cover" />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="grid gap-3 rounded-3xl border border-slate-200/70 bg-white p-6 text-sm text-slate-600">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Description</div>
              {product?.descriptionShort ? (
                <div
                  className="text-sm text-slate-700"
                  dangerouslySetInnerHTML={{ __html: product.descriptionShort }}
                />
              ) : (
                <div className="text-sm text-slate-500">Aucune description courte.</div>
              )}
              {product?.description ? (
                <div
                  className="text-sm text-slate-600"
                  dangerouslySetInnerHTML={{ __html: product.description }}
                />
              ) : null}
            </div>
          </div>

          <div className="space-y-6">
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-600">Produit</div>
              <div className="flex items-start gap-3">
                <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">
                  {product?.name ?? 'Chargement...'}
                </h1>
                {(() => {
                  const badge = getProductBadge(product?.dateAdd)
                  return badge ? (
                    <span className={`rounded-full ${badge.color} px-3 py-1 text-xs font-semibold text-white whitespace-nowrap`}>
                      {badge.label}
                    </span>
                  ) : null
                })()}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
                <span>Ref {product?.reference || product?.id}</span>
                <span className="h-1 w-1 rounded-full bg-slate-300"></span>
                <span>{loading ? 'Chargement...' : `${totalStock} en stock`}</span>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200/70 bg-white p-6 shadow-lg shadow-slate-900/5">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Prix</div>
              <div className="mt-2">
                {product ? (() => {
                  const selected = combinations.find((c) => c.id === selectedCombinationId)
                  const displayHt = product.price + (selected?.priceImpact ?? 0)
                  const displayTtc = displayHt * (1 + (product.taxRate ?? 0) / 100)
                  return (
                    <>
                      <div className="text-4xl font-bold text-slate-900">{formatPrice(displayHt)} <span className="text-sm font-normal text-slate-500">HT</span></div>
                      <div className="mt-1 text-sm text-slate-500">TTC: {formatPrice(displayTtc)}</div>
                    </>
                  )
                })() : (
                  <div className="text-4xl font-bold text-slate-900">0</div>
                )}
              </div>
              <p className="mt-3 text-sm text-slate-500">
                Prix de base hors variantes (HT). Les variantes affichent l'impact en HT et TTC.
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <input
                  type="number"
                  min={1}
                  className="w-24 rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  value={qty}
                  onChange={(e) => setQty(Math.max(1, Number(e.target.value)))}
                />
                <button
                  className="flex-1 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-900/20"
                  onClick={() => {
                    if (!product) return
                    const selected = combinations.find((c) => c.id === selectedCombinationId)
                    const finalPriceHt = product.price + (selected?.priceImpact ?? 0)
                    const finalPrice = finalPriceHt * (1 + (product.taxRate ?? 0) / 100) // store TTC in cart
                    dispatch(
                      addItem({
                        id: product.id,
                        name: product.name,
                        price: finalPrice,
                        reference: product.reference,
                        qty,
                        combinationId: selected?.id ?? null,
                      }),
                    )
                  }}
                >
                  Ajouter au panier
                </button>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200/70 bg-white p-6">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  Variantes
                </div>
                <div className="text-xs text-slate-400">{combinations.length} choix</div>
              </div>
              <div className="mt-4 grid gap-3">
                {combinations.map((combo) => (
                  <button
                    key={combo.id}
                    type="button"
                    onClick={() => setSelectedCombinationId(combo.id)}
                    className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-sm ${
                      combo.id === selectedCombinationId ? 'border-slate-900 bg-slate-50' : 'border-slate-200'
                    }`}
                  >
                    <div>
                      <div className="font-semibold text-slate-900">{combo.reference}</div>
                      <div className="text-xs text-slate-500">ID {combo.id}</div>
                    </div>
                    <div className="text-sm font-semibold text-slate-700">
                      {combo.priceImpact >= 0 ? '+' : ''}{formatPrice(combo.priceImpact)} HT
                      <div className="text-xs text-slate-400">{combo.priceImpact ? `+${formatPrice((combo.priceImpact) * (1 + (product?.taxRate ?? 0) / 100))} TTC` : '0.00 TTC'}</div>
                    </div>
                  </button>
                ))}
                {combinations.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-4 text-sm text-slate-500">
                    Aucune variante.
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200/70 bg-white p-6">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Stock detail</div>
              <div className="mt-3 grid gap-2 text-sm text-slate-600">
                {stock.map((item, index) => {
                  const combo = combinations.find((c) => c.id === item.idProductAttribute)
                  const label = combo?.reference || (item.idProductAttribute ? `Variante ${item.idProductAttribute}` : 'Stock standard')
                  return (
                    <div key={`${item.idProductAttribute}-${index}`} className="flex items-center justify-between">
                      <span>{label}</span>
                      <span className="font-semibold text-slate-700">{item.quantity}</span>
                    </div>
                  )
                })}
                {stock.length === 0 ? (
                  <div className="text-sm text-slate-500">Aucune information de stock.</div>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
