import type { WsConfig } from '../../shared/http/prestashopWebserviceClient'
import { wsRequest } from '../../shared/http/prestashopWebserviceClient'
import { parseCsv } from '../../shared/csv/csv'
import { applyXmlTemplate, escapeXml } from '../../shared/xml/xmlTemplate'
import { extractItemsFromList } from '../../shared/http/prestashopResources'
import { parseXml } from '../../shared/xml/xml'
import JSZip from 'jszip'

export type ImportFiles = {
  productsCsv?: File | null
  variantsCsv?: File | null
  ordersCsv?: File | null
  imagesZip?: File | null
  customersCsv?: File | null
  categoriesCsv?: File | null
  combinationsCsv?: File | null
  suppliersCsv?: File | null
  addressesCsv?: File | null
  brandsCsv?: File | null
}


export type ImportLog = {
  step: string
  message: string
}

export type ImportResult = {
  logs: ImportLog[]
  hasErrors?: boolean
}

type ProductRow = {
  date_availability_produit: string
  nom: string
  reference: string
  prix_ttc: string
  Taxe: string
  categorie: string
  prix_achat: string
}

type VariantRow = {
  reference: string
  specificite: string
  karazany: string
  stock_initial: string
  prix_vente_ttc: string
}

type OrderRow = {
  date: string
  nom: string
  email: string
  pwd: string
  adresse: string
  achat: string
  etat: string
}

const ORDER_STATE_ALIASES = {
  cart: 'dans le panier',
  paid: 'paiement accepté',
  canceled: 'annulé',
}

type ProductImport = {
  id: number
  reference: string
  name: string
  priceHt: number
  priceTtc: number
  taxRate: number
}

type VariantImport = {
  idProductAttribute: number
  reference: string
  variantValue: string
  priceTtc: number
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


const PRODUCT_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop>
  <product>
    <name>
      <language id="1">{{name}}</language>
    </name>
    <link_rewrite>
      <language id="1">{{link_rewrite}}</language>
    </link_rewrite>
    <reference>{{reference}}</reference>
    <price>{{price}}</price>
    <id_category_default>{{id_category_default}}</id_category_default>
    <id_tax_rules_group>{{id_tax_rules_group}}</id_tax_rules_group>
    <available_for_order>1</available_for_order>
    <show_price>1</show_price>
    <visibility>both</visibility>
    <state>1</state>
    <associations>
      <categories>
        <category>
          <id>{{id_category_default}}</id>
        </category>
      </categories>
    </associations>
    <active>1</active>
  </product>
</prestashop>
`

const CATEGORY_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop>
  <category>
    <name>
      <language id="1">{{name}}</language>
    </name>
    <link_rewrite>
      <language id="1">{{link_rewrite}}</language>
    </link_rewrite>
    <id_parent>{{id_parent}}</id_parent>
    <active>1</active>
  </category>
</prestashop>
`

const PRODUCT_OPTION_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop>
  <product_option>
    <name>
      <language id="1">{{name}}</language>
    </name>
    <public_name>
      <language id="1">{{name}}</language>
    </public_name>
  </product_option>
</prestashop>
`

const PRODUCT_OPTION_VALUE_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop>
  <product_option_value>
    <id_attribute_group>{{id_attribute_group}}</id_attribute_group>
    <name>
      <language id="1">{{name}}</language>
    </name>
  </product_option_value>
</prestashop>
`

const COMBINATION_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop>
  <combination>
    <id_product>{{id_product}}</id_product>
    <reference>{{reference}}</reference>
    <price>{{price}}</price>
    <minimal_quantity>1</minimal_quantity>
    <associations>
      <product_option_values>
        <product_option_value>
          <id>{{id_product_option_value}}</id>
        </product_option_value>
      </product_option_values>
    </associations>
  </combination>
</prestashop>
`

const CUSTOMER_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop>
  <customer>
    <firstname>{{firstname}}</firstname>
    <lastname>{{lastname}}</lastname>
    <email>{{email}}</email>
    <passwd>{{passwd}}</passwd>
    <active>1</active>
  </customer>
</prestashop>
`

const ADDRESS_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop>
  <address>
    <id_customer>{{id_customer}}</id_customer>
    <alias>{{alias}}</alias>
    <lastname>{{lastname}}</lastname>
    <firstname>{{firstname}}</firstname>
    <address1>{{address1}}</address1>
    <city>{{city}}</city>
    <id_country>{{id_country}}</id_country>
    <active>1</active>
  </address>
</prestashop>
`

const CART_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop>
  <cart>
    <id_currency>{{id_currency}}</id_currency>
    <id_lang>{{id_lang}}</id_lang>
    <id_address_delivery>{{id_address_delivery}}</id_address_delivery>
    <id_address_invoice>{{id_address_invoice}}</id_address_invoice>
    <id_customer>{{id_customer}}</id_customer>
    <id_carrier>{{id_carrier}}</id_carrier>
    <associations>
      <cart_rows>
        {{cart_rows}}
      </cart_rows>
    </associations>
  </cart>
</prestashop>
`

const ORDER_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop>
  <order>
    <id_address_delivery>{{id_address_delivery}}</id_address_delivery>
    <id_address_invoice>{{id_address_invoice}}</id_address_invoice>
    <id_cart>{{id_cart}}</id_cart>
    <id_currency>{{id_currency}}</id_currency>
    <id_lang>{{id_lang}}</id_lang>
    <id_customer>{{id_customer}}</id_customer>
    <id_carrier>{{id_carrier}}</id_carrier>
    <current_state>{{current_state}}</current_state>
    <module>{{module}}</module>
    <payment>{{payment}}</payment>
    <secure_key>{{secure_key}}</secure_key>
    <total_paid>{{total_paid}}</total_paid>
    <total_paid_tax_incl>{{total_paid_tax_incl}}</total_paid_tax_incl>
    <total_paid_tax_excl>{{total_paid_tax_excl}}</total_paid_tax_excl>
    <total_paid_real>{{total_paid_real}}</total_paid_real>
    <total_products>{{total_products}}</total_products>
    <total_products_wt>{{total_products_wt}}</total_products_wt>
    <total_shipping>0</total_shipping>
    <total_shipping_tax_incl>0</total_shipping_tax_incl>
    <total_shipping_tax_excl>0</total_shipping_tax_excl>
    <total_discounts>0</total_discounts>
    <total_discounts_tax_incl>0</total_discounts_tax_incl>
    <total_discounts_tax_excl>0</total_discounts_tax_excl>
    <valid>1</valid>
    <conversion_rate>1</conversion_rate>
    <associations>
      <order_rows>
        {{order_rows}}
      </order_rows>
    </associations>
  </order>
</prestashop>
`

const ORDER_STATE_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop>
  <order_state>
    <name>
      <language id="{{id_lang}}">{{name}}</language>
    </name>
    <color>{{color}}</color>
    <send_email>0</send_email>
    <module_name></module_name>
    <invoice>0</invoice>
    <logable>0</logable>
    <delivery>0</delivery>
    <hidden>0</hidden>
    <shipped>0</shipped>
    <paid>0</paid>
    <pdf_invoice>0</pdf_invoice>
    <pdf_delivery>0</pdf_delivery>
    <unremovable>0</unremovable>
  </order_state>
</prestashop>
`

function parseNumber(value: string): number {
  const normalized = value.replace('%', '').replace(',', '.').trim()
  const num = Number(normalized)
  return Number.isFinite(num) ? num : 0
}

function parseOrderDate(value: string): string {
  const raw = value.trim()
  if (!raw) return ''

  const frMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (frMatch) return `${frMatch[3]}-${frMatch[2]}-${frMatch[1]}`

  return ''
}

function normalizeHeader(value: string): string {
  return normalizeLabel(value).replace(/[\s-]+/g, '_')
}

function isValidDdMmYyyy(value: string): boolean {
  const raw = value.trim()
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!match) return false

  const day = Number(match[1])
  const month = Number(match[2])
  const year = Number(match[3])
  const date = new Date(year, month - 1, day)

  return (
    Number.isFinite(day) &&
    Number.isFinite(month) &&
    Number.isFinite(year) &&
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  )
}

