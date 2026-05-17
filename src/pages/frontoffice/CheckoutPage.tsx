import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../../app/hooks'
import { authService } from '../../features/auth/authService'
import { clearCart } from '../../features/shop/cartSlice'
import { createCodOrder, type CheckoutCustomer } from '../../features/shop/checkoutWebservice'

function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return value.toFixed(2)
}

export default function CheckoutPage() {
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const wsConfig = useAppSelector((s) => s.auth.wsConfig)
  const items = useAppSelector((s) => s.cart.items)
  const [connectedCustomerId, setConnectedCustomerId] = useState<number | null>(null)

  const [form, setForm] = useState<CheckoutCustomer>({
    firstname: '',
    lastname: '',
    email: '',
    address1: '',
    city: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [orderId, setOrderId] = useState<number | null>(null)

  const total = useMemo(() => items.reduce((sum, item) => sum + item.price * item.qty, 0), [items])

  useEffect(() => {
    const connectedCustomer = authService.getStoredCustomerUser()
    const id = Number(connectedCustomer?.id)
    setConnectedCustomerId(Number.isFinite(id) && id > 0 ? id : null)

    if (connectedCustomer) {
      setForm((prev) => ({
        ...prev,
        firstname: String(connectedCustomer.firstname ?? prev.firstname ?? ''),
        lastname: String(connectedCustomer.lastname ?? prev.lastname ?? ''),
        email: String(connectedCustomer.email ?? prev.email ?? ''),
      }))
    }
  }, [])

  async function handleSubmit() {
    if (!wsConfig) {
      setError('Cle webservice manquante. Ouvre le backoffice pour configurer l acces API.')
      return
    }

    if (!form.firstname || !form.lastname || !form.email || !form.address1 || !form.city) {
      setError('Merci de remplir tous les champs.')
      return
    }

    setBusy(true)
    setError(null)

    try {
      const result = await createCodOrder(wsConfig, form, items, {
        existingCustomerId: connectedCustomerId ?? undefined,
      })
      setOrderId(result.orderId)
      dispatch(clearCart())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setBusy(false)
    }
  }

  if (orderId) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#fff1d6,_#f6f7fb_45%,_#e7eefc_100%)] text-slate-900 font-['Space_Grotesk',ui-sans-serif,system-ui]">
        <header className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-lg font-bold text-amber-200 shadow-lg">
              FO
            </div>
            <div>
              <div className="text-lg font-bold tracking-tight">Commande validee</div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Boutique</div>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm font-semibold">
            <Link className="rounded-full border border-slate-300 px-4 py-2 text-slate-700 transition-colors hover:bg-white" to="/products">
              Retour accueil
            </Link>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl px-6 pb-16">
          <section className="rounded-[32px] border border-white/70 bg-white/80 p-8 shadow-xl backdrop-blur">
            <h1 className="text-3xl font-bold text-slate-900">Merci pour votre commande</h1>
            <p className="mt-2 text-sm text-slate-600">
              Votre commande a ete enregistree. Paiement a la livraison uniquement.
            </p>
            <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
              Numero de commande: <strong>{orderId}</strong>
            </div>
            <button
              type="button"
              className="mt-6 rounded-2xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-900/20"
              onClick={() => navigate('/products')}
            >
              Continuer
            </button>
          </section>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#fff1d6,_#f6f7fb_45%,_#e7eefc_100%)] text-slate-900 font-['Space_Grotesk',ui-sans-serif,system-ui]">
      <header className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-lg font-bold text-amber-200 shadow-lg">
            FO
          </div>
          <div>
            <div className="text-lg font-bold tracking-tight">Validation commande</div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Boutique</div>
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm font-semibold">
          <Link className="rounded-full border border-slate-300 px-4 py-2 text-slate-700 transition-colors hover:bg-white" to="/cart">
            Retour panier
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-6 pb-16">
        <section className="grid gap-8 rounded-[32px] border border-white/70 bg-white/80 p-8 shadow-xl backdrop-blur lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">Informations client</h1>
              <p className="text-sm text-slate-600">Paiement a la livraison uniquement. Livraison gratuite.</p>
            </div>

            <div className="grid gap-4">
              <div className="grid gap-2">
                <label className="text-sm font-semibold text-slate-700">Prenom</label>
                <input
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm"
                  value={form.firstname}
                  onChange={(e) => setForm({ ...form, firstname: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-semibold text-slate-700">Nom</label>
                <input
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm"
                  value={form.lastname}
                  onChange={(e) => setForm({ ...form, lastname: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-semibold text-slate-700">Email</label>
                <input
                  type="email"
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  readOnly={connectedCustomerId !== null}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-semibold text-slate-700">Adresse</label>
                <input
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm"
                  value={form.address1}
                  onChange={(e) => setForm({ ...form, address1: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-semibold text-slate-700">Ville</label>
                <input
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                />
              </div>
            </div>

            {error ? (
              <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            ) : null}
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl border border-slate-200/70 bg-white p-6 shadow-lg shadow-slate-900/5">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Recapitulatif</div>
              <div className="mt-4 grid gap-2 text-sm text-slate-600">
                {items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between">
                    <span>
                      {item.name} x{item.qty}
                    </span>
                    <span className="font-semibold text-slate-700">{formatPrice(item.price * item.qty)}</span>
                  </div>
                ))}
                {items.length === 0 ? <div>Panier vide.</div> : null}
              </div>
              <div className="mt-4 flex items-center justify-between text-sm font-semibold text-slate-900">
                <span>Total</span>
                <span>{formatPrice(total)}</span>
              </div>
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
                Paiement a la livraison uniquement. Livraison gratuite.
              </div>
              <button
                type="button"
                disabled={busy || items.length === 0}
                onClick={handleSubmit}
                className="mt-5 w-full rounded-2xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-900/20 disabled:opacity-50"
              >
                {busy ? 'Validation...' : 'Valider la commande'}
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
