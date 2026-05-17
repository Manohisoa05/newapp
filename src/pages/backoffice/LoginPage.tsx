import { useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../../app/hooks'
import { setBackofficeLoggedIn, setWsConfig } from '../../features/auth/authSlice'
import type { WsConfig } from '../../shared/http/prestashopWebserviceClient'
import { authService } from '../../features/auth/authService'
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

export default function LoginPage() {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const current = useAppSelector((s) => s.auth.wsConfig)
  const backofficeLoggedIn = useAppSelector((s) => s.auth.backofficeLoggedIn)

  const [shopUrl, setShopUrl] = useState(current?.shopBaseUrl ?? suggestShopBaseUrl())
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const canSubmit = useMemo(() => {
    return email.trim().length > 0 && password.trim().length > 0
  }, [email, password])

  if (current && backofficeLoggedIn) return <Navigate to="/backoffice" replace />

  async function handleSubmit(config: WsConfig) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await authService.loginAdmin(config, email.trim(), password)
      dispatch(setWsConfig(config))
      dispatch(setBackofficeLoggedIn(true))
      navigate('/backoffice', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
      <div className="w-full max-w-lg">
        <div className="mb-8">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-400 text-slate-900 font-bold">
            BO
          </div>
          <h1 className="mt-5 text-3xl font-bold tracking-tight">Backoffice Login</h1>
          <p className="mt-2 text-sm text-slate-400">
            Auth only. PrestaShop API stays on the client.
          </p>
        </div>

        <form
          className="grid gap-5 rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-2xl"
          onSubmit={(e) => {
            e.preventDefault()
            if (!canSubmit || busy) return
            handleSubmit({ shopBaseUrl: shopUrl.trim(), wsKey: DEFAULT_WS_KEY })
          }}
        >
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-slate-200">URL boutique</span>
            <input
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
              value={shopUrl}
              onChange={(e) => setShopUrl(e.target.value)}
              placeholder="http://localhost/eval"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={busy}
            />
            <span className="text-xs text-slate-500">Use shop base URL. Leave empty to auto-detect.</span>
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-semibold text-slate-200">Email admin </span>
            <input
              type="email"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@exemple.com"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={busy}
            />
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-semibold text-slate-200">Mot de passe </span>
            <input
              type="password"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
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

          {error ? (
            <div className="rounded-lg border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          {notice ? (
            <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              {notice}
            </div>
          ) : null}

          <button
            type="submit"
            className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-900 transition-colors hover:bg-emerald-300 disabled:opacity-60"
            disabled={!canSubmit || busy}
          >
            {busy ? 'Connexion...' : 'Se connecter'}
          </button>
        </form>
      </div>
    </div>
  )
}
