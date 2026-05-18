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
    const generated = Array.from(bytes).map((b) => Number(b).toString(16).padStart(2, '0')).join('')

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

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop>
  <customer>
    <firstname>${customer.firstname}</firstname>
    <lastname>${customer.lastname}</lastname>
    <email>${customer.email}</email>
    <passwd>${Math.random().toString(36).slice(2, 12)}</passwd>
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
        `<tax_rate>0</tax_rate>` +
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

  // Ensure product-level stock reflects variant totals to avoid double-decrement side-effects
  return { orderId, cartId }
}
