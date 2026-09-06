/**
 * generate_svg tool (renderer skill): the Q4 closed loop — LLM-written SVG is
 * render-checked, diagnostics feed back on failure (≤2 attempts), success lands
 * a double-part addPicture op (raster fallback + svgText) with EMU geometry.
 * svg-raster is mocked: the real one needs a browser Image/canvas. The tool
 * lands edits through the global window.slidesApi (same as generate_video).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSlidesSkill } from '../src/renderer/ai/slides-skill'
import type { AgentToolCall } from '../src/shared/ipc'

vi.mock('../src/renderer/ai/svg-raster', () => ({
  rasterizeSvg: vi.fn(),
}))
import { rasterizeSvg } from '../src/renderer/ai/svg-raster'

const SVG_OK =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#1565C0"/></svg>'

const PNG_1PX_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const applyTxn = vi.fn(async (req: { ops: Array<Record<string, unknown>> }) => ({
  applied: true,
  records: req.ops.map((o) => ({ op: String(o.op), created: ['e_new1'] })),
}))

const call = (input: Record<string, unknown>): AgentToolCall =>
  ({ id: 't1', name: 'generate_svg', input }) as unknown as AgentToolCall

beforeEach(() => {
  vi.mocked(rasterizeSvg).mockReset()
  applyTxn.mockClear()
  ;(globalThis as { window?: unknown }).window = {
    slidesApi: { applyTxn },
  }
})

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

const skill = () => createSlidesSkill({ getSlides: () => [], getCurrent: () => 0 } as never)

describe('generate_svg tool', () => {
  it('success: lands a double-part addPicture with EMU rect, diagnostics, and the minted id', async () => {
    vi.mocked(rasterizeSvg).mockResolvedValue({
      ok: true,
      base64: PNG_1PX_BASE64,
      width: 100,
      height: 100,
      paintRatio: 0.42,
    })
    const r = await skill().executeTool!(call({ svg: SVG_OK, x: 100, y: 50, w: 200, h: 200 }))
    expect(r!.mutated).toBe(true)
    expect(r!.output).toContain('element id=e_new1')
    expect(r!.output).toContain('42.0% painted')
    expect(applyTxn).toHaveBeenCalledTimes(1)
    const op = applyTxn.mock.calls[0]![0].ops[0]
    expect(op).toMatchObject({
      op: 'addPicture',
      ext: 'png',
      svgText: SVG_OK,
      slide: 0,
      bytes: PNG_1PX_BASE64,
      offset: { x: 100 * 9525, y: 50 * 9525, cx: 200 * 9525, cy: 200 * 9525 },
    })
  })

  it('defaults: centered 320px, square when the viewBox is square', async () => {
    vi.mocked(rasterizeSvg).mockResolvedValue({
      ok: true,
      base64: PNG_1PX_BASE64,
      width: 100,
      height: 100,
      paintRatio: 0.4,
    })
    await skill().executeTool!(call({ svg: SVG_OK }))
    const op = applyTxn.mock.calls[0]![0].ops[0]
    expect(op.offset).toEqual({
      x: ((1280 - 320) / 2) * 9525,
      y: ((720 - 320) / 2) * 9525,
      cx: 320 * 9525,
      cy: 320 * 9525,
    })
  })

  it('failed render check feeds diagnostics back and counts attempts', async () => {
    vi.mocked(rasterizeSvg).mockRejectedValue(new Error('SVG failed to decode'))
    const s = skill()
    const r1 = await s.executeTool!(call({ svg: SVG_OK }))
    expect(r1!.mutated).toBe(false)
    expect(r1!.output).toContain('attempt 1/2')
    expect(r1!.output).toContain('SVG failed to decode')
    expect(applyTxn).not.toHaveBeenCalled()
  })

  it('a blank render counts as a failure; the second instructs a channel fallback', async () => {
    vi.mocked(rasterizeSvg).mockResolvedValue({
      ok: true,
      base64: PNG_1PX_BASE64,
      width: 10,
      height: 10,
      paintRatio: 0,
    })
    const s = skill()
    const r1 = await s.executeTool!(call({ svg: SVG_OK }))
    expect(r1!.output).toContain('the render is blank')
    expect(r1!.output).toContain('attempt 1/2')
    const r2 = await s.executeTool!(call({ svg: SVG_OK }))
    expect(r2!.output).toContain('attempt 2/2')
    expect(r2!.output).toContain('do NOT call generate_svg again')
    expect(applyTxn).not.toHaveBeenCalled()
  })

  it('a success resets the attempt counter', async () => {
    vi.mocked(rasterizeSvg)
      .mockRejectedValueOnce(new Error('decode fail'))
      .mockResolvedValueOnce({ ok: true, base64: PNG_1PX_BASE64, width: 10, height: 10, paintRatio: 0.3 })
      .mockRejectedValueOnce(new Error('decode fail again'))
    const s = skill()
    await s.executeTool!(call({ svg: SVG_OK }))
    const ok = await s.executeTool!(call({ svg: SVG_OK }))
    expect(ok!.mutated).toBe(true)
    const bad = await s.executeTool!(call({ svg: SVG_OK }))
    expect(bad!.output).toContain('attempt 1/2')
  })

  it('non-SVG input is rejected without touching the rasterizer', async () => {
    const r = await skill().executeTool!(call({ svg: '<div>hi</div>' }))
    expect(r!.mutated).toBe(false)
    expect(r!.output).toContain('starting with <svg')
    expect(rasterizeSvg).not.toHaveBeenCalled()
  })
})
