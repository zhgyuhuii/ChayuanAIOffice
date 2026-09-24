/**
 * Phase-2 SVG line ops (roadmap v3 §8): addPicture's double-part vector insert
 * (svgText), the addWordArt display-text op, and the unlocked setAnimations
 * with its per-page guard — all against a real in-memory deck, no mocks.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createBlankPptx, openPptx, savePptx, type OpenedPptx } from '@chatoffice/pptx-engine'
import { runTxn, opNames } from '@chatoffice/pptx-ops'
import { OP_DOCS, opVocabulary } from '@chatoffice/pptx-ops'

const PNG_1PX_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const SVG_CIRCLE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#1565C0"/></svg>'
const EMU = { x: 914400, y: 914400, cx: 1828800, cy: 914400 }

let opened: OpenedPptx

beforeEach(async () => {
  opened = await openPptx(await createBlankPptx())
})

describe('addPicture op: svgText double-part insert', () => {
  it('lands a vector picture: svg part + png fallback + svgMediaRef', async () => {
    const r = runTxn(opened, {
      ops: [
        {
          op: 'addPicture',
          bytes: PNG_1PX_BASE64,
          ext: 'png',
          svgText: SVG_CIRCLE,
          target: { slide: 0 },
          offset: EMU,
        },
      ],
    })
    expect(r.applied).toBe(true)
    const el = opened.deck.slides[0]!.elements[0] as unknown as {
      type: string
      mediaRef: string
      svgMediaRef?: string
      anchor: { originalXml: string }
    }
    expect(el.type).toBe('picture')
    expect(el.mediaRef).toMatch(/\.png$/)
    expect(el.svgMediaRef).toMatch(/\.svg$/)
    expect(el.anchor.originalXml).toContain('asvg:svgBlip')
  })

  it('svgText that is not SVG markup is guided, nothing applied', () => {
    const r = runTxn(opened, {
      ops: [
        {
          op: 'addPicture',
          bytes: PNG_1PX_BASE64,
          ext: 'png',
          svgText: '<div>nope</div>',
          target: { slide: 0 },
          offset: EMU,
        },
      ],
    })
    expect(r.applied).toBe(false)
    expect(r.failures![0]!.error).toContain('svgText must be SVG markup')
    expect(opened.deck.slides[0]!.elements).toHaveLength(0)
  })
})

describe('addWordArt op', () => {
  it('creates a styled display-text element with run outline', async () => {
    const r = runTxn(opened, {
      ops: [
        {
          op: 'addWordArt',
          text: 'SALE 50%',
          target: { slide: 0 },
          offset: EMU,
          fontSizePt: 64,
          fill: '#E53935',
          outline: { color: '#B71C1C', widthPt: 2 },
        },
      ],
    })
    expect(r.applied).toBe(true)
    const el = opened.deck.slides[0]!.elements[0]!
    expect(el.name).toBe('WordArt')
    expect(el.type).toBe('text')
    const body = (el as unknown as { text?: { paragraphs?: Array<{ runs: Array<Record<string, unknown>> }> } }).text
    const run = body?.paragraphs?.[0]?.runs[0]
    expect(run?.text).toBe('SALE 50%')
    expect(run?.fontSize).toBe(64)
    expect(run?.bold).toBe(true)
    expect(run?.color).toBe('#E53935')
    expect(run?.outline).toEqual({ color: '#B71C1C', widthEmu: 25400 })
  })

  it('rejects a non-hex fill before touching the deck', () => {
    const r = runTxn(opened, {
      ops: [{ op: 'addWordArt', text: 'X', fill: 'red', target: { slide: 0 }, offset: EMU }],
    })
    expect(r.applied).toBe(false)
    expect(r.failures![0]!.error).toContain('fill must be "#RRGGBB"')
  })
})

describe('setAnimations unlock (Q5)', () => {
  const items = (n: number, sourceId: string) =>
    Array.from({ length: n }, () => ({
      sourceId,
      effect: 'fade',
      trigger: 'onClick',
      durationMs: 500,
      delayMs: 0,
    }))

  it('is now AI-callable vocabulary and applies a small set', async () => {
    expect(OP_DOCS.setAnimations?.aiCallable).toBeUndefined()
    expect(opVocabulary()).toContain('setAnimations')
    const seed = runTxn(opened, {
      ops: [{ op: 'addElement', kind: 'textbox', target: { slide: 0 }, offset: EMU, paragraphs: [{ runs: [{ text: 'A' }] }] }],
    })
    const id = seed.records![0]!.created![0]!
    const r = runTxn(opened, {
      ops: [{ op: 'setAnimations', target: { slide: 0 }, items: items(3, id) }],
    })
    expect(r.applied).toBe(true)
  })

  it('the per-page guard rejects oversized sets with guidance', async () => {
    const seed = runTxn(opened, {
      ops: [{ op: 'addElement', kind: 'textbox', target: { slide: 0 }, offset: EMU, paragraphs: [{ runs: [{ text: 'A' }] }] }],
    })
    const id = seed.records![0]!.created![0]!
    const r = runTxn(opened, {
      ops: [{ op: 'setAnimations', target: { slide: 0 }, items: items(25, id) }],
    })
    expect(r.applied).toBe(false)
    expect(r.failures![0]!.error).toContain('at most 24 animation items per slide')
  })

  it('addWordArt is in the op vocabulary', () => {
    expect(opNames()).toContain('addWordArt')
    expect(opVocabulary()).toContain('addWordArt')
  })
})

describe('double-part survival through save', () => {
  it('svg insert survives save → reopen', async () => {
    runTxn(opened, {
      ops: [
        {
          op: 'addPicture',
          bytes: PNG_1PX_BASE64,
          ext: 'png',
          svgText: SVG_CIRCLE,
          target: { slide: 0 },
          offset: EMU,
        },
      ],
    })
    const out = await savePptx(opened)
    const reopened = await openPptx(out)
    const pic = reopened.deck.slides[0]!.elements[0] as { mediaRef: string; svgMediaRef?: string }
    expect(pic.svgMediaRef).toMatch(/\.svg$/)
    expect(pic.mediaRef).toMatch(/\.png$/)
  })
})
