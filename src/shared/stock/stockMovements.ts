export type StockMovement = {
  productId: number
  productAttributeId: number
  qty: number
  type: 'entree' | 'sortie'
  date: string
  source: 'manual' | 'delivery'
}

const STORAGE_KEY = 'newapp.stockMovements.v1'

function loadAll(): StockMovement[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as StockMovement[]) : []
  } catch {
    return []
  }
}

function saveAll(rows: StockMovement[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
}

export function addStockMovement(row: StockMovement) {
  const all = loadAll()
  all.push(row)
  saveAll(all)
}

export function getStockMovementsByProduct(productId: number): StockMovement[] {
  return loadAll().filter((row) => row.productId === productId)
}
