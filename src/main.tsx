import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { AppProviders } from './app/providers'

function normalizeLegacyHashUrl() {
  const { pathname, search, hash } = window.location

  // HashRouter expects routes in location.hash (e.g. /#/backoffice).
  // If the app is opened as /backoffice#/, move pathname into hash.
  if (pathname !== '/' && (hash === '#/' || hash === '#' || hash === '')) {
    const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`
    const target = `/#${normalizedPath}${search}`
    window.history.replaceState(null, '', target)
  }
}

normalizeLegacyHashUrl()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders>
      <HashRouter>
        <App />
      </HashRouter>
    </AppProviders>
  </StrictMode>,
)
