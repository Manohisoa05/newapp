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

function buildUrl(config: WsConfig, path: string, query?: WsRequestOptions['query']) {
  const rawBase = config.shopBaseUrl.trim()
  const normalizedKey = config.wsKey.trim()
  const url = rawBase
    ? new URL(`${normalizeBaseUrl(rawBase)}/api/${path.replace(/^\/+/, '')}`)
    : new URL(`/api/${path.replace(/^\/+/, '')}`, detectShopBaseUrlFromLocation())

  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue
      url.searchParams.set(k, String(v))
    }
  }

  // Fallback auth for servers that don't forward Authorization headers reliably.
  // PrestaShop Webservice accepts ws_key as query parameter.
  if (normalizedKey && !url.searchParams.has('ws_key')) {
    url.searchParams.set('ws_key', normalizedKey)
  }

  return url
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

  const res = await fetch(url, {
    method: options.method,
    headers,
    body: options.xmlBody,
    signal: options.signal,
  })

  const xml = await res.text()

  return {
    status: res.status,
    ok: res.ok,
    xml,
    headers: res.headers,
  }
}
