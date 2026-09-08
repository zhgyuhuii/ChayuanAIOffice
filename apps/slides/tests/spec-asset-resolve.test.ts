/**
 * spec-asset-resolve: the local writer references brand assets by handle
 * (`{"type":"image","asset":"deck:1"}`) so multi-KB data URIs never round-trip
 * through the model output. Resolution rewrites handles to the parser's native
 * `dataUri`, keeps the box aspect-true (picture inserts cover-crop otherwise),
 * and drops unknown handles (page continues without them).
 */
import { describe, it, expect } from 'vitest'
import { resolveSpecAssets, fitBoxToAsset } from '../src/renderer/ai/spec-asset-resolve'
import type { DeckImageAsset } from '../src/renderer/ai/slides-skill'

const ASSETS: DeckImageAsset[] = [
  {
    id: 'deck:1',
    name: 'logo.png',
    dataUri: 'data:image/png;base64,QUJD',
    width: 400,
    height: 200,
  },
  { id: 'deck:2', name: 'mascot.png', dataUri: 'data:image/png;base64,REVG' },
]

const specWith = (elements: unknown[]): string =>
  JSON.stringify({ background: '#FFFFFF', elements })

describe('fitBoxToAsset', () => {
  it('contain-fits the box around the asset aspect, anchored at the box center', () => {
    expect(fitBoxToAsset({ x: 100, y: 100, w: 400, h: 200 }, 100, 100)).toEqual({
      x: 200,
      y: 100,
      w: 200,
      h: 200,
    })
    expect(fitBoxToAsset({ x: 0, y: 0, w: 100, h: 300 }, 300, 100)).toEqual({
      x: 0,
      y: 134,
      w: 100,
      h: 33,
    })
  })

  it('returns the box unchanged for non-positive sizes', () => {
    expect(fitBoxToAsset({ x: 1, y: 2, w: 10, h: 0 }, 10, 10)).toEqual({ x: 1, y: 2, w: 10, h: 0 })
    expect(fitBoxToAsset({ x: 1, y: 2, w: 10, h: 10 }, 0, 10)).toEqual({ x: 1, y: 2, w: 10, h: 10 })
  })
})

describe('resolveSpecAssets', () => {
  it('rewrites handles to dataUri, drops the asset key, and keeps the aspect true', async () => {
    const r = resolveSpecAssets(
      specWith([{ type: 'image', asset: 'deck:1', x: 100, y: 100, w: 400, h: 200 }]),
      ASSETS,
    )
    expect(r).toMatchObject({ resolved: 1, dropped: 0 })
    const out = JSON.parse(r.json) as { elements: Array<Record<string, unknown>> }
    expect(out.elements[0]).toEqual({
      type: 'image',
      x: 100,
      y: 100,
      w: 400,
      h: 200,
      dataUri: 'data:image/png;base64,QUJD',
    })
  })

  it('drops an element whose handle matches no asset', () => {
    const r = resolveSpecAssets(
      specWith([
        { type: 'image', asset: 'deck:9', x: 0, y: 0, w: 10, h: 10 },
        { type: 'text', x: 0, y: 0, w: 10, h: 10, paragraphs: [] },
      ]),
      ASSETS,
    )
    expect(r).toMatchObject({ resolved: 0, dropped: 1 })
    const out = JSON.parse(r.json) as { elements: unknown[] }
    expect(out.elements).toHaveLength(1)
  })

  it('leaves the box untouched when the asset has no natural size', () => {
    const r = resolveSpecAssets(
      specWith([{ type: 'image', asset: 'deck:2', x: 5, y: 6, w: 70, h: 80 }]),
      ASSETS,
    )
    const out = JSON.parse(r.json) as { elements: Array<Record<string, unknown>> }
    expect(out.elements[0]).toMatchObject({
      x: 5,
      y: 6,
      w: 70,
      h: 80,
      dataUri: 'data:image/png;base64,REVG',
    })
  })

  it('passes through output without a JSON object or elements array untouched', () => {
    expect(resolveSpecAssets('garbage', ASSETS)).toMatchObject({ resolved: 0, dropped: 0 })
    expect(resolveSpecAssets('{"a":1}', ASSETS)).toMatchObject({ resolved: 0, dropped: 0 })
  })
})
