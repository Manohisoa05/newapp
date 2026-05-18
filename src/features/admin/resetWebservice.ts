import type { WsConfig } from '../../shared/http/prestashopWebserviceClient'
import { wsRequest } from '../../shared/http/prestashopWebserviceClient'
import { extractIdsFromList } from '../../shared/http/prestashopResources'
import { parseXml } from '../../shared/xml/xml'

export type ResetTarget =
  | 'products'
  | 'categories'
  | 'customers'
  | 'orders'
  | 'manufacturers'
  | 'product_options'
  | 'product_option_values'
  | 'combinations'
  | 'stock_availables'
  | 'addresses'
  | 'carts'
  | 'order_histories'

const RESOURCE_META: Record<ResetTarget, { listKey: string; itemKey: string }> = {
  products: { listKey: 'products', itemKey: 'product' },
  categories: { listKey: 'categories', itemKey: 'category' },
  customers: { listKey: 'customers', itemKey: 'customer' },
  orders: { listKey: 'orders', itemKey: 'order' },
  manufacturers: { listKey: 'manufacturers', itemKey: 'manufacturer' },
  product_options: { listKey: 'product_options', itemKey: 'product_option' },
  product_option_values: { listKey: 'product_option_values', itemKey: 'product_option_value' },
  combinations: { listKey: 'combinations', itemKey: 'combination' },
  stock_availables: { listKey: 'stock_availables', itemKey: 'stock_available' },
  addresses: { listKey: 'addresses', itemKey: 'address' },
  carts: { listKey: 'carts', itemKey: 'cart' },
  order_histories: { listKey: 'order_histories', itemKey: 'order_history' },
}

