import { useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../../app/hooks'
import { setFrontofficeLoggedIn, setWsConfig } from '../../features/auth/authSlice'
import { authService } from '../../features/auth/authService'
import type { WsConfig } from '../../shared/http/prestashopWebserviceClient'
import { DEFAULT_WS_KEY } from '../../config/webservice'

function suggestShopBaseUrl(): string {
  const fromEnv = String(import.meta.env.VITE_PS_SHOP_BASE_URL ?? '').trim()
  if (fromEnv) return fromEnv

  const origin = window.location.origin
  const path = window.location.pathname
  const adminMatch = path.match(/\/admin[^/]*\//)
  if (adminMatch?.index !== undefined) {
    const basePath = path.slice(0, adminMatch.index)
    return `${origin}${basePath}`
  }

  return ''
}

export default function FrontLoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const dispatch = useAppDispatch()
  const wsConfig = useAppSelector((s) => s.auth.wsConfig)
  const [shopUrl, setShopUrl] = useState(wsConfig?.shopBaseUrl ?? suggestShopBaseUrl())

  const prefilledEmail = (location.state as any)?.prefilledEmail ?? ''
  const [email, setEmail] = useState(prefilledEmail)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = useMemo(() => {
    return email.trim().length > 0 && password.trim().length > 0
  }, [email, password])

  async function handleSubmit() {
    setBusy(true)
    setNotice(null)
    setError(null)

    try {
      const config: WsConfig = { shopBaseUrl: shopUrl.trim(), wsKey: DEFAULT_WS_KEY }
      await authService.loginCustomer(config, email.trim(), password)
      dispatch(setWsConfig(config))
      dispatch(setFrontofficeLoggedIn(true))
      navigate('/products', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#fff1d6,_#f6f7fb_45%,_#e7eefc_100%)] text-slate-900 font-['Space_Grotesk',ui-sans-serif,system-ui] flex items-center justify-center px-4">
      <div className="w-full max-w-lg">
        <div className="mb-8">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-amber-200 font-bold">
            FO
          </div>
          <h1 className="mt-5 text-3xl font-bold tracking-tight">Frontoffice Login</h1>
          <p className="mt-2 text-sm text-slate-600">
            Connexion locale (mot de passe accepte sans verification).
          </p>
        </div>

        <form
          className="grid gap-5 rounded-2xl border border-white/70 bg-white/80 p-6 shadow-2xl"
          onSubmit={(e) => {
            e.preventDefault()
            if (!canSubmit || busy) return
            handleSubmit()
          }}
        >
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-slate-700">URL boutique</span>
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={shopUrl}
              onChange={(e) => setShopUrl(e.target.value)}
              placeholder="http://localhost/eval"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={busy}
            />
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-semibold text-slate-700">Email</span>
            <input
              type="email"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="client@exemple.com"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={busy}
            />
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-semibold text-slate-700">Mot de passe</span>
            <input
              type="password"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mot de passe"
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={busy}
            />
          </label>

          {notice ? (
            <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              {notice}
            </div>
          ) : null}

          {error ? (
            <div className="rounded-lg border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
            disabled={!canSubmit || busy}
          >
            {busy ? 'Connexion...' : 'Se connecter'}
          </button>
        </form>
      </div>
    </div>
  )
}
