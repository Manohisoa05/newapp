import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../../app/hooks'
import { addItem } from '../../features/shop/cartSlice'
import { wsRequest } from '../../shared/http/prestashopWebserviceClient'
import { extractIdsFromList, getFirstLanguageText } from '../../shared/http/prestashopResources'
import { parseXml } from '../../shared/xml/xml'

type ProductCard = {
  id: number
  name: string
  price: number
  reference: string
  descriptionShort: string
  images: number[]
  dateAdd?: string
  categoryId?: number
  categoryName?: string
}

type Category = {
  id: number
  name: string
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

function parseProduct(xml: string, taxRates: Map<number, number>, categoryNames: Map<number, string>): ProductCard | null {
  const parsed = parseXml<any>(xml)
  const product = parsed?.prestashop?.product
  if (!product) return null

  const id = Number(product?.id)
  if (!Number.isFinite(id)) return null

  const name = getFirstLanguageText(product?.name)
  const price = Number(nodeText(product?.price) || 0)
  const reference = nodeText(product?.reference)
  const dateAdd = nodeText(product?.date_add)
  const taxGroupId = Number(nodeText(product?.id_tax_rules_group))
  const categoryId = Number(nodeText(product?.id_category_default))
  const taxRate = taxRates.get(taxGroupId) ?? 0
  const priceTtc = Number.isFinite(price) ? price * (1 + taxRate / 100) : 0
  const descriptionShort = nodeText(product?.description_short)

  return {
    id,
    name: name || `Produit ${id}`,
    price: Number.isFinite(priceTtc) ? priceTtc : 0,
    reference,
    descriptionShort,
    images: extractProductImageIds(product),
    dateAdd,
    categoryId: Number.isFinite(categoryId) ? categoryId : undefined,
    categoryName: Number.isFinite(categoryId) ? categoryNames.get(categoryId) : undefined,
  }
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

async function fetchCategories(config: { shopBaseUrl: string; wsKey: string }): Promise<{ categories: Category[]; nameMap: Map<number, string> }> {
  try {
    const res = await wsRequest(config, {
      method: 'GET',
      path: 'categories',
      query: { display: '[id,name]', limit: '1000' },
    })

    if (!res.ok) return { categories: [], nameMap: new Map() }

    const parsed = parseXml<any>(res.xml)
    const categoryList = parsed?.prestashop?.categories?.category
    const categoryArray = Array.isArray(categoryList) ? categoryList : categoryList ? [categoryList] : []
    const categories: Category[] = []
    const nameMap = new Map<number, string>()

    for (const cat of categoryArray) {
      const id = Number(nodeText(cat?.id))
      const name = getFirstLanguageText(cat?.name)
      if (Number.isFinite(id) && name) {
        categories.push({ id, name })
        nameMap.set(id, name)
      }
    }

    return { categories: categories.sort((a, b) => a.name.localeCompare(b.name)), nameMap }
  } catch {
    return { categories: [], nameMap: new Map() }
  }
}

export default function HomePage() {
  const dispatch = useAppDispatch()
  const wsConfig = useAppSelector((s) => s.auth.wsConfig)
  const cartCount = useAppSelector((s) => s.cart.items.reduce((sum, item) => sum + item.qty, 0))
  const [products, setProducts] = useState<ProductCard[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Filtres de recherche
  const [searchName, setSearchName] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<number | ''>('')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')

  const baseUrl = useMemo(() => {
    if (wsConfig?.shopBaseUrl) return wsConfig.shopBaseUrl
    return detectShopBaseUrlFromLocation()
  }, [wsConfig?.shopBaseUrl])

  useEffect(() => {
    async function loadProducts() {
      setLoading(true)
      setError(null)

      const wsKey = wsConfig?.wsKey?.trim() ?? ''
      if (!wsKey) {
        setError('Cle webservice manquante. Ouvre le backoffice pour configurer l acces API.')
        setLoading(false)
        return
      }

      try {
        const taxRates = await fetchTaxRates({ shopBaseUrl: baseUrl, wsKey })
        const { categories: cats, nameMap: categoryNames } = await fetchCategories({ shopBaseUrl: baseUrl, wsKey })
        setCategories(cats)
        const ids: number[] = []
        const pageSize = 100
        let offset = 0

        while (true) {
          const listRes = await wsRequest(
            { shopBaseUrl: baseUrl, wsKey },
            {
              method: 'GET',
              path: 'products',
              query: {
                display: '[id]',
                sort: '[id_DESC]',
                limit: `${offset},${pageSize}`,
              },
            },
          )

          if (!listRes.ok) {
            setError(`Impossible de charger la liste des produits (HTTP ${listRes.status}).`)
            return
          }

          const batch = extractIdsFromList(listRes.xml, 'products', 'product')
          ids.push(...batch)
          if (batch.length < pageSize) break
          offset += pageSize
        }

        const chunks: number[][] = []
        const chunkSize = 10
        for (let i = 0; i < ids.length; i += chunkSize) {
          chunks.push(ids.slice(i, i + chunkSize))
        }

        const items: ProductCard[] = []
        for (const chunk of chunks) {
          const results = await Promise.all(
            chunk.map(async (productId) => {
              const productRes = await wsRequest(
                { shopBaseUrl: baseUrl, wsKey },
                { method: 'GET', path: `products/${productId}` },
              )
              if (!productRes.ok) return null
              return parseProduct(productRes.xml, taxRates, categoryNames)
            }),
          )
          for (const result of results) {
            if (result) items.push(result)
          }
        }

        setProducts(items)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erreur inconnue')
      } finally {
        setLoading(false)
      }
    }

    loadProducts()
  }, [baseUrl, wsConfig?.wsKey])

  // Filtrer les produits
  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      // Filtre par nom
      if (searchName.trim() && !product.name.toLowerCase().includes(searchName.toLowerCase())) {
        return false
      }

      // Filtre par catégorie
      if (selectedCategory !== '' && product.categoryId !== selectedCategory) {
        return false
      }

      // Filtre par prix
      const min = minPrice ? Number(minPrice) : 0
      const max = maxPrice ? Number(maxPrice) : Infinity
      if (product.price < min || product.price > max) {
        return false
      }

      return true
    })
  }, [products, searchName, selectedCategory, minPrice, maxPrice])

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#fff1d6,_#f6f7fb_45%,_#e7eefc_100%)] text-slate-900 font-['Space_Grotesk',ui-sans-serif,system-ui]">
      <header className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-6">
        <div className="flex items-center gap-3">
          <Link to="/products" className="flex items-center gap-3 hover:opacity-75 transition-opacity">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-lg font-bold text-amber-200 shadow-lg">
              FO
            </div>
            <div>
              <div className="text-lg font-bold tracking-tight">Front Office</div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                Boutique
              </div>
            </div>
          </Link>
        </div>
        <div className="flex items-center gap-3 text-sm font-semibold">
          <Link
            className="rounded-full border border-slate-300 px-4 py-2 text-slate-700 transition-colors hover:bg-white"
            to="/cart"
          >
            Panier ({cartCount})
          </Link>
          <Link
            className="rounded-full border border-slate-300 px-4 py-2 text-slate-700 transition-colors hover:bg-white"
            to="/my-orders"
          >
            Mes commandes
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
        <section className="grid gap-8 rounded-[32px] border border-white/70 bg-white/70 p-8 shadow-xl backdrop-blur sm:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
              Collection locale
            </div>
            <h1 className="text-4xl font-bold leading-tight text-slate-900 sm:text-5xl">
              Decouvrez nos produits essentiels.
            </h1>
            <p className="text-sm text-slate-600 sm:text-base">
              Une selection claire, rapide et simple. Nous mettons en avant les produits
              disponibles et les informations utiles pour commander.
            </p>
            <div className="flex flex-wrap gap-3">
              <button className="rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-slate-900/20">
                Voir la collection
              </button>
              <div className="rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-700">
                {normalizeBaseUrl(baseUrl)}
              </div>
            </div>
          </div>
          <div className="relative overflow-hidden rounded-3xl bg-slate-900 p-6 text-white">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.25),_transparent_60%)]"></div>
            <div className="relative space-y-4">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">Focus</div>
              <div className="text-2xl font-semibold">Produits recents</div>
              <p className="text-sm text-slate-300">
                {loading ? 'Chargement en cours...' : `${products.length} articles charges`}
              </p>
              <div className="grid gap-2 text-xs text-slate-300">
                <div className="flex items-center justify-between">
                  <span>Livraison locale</span>
                  <span>24h</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Support</span>
                  <span>7/7</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-12 space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-slate-900">Produits</h2>
              <p className="text-sm text-slate-500">Affichage direct depuis PrestaShop.</p>
            </div>
            <div className="rounded-full bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              {filteredProducts.length} résultat{filteredProducts.length !== 1 ? 's' : ''}
            </div>
          </div>

          {error ? (
            <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          {/* Formulaire de recherche multicritère */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-lg">
            <h3 className="mb-4 text-lg font-semibold text-slate-900">Rechercher</h3>
            <div className="grid gap-4 sm:grid-cols-4">
              {/* Recherche par nom */}
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600">Nom</label>
                <input
                  type="text"
                  placeholder="Rechercher..."
                  value={searchName}
                  onChange={(e) => setSearchName(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>

              {/* Filtre par catégorie */}
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600">Catégorie</label>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value === '' ? '' : Number(e.target.value))}
                  className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                >
                  <option value="">Toutes</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Filtre prix min */}
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600">Prix min</label>
                <input
                  type="number"
                  placeholder="0"
                  value={minPrice}
                  onChange={(e) => setMinPrice(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  min="0"
                />
              </div>

              {/* Filtre prix max */}
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600">Prix max</label>
                <input
                  type="number"
                  placeholder="9999"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  min="0"
                />
              </div>
            </div>

            {/* Bouton réinitialiser */}
            {(searchName || selectedCategory !== '' || minPrice || maxPrice) && (
              <button
                onClick={() => {
                  setSearchName('')
                  setSelectedCategory('')
                  setMinPrice('')
                  setMaxPrice('')
                }}
                className="mt-4 text-sm font-semibold text-blue-600 hover:text-blue-700 underline"
              >
                Réinitialiser les filtres
              </button>
            )}
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {filteredProducts.map((product) => (
              <article
                key={product.id}
                className="group flex h-full flex-col justify-between rounded-3xl border border-slate-200/80 bg-white/90 p-6 shadow-lg shadow-slate-900/5 transition-transform duration-300 hover:-translate-y-1"
              >
                <div className="space-y-4">
                  <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-slate-50">
                    <div className="aspect-[4/3] w-full">
                      {product.images.length > 0 ? (
                        <img
                          src={(() => {
                            const base = normalizeBaseUrl(baseUrl)
                            const wsKey = wsConfig?.wsKey?.trim() ?? ''
                            const url = new URL(
                              `${base}/api/images/products/${product.id}/${product.images[0]}`,
                            )
                            if (wsKey) url.searchParams.set('ws_key', wsKey)
                            return url.toString()
                          })()}
                          alt={product.name}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">
                          Aucune image
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                    <span>Ref {product.reference || product.id}</span>
                    {(() => {
                      const badge = getProductBadge(product.dateAdd)
                      return badge ? (
                        <span className={`rounded-full ${badge.color} px-3 py-1 text-white`}>
                          {badge.label}
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-700">Nouveau</span>
                      )
                    })()}
                  </div>
                  <h3 className="text-xl font-semibold text-slate-900">{product.name}</h3>
                  <p className="text-sm text-slate-600">
                    {product.descriptionShort || 'Aucune description.'}
                  </p>
                </div>
                <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
                  <div className="text-2xl font-bold text-slate-900">{formatPrice(product.price)}</div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        dispatch(
                          addItem({
                            id: product.id,
                            name: product.name,
                            price: product.price,
                            reference: product.reference,
                            qty: 1,
                          }),
                        )
                      }
                      className="rounded-full border border-slate-900 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-900 transition-colors group-hover:bg-slate-900 group-hover:text-white"
                    >
                      Ajouter
                    </button>
                    <Link
                      to={`/product/${product.id}`}
                      className="rounded-full border border-slate-300 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-700 transition-colors group-hover:bg-white"
                    >
                      Fiche produit
                    </Link>
                  </div>
                </div>
              </article>
            ))}

            {filteredProducts.length === 0 && !loading && !error ? (
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500 sm:col-span-2 lg:col-span-3">
                {products.length === 0
                  ? 'Aucun produit trouvé.'
                  : 'Aucun produit ne correspond à votre recherche. Essayez de modifier vos filtres.'}
              </div>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  )
}
