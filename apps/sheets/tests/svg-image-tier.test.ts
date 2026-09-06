/**
 * generate_svg offline imagery tier (docs/image-source-plan.md #9): sanitize +
 * rasterize + short dataref token so multi-KB base64 stays out of the model
 * context, and the bank stays bounded.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createImageSkill } from '../src/renderer/ai/image-skill'
import { isSvgRef, registerSvgDataUrl, resolveSvgDataUrl } from '../src/renderer/ai/svg-bank'

vi.mock('@chatoffice/pptx-render/svg-raster', () => ({
  rasterizeSvg: vi.fn(),
}))

import { rasterizeSvg } from '@chatoffice/pptx-render/svg-raster'

const mockedRaster = vi.mocked(rasterizeSvg)

const GOOD_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#ff0000"/></svg>'

function call(name: string, input: Record<string, unknown>) {
  return { id: 'call-1', name, input }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('generate_svg tool', () => {
  it('rejects markup that is not an SVG before rasterizing', async () => {
    const r = await createImageSkill().executeTool(call('generate_svg', { svg: '<div>x</div>' }))
    expect(r.isError).toBe(true)
    expect(mockedRaster).not.toHaveBeenCalled()
  })

  it('registers the rasterized PNG and returns a short dataref token', async () => {
    mockedRaster.mockResolvedValue({
      ok: true,
      base64: 'QUJD',
      width: 10,
      height: 10,
      paintRatio: 0.5,
    })
    const r = await createImageSkill().executeTool(call('generate_svg', { svg: GOOD_SVG }))
    expect(r.isError).toBeUndefined()
    const m = /dataref:svg-\d+/.exec(r.output)
    expect(m).toBeTruthy()
    expect(resolveSvgDataUrl(m![0])).toBe('data:image/png;base64,QUJD')
  })

  it('reports a blank render as an error', async () => {
    mockedRaster.mockResolvedValue({ ok: true, base64: 'QUJD', width: 10, height: 10, paintRatio: 0 })
    const r = await createImageSkill().executeTool(call('generate_svg', { svg: GOOD_SVG }))
    expect(r.isError).toBe(true)
    expect(r.output).toContain('blank')
  })

  it('surfaces render-check failures as errors', async () => {
    mockedRaster.mockRejectedValue(new Error('SVG failed to decode'))
    const r = await createImageSkill().executeTool(call('generate_svg', { svg: GOOD_SVG }))
    expect(r.isError).toBe(true)
    expect(r.output).toContain('SVG failed to decode')
  })
})

describe('svg-bank', () => {
  it('resolves registered refs and flags dataref paths', () => {
    expect(isSvgRef('dataref:svg-3')).toBe(true)
    expect(isSvgRef('https://example.com/a.png')).toBe(false)
    const ref = registerSvgDataUrl('data:image/png;base64,ZZZ')
    expect(resolveSvgDataUrl(ref)).toBe('data:image/png;base64,ZZZ')
    expect(resolveSvgDataUrl('dataref:svg-999999')).toBeUndefined()
  })
})
