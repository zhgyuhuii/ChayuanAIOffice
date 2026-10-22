import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { FieldDisplay } from '@chaoffice/docx-engine'
import { renderFieldSpec } from '../src/renderer/editor/protected-render'

type Span = [string, Record<string, string>, string]

const leaderSpan = (field: FieldDisplay) => {
  const spec = renderFieldSpec(field) as unknown[]
  return spec.find(
    (c) => Array.isArray(c) && (c[1] as Record<string, string>).class?.startsWith('doc-toc-dots'),
  ) as Span
}

describe('TOC entry leader rendering', () => {
  const base: FieldDisplay = { kind: 'tocLine', left: 'Title', right: '3', level: 1 }

  it('draws the leader as repeated glyphs of the entry font, dots when the leader is unknown', () => {
    expect(leaderSpan(base)[2]).toBe('.'.repeat(220))
    expect(leaderSpan({ ...base, leader: 'dot' })[2]).toBe('.'.repeat(220))
    expect(leaderSpan({ ...base, leader: 'hyphen' })[2]).toBe('-'.repeat(220))
    expect(leaderSpan({ ...base, leader: 'underscore' })[2]).toBe('_'.repeat(220))
    expect(leaderSpan({ ...base, leader: 'middleDot' })[2]).toBe('\u00b7'.repeat(220))
  })

  it('a bare right tab leaves the gap empty, heavy is a bold underscore run', () => {
    const none = leaderSpan({ ...base, leader: 'none' })
    expect(none[2]).toBe('')
    expect(none[1].class).toBe('doc-toc-dots')
    const heavy = leaderSpan({ ...base, leader: 'heavy' })
    expect(heavy[2]).toBe('_'.repeat(220))
    expect(heavy[1].class).toBe('doc-toc-dots doc-toc-leader-heavy')
  })
})

describe('TOC entry line layout', () => {
  const css = readFileSync(join(__dirname, '../src/renderer/styles.css'), 'utf8')
  const block = (sel: string) =>
    new RegExp(sel.replace(/\./g, '\\.') + '\\s*\\{([^}]*)\\}').exec(css)?.[1] ?? ''

  it('a wrapped entry keeps the number on the first line and the leader + page on the last', () => {
    expect(block('.doc-toc-line')).toMatch(/align-items:\s*flex-end/)
    expect(block('.doc-toc-num')).toMatch(/align-self:\s*flex-start/)
  })
})
