import type { XmlString } from './xml'

export function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/**
 * Replaces `{{column}}` placeholders with escaped values from the row.
 * Unknown columns are replaced with empty string.
 */
export function applyXmlTemplate(template: string, row: Record<string, string>): XmlString {
  return template.replace(/\{\{\s*([a-zA-Z0-9_\-.]+)\s*\}\}/g, (_m, key: string) => {
    const raw = row[key] ?? ''
    return escapeXml(String(raw))
  })
}