function validateHeaders(
  fileLabel: string,
  headers: string[],
  requiredGroups: string[][],
  logs: ImportLog[],
): boolean {
  const normalizedHeaders = headers.map(normalizeHeader)
  const headerSet = new Set(normalizedHeaders)
  const allowed = new Set(requiredGroups.flat().map(normalizeHeader))

  const missing: string[] = []
  for (const group of requiredGroups) {
    const found = group.some((candidate) => headerSet.has(normalizeHeader(candidate)))
    if (!found) missing.push(group[0])
  }

  const unknown = normalizedHeaders.filter((header) => !allowed.has(header))

  if (missing.length > 0) {
    logs.push({
      step: 'validation',
      message: `${fileLabel}: nom de colonne non conforme. Colonnes manquantes: ${missing.join(', ')}`,
    })
    return false
  }

  if (unknown.length > 0) {
    logs.push({
      step: 'validation',
      message: `${fileLabel}: colonnes non reconnues detectees (${unknown.join(', ')})`,
    })
  }

  return true
}

function validateRows(
  products: ProductRow[],
  variants: VariantRow[],
  orders: OrderRow[],
  logs: ImportLog[],
): boolean {
  let hasErrors = false

  for (let i = 0; i < products.length; i++) {
    const row = products[i]
    const line = i + 2

    if (row.date_availability_produit?.trim() && !isValidDdMmYyyy(row.date_availability_produit)) {
      logs.push({
        step: 'validation',
        message: `Produits ligne ${line}: format date invalide (${row.date_availability_produit}). Attendu DD/MM/YYYY`,
      })
      hasErrors = true
    }

    const priceTtc = parseNumber(row.prix_ttc)
    if (!Number.isFinite(priceTtc) || priceTtc <= 0) {
      logs.push({
        step: 'validation',
        message: `Produits ligne ${line}: montant prix_ttc doit etre positif (${row.prix_ttc || 'vide'})`,
      })
      hasErrors = true
    }

    const purchasePrice = parseNumber(row.prix_achat)
    if (!Number.isFinite(purchasePrice) || purchasePrice <= 0) {
      logs.push({
        step: 'validation',
        message: `Produits ligne ${line}: montant prix_achat doit etre positif (${row.prix_achat || 'vide'})`,
      })
      hasErrors = true
    }
  }

  for (let i = 0; i < variants.length; i++) {
    const row = variants[i]
    const line = i + 2
    const rawPrice = (row.prix_vente_ttc ?? '').toString().trim()
    let priceTtc: number | null = parseNumber(row.prix_vente_ttc)
    if (rawPrice === '' || !Number.isFinite(priceTtc) || priceTtc <= 0) {
      if (rawPrice === '') {
        logs.push({
          step: 'validation',
          message: `Variantes ligne ${line}: prix_vente_ttc vide -> utilisera le prix produit (warning)`,
        })
        // fallback to product price later when product is available
      } else {
        logs.push({
          step: 'validation',
          message: `Variantes ligne ${line}: montant prix_vente_ttc doit etre positif (${row.prix_vente_ttc || 'vide'})`,
        })
        hasErrors = true
      }
    }
  }

  for (let i = 0; i < orders.length; i++) {
    const row = orders[i]
    const line = i + 2
    if (!isValidDdMmYyyy(row.date)) {
      logs.push({
        step: 'validation',
        message: `Commandes ligne ${line}: format date invalide (${row.date || 'vide'}). Attendu DD/MM/YYYY`,
      })
      hasErrors = true
    }
  }

  return !hasErrors
}

function pickRowValue(row: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    if (row[key] !== undefined) return row[key]
  }
  return ''
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

function buildImageUrl(config: WsConfig, productId: number) {
  const rawBase = config.shopBaseUrl.trim()
  const normalizedKey = config.wsKey.trim()
  const base = rawBase ? normalizeBaseUrl(rawBase) : detectShopBaseUrlFromLocation()
  const url = new URL(`${base}/api/images/products/${productId}`)
  if (normalizedKey && !url.searchParams.has('ws_key')) {
    url.searchParams.set('ws_key', normalizedKey)
  }
  return url
}

function getBaseName(path: string): string {
  const name = path.split('/').pop() ?? path
  const dot = name.lastIndexOf('.')
  return (dot >= 0 ? name.slice(0, dot) : name).trim()
}

function matchesReference(baseName: string, reference: string): boolean {
  const normalized = baseName.trim().toLowerCase()
  const ref = reference.trim().toLowerCase()
  if (!normalized || !ref) return false
  return (
    normalized === ref ||
    normalized.startsWith(`${ref}-`) ||
    normalized.startsWith(`${ref}_`) ||
    normalized.includes(ref)
  )
}

type ImageUploadResult = {
  matched: number
  uploaded: number
  failed: number
  failures: string[]
  skipped: number
}

function isImageFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)
}

async function uploadProductImages(
  config: WsConfig,
  productId: number,
  reference: string,
  zip: JSZip,
): Promise<ImageUploadResult> {
  const entries = Object.values(zip.files).filter((f) => !f.dir)
  const matching = entries.filter(
    (entry) =>
      !entry.name.startsWith('__MACOSX/') &&
      !entry.name.includes('/__MACOSX/') &&
      matchesReference(getBaseName(entry.name), reference),
  )

  let uploaded = 0
  let failed = 0
  let skipped = 0
  const failures: string[] = []
  for (const entry of matching) {
    if (!isImageFile(entry.name)) {
      skipped++
      continue
    }

    const blob = await entry.async('blob')
    const form = new FormData()
    form.append('image', blob, entry.name)

    const url = buildImageUrl(config, productId)
    const basic = btoa(`${config.wsKey.trim()}:`)

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
      },
      body: form,
    })

    if (res.ok) {
      uploaded++
    } else {
      failed++
      failures.push(`${entry.name} HTTP ${res.status}`)
    }
  }

  return { matched: matching.length, uploaded, failed, failures, skipped }
}

