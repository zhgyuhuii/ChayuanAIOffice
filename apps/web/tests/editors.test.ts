import { describe, expect, it } from 'vitest'
import { resolveEditors } from '../src/editors.js'

describe('resolveEditors', () => {
  it('falls back to the dev-server ports for all five editors', () => {
    const editors = resolveEditors()
    expect(editors.map((e) => e.key)).toEqual(['docs', 'sheets', 'slides', 'pdf', 'markdown'])
    expect(editors[0].url).toBe('http://localhost:5173')
    expect(editors[4].url).toBe('http://localhost:5177')
  })

  it('prefers injected production URLs per editor', () => {
    const editors = resolveEditors({ docs: '/editors/docs/', markdown: '/editors/markdown/' })
    expect(editors[0].url).toBe('/editors/docs/')
    expect(editors[4].url).toBe('/editors/markdown/')
    expect(editors[1].url).toBe('http://localhost:5174')
  })
})
