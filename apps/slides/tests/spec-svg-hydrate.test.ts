/**
 * spec-svg-hydrate: writer-emitted inline SVGs are sanitized + rasterized with a
 * PNG fallback before the spec reaches the main-process build; failed ones drop
 * from the spec (page continues). Graphics-only rule: an SVG carrying <text>
 * rasterizes its words into an uneditable picture — rejected outright.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../src/renderer/ai/svg-raster', () => ({
  rasterizeSvg: vi.fn(),
}))
import { rasterizeSvg } from '../src/renderer/ai/svg-raster'
import { hydrateSpecSvg } from '../src/renderer/ai/spec-svg-hydrate'

const SVG_OK =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#1565C0"/></svg>'
const SVG_WITH_TEXT =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="10" y="50" font-family="Arial">牛气冲天</text><rect x="0" y="0" width="10" height="10"/></svg>'
const PNG_1PX_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const specWith = (elements: unknown[]): string =>
  JSON.stringify({ background: '#FFFFFF', elements })

beforeEach(() => {
  vi.mocked(rasterizeSvg).mockReset()
  vi.mocked(rasterizeSvg).mockResolvedValue({
    ok: true,
    base64: PNG_1PX_BASE64,
    width: 100,
    height: 100,
    paintRatio: 0.4,
  })
})

describe('hydrateSpecSvg', () => {
  it('rasterizes an inline SVG and attaches the PNG fallback', async () => {
    const r = await hydrateSpecSvg(
      specWith([{ type: 'image', svg: SVG_OK, x: 10, y: 10, w: 50, h: 50 }]),
    )
    expect(r.svgOk).toBe(1)
    expect(r.svgFailed).toBe(0)
    const out = JSON.parse(r.json) as { elements: Array<Record<string, unknown>> }
    expect(out.elements[0]!.pngDataUri).toBe(`data:image/png;base64,${PNG_1PX_BASE64}`)
  })

  it('rejects an SVG carrying <text> — words must land as text elements', async () => {
    const r = await hydrateSpecSvg(
      specWith([{ type: 'image', svg: SVG_WITH_TEXT, x: 10, y: 10, w: 50, h: 50 }]),
    )
    expect(r.svgFailed).toBe(1)
    expect(r.svgOk).toBe(0)
    expect(rasterizeSvg).not.toHaveBeenCalled()
    const out = JSON.parse(r.json) as { elements: unknown[] }
    expect(out.elements).toHaveLength(0)
  })

  it('keeps non-SVG elements untouched and drops broken SVGs', async () => {
    vi.mocked(rasterizeSvg).mockRejectedValue(new Error('decode fail'))
    const r = await hydrateSpecSvg(
      specWith([
        { type: 'text', x: 0, y: 0, w: 10, h: 10, paragraphs: [] },
        { type: 'image', svg: '<svg viewBox="0 0 10 10"></svg>', x: 0, y: 0, w: 10, h: 10 },
      ]),
    )
    expect(r.svgFailed).toBe(1)
    const out = JSON.parse(r.json) as { elements: unknown[] }
    expect(out.elements).toHaveLength(1)
  })

  it('passes through output with no JSON object or no elements array untouched', async () => {
    expect(await hydrateSpecSvg('not json at all')).toMatchObject({ svgOk: 0, svgFailed: 0 })
    expect(await hydrateSpecSvg('{"a":1}')).toMatchObject({ svgOk: 0, svgFailed: 0 })
  })
})
