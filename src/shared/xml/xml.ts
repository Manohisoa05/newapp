import { XMLParser } from 'fast-xml-parser'

export type XmlString = string

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
  trimValues: true,
})

export function isProbablyXml(value: unknown): value is string {
  return typeof value === 'string' && value.trim().startsWith('<')
}

export function parseXml<T = unknown>(xml: XmlString): T {
  return parser.parse(xml) as T
}

export function validateXml(xml: XmlString): { ok: true } | { ok: false; error: string } {
  try {
    // Basic validation: parse + ensure we got an object.
    const parsed = parseXml<Record<string, unknown>>(xml)
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, error: 'XML parse returned empty result' }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
