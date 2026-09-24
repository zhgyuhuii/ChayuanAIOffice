// One-shot codemod: insert AI panel keys after an anchor key in every locale
// block of an app's i18n strings file. Keys and order come from the JSON's
// first locale entry; translations are per-locale. Usage:
//   node scripts/add-ai-tab-keys.mjs <target.ts> <json-translations> <anchorKey>
import { readFileSync, writeFileSync } from 'node:fs'

const [target, translationsFile, anchorKey = 'aiSummarizeBtn'] = process.argv.slice(2)
const translations = JSON.parse(readFileSync(translationsFile, 'utf8'))
const keyOrder = Object.keys(Object.values(translations)[0])

const lines = readFileSync(target, 'utf8').split('\n')
let locale = null
const out = []
for (const line of lines) {
  out.push(line)
  const block = line.match(/^ {2}['"]?([a-zA-Z][\w-]*)['"]?: \{$/)
  if (block) locale = block[1]
  if (locale && line.includes(`${anchorKey}:`) && translations[locale]) {
    const t = translations[locale]
    const indent = '    '
    const q = (v) => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
    for (const key of keyOrder) {
      if (!(key in t)) throw new Error(`locale ${locale} is missing key ${key}`)
      out.push(`${indent}${key}: ${q(t[key])},`)
    }
  }
}
writeFileSync(target, out.join('\n'))
console.log(`done: ${target} (${keyOrder.length} keys after ${anchorKey})`)
