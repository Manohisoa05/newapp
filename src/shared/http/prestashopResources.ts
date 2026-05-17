import { parseXml } from '../xml/xml'
import type { XmlString } from '../xml/xml'

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function nodeText(value: any): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)

  if (typeof value === 'object') {
    // fast-xml-parser commonly uses '#text' for nodes with attributes.
    if (typeof value['#text'] === 'string' || typeof value['#text'] === 'number') return String(value['#text'])
    // Sometimes it can be stored under '' depending on parser options (fallback).
    if (typeof value[''] === 'string' || typeof value[''] === 'number') return String(value[''])
  }

  return ''
}

export function getFirstLanguageText(value: any): string {
  const lang = value?.language
  if (lang === undefined || lang === null) return nodeText(value)
  const first = Array.isArray(lang) ? lang[0] : lang
  return nodeText(first)
}

export function asBool01(value: any): boolean {
  const s = nodeText(value).trim()
  if (s === '1' || s.toLowerCase() === 'true') return true
  if (s === '0' || s.toLowerCase() === 'false') return false
  return Boolean(s)
}

export function extractItemsFromList<T>(
  xml: XmlString,
  listKey: string,
  itemKey: string,
  mapItem: (item: any) => T | null,
): T[] {
  const parsed = parseXml<any>(xml)
  const container = parsed?.prestashop?.[listKey]
  if (!container) return []

  const items = toArray(container[itemKey])
  const out: T[] = []

  for (const item of items) {
    const mapped = mapItem(item)
    if (mapped) out.push(mapped)
  }

  return out
}

/**
 * Extracts IDs from a standard PrestaShop Webservice list response.
 * Expected shape:
 * <prestashop><products><product id="1" .../></products></prestashop>
 */
export function extractIdsFromList(xml: XmlString, listKey: string, itemKey: string): number[] {
  const parsed = parseXml<any>(xml)
  const container = parsed?.prestashop?.[listKey]
  if (!container) return []

  const items = toArray(container[itemKey])
  const ids: number[] = []

  for (const item of items) {
    const raw = item?.['@_id'] ?? item?.id
    const n = Number(raw)
    if (Number.isFinite(n)) ids.push(n)
  }

  return ids
}
