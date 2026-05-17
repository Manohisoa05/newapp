import type { WsConfig } from '../../shared/http/prestashopWebserviceClient'
import { wsRequest } from '../../shared/http/prestashopWebserviceClient'
import { extractItemsFromList } from '../../shared/http/prestashopResources'
import { parseXml } from '../../shared/xml/xml'
import type { CartItem } from './cartSlice'

export type CheckoutCustomer = {
  firstname: string
  lastname: string
  email: string
  address1: string
  city: string
}

type CreateCodOrderOptions = {
  existingCustomerId?: number
}

type OrderStateInfo = {
  id: number
  moduleName: string
}

const COD_ALIASES = ['paiement a la livraison', 'paiement a la livraison (cod)', 'cash on delivery']

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

function parseNumber(value: string): number {
  const normalized = value.replace('%', '').replace(',', '.').trim()
  const num = Number(normalized)
  return Number.isFinite(num) ? num : 0
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

async function resolveOrderState(config: WsConfig): Promise<OrderStateInfo> {
  const res = await wsRequest(config, {
    method: 'GET',
    path: 'order_states',
    query: { display: '[id,name,module_name]' },
  })

  if (!res.ok) return { id: 1, moduleName: 'ps_cashondelivery' }

  const matches = extractItemsFromList(res.xml, 'order_states', 'order_state', (item) => {
    const name = item?.name
    const id = Number(item?.['@_id'] ?? item?.id)
    if (!Number.isFinite(id)) return null
    const value = typeof name === 'object' ? String(name?.language?.['#text'] ?? name?.language ?? '') : String(name ?? '')
    const moduleName = String(item?.module_name ?? '')
    return { id, value: normalizeLabel(value), moduleName }
  })

  const exact = matches.find((m) => COD_ALIASES.includes(m.value))
  if (exact) return { id: exact.id, moduleName: exact.moduleName || 'ps_cashondelivery' }

  const partial = matches.find((m) => COD_ALIASES.some((alias) => m.value.includes(alias)))
  if (partial) return { id: partial.id, moduleName: partial.moduleName || 'ps_cashondelivery' }

  return { id: 1, moduleName: 'ps_cashondelivery' }
}

async function getCustomerSecureKey(config: WsConfig, customerId: number): Promise<string> {
  const res = await wsRequest(config, {
    method: 'GET',
    path: `customers/${customerId}`,
  })

  if (!res.ok) throw new Error(`Echec lecture client ${customerId} (HTTP ${res.status}). Response: ${res.xml}`)
  const parsed = parseXml<any>(res.xml)
  let secureKey = String(parsed?.prestashop?.customer?.secure_key ?? '')
  if (secureKey) return secureKey

  // If no secure_key present, generate one and update the customer record by PUTting
  // the full customer XML returned by the GET with an injected <secure_key> element.
  try {
    const bytes = (typeof crypto !== 'undefined' && (crypto as any).getRandomValues)
      ? (crypto as any).getRandomValues(new Uint8Array(16))
      : Array.from({ length: 16 }, () => Math.floor(Math.random() * 256))
    const generated = Array.from(bytes).map((b: number) => b.toString(16).padStart(2, '0')).join('')

    // Insert <secure_key> before the closing </customer> tag in the GET response XML
    const rawXml = res.xml || ''
    const injectedXml = rawXml.replace(/<\/customer>/i, `<secure_key>${generated}</secure_key></customer>`)

    const putRes = await wsRequest(config, {
      method: 'PUT',
      path: `customers/${customerId}`,
      xmlBody: injectedXml,
    })

    if (putRes.ok) return generated
    throw new Error(`Echec mise a jour secure_key client (HTTP ${putRes.status}). Response: ${putRes.xml}`)
  } catch (e) {
    throw e
  }
}

async function ensureCustomer(config: WsConfig, customer: CheckoutCustomer): Promise<number> {
  const customerRes = await wsRequest(config, {
    method: 'GET',
    path: 'customers',
    query: { display: '[id,email]', 'filter[email]': `[${customer.email}]` },
  })

  if (customerRes.ok) {
    const ids = extractItemsFromList(customerRes.xml, 'customers', 'customer', (item) => {
      const id = Number(item?.['@_id'] ?? item?.id)
      return Number.isFinite(id) ? id : null
    })
    if (ids[0]) return ids[0]
  }

  const password = Math.random().toString(36).slice(2, 12)
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop>
  <customer>
    <firstname>${customer.firstname}</firstname>
    <lastname>${customer.lastname}</lastname>
    <email>${customer.email}</email>
    <passwd>${password}</passwd>
    <secure_key></secure_key>
    <active>1</active>
  </customer>
</prestashop>
`

  const createRes = await wsRequest(config, {
    method: 'POST',
    path: 'customers',
    xmlBody: xml,
  })

  if (!createRes.ok) return 0
  return extractCreatedId(createRes.xml, 'customer')
}

async function createAddress(config: WsConfig, customerId: number, customer: CheckoutCustomer, countryId: number) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop>
  <address>
    <id_customer>${customerId}</id_customer>
    <alias>Livraison</alias>
    <lastname>${customer.lastname}</lastname>
    <firstname>${customer.firstname}</firstname>
    <address1>${customer.address1}</address1>
    <city>${customer.city}</city>
    <id_country>${countryId}</id_country>
    <active>1</active>
  </address>
</prestashop>
`

  const res = await wsRequest(config, {
    method: 'POST',
    path: 'addresses',
    xmlBody: xml,
  })

  if (!res.ok) return 0
  return extractCreatedId(res.xml, 'address')
}

function formatCartRows(items: CartItem[]): string {
  return items
    .map(
      (row) =>
        `<cart_row><id_product>${row.id}</id_product><id_product_attribute>${row.combinationId ?? 0}</id_product_attribute><quantity>${row.qty}</quantity></cart_row>`,
    )
    .join('')
}

function formatOrderRows(items: CartItem[]): string {
  return items
    .map((row) => {
      const unitTtc = row.price
      const totalTtc = unitTtc * row.qty
      return (
        `<order_row>` +
        `<product_id>${row.id}</product_id>` +
        `<product_attribute_id>${row.combinationId ?? 0}</product_attribute_id>` +
        `<product_quantity>${row.qty}</product_quantity>` +
        `<product_name>${row.name}</product_name>` +
        `<product_reference>${row.reference}</product_reference>` +
        `<product_price>${unitTtc.toFixed(2)}</product_price>` +
        `<unit_price_tax_incl>${unitTtc.toFixed(2)}</unit_price_tax_incl>` +
        `<unit_price_tax_excl>${unitTtc.toFixed(2)}</unit_price_tax_excl>` +
        `<total_price_tax_incl>${totalTtc.toFixed(2)}</total_price_tax_incl>` +
        `<total_price_tax_excl>${totalTtc.toFixed(2)}</total_price_tax_excl>` +
        `<original_product_price>${unitTtc.toFixed(2)}</original_product_price>` +
        `<tax_rate>${0}</tax_rate>` +
        `</order_row>`
      )
    })
    .join('')
}

function calcTotals(items: CartItem[]) {
  let totalTtc = 0
  for (const row of items) {
    totalTtc += row.price * row.qty
  }

  return {
    totalTtc: Number(totalTtc.toFixed(2)),
    totalHt: Number(totalTtc.toFixed(2)),
  }
}

async function decrementStockAvailable(config: WsConfig, idProduct: number, idProductAttribute: number, decreaseBy: number) {
  // If product has combinations, never touch the product-level stock (id_product_attribute = 0)
  if (idProductAttribute === 0) {
    try {
      const comboRes = await wsRequest(config, {
        method: 'GET',
        path: 'combinations',
        query: { display: '[id]', 'filter[id_product]': `[${idProduct}]`, limit: '0,1' },
      })
      if (comboRes.ok) {
        const parsedCombo = parseXml<any>(comboRes.xml)
        const comboList = parsedCombo?.prestashop?.combinations?.combination
        const hasCombo = !!(Array.isArray(comboList) ? comboList.length > 0 : comboList)
        if (hasCombo) return false
      }
    } catch (e) {
      // ignore and proceed conservatively
      return false
    }
  }
  const getRes = await wsRequest(config, {
    method: 'GET',
    path: 'stock_availables',
    query: {
      display: '[id,id_product,id_product_attribute,quantity]',
      'filter[id_product]': `[${idProduct}]`,
      'filter[id_product_attribute]': `[${idProductAttribute}]`,
      limit: '0,1',
    },
  })

  if (!getRes.ok) return false

  const parsed = parseXml<any>(getRes.xml)
  const list = parsed?.prestashop?.stock_availables?.stock_available
  const arr = Array.isArray(list) ? list : list ? [list] : []
  if (arr.length === 0) return false

  const stockNode = arr[0]
  const stockId = Number(stockNode?.id ?? stockNode?.['@_id'] ?? 0)
  const currentQty = Number(stockNode?.quantity ?? stockNode?.['quantity'] ?? 0)
  if (!Number.isFinite(stockId)) return false

  const newQty = Math.max(0, (Number.isFinite(currentQty) ? currentQty : 0) - Math.max(0, Math.floor(decreaseBy)))

  const putXml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop>
  <stock_available>
    <id>${stockId}</id>
    <id_product>${idProduct}</id_product>
    <id_product_attribute>${idProductAttribute}</id_product_attribute>
    <id_shop>1</id_shop>
    <id_shop_group>1</id_shop_group>
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

async function getTotalStock(config: WsConfig, idProduct: number, idProductAttribute?: number) {
  const query: any = {
    display: '[quantity]',
    'filter[id_product]': `[${idProduct}]`,
    limit: '0,200',
  }
  if (typeof idProductAttribute === 'number') query['filter[id_product_attribute]'] = `[${idProductAttribute}]`

  const res = await wsRequest(config, {
    method: 'GET',
    path: 'stock_availables',
    query,
  })

  if (!res.ok) return 0
  const parsed = parseXml<any>(res.xml)
  const list = parsed?.prestashop?.stock_availables?.stock_available
  const arr = Array.isArray(list) ? list : list ? [list] : []
  let total = 0
  // If no specific attribute requested, and product has combinations, exclude product-level stock entries
  let excludeProductLevel = false
  if (typeof idProductAttribute !== 'number') {
    try {
      const comboRes = await wsRequest(config, {
        method: 'GET',
        path: 'combinations',
        query: { display: '[id]', 'filter[id_product]': `[${idProduct}]`, limit: '0,1' },
      })
      if (comboRes.ok) {
        const parsedCombo = parseXml<any>(comboRes.xml)
        const comboList = parsedCombo?.prestashop?.combinations?.combination
        const hasCombo = !!(Array.isArray(comboList) ? comboList.length > 0 : comboList)
        if (hasCombo) excludeProductLevel = true
      }
    } catch (e) {
      // ignore and include all entries by default
    }
  }

  for (const node of arr) {
    const attrId = Number(node?.id_product_attribute ?? node?.['id_product_attribute'] ?? 0)
    if (excludeProductLevel && attrId === 0) continue
    const qty = Number(node?.quantity ?? node?.['quantity'] ?? 0)
    if (Number.isFinite(qty)) total += qty
  }
  return total
}

async function syncProductLevelStock(config: WsConfig, idProduct: number) {
  // Read all stock_availables for product
  const res = await wsRequest(config, {
    method: 'GET',
    path: 'stock_availables',
    query: { display: '[id,id_product_attribute,quantity,id_shop,id_shop_group]', 'filter[id_product]': `[${idProduct}]`, limit: '0,200' },
  })

  if (!res.ok) return false
  const parsed = parseXml<any>(res.xml)
  const list = parsed?.prestashop?.stock_availables?.stock_available
  const arr = Array.isArray(list) ? list : list ? [list] : []

  // sum variant quantities (exclude id_product_attribute == 0)
  let sumVariants = 0
  const productLevelNodes: any[] = []
  for (const node of arr) {
    const attr = Number(node?.id_product_attribute ?? node?.['id_product_attribute'] ?? 0)
    const qty = Number(node?.quantity ?? node?.['quantity'] ?? 0)
    if (attr === 0) productLevelNodes.push(node)
    else if (Number.isFinite(qty)) sumVariants += qty
  }

  if (productLevelNodes.length === 0) return true

  // Zero all product-level stock entries when product has combinations.
  for (const node of productLevelNodes) {
    const sid = Number(node?.id ?? node?.['@_id'] ?? 0)
    if (!Number.isFinite(sid)) continue
    const shopId = Number(node?.id_shop ?? node?.['id_shop'] ?? 1) || 1
    const shopGroupId = Number(node?.id_shop_group ?? node?.['id_shop_group'] ?? 1) || 1
    const putXml = `<?xml version="1.0" encoding="UTF-8"?>\n<prestashop>\n  <stock_available>\n    <id>${sid}</id>\n    <id_product>${idProduct}</id_product>\n    <id_product_attribute>0</id_product_attribute>\n    <id_shop>${shopId}</id_shop>\n    <id_shop_group>${shopGroupId}</id_shop_group>\n    <quantity>0</quantity>\n    <depends_on_stock>0</depends_on_stock>\n    <out_of_stock>2</out_of_stock>\n  </stock_available>\n</prestashop>\n`

    // Try a few times with backoff if the PUT fails
    let attempt = 0
    let success = false
    while (attempt < 3 && !success) {
      attempt += 1
      try {
        const putRes = await wsRequest(config, { method: 'PUT', path: `stock_availables/${sid}`, xmlBody: putXml })
        if (putRes.ok) {
          success = true
          break
        }
        // if server rejected, wait and retry
      } catch (e) {
        // continue to retry
      }
      // backoff
      await new Promise((r) => setTimeout(r, 300 * attempt))
    }

    if (!success) {
      console.warn(`Impossible de mettre a zero stock produit ${idProduct} (sid=${sid}) apres ${attempt} tentatives.`)
      return false
    }
  }

  return true
}

export async function createCodOrder(
  config: WsConfig,
  customer: CheckoutCustomer,
  items: CartItem[],
  options?: CreateCodOrderOptions,
) {
  if (items.length === 0) throw new Error('Panier vide.')

  const forcedCustomerId = Number(options?.existingCustomerId)
  const customerId = Number.isFinite(forcedCustomerId) && forcedCustomerId > 0
    ? forcedCustomerId
    : await ensureCustomer(config, customer)
  if (!customerId) throw new Error('Impossible de creer le client.')

  const countryId = await getActiveCountryId(config)
  const addressId = await createAddress(config, customerId, customer, countryId)
  if (!addressId) throw new Error('Impossible de creer l adresse.')

  const currencyId = await getFirstId(config, 'currencies')
  const langId = await getFirstId(config, 'languages')
  const carrierId = await getFirstId(config, 'carriers')
  const orderState = await resolveOrderState(config)
  const secureKey = await getCustomerSecureKey(config, customerId)
  if (!secureKey) throw new Error('Impossible d\'obtenir secure_key client; mise a jour secure_key a echoue.')

  const cartRows = formatCartRows(items)
  // Ensure product-level stock entries are zeroed before creating cart when product has combinations
  const productIds = Array.from(new Set(items.map((it) => it.id)))
  for (const pid of productIds) {
    try {
      // try up to 3 times
      let ok = false
      for (let a = 0; a < 3 && !ok; a++) {
        try {
          ok = await syncProductLevelStock(config, pid)
        } catch (e) {
          ok = false
        }
        if (!ok) await new Promise((r) => setTimeout(r, 200 * (a + 1)))
      }
      if (!ok) {
        console.warn(`Impossible de garantir stock produit-level a zero pour produit ${pid}`)
        // continue without failing the order
      }
    } catch (e) {
      console.warn('Erreur lors tentative zero product-level', e)
      // continue without failing the order
    }
  }
  const cartXml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop>
  <cart>
    <id_currency>${currencyId}</id_currency>
    <id_lang>${langId}</id_lang>
    <id_address_delivery>${addressId}</id_address_delivery>
    <id_address_invoice>${addressId}</id_address_invoice>
    <id_customer>${customerId}</id_customer>
    <id_carrier>${carrierId}</id_carrier>
    <associations>
      <cart_rows>
        ${cartRows}
      </cart_rows>
    </associations>
  </cart>
</prestashop>
`

  // capture initial stock totals per item to detect automatic stock changes by PrestaShop
  const initialStockMap = new Map<string, number>()
  for (const row of items) {
    const key = `${row.id}:${row.combinationId ?? 0}`
    if (!initialStockMap.has(key)) {
      // capture total stock for the whole product (all attributes) to detect global decreases
      const total = await getTotalStock(config, row.id)
      initialStockMap.set(key, total)
    }
  }

  const cartRes = await wsRequest(config, {
    method: 'POST',
    path: 'carts',
    xmlBody: cartXml,
  })

  if (!cartRes.ok) throw new Error(`Echec creation panier (HTTP ${cartRes.status}). Response: ${cartRes.xml}`)

  const cartId = extractCreatedId(cartRes.xml, 'cart')
  const totals = calcTotals(items)
  const orderRows = formatOrderRows(items)

  const orderXml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop>
  <order>
    <id_address_delivery>${addressId}</id_address_delivery>
    <id_address_invoice>${addressId}</id_address_invoice>
    <id_cart>${cartId}</id_cart>
    <id_currency>${currencyId}</id_currency>
    <id_lang>${langId}</id_lang>
    <id_customer>${customerId}</id_customer>
    <id_carrier>${carrierId}</id_carrier>
    <current_state>${orderState.id}</current_state>
    <module>${orderState.moduleName || 'ps_cashondelivery'}</module>
    <payment>Paiement a la livraison</payment>
    ${secureKey ? `<secure_key>${secureKey}</secure_key>` : ''}
    <total_paid>${totals.totalTtc}</total_paid>
    <total_paid_tax_incl>${totals.totalTtc}</total_paid_tax_incl>
    <total_paid_tax_excl>${totals.totalHt}</total_paid_tax_excl>
    <total_paid_real>${totals.totalTtc}</total_paid_real>
    <total_products>${totals.totalHt}</total_products>
    <total_products_wt>${totals.totalTtc}</total_products_wt>
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
        ${orderRows}
      </order_rows>
    </associations>
  </order>
</prestashop>
`

  const orderRes = await wsRequest(config, {
    method: 'POST',
    path: 'orders',
    xmlBody: orderXml,
  })

  if (!orderRes.ok) throw new Error(`Echec creation commande (HTTP ${orderRes.status}). Response: ${orderRes.xml}`)

  const orderId = extractCreatedId(orderRes.xml, 'order')
  // After order creation, check actual stock change and apply only remaining decrement if needed
  const processedKeys = new Set<string>()
  for (const row of items) {
    const key = `${row.id}:${row.combinationId ?? 0}`
    if (processedKeys.has(key)) continue
    processedKeys.add(key)
    const initial = initialStockMap.get(key) ?? 0
    // read total after order for whole product
    const after = await getTotalStock(config, row.id)
    const actualDecreased = Math.max(0, initial - after)
    // compute total requested decrease for this key
    const requested = items.filter((it) => `${it.id}:${it.combinationId ?? 0}` === key).reduce((s, it) => s + it.qty, 0)
    const missing = Math.max(0, requested - actualDecreased)
    if (missing > 0) {
      try {
        await decrementStockAvailable(config, row.id, row.combinationId ?? 0, missing)
      } catch (e) {
        // ignore
      }
    }
  }

  // Ensure product-level stock reflects variant totals to avoid double-decrement side-effects
  const synced = new Set<number>()
  for (const row of items) {
    const pid = row.id
    if (synced.has(pid)) continue
    synced.add(pid)
    // Try multiple times to override any automatic adjustments
    let ok = false
    for (let a = 0; a < 5 && !ok; a++) {
      try {
        ok = await syncProductLevelStock(config, pid)
      } catch (e) {
        ok = false
      }
      if (!ok) await new Promise((r) => setTimeout(r, 200 * (a + 1)))
    }
    if (!ok) {
      console.warn(`Echec synchronisation stock produit ${pid} apres commande.`)
      // do not throw; best-effort only
    }
  }

  return { orderId, cartId }
}
