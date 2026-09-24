/**
 * Deck imagery source resolution + slot allocation
 * (docs/image-source-plan.md #2/#3): auto chain, empty-pool fallback, per-slot
 * degrade-to-brief semantics, cross-page dedup, explicit URL passthrough.
 */
import { describe, expect, it } from 'vitest'
import { allocateImagery, resolveDeckImageSource } from '../src/renderer/ai/image-source'

describe('resolveDeckImageSource', () => {
  it('auto: picks the model when an image model is configured', () => {
    expect(resolveDeckImageSource('auto', true, 0).source).toBe('model')
  })
  it('auto: falls to web without an image model', () => {
    expect(resolveDeckImageSource('auto', false, 0).source).toBe('web')
  })
  it('explicit sources pass through', () => {
    expect(resolveDeckImageSource('svg', false, 0).source).toBe('svg')
    expect(resolveDeckImageSource('web', true, 0).source).toBe('web')
  })
  it('local with a non-empty pool passes through', () => {
    expect(resolveDeckImageSource('local', true, 3).source).toBe('local')
    expect(resolveDeckImageSource('local', true, 3).emptyPoolNote).toBeUndefined()
  })
  it('local with an empty pool falls back to the auto chain with a note', () => {
    const r = resolveDeckImageSource('local', false, 0)
    expect(r.source).toBe('web')
    expect(r.emptyPoolNote).toBe(true)
  })
})

describe('allocateImagery', () => {
  it('svg source turns every keyword into a brief', () => {
    const pages = [
      { image_queries: ['mountain lake', 'https://example.com/a.jpg'] },
      { image_queries: ['city skyline'] },
    ]
    const slots = allocateImagery(pages, 'svg', new Map())
    expect(slots[0]).toEqual({ urls: ['https://example.com/a.jpg'], briefs: ['mountain lake'] })
    expect(slots[1]).toEqual({ urls: [], briefs: ['city skyline'] })
  })

  it('sourced keywords become urls; unsourced ones degrade to briefs', () => {
    const pages = [{ image_queries: ['solar panel', 'wind turbine'] }]
    const candidates = new Map([['solar panel', ['https://cdn.example/1.jpg']]])
    const slots = allocateImagery(pages, 'model', candidates)
    expect(slots[0]!.urls).toEqual(['https://cdn.example/1.jpg'])
    expect(slots[0]!.briefs).toEqual(['wind turbine'])
  })

  it('cross-page dedup prefers unused candidates and reuses when exhausted', () => {
    const pages = [
      { image_queries: ['bridge'] },
      { image_queries: ['bridge'] },
    ]
    const candidates = new Map([
      ['bridge', ['https://cdn.example/1.jpg', 'https://cdn.example/2.jpg']],
    ])
    const slots = allocateImagery(pages, 'web', candidates)
    expect(slots[0]!.urls).toEqual(['https://cdn.example/1.jpg'])
    expect(slots[1]!.urls).toEqual(['https://cdn.example/2.jpg'])
  })

  it('a single candidate is reused across pages (an image beats no image)', () => {
    const pages = [
      { image_queries: ['bridge'] },
      { image_queries: ['bridge'] },
    ]
    const candidates = new Map([['bridge', ['https://cdn.example/1.jpg']]])
    const slots = allocateImagery(pages, 'web', candidates)
    expect(slots[1]!.urls).toEqual(['https://cdn.example/1.jpg'])
  })

  it('keyword matching is case/space-insensitive; pages without slots stay empty', () => {
    const pages = [{ image_queries: ['  Solar   PANEL '] }, { title: 'cover' }]
    const candidates = new Map([['solar panel', ['https://cdn.example/1.jpg']]])
    const slots = allocateImagery(pages, 'web', candidates)
    expect(slots[0]!.urls).toEqual(['https://cdn.example/1.jpg'])
    expect(slots[1]).toEqual({ urls: [], briefs: [] })
  })

  it('data URIs count as resolved and pass through', () => {
    const pages = [{ image_queries: ['data:image/png;base64,AAA'] }]
    const slots = allocateImagery(pages, 'local', new Map())
    expect(slots[0]!.urls).toEqual(['data:image/png;base64,AAA'])
  })
})
