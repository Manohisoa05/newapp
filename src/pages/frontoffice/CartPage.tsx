import { Link, useNavigate } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../../app/hooks'
import { removeItem, updateQty } from '../../features/shop/cartSlice'

function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return value.toFixed(2)
}

export default function CartPage() {
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const items = useAppSelector((s) => s.cart.items)

  const total = items.reduce((sum, item) => sum + item.price * item.qty, 0)

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#fff1d6,_#f6f7fb_45%,_#e7eefc_100%)] text-slate-900 font-['Space_Grotesk',ui-sans-serif,system-ui]">
      <header className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-lg font-bold text-amber-200 shadow-lg">
            FO
          </div>
          <div>
            <div className="text-lg font-bold tracking-tight">Panier</div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Boutique</div>
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm font-semibold">
          <Link className="rounded-full border border-slate-300 px-4 py-2 text-slate-700 transition-colors hover:bg-white" to="/products">
            Continuer
          </Link>
          <Link
            className="rounded-full border border-slate-300 px-4 py-2 text-slate-700 transition-colors hover:bg-white"
            to="/login"
          >
            Backoffice
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-6 pb-16">
        <section className="rounded-[32px] border border-white/70 bg-white/80 p-8 shadow-xl backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">Votre panier</h1>
              <p className="text-sm text-slate-500">Paiement a la livraison, pas de frais de livraison.</p>
            </div>
            <div className="rounded-full bg-amber-100 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
              {items.length} articles
            </div>
          </div>

          <div className="mt-6 grid gap-4">
            {items.map((item) => (
              <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{item.name}</div>
                    <div className="text-xs text-slate-500">Ref {item.reference || item.id}</div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-sm font-semibold text-slate-700">{formatPrice(item.price)}</div>
                    <input
                      type="number"
                      min={1}
                      className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-sm"
                      value={item.qty}
                      onChange={(e) => dispatch(updateQty({ id: item.id, qty: Number(e.target.value) }))}
                    />
                    <button
                      className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-600"
                      onClick={() => dispatch(removeItem(item.id))}
                      type="button"
                    >
                      Supprimer
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500">
                Panier vide.
              </div>
            ) : null}
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
            <div className="text-xl font-bold text-slate-900">Total: {formatPrice(total)}</div>
            <button
              type="button"
              onClick={() => navigate('/checkout')}
              disabled={items.length === 0}
              className="rounded-2xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-900/20 disabled:opacity-50"
            >
              Valider la commande
            </button>
          </div>
        </section>
      </main>
    </div>
  )
}