type StockAvailableRow = {
  id: number
  idProduct: number
  idProductAttribute: number
  idShop: number
  idShopGroup: number
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

function parseStockAvailables(xml: string): StockAvailableRow[] {
  const parsed = parseXml<any>(xml)
  const container = parsed?.prestashop?.stock_availables?.stock_available
  const rows = toArray(container)
  const out: StockAvailableRow[] = []

  for (const row of rows) {
    const id = Number(nodeText(row?.id ?? row?.['@_id']))
    const idProduct = Number(nodeText(row?.id_product))
    const idProductAttribute = Number(nodeText(row?.id_product_attribute))
    const idShop = Number(nodeText(row?.id_shop))
    const idShopGroup = Number(nodeText(row?.id_shop_group))
    if (!Number.isFinite(id)) continue
    out.push({
      id,
      idProduct: Number.isFinite(idProduct) ? idProduct : 0,
      idProductAttribute: Number.isFinite(idProductAttribute) ? idProductAttribute : 0,
      idShop: Number.isFinite(idShop) ? idShop : 1,
      idShopGroup: Number.isFinite(idShopGroup) ? idShopGroup : 1,
    })
  }

  return out
}

export async function deleteAllForResource(
  config: WsConfig,
  resource: ResetTarget,
  opts?: { limit?: number; force?: boolean },
) {
  const meta = RESOURCE_META[resource]
  opts = { ...opts, force: opts?.force ?? false } // Ensure force is defined

  // Note: PrestaShop WS typically supports `limit` as "offset,count".
  // We'll fetch from offset 0 each time to avoid skipping items while deleting.
  const pageSize = 100
  const concurrency = 6
  const maxToDelete = Math.max(1, Math.min(opts?.limit ?? 200, 5000))

  let deleted = 0
  let failed = 0
  let loops = 0

  async function runWithConcurrency(ids: number[], worker: (id: number) => Promise<void>) {
    let cursor = 0
    const runners = Array.from({ length: Math.min(concurrency, ids.length) }, async () => {
      while (cursor < ids.length) {
        const id = ids[cursor]
        cursor += 1
        await worker(id)
      }
    })
    await Promise.all(runners)
  }

  async function runWithConcurrencyItems<T>(items: T[], worker: (item: T) => Promise<void>) {
    let cursor = 0
    const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const item = items[cursor]
        cursor += 1
        await worker(item)
      }
    })
    await Promise.all(runners)
  }

  async function deleteOne(id: number): Promise<boolean> {
    let didDelete = false

    const delRes = await wsRequest(config, {
      method: 'DELETE',
      path: `${resource}/${id}`,
    })

    // Some setups may return 200/204; keep it simple.
    if (!delRes.ok) {
      // Capture server response XML if available for diagnostics
      const serverXml = delRes.xml ?? ''
      // Some resources (eg. stock_availables) may not allow DELETE (HTTP 405).
      // Try fallback: for stock_availables, set quantity to 0 via PUT.
      if (delRes.status === 405 && resource === 'stock_availables') {
        // Try to GET the full resource, set quantity to 0 and PUT it back
        const getRes = await wsRequest(config, { method: 'GET', path: `${resource}/${id}` })
        if (getRes.ok && typeof getRes.xml === 'string') {
          let finalXml = getRes.xml

          // replace or insert <quantity>
          if (/<quantity>[\s\S]*?<\/quantity>/i.test(finalXml)) {
            finalXml = finalXml.replace(/<quantity>[\s\S]*?<\/quantity>/i, `<quantity>0</quantity>`)
          } else {
            finalXml = finalXml.replace(/<\/stock_available>/i, `  <quantity>0</quantity>\n</stock_available>`)
          }

          // helper to read tag value
          const readTag = (xml: string, tag: string) => {
            const m = xml.match(new RegExp(`<${tag}>([\s\S]*?)<\/${tag}>`, 'i'))
            return m ? m[1] : null
          }

          const defaults: Record<string, string> = {
            id_product: readTag(finalXml, 'id_product') ?? '0',
            id_product_attribute: readTag(finalXml, 'id_product_attribute') ?? '0',
            id_shop: readTag(finalXml, 'id_shop') ?? '1',
            id_shop_group: readTag(finalXml, 'id_shop_group') ?? '1',
          }

          // ensure required tags exist
          for (const [tag, val] of Object.entries(defaults)) {
            if (!new RegExp(`<${tag}>[\s\S]*?<\/${tag}>`, 'i').test(finalXml)) {
              finalXml = finalXml.replace(/<\/stock_available>/i, `  <${tag}>${val}<\/${tag}>\n</stock_available>`)
            }
          }

          // perform PUT
          const putRes = await wsRequest(config, { method: 'PUT', path: `${resource}/${id}`, xmlBody: finalXml })
          if (!putRes.ok) {
            const putXml = putRes.xml ?? ''

            // Final fallback: attempt to delete parent combination or product
            const tryParentDeletion = async () => {
              try {
                // read parent ids from GET XML
                const mProd = getRes.xml.match(/<id_product>([\s\S]*?)<\/id_product>/i)
                const mAttr = getRes.xml.match(/<id_product_attribute>([\s\S]*?)<\/id_product_attribute>/i)
                const idProduct = mProd ? mProd[1] : null
                const idAttr = mAttr ? mAttr[1] : null

                if (idAttr && idAttr !== '0') {
                  const delCombo = await wsRequest(config, { method: 'DELETE', path: `combinations/${idAttr}` })
                  if (delCombo.ok) return { deletedType: 'combination', id: idAttr }
                }

                if (idProduct && idProduct !== '0') {
                  const delProd = await wsRequest(config, { method: 'DELETE', path: `products/${idProduct}` })
                  if (delProd.ok) return { deletedType: 'product', id: idProduct }
                }
              } catch {
                // ignore and return null
              }
              return null
            }

            const parentResult = await tryParentDeletion()
            if (parentResult) {
              console.warn(
                `Fallback parent deletion succeeded for ${resource}/${id}: removed ${parentResult.deletedType}/${parentResult.id}`,
              )
              didDelete = true
              return didDelete
            }

            if (opts?.force) {
              console.warn(
                `Delete ${resource}/${id} failed: HTTP ${delRes.status}; fallback PUT failed: HTTP ${putRes.status}; GET-xml: ${getRes.xml}; PUT-xml: ${putXml}`,
              )
            } else {
              throw new Error(
                `Delete ${resource}/${id} failed: HTTP ${delRes.status}; fallback PUT failed: HTTP ${putRes.status}; GET-xml: ${getRes.xml}; PUT-xml: ${putXml}`,
              )
            }
          }
          didDelete = true
          return didDelete
        }

        // GET failed; build minimal XML with typical required fields
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<prestashop>\n  <stock_available>\n    <id>${id}</id>\n    <id_product>0</id_product>\n    <id_product_attribute>0</id_product_attribute>\n    <id_shop>1</id_shop>\n    <id_shop_group>1</id_shop_group>\n    <quantity>0</quantity>\n  </stock_available>\n</prestashop>`
        const putRes = await wsRequest(config, { method: 'PUT', path: `${resource}/${id}`, xmlBody: xml })
        if (!putRes.ok) {
          const putXml = putRes.xml ?? ''
          const getXml = getRes.xml ?? ''
          if (opts?.force) {
            console.warn(
              `Delete ${resource}/${id} failed: HTTP ${delRes.status}; GET failed: HTTP ${getRes.status}; fallback minimal PUT failed: HTTP ${putRes.status}; GET-xml: ${getXml}; PUT-xml: ${putXml}`,
            )
          } else {
            throw new Error(
              `Delete ${resource}/${id} failed: HTTP ${delRes.status}; GET failed: HTTP ${getRes.status}; fallback minimal PUT failed: HTTP ${putRes.status}; GET-xml: ${getXml}; PUT-xml: ${putXml}`,
            )
          }
        } else {
          didDelete = true
          return didDelete
        }
      }

      // If product delete fails with 500, attempt to disable the product and retry
      if (delRes.status === 500 && resource === 'products') {
        try {
          const getRes = await wsRequest(config, { method: 'GET', path: `${resource}/${id}` })
          if (getRes.ok && typeof getRes.xml === 'string') {
            let prodXml = getRes.xml
            // ensure <active>0</active> exists
            if (/<active>[\s\S]*?<\/active>/i.test(prodXml)) {
              prodXml = prodXml.replace(/<active>[\s\S]*?<\/active>/i, `<active>0</active>`)
            } else {
              prodXml = prodXml.replace(/<\/product>/i, `  <active>0</active>\n</product>`)
            }

            const putRes = await wsRequest(config, { method: 'PUT', path: `${resource}/${id}`, xmlBody: prodXml })
            if (putRes.ok) {
              // retry delete
              const delRes2 = await wsRequest(config, { method: 'DELETE', path: `${resource}/${id}` })
              if (delRes2.ok) {
                didDelete = true
                return didDelete
              }
              if (opts?.force) {
                console.warn(`Retry delete ${resource}/${id} after deactivate failed: HTTP ${delRes2.status}`)
              } else {
                throw new Error(`Retry delete ${resource}/${id} after deactivate failed: HTTP ${delRes2.status}`)
              }
            } else if (opts?.force) {
              console.warn(`Deactivate product ${resource}/${id} failed: HTTP ${putRes.status}`)
            } else {
              throw new Error(`Deactivate product ${resource}/${id} failed: HTTP ${putRes.status}`)
            }
          } else if (opts?.force) {
            console.warn(`Fetch product ${resource}/${id} failed: HTTP ${getRes.status}`)
          } else {
            throw new Error(`Fetch product ${resource}/${id} failed: HTTP ${getRes.status}`)
          }
        } catch (e) {
          if (opts?.force) {
            console.warn(`Product deactivate fallback error for ${resource}/${id}: ${String(e)}; server-response: ${serverXml}`)
          } else {
            throw new Error(`${String(e)}; server-response: ${serverXml}`)
          }
        }
      }

      if (opts?.force) {
        console.warn(`Delete ${resource}/${id} failed: HTTP ${delRes.status}; server-response: ${serverXml}`)
      } else {
        throw new Error(`Delete ${resource}/${id} failed: HTTP ${delRes.status}; server-response: ${serverXml}`)
      }
    } else {
      didDelete = true
      return didDelete
    }

    return didDelete
  }

  while (deleted < maxToDelete && loops < 200) {
    loops += 1
    const listRes = await wsRequest(config, {
      method: 'GET',
      path: resource,
      query: {
        display: resource === 'stock_availables'
          ? '[id,id_product,id_product_attribute,id_shop,id_shop_group]'
          : '[id]',
        limit: `0,${pageSize}`,
      },
    })

    if (!listRes.ok) {
      throw new Error(`List ${resource} failed: HTTP ${listRes.status}`)
    }

    let loopDeleted = 0

    if (resource === 'stock_availables') {
      const rows = parseStockAvailables(listRes.xml)
      if (rows.length === 0) break

      const batch = rows.slice(0, Math.max(0, maxToDelete - deleted))
      await runWithConcurrencyItems(batch, async (row) => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<prestashop>\n  <stock_available>\n    <id>${row.id}</id>\n    <id_product>${row.idProduct}</id_product>\n    <id_product_attribute>${row.idProductAttribute}</id_product_attribute>\n    <id_shop>${row.idShop}</id_shop>\n    <id_shop_group>${row.idShopGroup}</id_shop_group>\n    <quantity>0</quantity>\n  </stock_available>\n</prestashop>`
        const putRes = await wsRequest(config, { method: 'PUT', path: `${resource}/${row.id}`, xmlBody: xml })
        if (putRes.ok) {
          deleted += 1
          loopDeleted += 1
        } else {
          failed += 1
          if (opts?.force) {
            console.warn(`Stock reset ${resource}/${row.id} failed: HTTP ${putRes.status}; server-response: ${putRes.xml}`)
          } else {
            throw new Error(`Stock reset ${resource}/${row.id} failed: HTTP ${putRes.status}; server-response: ${putRes.xml}`)
          }
        }
      })
    } else {
      const ids = extractIdsFromList(listRes.xml, meta.listKey, meta.itemKey)
      if (ids.length === 0) break

      const batch = ids.slice(0, Math.max(0, maxToDelete - deleted))
      await runWithConcurrency(batch, async (id) => {
        const didDelete = await deleteOne(id)
        if (didDelete) {
          deleted += 1
          loopDeleted += 1
        } else {
          failed += 1
        }
      })
    }

    if (loopDeleted === 0) {
      // Avoid long loops if nothing can be deleted in this pass.
      break
    }
  }

  return { deleted, failed }
}
