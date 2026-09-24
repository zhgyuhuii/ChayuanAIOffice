/**
 * DockShell geometry + persistence tests (node env: pure math and localStorage
 * load paths only — pointer interactions are covered by manual/e2e testing).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clampBottom,
  clampFloatRect,
  clampSide,
  defaultFloatRect,
  loadState,
} from '../src/DockShell'

/** minimal localStorage stub (node env has none) */
const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  ;(globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  }
})

describe('clampSide', () => {
  it('applies static bounds when the shell is unmeasured', () => {
    expect(clampSide(100, 0)).toBe(280)
    expect(clampSide(400, 0)).toBe(400)
    expect(clampSide(2000, 0)).toBe(1200)
  })

  it('keeps the panel within [min, shell - content min]', () => {
    expect(clampSide(100, 1280)).toBe(280)
    expect(clampSide(500, 1280)).toBe(500)
    // 1280 - 320 = 960 is the live cap; in-range values pass through untouched
    expect(clampSide(900, 1280)).toBe(900)
    expect(clampSide(1100, 1280)).toBe(960)
  })

  it('protects the content area on narrow shells', () => {
    // 800 - 320 = 480 < 720, so 480 is the cap
    expect(clampSide(700, 800)).toBe(480)
  })

  it('never collapses below a usable floor on degenerate shells', () => {
    // 400 - 320 = 80 -> floor 120 wins over the 280 min
    expect(clampSide(280, 400)).toBe(120)
  })
})

describe('clampBottom', () => {
  it('applies static bounds when unmeasured', () => {
    expect(clampBottom(50, 0)).toBe(200)
    expect(clampBottom(320, 0)).toBe(320)
    expect(clampBottom(5000, 0)).toBe(800)
  })

  it('keeps 320px for the content area', () => {
    expect(clampBottom(700, 900)).toBe(580)
    expect(clampBottom(300, 900)).toBe(300)
  })
})

describe('clampFloatRect', () => {
  it('enforces the minimum size', () => {
    expect(clampFloatRect({ x: 0, y: 0, width: 100, height: 80 }, 1280, 800)).toEqual({
      x: 0,
      y: 0,
      width: 320,
      height: 240,
    })
  })

  it('pulls the window back inside the shell', () => {
    expect(clampFloatRect({ x: 1200, y: 700, width: 480, height: 560 }, 1280, 800)).toEqual({
      x: 800,
      y: 240,
      width: 480,
      height: 560,
    })
  })

  it('shrinks to the shell when larger than it', () => {
    expect(clampFloatRect({ x: 0, y: 0, width: 2000, height: 1200 }, 1000, 700)).toEqual({
      x: 0,
      y: 0,
      width: 1000,
      height: 700,
    })
  })

  it('never goes negative', () => {
    const r = clampFloatRect({ x: -50, y: -20, width: 400, height: 300 }, 1280, 800)
    expect(r.x).toBe(0)
    expect(r.y).toBe(0)
  })
})

describe('defaultFloatRect', () => {
  it('hugs the right edge, vertically centered', () => {
    const r = defaultFloatRect(1440, 900)
    expect(r.width).toBe(480)
    expect(r.height).toBe(560)
    expect(r.x).toBe(1440 - 480 - Math.round(1440 * 0.06))
    expect(r.y).toBe(Math.round((900 - 560) / 2))
  })

  it('fits small shells', () => {
    const r = defaultFloatRect(400, 300)
    expect(r.width).toBeLessThanOrEqual(400)
    expect(r.height).toBeLessThanOrEqual(300)
    expect(r.x).toBeGreaterThanOrEqual(16)
  })
})

describe('loadState', () => {
  it('returns defaults when nothing is stored', () => {
    expect(loadState('k')).toEqual({
      position: 'left',
      sideWidth: 360,
      sideWidthAuto: true,
      bottomHeight: 320,
      floatRect: null,
      maximized: false,
    })
  })

  it('marks a stored old-default width (360) as auto — it was persisted on every load, not chosen', () => {
    store.set('k', JSON.stringify({ sideWidth: 360 }))
    expect(loadState('k').sideWidthAuto).toBe(true)
  })

  it('marks a hand-picked width as not auto', () => {
    store.set('k', JSON.stringify({ sideWidth: 420 }))
    expect(loadState('k').sideWidthAuto).toBe(false)
  })

  it('marks a legacy-key width of the old default as auto too', () => {
    store.set('legacy', '360')
    expect(loadState('k', 'legacy').sideWidthAuto).toBe(true)
  })

  it('restores a full persisted state', () => {
    store.set(
      'k',
      JSON.stringify({
        position: 'bottom',
        sideWidth: 420,
        bottomHeight: 260,
        floatRect: { x: 10, y: 20, width: 500, height: 400 },
        maximized: true,
      }),
    )
    expect(loadState('k')).toEqual({
      position: 'bottom',
      sideWidth: 420,
      sideWidthAuto: false,
      bottomHeight: 260,
      floatRect: { x: 10, y: 20, width: 500, height: 400 },
      maximized: true,
    })
  })

  it('migrates the legacy width key when no new state exists', () => {
    store.set('legacy', '500')
    expect(loadState('k', 'legacy').sideWidth).toBe(500)
  })

  it('prefers the new key over the legacy one', () => {
    store.set('k', JSON.stringify({ sideWidth: 300 }))
    store.set('legacy', '500')
    expect(loadState('k', 'legacy').sideWidth).toBe(300)
  })

  it('survives corrupted JSON', () => {
    store.set('k', '{not json')
    expect(loadState('k').position).toBe('left')
  })

  it('rejects unknown positions and garbage rects', () => {
    store.set(
      'k',
      JSON.stringify({ position: 'top', floatRect: { x: Number.NaN, y: 0, width: -5, height: 0 } }),
    )
    const s = loadState('k')
    expect(s.position).toBe('left')
    expect(s.floatRect).toBeNull()
  })

  it('clamps persisted sizes to static bounds (no window dependence on load)', () => {
    store.set('k', JSON.stringify({ sideWidth: 5000, bottomHeight: 10 }))
    const s = loadState('k')
    expect(s.sideWidth).toBe(1200)
    expect(s.bottomHeight).toBe(200)
  })
})
