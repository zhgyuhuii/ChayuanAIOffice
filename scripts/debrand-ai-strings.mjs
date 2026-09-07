// One-shot codemod: debrand AI strings across locale blocks of strings files.
// Replaces or deletes (null) whole entries; handles single- and multi-line
// values. Usage:
//   node scripts/debrand-ai-strings.mjs scripts/debrand-ai-strings.json
// Config: { "<file>": { "<key>": { "<locale>": "<value>" | null } | null } }
//   key -> null            delete the entry in every locale
//   key -> { locale: ... } replace/delete only in listed locales
import { readFileSync, writeFileSync } from 'node:fs'

const config = JSON.parse(readFileSync(process.argv[2], 'utf8'))

const q = (v) => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

for (const [file, edits] of Object.entries(config)) {
  const lines = readFileSync(file, 'utf8').split('\n')
  const out = []
  let locale = null
  let touched = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const block = line.match(/^ {2}['"]?([a-zA-Z][\w-]*)['"]?: \{$/)
    if (block) locale = block[1]
    const key = Object.keys(edits).find((k) => new RegExp(`^\\s*${k}:`).test(line))
    if (!key) {
      out.push(line)
      continue
    }
    const spec = edits[key]
    const value = spec === null ? null : spec[locale]
    if (value === undefined) {
      out.push(line)
      continue
    }
    let end = i
    while (end < lines.length && !lines[end].trimEnd().endsWith(',')) end++
    i = end
    if (value !== null) out.push(`${line.match(/^\s*/)[0]}${key}: ${q(value)},`)
    touched++
  }
  writeFileSync(file, out.join('\n'))
  console.log(`${file}: ${touched} entries`)
}
