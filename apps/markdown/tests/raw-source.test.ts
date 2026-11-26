import { describe, expect, it } from 'vitest'
import {
  isRawSourcePath,
  parseDocText,
  rawSourceEnvelope,
  rawSourceFileText,
} from '../src/renderer/markdown/docText'

describe('raw source mode (.txt/.json)', () => {
  it('routes exactly txt/json', () => {
    expect(isRawSourcePath('/a/data.json')).toBe(true)
    expect(isRawSourcePath('/a/notes.txt')).toBe(true)
    expect(isRawSourcePath('/a/notes.TXT')).toBe(true)
    expect(isRawSourcePath('/a/readme.md')).toBe(false)
    expect(isRawSourcePath('/a/data.json.bak')).toBe(false)
  })

  it('round-trips a JSON file byte-for-byte (BOM, CRLF, no trailing newline)', () => {
    const raw = '\uFEFF{\r\n  "a": 1\r\n}'
    const { envelope, text } = rawSourceEnvelope(raw)
    expect(envelope.frontmatter).toBe('')
    expect(envelope.bom).toBe(true)
    expect(envelope.eol).toBe('\r\n')
    expect(envelope.trailingNewline).toBe(false)
    expect(text).toBe('{\n  "a": 1\n}')
    expect(rawSourceFileText(envelope, text)).toBe(raw)
  })

  it('keeps a trailing newline and plain LF untouched', () => {
    const raw = '{\n  "b": 2\n}\n'
    const { envelope, text } = rawSourceEnvelope(raw)
    expect(envelope.eol).toBe('\n')
    expect(envelope.trailingNewline).toBe(true)
    expect(rawSourceFileText(envelope, text)).toBe(raw)
  })

  it('does not strip a leading fence as frontmatter in a .txt', () => {
    // the markdown envelope parser would take this for a frontmatter block and
    // the save would silently drop it — raw sources never enter that parser
    const raw = '```\nplain text that starts with a fence\n'
    const { envelope, text } = rawSourceEnvelope(raw)
    expect(envelope.frontmatter).toBe('')
    expect(text).toBe(raw)
    expect(rawSourceFileText(envelope, text)).toBe(raw)
  })

  it('edits in the pane write exactly the edited text', () => {
    const raw = '{\n  "a": 1\n}\n'
    const { envelope } = rawSourceEnvelope(raw)
    const edited = '{\n  "a": 2,\n  "b": 3\n}\n'
    expect(rawSourceFileText(envelope, edited)).toBe(edited)
  })

  it('the markdown envelope parser itself still handles its own files', () => {
    const envelope = parseDocText('---\ntitle: x\n---\n\nbody')
    // sanity only: markdown behavior is unchanged by the raw-source additions
    expect(envelope.body).toContain('body')
  })
})

describe('raw source mode at data-file scale', () => {
  it('normalizes and restores a 6.8 MB single-paragraph text in well under a second', () => {
    // the shape of the file that reported minutes-to-open: one huge JSON
    // object, no blank lines (a single marked paragraph token)
    const chunk = '{"key":"' + 'x'.repeat(120) + '","value":' + '1234567890,'.repeat(6) + '"t":"中文"}'
    const big = '{\n' + Array.from({ length: 50000 }, (_, i) => `"row${i}": ${chunk}`).join(',\n') + '\n}'
    expect(big.length).toBeGreaterThan(6_000_000)
    const t0 = performance.now()
    const { envelope, text } = rawSourceEnvelope(big)
    const round = rawSourceFileText(envelope, text)
    const ms = performance.now() - t0
    expect(round).toBe(big)
    // the parser path measured 89 s + 177 s on this input; the raw path must
    // stay linear and fast — 2 s leaves headroom for CI machines
    expect(ms).toBeLessThan(2000)
  })
})
