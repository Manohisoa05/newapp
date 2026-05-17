import type { WsConfig } from '../../shared/http/prestashopWebserviceClient'
import { DEFAULT_WS_KEY } from '../../config/webservice'

const STORAGE_KEY = 'newapp.wsConfig.v1'
const AUTH_KEY = 'newapp.auth.v1'

export type AuthFlags = {
  backofficeLoggedIn: boolean
  frontofficeLoggedIn: boolean
}

function loadEnvWsConfig(): WsConfig | null {
  try {
    const wsKey = DEFAULT_WS_KEY.trim()
    if (!wsKey) return null

    const shopBaseUrl = String(import.meta.env.VITE_PS_SHOP_BASE_URL ?? '').trim()
    return { wsKey, shopBaseUrl }
  } catch {
    return null
  }
}

export function loadWsConfig(): WsConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return loadEnvWsConfig()
    const parsed = JSON.parse(raw) as Partial<WsConfig>
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.wsKey !== 'string' || !parsed.wsKey.trim()) return null
    if (typeof parsed.shopBaseUrl !== 'string') return null
    return { shopBaseUrl: parsed.shopBaseUrl, wsKey: parsed.wsKey }
  } catch {
    return loadEnvWsConfig()
  }
}

export function saveWsConfig(config: WsConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}

export function clearWsConfig() {
  localStorage.removeItem(STORAGE_KEY)
}

export function loadAuthFlags(): AuthFlags {
  try {
    const raw = localStorage.getItem(AUTH_KEY)
    if (!raw) return { backofficeLoggedIn: false, frontofficeLoggedIn: false }
    const parsed = JSON.parse(raw) as Partial<AuthFlags>
    return {
      backofficeLoggedIn: Boolean(parsed.backofficeLoggedIn),
      frontofficeLoggedIn: Boolean(parsed.frontofficeLoggedIn),
    }
  } catch {
    return { backofficeLoggedIn: false, frontofficeLoggedIn: false }
  }
}

export function saveAuthFlags(flags: AuthFlags) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(flags))
}

export function clearAuthFlags() {
  localStorage.removeItem(AUTH_KEY)
}
