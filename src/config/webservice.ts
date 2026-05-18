const ENV_WS_KEY = String(import.meta.env.VITE_PS_WS_KEY ?? '').trim()

// Keep a fallback to avoid breaking existing local setups without .env.
export const DEFAULT_WS_KEY = ENV_WS_KEY || 'T4RQ5B1M33TQ8RUYPGTK1DAFUZBIMSYK'
