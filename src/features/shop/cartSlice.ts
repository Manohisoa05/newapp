import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { loadCart } from './cartStorage'

export type CartItem = {
  id: number
  name: string
  price: number
  reference: string
  qty: number
  combinationId?: number | null
}

type CartState = {
  items: CartItem[]
}

const initialState: CartState = {
  items: loadCart(),
}

const cartSlice = createSlice({
  name: 'cart',
  initialState,
  reducers: {
    addItem(state, action: PayloadAction<Omit<CartItem, 'qty'> & { qty?: number }>) {
      const qty = action.payload.qty ?? 1
      const existing = state.items.find((item) => item.id === action.payload.id && item.combinationId === (action.payload as any).combinationId)
      if (existing) {
        existing.qty += qty
        return
      }
      state.items.push({
        id: action.payload.id,
        name: action.payload.name,
        price: action.payload.price,
        reference: action.payload.reference,
        qty,
        combinationId: (action.payload as any).combinationId ?? null,
      })
    },
    updateQty(state, action: PayloadAction<{ id: number; qty: number }>) {
      const item = state.items.find((entry) => entry.id === action.payload.id)
      if (!item) return
      item.qty = Math.max(1, Math.floor(action.payload.qty))
    },
    removeItem(state, action: PayloadAction<number>) {
      state.items = state.items.filter((item) => item.id !== action.payload)
    },
    clearCart(state) {
      state.items = []
    },
  },
})

export const { addItem, updateQty, removeItem, clearCart } = cartSlice.actions
export const cartReducer = cartSlice.reducer
