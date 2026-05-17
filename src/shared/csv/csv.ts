export type CsvParseResult = {
  headers: string[]
  rows: Array<Record<string, string>>
}

function detectDelimiter(sampleLine: string): ',' | ';' | '\t' {
  const comma = (sampleLine.match(/,/g) ?? []).length
  const semicolon = (sampleLine.match(/;/g) ?? []).length
  const tab = (sampleLine.match(/\t/g) ?? []).length

  if (tab >= comma && tab >= semicolon) return '\t'
  if (semicolon >= comma) return ';'
  return ','
}

function parseLine(line: string, delimiter: string): string[] {
  const out: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]

    if (inQuotes) {
      if (ch === '"') {
        const next = line[i + 1]
        if (next === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
      continue
    }

    if (ch === '"') {
      inQuotes = true
      continue
    }

    if (ch === delimiter) {
      out.push(current)
      current = ''
      continue
    }

    current += ch
  }

  out.push(current)
  return out
}

export function parseCsv(text: string): CsvParseResult {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length === 0) return { headers: [], rows: [] }

  const delimiter = detectDelimiter(lines[0])
  const rawHeaders = parseLine(lines[0], delimiter).map((h) => h.trim())
  const headers = rawHeaders.filter((h) => h.length > 0)

  const rows: Array<Record<string, string>> = []
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i], delimiter)
    const row: Record<string, string> = {}

    for (let c = 0; c < headers.length; c++) {
      row[headers[c]] = (values[c] ?? '').trim()
    }

    // ignore fully empty rows
    if (Object.values(row).every((v) => v === '')) continue
    rows.push(row)
  }

  return { headers, rows }
}
