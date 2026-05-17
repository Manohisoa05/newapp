import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth } from './features/auth/RequireAuth'
import { RequireFrontAuth } from './features/auth/RequireFrontAuth'
import { AppLayout } from './layout/AppLayout'
import { BackofficePage, ImportDataPage, LoginPage, OrdersPage, ResetDataPage, StockHistoryPage, StockPage } from './pages/backoffice'
import { CartPage, CheckoutPage, FrontLoginPage, HomePage, MyOrdersPage, ProductPage, UserSelectorPage } from './pages/frontoffice'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<UserSelectorPage />} />
      <Route
        path="/products"
        element={
          <RequireFrontAuth>
            <HomePage />
          </RequireFrontAuth>
        }
      />
      <Route
        path="/product/:id"
        element={
          <RequireFrontAuth>
            <ProductPage />
          </RequireFrontAuth>
        }
      />
      <Route
        path="/cart"
        element={
          <RequireFrontAuth>
            <CartPage />
          </RequireFrontAuth>
        }
      />
      <Route
        path="/checkout"
        element={
          <RequireFrontAuth>
            <CheckoutPage />
          </RequireFrontAuth>
        }
      />
      <Route
        path="/my-orders"
        element={
          <RequireFrontAuth>
            <MyOrdersPage />
          </RequireFrontAuth>
        }
      />
      <Route path="/front-login" element={<FrontLoginPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/backoffice"
        element={
          <RequireAuth>
            <AppLayout>
              <BackofficePage />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/backoffice/reset"
        element={
          <RequireAuth>
            <AppLayout>
              <ResetDataPage />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/backoffice/import"
        element={
          <RequireAuth>
            <AppLayout>
              <ImportDataPage />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/backoffice/orders"
        element={
          <RequireAuth>
            <AppLayout>
              <OrdersPage />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/backoffice/stock"
        element={
          <RequireAuth>
            <AppLayout>
              <StockPage />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/backoffice/stock-history"
        element={
          <RequireAuth>
            <AppLayout>
              <StockHistoryPage />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
