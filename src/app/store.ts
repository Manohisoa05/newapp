import { configureStore } from '@reduxjs/toolkit'
import { authReducer } from '../features/auth/authSlice'
import { cartReducer } from '../features/shop/cartSlice'
import { saveCart } from '../features/shop/cartStorage'

export const store = configureStore({
  reducer: {
    auth: authReducer,
    cart: cartReducer,
  },
})

store.subscribe(() => {
  const state = store.getState()
  saveCart(state.cart.items)
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
