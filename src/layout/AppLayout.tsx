import type { PropsWithChildren } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../app/hooks'
import { clearAll } from '../features/auth/authSlice'

export function AppLayout({ children }: PropsWithChildren) {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const wsConfig = useAppSelector((s) => s.auth.wsConfig)

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 selection:bg-blue-200 selection:text-blue-900 font-sans">
      <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/90 backdrop-blur-lg">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 font-bold text-white shadow-lg">
              BO
            </div>
            <div>
              <div className="text-lg font-bold tracking-tight text-slate-900">Backoffice</div>
              <div className="text-xs font-medium text-slate-500">NewApp React</div>
            </div>
          </div>
          <nav className="flex items-center gap-3">
            <NavLink
              to="/backoffice"
              className={({ isActive }) =>
                [
                  'rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
                  isActive ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100',
                ].join(' ')
              }
            >
              Dashboard
            </NavLink>
            <NavLink
              to="/backoffice/reset"
              className={({ isActive }) =>
                [
                  'rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
                  isActive ? 'bg-rose-600 text-white' : 'text-slate-700 hover:bg-slate-100',
                ].join(' ')
              }
            >
              Reset
            </NavLink>
            <NavLink
              to="/backoffice/import"
              className={({ isActive }) =>
                [
                  'rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
                  isActive ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100',
                ].join(' ')
              }
            >
              Import
            </NavLink>
            <NavLink
              to="/"
              className={({ isActive }) =>
                [
                  'rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
                  isActive ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100',
                ].join(' ')
              }
            >
              Front Office
            </NavLink>
            <NavLink
              to="/backoffice/orders"
              className={({ isActive }) =>
                [
                  'rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
                  isActive ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100',
                ].join(' ')
              }
            >
              Commandes
            </NavLink>
            <NavLink
              to="/backoffice/stock"
              className={({ isActive }) =>
                [
                  'rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
                  isActive ? 'bg-emerald-600 text-white' : 'text-slate-700 hover:bg-slate-100',
                ].join(' ')
              }
            >
              Stock
            </NavLink>
            <NavLink
              to="/backoffice/stock-history"
              className={({ isActive }) =>
                [
                  'rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
                  isActive ? 'bg-emerald-600 text-white' : 'text-slate-700 hover:bg-slate-100',
                ].join(' ')
              }
            >
              Historique stock
            </NavLink>
            <div className="hidden items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 sm:flex">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500"></span>
              {wsConfig?.shopBaseUrl ? wsConfig.shopBaseUrl : 'Auto'}
            </div>
            <button
              type="button"
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800"
              onClick={() => {
                dispatch(clearAll())
                navigate('/login', { replace: true })
              }}
            >
              Deconnexion
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-6 py-10">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          {children}
        </div>
      </main>
    </div>
  )
}
