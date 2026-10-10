import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The main-process locale table (src/main/index.ts) is an inline object handed
 * to createI18n, so it cannot be imported to assert on it — the values are read
 * out of the source instead, the same way home-duplicate-atomic.test.ts does.
 *
 * What is pinned here is a real bug that shipped: the pt block carried the
 * Spanish "Archivos de texto" instead of the Portuguese "Arquivos de texto", so
 * Portuguese users saw a Spanish dialog filter. The two words differ by one
 * letter, which is why a check that only compares key sets never caught it.
 */
const source = readFileSync(join(__dirname, '../src/main/index.ts'), 'utf8')

/** One locale's slice of the table, from its `xx: {` header to the next one. */
function localeBlock(locale: string): string {
  const start = source.search(new RegExp(`\\n {2}${locale}: \\{`))
  if (start < 0) throw new Error(`no ${locale} block in the main-process locale table`)
  const rest = source.slice(start + 1)
  const end = rest.search(/\n {2}\S+: \{/)
  return end < 0 ? rest : rest.slice(0, end)
}

function filterMarkdownIn(locale: string): string {
  const value = localeBlock(locale).match(/filterMarkdown: '([^']*)'/)?.[1]
  if (value === undefined) throw new Error(`no filterMarkdown in the ${locale} block`)
  return value
}

describe('the text-file dialog filter', () => {
  it('is Portuguese in the pt block', () => {
    expect(filterMarkdownIn('pt')).toBe('Arquivos de texto (Markdown, TXT, JSON)')
  })

  it('is still Spanish in the es block', () => {
    // the es string is correct there; fixing pt must not "fix" es as well
    expect(filterMarkdownIn('es')).toBe('Archivos de texto (Markdown, TXT, JSON)')
  })
})

/**
 * The app's File > New label. The dropped upstream rename left the branding
 * residue "AI Markdown" in every locale; the maintainers' call (2026-10) is
 * 「MD文档」 in zh and the neutral format name elsewhere — no locale may
 * reintroduce the stale "AI " prefix.
 */
describe('the File > New menu label', () => {
  it('reads MD文档 in zh and Markdown in every other locale', () => {
    const labels = [...source.matchAll(/menuNewMarkdown: '([^']*)'/g)].map((match) => match[1])
    expect(labels.length).toBeGreaterThanOrEqual(19)
    expect(new Set(labels)).toEqual(new Set(['MD文档', 'Markdown']))
    // zh is the first block of the table
    expect(labels[0]).toBe('MD文档')
  })
})
