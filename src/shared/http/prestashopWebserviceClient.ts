import type { XmlString } from '../xml/xml'

export type WsConfig = {
  shopBaseUrl: string // ex: http://localhost/eval
  wsKey: string
}

export type WsRequestOptions = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string // ex: 'products' or 'products/123'
  query?: Record<string, string | number | boolean | undefined>
  xmlBody?: XmlString
  signal?: AbortSignal
}

export type WsResponse = {
  status: number
  ok: boolean
  xml: XmlString
  headers: Headers
}

function detectShopBaseUrlFromLocation(): string {
  // Heuristic for same-origin deployments under PrestaShop admin folder.
  // Example: http://localhost/eval/admin123/newapp/  -> shop base = http://localhost/eval
  const origin = window.location.origin
  const path = window.location.pathname

  const adminMatch = path.match(/\/admin[^/]*\//)
  if (adminMatch?.index !== undefined) {
    const basePath = path.slice(0, adminMatch.index)
    return `${origin}${basePath}`
  }

  return origin
}

function normalizeBaseUrl(url: string) {
  return url.replace(/\/+$/, '')
}

function buildUrlWithBase(base: string, key: string, path: string, query?: WsRequestOptions['query']) {
  const url = base
    ? new URL(`${normalizeBaseUrl(base)}/api/${path.replace(/^\/+/, '')}`)
    : new URL(`/api/${path.replace(/^\/+/, '')}`, detectShopBaseUrlFromLocation())

  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue
      url.searchParams.set(k, String(v))
    }
  }

  // Fallback auth for servers that don't forward Authorization headers reliably.
  // PrestaShop Webservice accepts ws_key as query parameter.
  if (key && !url.searchParams.has('ws_key')) {
    url.searchParams.set('ws_key', key)
  }

  return url
}

function buildUrl(config: WsConfig, path: string, query?: WsRequestOptions['query']) {
  const rawBase = config.shopBaseUrl.trim()
  const normalizedKey = config.wsKey.trim()
  return buildUrlWithBase(rawBase, normalizedKey, path, query)
}

export async function wsRequest(config: WsConfig, options: WsRequestOptions): Promise<WsResponse> {
  const url = buildUrl(config, options.path, options.query)
  const normalizedKey = config.wsKey.trim()

  const headers = new Headers()
  headers.set('Accept', 'application/xml')

  if (options.xmlBody !== undefined) {
    headers.set('Content-Type', 'application/xml; charset=UTF-8')
  }

  // Webservice auth: HTTP Basic with key as username and empty password.
  // IMPORTANT: this exposes the key to the browser runtime (constraint: no custom backend).
  const basic = btoa(`${normalizedKey}:`)
  headers.set('Authorization', `Basic ${basic}`)

  let res: Response
  try {
    res = await fetch(url, {
      method: options.method,
      headers,
      body: options.xmlBody,
      signal: options.signal,
    })
  } catch (err) {
    const shopBase = config.shopBaseUrl.trim()
    const appOrigin = window.location.origin
    const isCrossOrigin = shopBase && !shopBase.startsWith(appOrigin)

    // Retry via Vite dev proxy when cross-origin fails.
    if (import.meta.env.DEV && isCrossOrigin) {
      try {
        const proxyUrl = buildUrlWithBase(appOrigin, normalizedKey, options.path, options.query)
        res = await fetch(proxyUrl, {
          method: options.method,
          headers,
          body: options.xmlBody,
          signal: options.signal,
        })
      } catch {
        const hint = ` Conseil: en dev Vite, utilise ${appOrigin} ou configure VITE_PS_SHOP_BASE_URL.`
        throw new Error(`Echec reseau vers l'API PrestaShop.${hint}`)
      }
    } else {
      const hint = isCrossOrigin
        ? ` Conseil: en dev Vite, mets l'URL boutique sur ${appOrigin} pour utiliser le proxy /api.`
        : ''
      throw new Error(`Echec reseau vers l'API PrestaShop.${hint}`)
    }
  }

  const xml = await res.text()

  return {
    status: res.status,
    ok: res.ok,
    xml,
    headers: res.headers,
  }
}
