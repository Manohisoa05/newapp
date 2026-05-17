import type { CartItem } from './cartSlice'

const STORAGE_KEY = 'newapp.cart.v1'

type StoredCart = {
  items: CartItem[]
}

export function loadCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as StoredCart
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) return []
    return parsed.items
  } catch {
    return []
  }
}

export function saveCart(items: CartItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ items }))
}

export function clearCartStorage() {
  localStorage.removeItem(STORAGE_KEY)
}