function normalizeLabel(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function slugify(value: string): string {
  return normalizeLabel(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item'
}

function mapCategoryName(value: string): string {
  const normalized = normalizeLabel(value)
  if (normalized === 'akanjo') return 'Vetements'
  return value
}

function extractCreatedId(xml: string, resource: string): number {
  const parsed = parseXml<any>(xml)
  const id = Number(parsed?.prestashop?.[resource]?.id ?? parsed?.prestashop?.[resource]?.['id'])
  return Number.isFinite(id) ? id : 0
}

async function getFirstId(config: WsConfig, resource: string): Promise<number> {
  const itemKeyMap: Record<string, string> = {
    categories: 'category',
    customers: 'customer',
    products: 'product',
    product_options: 'product_option',
    product_option_values: 'product_option_value',
    order_states: 'order_state',
    currencies: 'currency',
    languages: 'language',
    carriers: 'carrier',
    countries: 'country',
    shops: 'shop',
  }
  const itemKey = itemKeyMap[resource] ?? resource.slice(0, -1)

  const res = await wsRequest(config, {
    method: 'GET',
    path: resource,
    query: { display: '[id]', limit: '0,1' },
  })

  if (!res.ok) return 1
  const ids = extractItemsFromList(res.xml, resource, itemKey, (item) => {
    const raw = item?.['@_id'] ?? item?.id
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  })

  return ids[0] ?? 1
}

async function getActiveCountryId(config: WsConfig): Promise<number> {
  const res = await wsRequest(config, {
    method: 'GET',
    path: 'countries',
    query: { display: '[id]', 'filter[active]': '[1]', limit: '0,1' },
  })

  if (!res.ok) return getFirstId(config, 'countries')
  const ids = extractItemsFromList(res.xml, 'countries', 'country', (item) => {
    const raw = item?.['@_id'] ?? item?.id
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  })
  return ids[0] ?? getFirstId(config, 'countries')
}

type OrderStateInfo = {
  id: number
  moduleName: string
}

async function resolveOrderState(config: WsConfig, label: string, langId: number): Promise<OrderStateInfo> {
  const res = await wsRequest(config, {
    method: 'GET',
    path: 'order_states',
    query: { display: '[id,name,module_name]' },
  })

  if (!res.ok) return { id: 1, moduleName: '' }

  const normalized = normalizeLabel(label)
  const matches = extractItemsFromList(res.xml, 'order_states', 'order_state', (item) => {
    const name = item?.name
    const id = Number(item?.['@_id'] ?? item?.id)
    if (!Number.isFinite(id)) return null
    const value = typeof name === 'object' ? String(name?.language?.['#text'] ?? name?.language ?? '') : String(name ?? '')
    const moduleName = String(item?.module_name ?? '')
    return { id, value: normalizeLabel(value), moduleName }
  })

  const exact = matches.find((m) => m.value === normalized)
  if (exact) return { id: exact.id, moduleName: exact.moduleName }

  const exactCart = matches.find((m) => m.value === normalizeLabel(ORDER_STATE_ALIASES.cart))
  if (normalized === normalizeLabel(ORDER_STATE_ALIASES.cart) && exactCart) return { id: exactCart.id, moduleName: exactCart.moduleName }

  const exactPaid = matches.find((m) => m.value === normalizeLabel(ORDER_STATE_ALIASES.paid))
  if (normalized === normalizeLabel(ORDER_STATE_ALIASES.paid) && exactPaid) return { id: exactPaid.id, moduleName: exactPaid.moduleName }

  const exactCanceled = matches.find((m) => m.value === normalizeLabel(ORDER_STATE_ALIASES.canceled))
  if (normalized === normalizeLabel(ORDER_STATE_ALIASES.canceled) && exactCanceled) return { id: exactCanceled.id, moduleName: exactCanceled.moduleName }

  throw new Error(`Etat de commande non autorise: ${label}`)
}

async function resolveTaxRuleGroupId(config: WsConfig, rate: number): Promise<number> {
  const taxRulesRes = await wsRequest(config, {
    method: 'GET',
    path: 'tax_rules',
    query: { display: '[id_tax_rules_group,id_tax]' },
  })

  const taxesRes = await wsRequest(config, {
    method: 'GET',
    path: 'taxes',
    query: { display: '[id,rate]' },
  })

  if (!taxRulesRes.ok || !taxesRes.ok) return 1

  const taxRateById = new Map<number, number>()
  extractItemsFromList(taxesRes.xml, 'taxes', 'tax', (item) => {
    const id = Number(item?.['@_id'] ?? item?.id)
    const rateValue = parseNumber(String(item?.rate ?? '0'))
    if (Number.isFinite(id)) taxRateById.set(id, rateValue)
    return null
  })

  const groupRates = new Map<number, number>()
  extractItemsFromList(taxRulesRes.xml, 'tax_rules', 'tax_rule', (item) => {
    const groupId = Number(item?.id_tax_rules_group)
    const taxId = Number(item?.id_tax)
    if (!Number.isFinite(groupId) || !Number.isFinite(taxId)) return null
    const taxRate = taxRateById.get(taxId)
    if (taxRate !== undefined) groupRates.set(groupId, taxRate)
    return null
  })

  for (const [groupId, groupRate] of groupRates.entries()) {
    if (Math.abs(groupRate - rate) < 0.01) return groupId
  }

  return groupRates.keys().next().value ?? 1
}

async function getDefaultCategoryParent(config: WsConfig): Promise<number> {
  const res = await wsRequest(config, {
    method: 'GET',
    path: 'categories',
    query: { display: '[id,name]', 'filter[id_parent]': '[1]' },
  })

  if (!res.ok) return 1
  const items = extractItemsFromList(res.xml, 'categories', 'category', (item) => {
    const id = Number(item?.['@_id'] ?? item?.id)
    return Number.isFinite(id) ? id : null
  })
  return items[0] ?? 1
}

async function getCustomerSecureKey(config: WsConfig, customerId: number): Promise<string> {
  const res = await wsRequest(config, {
    method: 'GET',
    path: `customers/${customerId}`,
  })

  if (!res.ok) return ''

  const parsed = parseXml<any>(res.xml)
  const key = String(parsed?.prestashop?.customer?.secure_key ?? '')
  return key
}

async function ensureCategory(config: WsConfig, name: string, parentId: number): Promise<number> {
  const res = await wsRequest(config, {
    method: 'GET',
    path: 'categories',
    query: { display: '[id,name]', 'filter[name]': `[${name}]` },
  })

  if (res.ok) {
    const items = extractItemsFromList(res.xml, 'categories', 'category', (item) => {
      const id = Number(item?.['@_id'] ?? item?.id)
      return Number.isFinite(id) ? id : null
    })
    if (items[0]) return items[0]
  }

  const xml = applyXmlTemplate(CATEGORY_TEMPLATE, {
    name,
    link_rewrite: slugify(name),
    id_parent: String(parentId),
  })

  const createRes = await wsRequest(config, {
    method: 'POST',
    path: 'categories',
    xmlBody: xml,
  })

  if (!createRes.ok) return parentId

  return extractCreatedId(createRes.xml, 'category') || parentId
}

async function ensureProductOption(config: WsConfig, name: string): Promise<number> {
  const res = await wsRequest(config, {
    method: 'GET',
    path: 'product_options',
    query: { display: '[id,name]', 'filter[name]': `[${name}]` },
  })

  if (res.ok) {
    const items = extractItemsFromList(res.xml, 'product_options', 'product_option', (item) => {
      const id = Number(item?.['@_id'] ?? item?.id)
      return Number.isFinite(id) ? id : null
    })
    if (items[0]) return items[0]
  }

  const xml = applyXmlTemplate(PRODUCT_OPTION_TEMPLATE, { name })
  const createRes = await wsRequest(config, {
    method: 'POST',
    path: 'product_options',
    xmlBody: xml,
  })

  if (!createRes.ok) return 0
  return extractCreatedId(createRes.xml, 'product_option')
}

async function ensureProductOptionValue(config: WsConfig, optionId: number, name: string): Promise<number> {
  const res = await wsRequest(config, {
    method: 'GET',
    path: 'product_option_values',
    query: { display: '[id,name,id_attribute_group]', 'filter[name]': `[${name}]` },
  })

  if (res.ok) {
    const items = extractItemsFromList(res.xml, 'product_option_values', 'product_option_value', (item) => {
      const id = Number(item?.['@_id'] ?? item?.id)
      return Number.isFinite(id) ? id : null
    })
    if (items[0]) return items[0]
  }

  const xml = applyXmlTemplate(PRODUCT_OPTION_VALUE_TEMPLATE, {
    id_attribute_group: String(optionId),
    name,
  })

  const createRes = await wsRequest(config, {
    method: 'POST',
    path: 'product_option_values',
    xmlBody: xml,
  })

  if (!createRes.ok) return 0
  return extractCreatedId(createRes.xml, 'product_option_value')
}

async function createStockAvailable(
  config: WsConfig,
  idProduct: number,
  idProductAttribute: number,
  quantity: number,
): Promise<{ ok: boolean; status: number }> {
  // First, look for existing stock_availables for this product/combination
  const getRes = await wsRequest(config, {
    method: 'GET',
    path: 'stock_availables',
    query: {
      display: '[id,quantity,id_shop,id_shop_group]',
      'filter[id_product]': `[${idProduct}]`,
      'filter[id_product_attribute]': `[${idProductAttribute}]`,
      limit: '0,200',
    },
  })

  if (getRes.ok) {
    const parsed = parseXml<any>(getRes.xml)
    const list = parsed?.prestashop?.stock_availables?.stock_available
    const arr = Array.isArray(list) ? list : list ? [list] : []

    if (arr.length > 0) {
      // Consolidate: set first entry to requested quantity, others to 0
      const first = arr[0]
      const firstId = Number(nodeText(first?.id ?? first?.['@_id']))
      const firstShop = Number(nodeText(first?.id_shop ?? first?.['id_shop'] ?? '1')) || 1
      const firstShopGroup = Number(nodeText(first?.id_shop_group ?? first?.['id_shop_group'] ?? '1')) || 1

      if (Number.isFinite(firstId)) {
        const putXml = `<?xml version="1.0" encoding="UTF-8"?>\n<prestashop>\n  <stock_available>\n    <id>${firstId}</id>\n    <id_product>${idProduct}</id_product>\n    <id_product_attribute>${idProductAttribute}</id_product_attribute>\n    <id_shop>${firstShop}</id_shop>\n    <id_shop_group>${firstShopGroup}</id_shop_group>\n    <quantity>${quantity}</quantity>\n    <depends_on_stock>0</depends_on_stock>\n    <out_of_stock>2</out_of_stock>\n  </stock_available>\n</prestashop>\n`
        const putRes = await wsRequest(config, { method: 'PUT', path: `stock_availables/${firstId}`, xmlBody: putXml })

        // set others to 0 to avoid duplicates
        for (let i = 1; i < arr.length; i++) {
          try {
            const node = arr[i]
            const id = Number(node?.id ?? node?.['@_id'] ?? 0)
            const shopId = Number(node?.id_shop ?? node?.['id_shop'] ?? 1) || 1
            const shopGroupId = Number(node?.id_shop_group ?? node?.['id_shop_group'] ?? 1) || 1
            if (Number.isFinite(id)) {
              const zeroXml = `<?xml version="1.0" encoding="UTF-8"?>\n<prestashop>\n  <stock_available>\n    <id>${id}</id>\n    <id_product>${idProduct}</id_product>\n    <id_product_attribute>${idProductAttribute}</id_product_attribute>\n    <id_shop>${shopId}</id_shop>\n    <id_shop_group>${shopGroupId}</id_shop_group>\n    <quantity>0</quantity>\n    <depends_on_stock>0</depends_on_stock>\n    <out_of_stock>2</out_of_stock>\n  </stock_available>\n</prestashop>\n`
              await wsRequest(config, { method: 'PUT', path: `stock_availables/${id}`, xmlBody: zeroXml })
            }
          } catch (e) {
            // ignore
          }
        }

        return { ok: putRes.ok, status: putRes.status }
      }
    }
  }

  // No existing entry -> create
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<prestashop>\n  <stock_available>\n    <id_product>${idProduct}</id_product>\n    <id_product_attribute>${idProductAttribute}</id_product_attribute>\n    <quantity>${quantity}</quantity>\n    <depends_on_stock>0</depends_on_stock>\n    <out_of_stock>2</out_of_stock>\n  </stock_available>\n</prestashop>\n`

  const res = await wsRequest(config, {
    method: 'POST',
    path: 'stock_availables',
    xmlBody: xml,
  })

  // If POST not allowed, fallback to GET+PUT (race condition)
  if (res.status === 405) {
    const g = await wsRequest(config, {
      method: 'GET',
      path: 'stock_availables',
      query: {
        display: '[id,quantity,id_shop,id_shop_group]',
        'filter[id_product]': `[${idProduct}]`,
        'filter[id_product_attribute]': `[${idProductAttribute}]`,
        limit: '0,1',
      },
    })
    if (g.ok) {
      const parsed = parseXml<any>(g.xml)
      const list = parsed?.prestashop?.stock_availables?.stock_available
      const arr = Array.isArray(list) ? list : list ? [list] : []
      if (arr.length > 0) {
        const node = arr[0]
        const sid = Number(node?.id ?? node?.['@_id'] ?? 0)
        if (Number.isFinite(sid)) {
          const putXml = `<?xml version="1.0" encoding="UTF-8"?>\n<prestashop>\n  <stock_available>\n    <id>${sid}</id>\n    <id_product>${idProduct}</id_product>\n    <id_product_attribute>${idProductAttribute}</id_product_attribute>\n    <id_shop>1</id_shop>\n    <id_shop_group>1</id_shop_group>\n    <quantity>${quantity}</quantity>\n    <depends_on_stock>0</depends_on_stock>\n    <out_of_stock>2</out_of_stock>\n  </stock_available>\n</prestashop>\n`
          const putRes = await wsRequest(config, { method: 'PUT', path: `stock_availables/${sid}`, xmlBody: putXml })
          return { ok: putRes.ok, status: putRes.status }
        }
      }
    }
  }

  return { ok: res.ok, status: res.status }
}

async function zeroProductLevelStock(config: WsConfig, idProduct: number) {
  // Find any stock_availables with id_product_attribute = 0 and set them to 0
  const getRes = await wsRequest(config, {
    method: 'GET',
    path: 'stock_availables',
    query: {
      display: '[id,quantity,id_product_attribute,id_shop,id_shop_group]',
      'filter[id_product]': `[${idProduct}]`,
      'filter[id_product_attribute]': `[0]`,
      limit: '0,200',
    },
  })

  if (!getRes.ok) return false
  const parsed = parseXml<any>(getRes.xml)
  const list = parsed?.prestashop?.stock_availables?.stock_available
  const arr = Array.isArray(list) ? list : list ? [list] : []
  for (const node of arr) {
    try {
      const sid = Number(node?.id ?? node?.['@_id'] ?? 0)
      const shopId = Number(node?.id_shop ?? node?.['id_shop'] ?? 1) || 1
      const shopGroupId = Number(node?.id_shop_group ?? node?.['id_shop_group'] ?? 1) || 1
      if (!Number.isFinite(sid)) continue
      const putXml = `<?xml version="1.0" encoding="UTF-8"?>\n<prestashop>\n  <stock_available>\n    <id>${sid}</id>\n    <id_product>${idProduct}</id_product>\n    <id_product_attribute>0</id_product_attribute>\n    <id_shop>${shopId}</id_shop>\n    <id_shop_group>${shopGroupId}</id_shop_group>\n    <quantity>0</quantity>\n    <depends_on_stock>0</depends_on_stock>\n    <out_of_stock>2</out_of_stock>\n  </stock_available>\n</prestashop>\n`
      await wsRequest(config, { method: 'PUT', path: `stock_availables/${sid}`, xmlBody: putXml })
    } catch (e) {
      // ignore
    }
  }

  return true
}

function parseAchat(value: string): Array<{ reference: string; qty: number; variant: string }> {
  const items: Array<{ reference: string; qty: number; variant: string }> = []
  const regex = /\(\s*"([^"]+)"\s*;\s*(\d+)\s*;\s*"([^"]*)"\s*\)/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(value)) !== null) {
    const reference = match[1]
    const qty = Number(match[2])
    const variant = match[3]
    items.push({ reference, qty: Number.isFinite(qty) ? qty : 0, variant })
  }

  return items
}

function formatCartRows(rows: Array<{ idProduct: number; idProductAttribute: number; qty: number }>) {
  return rows
    .map(
      (row) =>
        `<cart_row><id_product>${row.idProduct}</id_product><id_product_attribute>${row.idProductAttribute}</id_product_attribute><quantity>${row.qty}</quantity></cart_row>`,
    )
    .join('')
}

function formatOrderRows(
  rows: Array<{
    idProduct: number
    idProductAttribute: number
    qty: number
    name: string
    reference: string
    priceTtc: number
    taxRate: number
  }>,
) {
  return rows
    .map(
      (row) => {
        const unitTtc = row.priceTtc
        const unitHt = row.taxRate > 0 ? unitTtc / (1 + row.taxRate / 100) : unitTtc
        const totalTtc = unitTtc * row.qty
        const totalHt = unitHt * row.qty

        return (
          `<order_row>` +
          `<product_id>${row.idProduct}</product_id>` +
          `<product_attribute_id>${row.idProductAttribute}</product_attribute_id>` +
          `<product_quantity>${row.qty}</product_quantity>` +
          `<product_name>${escapeXml(row.name)}</product_name>` +
          `<product_reference>${escapeXml(row.reference)}</product_reference>` +
          `<product_price>${unitHt.toFixed(2)}</product_price>` +
          `<unit_price_tax_incl>${unitTtc.toFixed(2)}</unit_price_tax_incl>` +
          `<unit_price_tax_excl>${unitHt.toFixed(2)}</unit_price_tax_excl>` +
          `<total_price_tax_incl>${totalTtc.toFixed(2)}</total_price_tax_incl>` +
          `<total_price_tax_excl>${totalHt.toFixed(2)}</total_price_tax_excl>` +
          `<original_product_price>${unitHt.toFixed(2)}</original_product_price>` +
          `<tax_rate>${row.taxRate}</tax_rate>` +
          `</order_row>`
        )
      },
    )
    .join('')
}

function calcTotals(lines: Array<{ priceTtc: number; qty: number; taxRate: number }>) {
  let totalTtc = 0
  let totalHt = 0

  for (const line of lines) {
    const lineTtc = line.priceTtc * line.qty
    const lineHt = line.taxRate > 0 ? lineTtc / (1 + line.taxRate / 100) : lineTtc
    totalTtc += lineTtc
    totalHt += lineHt
  }

  return {
    totalTtc: Number(totalTtc.toFixed(2)),
    totalHt: Number(totalHt.toFixed(2)),
  }
}

export async function importAllFromCsv(config: WsConfig, files: ImportFiles): Promise<ImportResult> {
  const logs: ImportLog[] = []

  const productsText = files.productsCsv ? await files.productsCsv.text() : ''
  const variantsText = files.variantsCsv ? await files.variantsCsv.text() : ''
  const ordersText = files.ordersCsv ? await files.ordersCsv.text() : ''
  const customersText = files.customersCsv ? await files.customersCsv.text() : ''
  const categoriesText = files.categoriesCsv ? await files.categoriesCsv.text() : ''
  const combinationsText = files.combinationsCsv ? await files.combinationsCsv.text() : ''
  const suppliersText = files.suppliersCsv ? await files.suppliersCsv.text() : ''
  const addressesText = files.addressesCsv ? await files.addressesCsv.text() : ''
  const brandsText = files.brandsCsv ? await files.brandsCsv.text() : ''
  const zip = files.imagesZip ? await JSZip.loadAsync(files.imagesZip) : null

  const productsCsv = productsText ? parseCsv(productsText) : null
  const variantsCsv = variantsText ? parseCsv(variantsText) : null
  const ordersCsv = ordersText ? parseCsv(ordersText) : null
  const customersCsv = customersText ? parseCsv(customersText) : null
  const categoriesCsv = categoriesText ? parseCsv(categoriesText) : null
  const combinationsCsv = combinationsText ? parseCsv(combinationsText) : null
  const suppliersCsv = suppliersText ? parseCsv(suppliersText) : null
  const addressesCsv = addressesText ? parseCsv(addressesText) : null
  const brandsCsv = brandsText ? parseCsv(brandsText) : null

  let headersOk = true
  if (productsCsv) {
    headersOk =
      validateHeaders(
        'CSV produits',
        productsCsv.headers,
        [['date_availability_produit'], ['nom'], ['reference'], ['prix_ttc'], ['taxe', 'Taxe'], ['categorie'], ['prix_achat']],
        logs,
      ) && headersOk
  }
  if (variantsCsv) {
    headersOk =
      validateHeaders(
        'CSV variantes',
        variantsCsv.headers,
        [['reference'], ['specificite', 'specificité'], ['karazany'], ['stock_initial'], ['prix_vente_ttc']],
        logs,
      ) && headersOk
  }
  if (ordersCsv) {
    headersOk =
      validateHeaders(
        'CSV commandes',
        ordersCsv.headers,
        [['date'], ['nom'], ['email'], ['pwd'], ['adresse'], ['achat'], ['etat']],
        logs,
      ) && headersOk
  }

  if (!headersOk) {
    logs.push({ step: 'validation', message: 'Import annule: corrige les noms de colonnes puis relance.' })
    return { logs, hasErrors: true }
  }

  const products = (productsCsv?.rows ?? []) as ProductRow[]
  const variants = (variantsCsv?.rows ?? []).map((row) => {
    const specificite = pickRowValue(row, ['specificite', 'specificité'])
    const karazany = pickRowValue(row, ['karazany'])
    const stock_initial = pickRowValue(row, ['stock_initial'])
    const prix_vente_ttc = pickRowValue(row, ['prix_vente_ttc'])
    const reference = pickRowValue(row, ['reference'])
    return {
      reference,
      specificite,
      karazany,
      stock_initial,
      prix_vente_ttc,
    } as VariantRow
  })
  const minVariantPriceByRef = new Map<string, number>()
  for (const variant of variants) {
    if (!variant.reference) continue
    const priceTtc = parseNumber(variant.prix_vente_ttc)
    if (!Number.isFinite(priceTtc) || priceTtc <= 0) continue
    const current = minVariantPriceByRef.get(variant.reference)
    if (current === undefined || priceTtc < current) {
      minVariantPriceByRef.set(variant.reference, priceTtc)
    }
  }
  const orders = (ordersCsv?.rows ?? []) as OrderRow[]

  const rowsOk = validateRows(products, variants, orders, logs)
  if (!rowsOk) {
    logs.push({ step: 'validation', message: 'Import annule: corrige les erreurs de date/montant puis relance.' })
    return { logs, hasErrors: true }
  }

  logs.push({
    step: 'parse',
    message: `Produits: ${products.length}, variantes: ${variants.length}, commandes: ${orders.length}, clients: ${(
      customersCsv?.rows ?? []
    ).length}, categories: ${(
      categoriesCsv?.rows ?? []
    ).length}, combinations: ${(
      combinationsCsv?.rows ?? []
    ).length}, fournisseurs: ${(
      suppliersCsv?.rows ?? []
    ).length}, adresses: ${(
      addressesCsv?.rows ?? []
    ).length}, marques: ${(
      brandsCsv?.rows ?? []
    ).length}`,
  })

  if (!files.productsCsv) {
    logs.push({ step: 'parse', message: 'CSV produits absent. Import produits ignore.' })
  }
  if (!files.variantsCsv) {
    logs.push({ step: 'parse', message: 'CSV variantes absent. Import variantes ignore.' })
  }
  if (!files.ordersCsv) {
    logs.push({ step: 'parse', message: 'CSV commandes absent. Import commandes ignore.' })
  }
  if (!files.customersCsv) {
    logs.push({ step: 'parse', message: 'CSV clients absent. Import clients ignore.' })
  }
  if (!files.categoriesCsv) {
    logs.push({ step: 'parse', message: 'CSV categories absent. Import categories ignore.' })
  }
  if (!files.combinationsCsv) {
    logs.push({ step: 'parse', message: 'CSV declinaisons absent. Import combinations ignore.' })
  }
  if (!files.suppliersCsv) {
    logs.push({ step: 'parse', message: 'CSV fournisseurs absent. Import fournisseurs ignore.' })
  }
  if (!files.addressesCsv) {
    logs.push({ step: 'parse', message: 'CSV adresses absent. Import adresses ignore.' })
  }
  if (!files.brandsCsv) {
    logs.push({ step: 'parse', message: 'CSV marques absent. Import marques ignore.' })
  }
  if (!files.imagesZip) {
    logs.push({ step: 'parse', message: 'ZIP images absent. Upload images ignore.' })
  }

  const defaultCategoryId = await getDefaultCategoryParent(config)
  const defaultCurrencyId = await getFirstId(config, 'currencies')
  const defaultLangId = await getFirstId(config, 'languages')
  const defaultCarrierId = await getFirstId(config, 'carriers')
  const defaultCountryId = await getActiveCountryId(config)

  const categoryByName = new Map<string, number>()
  const productByReference = new Map<string, ProductImport>()
  const variantByKey = new Map<string, VariantImport>()

  const taxGroupByRate = new Map<number, number>()

  for (const row of products) {
    const categoryName = mapCategoryName(row.categorie?.trim() || 'Divers')
    let categoryId = categoryByName.get(categoryName)
    if (!categoryId) {
      categoryId = await ensureCategory(config, categoryName, defaultCategoryId)
      categoryByName.set(categoryName, categoryId)
      logs.push({ step: 'category', message: `${categoryName} -> ${categoryId}` })
    }

    const taxRate = parseNumber(row.Taxe)
    let taxGroupId = taxGroupByRate.get(taxRate)
    if (!taxGroupId) {
      taxGroupId = await resolveTaxRuleGroupId(config, taxRate)
      taxGroupByRate.set(taxRate, taxGroupId)
    }

    const rowPriceTtc = parseNumber(row.prix_ttc)
    const minVariantTtc = minVariantPriceByRef.get(row.reference)
    const priceTtc = minVariantTtc && minVariantTtc > 0 ? Math.min(rowPriceTtc, minVariantTtc) : rowPriceTtc
    const priceHt = taxRate > 0 ? priceTtc / (1 + taxRate / 100) : priceTtc
    const xml = applyXmlTemplate(PRODUCT_TEMPLATE, {
      name: row.nom,
      link_rewrite: slugify(row.nom),
      reference: row.reference,
      price: priceHt.toFixed(6),
      id_category_default: String(categoryId),
      id_tax_rules_group: String(taxGroupId),
    })

    const createRes = await wsRequest(config, {
      method: 'POST',
      path: 'products',
      xmlBody: xml,
    })

    if (!createRes.ok) {
      logs.push({ step: 'product', message: `Echec produit ${row.reference} HTTP ${createRes.status}` })
      logs.push({ step: 'product', message: createRes.xml || 'Reponse vide' })
      logs.push({ step: 'product', message: xml })
      continue
    }

    const id = extractCreatedId(createRes.xml, 'product')
    productByReference.set(row.reference, {
      id,
      reference: row.reference,
      name: row.nom,
      priceHt,
      priceTtc,
      taxRate,
    })
    logs.push({ step: 'product', message: `${row.reference} -> ${id}` })

    if (zip) {
      const result = await uploadProductImages(config, id, row.reference, zip)
      logs.push({
        step: 'image',
        message: `${row.reference} images: ${result.uploaded}/${result.matched} (fails: ${result.failed}, skipped: ${result.skipped})`,
      })
      if (result.matched === 0) {
        logs.push({ step: 'image', message: `Aucune image trouvee pour ${row.reference}` })
      }
      if (result.failures.length > 0) {
        logs.push({ step: 'image', message: `Echecs images ${row.reference}: ${result.failures.join(', ')}` })
      }
    }
  }

  const optionCache = new Map<string, number>()
  const valueCache = new Map<string, number>()

  for (const row of variants) {
    if (!row.reference) continue
    const product = productByReference.get(row.reference)
    if (!product) continue

    // If specificite / karazany missing, treat as product-level stock
    if (!row.specificite || !row.karazany) {
      const stock = parseNumber(row.stock_initial)
      const stockQty = Number.isFinite(stock) ? stock : 0
      if (stockQty > 0) {
        const stockRes = await createStockAvailable(config, product.id, 0, stockQty)
        if (stockRes.ok) {
          logs.push({ step: 'variant', message: `Stock produit ${row.reference} -> ${stockQty}` })
        } else {
          logs.push({ step: 'variant', message: `Echec stock produit ${row.reference} HTTP ${stockRes.status}` })
        }
      }
      continue
    }

    const optionKey = row.specificite.trim()
    let optionId = optionCache.get(optionKey)
    if (!optionId) {
      optionId = await ensureProductOption(config, optionKey)
      optionCache.set(optionKey, optionId)
    }

    const valueKey = `${optionId}:${row.karazany.trim()}`
    let valueId = valueCache.get(valueKey)
    if (!valueId) {
      valueId = await ensureProductOptionValue(config, optionId, row.karazany.trim())
      valueCache.set(valueKey, valueId)
    }

    const rawPrice = (row.prix_vente_ttc ?? '').toString().trim()
    let priceTtc = parseNumber(row.prix_vente_ttc)
    if (!Number.isFinite(priceTtc) || priceTtc <= 0) {
      if (rawPrice === '') {
        // fallback to product price if variant price not provided
        priceTtc = product.priceTtc
        logs.push({ step: 'variant', message: `Variante ${row.reference}/${row.karazany}: prix vide -> utilise prix produit (${priceTtc})` })
      } else {
        logs.push({
          step: 'variant',
          message: `Variante ${row.reference}/${row.karazany} ignoree: montant prix_vente_ttc doit etre positif (${row.prix_vente_ttc || 'vide'})`,
        })
        continue
      }
    }

    const priceHt = product.taxRate > 0 ? priceTtc / (1 + product.taxRate / 100) : priceTtc
    let priceImpact = priceHt - product.priceHt
    if (!Number.isFinite(priceImpact)) {
      logs.push({
        step: 'variant',
        message: `Variante ${row.reference}/${row.karazany} ignoree: calcul prix invalide`,
      })
      continue
    }
    if (priceImpact < 0 && priceImpact > -0.01) priceImpact = 0
    const xml = applyXmlTemplate(COMBINATION_TEMPLATE, {
      id_product: String(product.id),
      reference: row.karazany.trim(),
      price: priceImpact.toFixed(6),
      id_product_option_value: String(valueId),
    })

    const comboRes = await wsRequest(config, {
      method: 'POST',
      path: 'combinations',
      xmlBody: xml,
    })

    if (!comboRes.ok) {
      logs.push({ step: 'variant', message: `Echec variante ${row.reference}/${row.karazany} HTTP ${comboRes.status}` })
      logs.push({ step: 'variant', message: comboRes.xml })
      continue
    }

    const idProductAttribute = extractCreatedId(comboRes.xml, 'combination')
    const stock = parseNumber(row.stock_initial)
    const stockQty = Number.isFinite(stock) ? stock : 0
    const stockRes = await createStockAvailable(config, product.id, idProductAttribute, stockQty)
    if (stockRes.ok) {
      logs.push({ step: 'variant', message: `Stock pour ${row.reference}/${row.karazany} -> ${stockQty}` })
    } else {
      logs.push({ step: 'variant', message: `Echec stock ${row.reference}/${row.karazany} HTTP ${stockRes.status}` })
    }

    const key = `${row.reference}:${row.karazany}`
    variantByKey.set(key, {
      idProductAttribute,
      reference: row.reference,
      variantValue: row.karazany,
      priceTtc,
    })
    logs.push({ step: 'variant', message: `${row.reference}/${row.karazany} -> ${idProductAttribute}` })
  }

  const orderStateCache = new Map<string, OrderStateInfo>()

  if (productByReference.size === 0) {
    logs.push({ step: 'guard', message: 'Aucun produit cree, arret des paniers/commandes.' })
    return { logs }
  }

  // Consolidate product-level stocks: if a product has variants, zero id_product_attribute=0 entries
  for (const [ref, product] of productByReference.entries()) {
    const hasVariant = Array.from(variantByKey.keys()).some((k) => k.startsWith(`${ref}:`))
    if (hasVariant) {
      try {
        await zeroProductLevelStock(config, product.id)
        logs.push({ step: 'variant', message: `Stock produit niveau zero pour ${ref}` })
      } catch (e) {
        logs.push({ step: 'variant', message: `Echec zero stock produit ${ref}` })
      }
    }
  }

  for (const row of orders) {
    const customerRes = await wsRequest(config, {
      method: 'GET',
      path: 'customers',
      query: { display: '[id,email]', 'filter[email]': `[${row.email}]` },
    })

    let customerId = 0
    if (customerRes.ok) {
      const ids = extractItemsFromList(customerRes.xml, 'customers', 'customer', (item) => {
        const id = Number(item?.['@_id'] ?? item?.id)
        return Number.isFinite(id) ? id : null
      })
      customerId = ids[0] ?? 0
    }

    if (!customerId) {
      const xml = applyXmlTemplate(CUSTOMER_TEMPLATE, {
        firstname: row.nom,
        lastname: 'Client',
        email: row.email,
        passwd: row.pwd,
      })

      const createRes = await wsRequest(config, {
        method: 'POST',
        path: 'customers',
        xmlBody: xml,
      })

      if (!createRes.ok) {
        logs.push({ step: 'customer', message: `Echec client ${row.email} HTTP ${createRes.status}` })
        continue
      }

      customerId = extractCreatedId(createRes.xml, 'customer')
      logs.push({ step: 'customer', message: `${row.email} -> ${customerId}` })
    }

    const addressXml = applyXmlTemplate(ADDRESS_TEMPLATE, {
      id_customer: String(customerId),
      alias: 'Adresse',
      lastname: 'Client',
      firstname: row.nom,
      address1: row.adresse,
      city: 'Antananarivo',
      id_country: String(defaultCountryId),
    })

    const addressRes = await wsRequest(config, {
      method: 'POST',
      path: 'addresses',
      xmlBody: addressXml,
    })

    if (!addressRes.ok) {
      logs.push({ step: 'address', message: `Echec adresse ${row.email} HTTP ${addressRes.status}` })
      continue
    }

    const addressId = extractCreatedId(addressRes.xml, 'address')

    const items = parseAchat(row.achat)
    const cartRows: Array<{ idProduct: number; idProductAttribute: number; qty: number }> = []
    const priceLines: Array<{ priceTtc: number; qty: number; taxRate: number }> = []
    const orderRows: Array<{
      idProduct: number
      idProductAttribute: number
      qty: number
      name: string
      reference: string
      priceTtc: number
      taxRate: number
    }> = []

    for (const item of items) {
      const product = productByReference.get(item.reference)
      if (!product) continue

      let idProductAttribute = 0
      let priceTtc = product.priceTtc
      if (item.variant) {
        const key = `${item.reference}:${item.variant}`
        const variant = variantByKey.get(key)
        if (variant) {
          idProductAttribute = variant.idProductAttribute
          priceTtc = variant.priceTtc
        }
      }

      cartRows.push({ idProduct: product.id, idProductAttribute, qty: item.qty })
      priceLines.push({ priceTtc, qty: item.qty, taxRate: product.taxRate })
      orderRows.push({
        idProduct: product.id,
        idProductAttribute,
        qty: item.qty,
        name: product.name,
        reference: product.reference,
        priceTtc,
        taxRate: product.taxRate,
      })
    }

    if (cartRows.length === 0) {
      logs.push({ step: 'cart', message: `Panier vide pour ${row.email}, skip.` })
      continue
    }

    const totals = calcTotals(priceLines)

    const cartRowsXml = formatCartRows(cartRows)
    const cartXml = applyXmlTemplate(CART_TEMPLATE, {
      id_currency: String(defaultCurrencyId),
      id_lang: String(defaultLangId),
      id_address_delivery: String(addressId),
      id_address_invoice: String(addressId),
      id_customer: String(customerId),
      id_carrier: String(defaultCarrierId),
      cart_rows: '__CART_ROWS__',
    }).replace('__CART_ROWS__', cartRowsXml)

    const cartRes = await wsRequest(config, {
      method: 'POST',
      path: 'carts',
      xmlBody: cartXml,
    })

    if (!cartRes.ok) {
      logs.push({ step: 'cart', message: `Echec panier ${row.email} HTTP ${cartRes.status}` })
      logs.push({ step: 'cart', message: cartRes.xml || 'Reponse vide' })
      logs.push({ step: 'cart', message: cartXml })
      continue
    }

    const cartId = extractCreatedId(cartRes.xml, 'cart')
    const normalizedState = normalizeLabel(row.etat)
    let stateInfo = orderStateCache.get(normalizedState)
    if (!stateInfo) {
      stateInfo = await resolveOrderState(config, row.etat, defaultLangId)
      orderStateCache.set(normalizedState, stateInfo)
    }

    const secureKey = await getCustomerSecureKey(config, customerId)

    const orderRowsXml = formatOrderRows(orderRows)
    const moduleName = stateInfo.moduleName || 'ps_checkpayment'
    const importDate = parseOrderDate(row.date)
    const importNote = importDate ? `import_date:${importDate}` : ''
    const orderXml = applyXmlTemplate(ORDER_TEMPLATE, {
      id_address_delivery: String(addressId),
      id_address_invoice: String(addressId),
      id_cart: String(cartId),
      id_currency: String(defaultCurrencyId),
      id_lang: String(defaultLangId),
      id_customer: String(customerId),
      id_carrier: String(defaultCarrierId),
      current_state: String(stateInfo.id),
      module: moduleName,
      payment: row.etat,
      secure_key: secureKey || 'import',
      total_paid: String(totals.totalTtc),
      total_paid_tax_incl: String(totals.totalTtc),
      total_paid_tax_excl: String(totals.totalHt),
      total_paid_real: String(totals.totalTtc),
      total_products: String(totals.totalHt),
      total_products_wt: String(totals.totalTtc),
      note: escapeXml(importNote),
      order_rows: '__ORDER_ROWS__',
    })
      .replace('__ORDER_ROWS__', orderRowsXml)

    const orderRes = await wsRequest(config, {
      method: 'POST',
      path: 'orders',
      xmlBody: orderXml,
    })

    if (!orderRes.ok) {
      logs.push({ step: 'order', message: `Echec commande ${row.email} HTTP ${orderRes.status}` })
      logs.push({ step: 'order', message: orderRes.xml || 'Reponse vide' })
      logs.push({ step: 'order', message: orderXml })
      continue
    }

    const orderId = extractCreatedId(orderRes.xml, 'order')
    if (orderId && importNote) {
      const orderDetailRes = await wsRequest(config, {
        method: 'GET',
        path: `orders/${orderId}`,
      })

      if (orderDetailRes.ok) {
        const noteXml = orderDetailRes.xml.replace(/<note>[\s\S]*?<\/note>/, `<note>${escapeXml(importNote)}</note>`)
        const finalXml = noteXml.includes('<note>')
          ? noteXml
          : noteXml.replace(/<\/order>/, `  <note>${escapeXml(importNote)}</note>\n  </order>`)

        const noteRes = await wsRequest(config, {
          method: 'PUT',
          path: `orders/${orderId}`,
          xmlBody: finalXml,
        })

        if (!noteRes.ok) {
          logs.push({ step: 'order', message: `Commande ${row.email} creee mais note datee impossible (HTTP ${noteRes.status})` })
          logs.push({ step: 'order', message: noteRes.xml || 'Reponse vide' })
        }
      } else {
        logs.push({ step: 'order', message: `Commande ${row.email} creee mais lecture detail impossible (HTTP ${orderDetailRes.status})` })
      }
    }
    logs.push({ step: 'order', message: `${row.email} -> ${orderId}` })
  }

  return { logs }
}
