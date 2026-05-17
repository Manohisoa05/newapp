import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppSelector } from '../../app/hooks'
import { wsRequest } from '../../shared/http/prestashopWebserviceClient'
import { parseXml } from '../../shared/xml/xml'
import { DEFAULT_WS_KEY } from '../../config/webservice'

type Customer = {
  id: number
  firstname: string
  lastname: string
  email: string
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

export default function UserSelectorPage() {
  const navigate = useNavigate()
  const reduxWsConfig = useAppSelector((s) => s.auth.wsConfig)
  const [shopUrl, setShopUrl] = useState(reduxWsConfig?.shopBaseUrl ?? '')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(!reduxWsConfig)

  async function loadCustomers(url: string) {
    setLoading(true)
    setError(null)
    setCustomers([])

    try {
      const config = { shopBaseUrl: url, wsKey: DEFAULT_WS_KEY }
      const response = await wsRequest(config, {
        method: 'GET',
        path: 'customers',
        query: {
          display: '[id,firstname,lastname,email]',
          limit: '1000',
        },
      })
      
      if (!response.ok) {
        console.error('WS Error Response:', response)
        setError(`Erreur API (HTTP ${response.status}): Vérifiez l'URL et la clé webservice.`)
        setLoading(false)
        return
      }

      const parsed = parseXml(response.xml)

      const customerList: Customer[] = []

      if (Array.isArray(parsed.customers?.customer)) {
        for (const customer of parsed.customers.customer) {
          const id = Number(nodeText(customer.id))
          const firstname = nodeText(customer.firstname)
          const lastname = nodeText(customer.lastname)
          const email = nodeText(customer.email)
          if (id > 0 && email) {
            customerList.push({ id, firstname, lastname, email })
          }
        }
      } else if (parsed.customers?.customer) {
        const customer = parsed.customers.customer
        const id = Number(nodeText(customer.id))
        const firstname = nodeText(customer.firstname)
        const lastname = nodeText(customer.lastname)
        const email = nodeText(customer.email)
        if (id > 0 && email) {
          customerList.push({ id, firstname, lastname, email })
        }
      }

      // Fallback: try prestashop wrapper
      if (customerList.length === 0 && parsed.prestashop?.customers?.customer) {
        const customerNode = parsed.prestashop.customers.customer
        const customers = Array.isArray(customerNode) ? customerNode : [customerNode]
        for (const customer of customers) {
          const id = Number(nodeText(customer.id))
          const firstname = nodeText(customer.firstname)
          const lastname = nodeText(customer.lastname)
          const email = nodeText(customer.email)
          if (id > 0 && email) {
            customerList.push({ id, firstname, lastname, email })
          }
        }
      }

      console.log('Customers found:', customerList.length)
      console.log('Response OK:', response.ok)
      console.log('Parsed result:', parsed)

      if (customerList.length === 0) {
        setError('Aucun utilisateur trouvé avec ces identifiants. Vérifiez l\'URL et la clé webservice.')
      } else {
        setCustomers(customerList.sort((a, b) => a.lastname.localeCompare(b.lastname)))
        setShowForm(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors du chargement des clients')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (reduxWsConfig && !showForm && customers.length === 0) {
      loadCustomers(reduxWsConfig.shopBaseUrl)
    }
  }, [reduxWsConfig, showForm])

  function handleSelectCustomer(email: string) {
    navigate('/front-login', { state: { prefilledEmail: email } })
  }

  function handleAnonymous() {
    // Utilisateur anonyme : on le redirige directement aux produits
    // (sans authentification, mais il peut quand même voir et acheter)
    navigate('/products')
  }

  function handleSubmitConfig(e: React.FormEvent) {
    e.preventDefault()
    if (!shopUrl.trim()) return
    loadCustomers(shopUrl.trim())
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#fff1d6,_#f6f7fb_45%,_#e7eefc_100%)] text-slate-900 font-['Space_Grotesk',ui-sans-serif,system-ui]">
      <div className="container mx-auto px-4 py-12">
        <div className="mb-10 text-center">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-900 text-amber-200 font-bold text-2xl">
            FO
          </div>
          <h1 className="mt-6 text-4xl font-bold tracking-tight">Bienvenue</h1>
          <p className="mt-3 text-lg text-slate-600">
            {showForm ? 'Configurez votre accès boutique' : 'Choisir un utilisateur'}
          </p>
        </div>

        {showForm ? (
          <div className="mx-auto max-w-lg">
            <form
              className="grid gap-5 rounded-2xl border border-white/70 bg-white/80 p-6 shadow-2xl"
              onSubmit={handleSubmitConfig}
            >
              <div>
                <label className="grid gap-2">
                  <span className="text-sm font-semibold text-slate-700">URL boutique</span>
                  <input
                    type="url"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    value={shopUrl}
                    onChange={(e) => setShopUrl(e.target.value)}
                    placeholder="http://localhost/eval"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    disabled={loading}
                  />
                </label>
              </div>

              {error ? (
                <div className="rounded-lg border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {error}
                </div>
              ) : null}

              <button
                type="submit"
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
                disabled={!shopUrl.trim() || loading}
              >
                {loading ? 'Chargement...' : 'Charger la liste des utilisateurs'}
              </button>

              <button
                type="button"
                onClick={handleAnonymous}
                className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-100"
              >
                Ou continuer en tant que client anonyme
              </button>
            </form>
          </div>
        ) : loading ? (
          <div className="flex justify-center items-center py-20">
            <div className="text-lg text-slate-600">Chargement des utilisateurs...</div>
          </div>
        ) : error ? (
          <div className="mx-auto max-w-lg rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800">
            <p className="font-semibold">Erreur</p>
            <p className="mt-2 text-sm">{error}</p>
            <div className="mt-4 max-h-64 overflow-auto bg-red-100 rounded p-2 text-xs font-mono text-red-900 border border-red-300">
              <p>Vérifiez la console du navigateur (F12) pour plus de détails.</p>
            </div>
            <button
              onClick={() => setShowForm(true)}
              className="mt-4 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800"
            >
              Réessayer
            </button>
          </div>
        ) : customers.length === 0 ? (
          <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white/80 p-6 text-center text-slate-600">
            <p>Aucun utilisateur trouvé</p>
            <button
              onClick={() => setShowForm(true)}
              className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Changer de configuration
            </button>
          </div>
        ) : (
          <div className="mx-auto grid max-w-4xl gap-3">
            {customers.map((customer) => (
              <button
                key={customer.id}
                onClick={() => handleSelectCustomer(customer.email)}
                className="group rounded-xl border border-slate-200 bg-white/80 px-6 py-4 text-left shadow-sm hover:border-amber-300 hover:bg-amber-50 hover:shadow-md transition-all"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-slate-900">
                      {customer.firstname} {customer.lastname}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">{customer.email}</p>
                  </div>
                  <svg
                    className="h-5 w-5 text-slate-400 group-hover:text-amber-600 transition-colors"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </div>
              </button>
            ))}

            <button
              onClick={() => setShowForm(true)}
              className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-white"
            >
              ← Changer de configuration
            </button>

            <button
              onClick={handleAnonymous}
              className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-100"
            >
              Continuer en tant que client anonyme
            </button>
          </div>
        )}

        {!showForm && customers.length > 0 && (
          <div className="mt-12 text-center">
            <p className="text-sm text-slate-600">
              Pas d'utilisateur sélectionné?{' '}
              <button
                onClick={() => navigate('/front-login')}
                className="font-semibold text-amber-600 hover:text-amber-700 underline"
              >
                Entrez vos identifiants directement
              </button>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
