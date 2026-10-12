/**
 * Deck imagery source resolution + slot allocation
 * (docs/image-source-plan.md #2/#3): auto chain, empty-pool fallback, per-slot
 * degrade-to-brief semantics, cross-page dedup, explicit URL passthrough.
 */
import { describe, expect, it } from 'vitest'
import { allocateImagery, resolveDeckImageSource, sourceKeyword } from '../src/renderer/ai/image-source'

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

describe('sourceKeyword (tiered chain: model → web rescue → brief)', () => {
  it('model tier success returns its URL with no web fallback', async () => {
    const r = await sourceKeyword('ox', {
      generateModelImage: async () => 'https://gen.example/ox.png',
      searchImages: async () => ['https://web.example/ox.jpg'],
    })
    expect(r).toEqual({ urls: ['https://gen.example/ox.png'], viaWeb: false })
  })

  it('model tier throwing is rescued by the web tier and disclosed via viaWeb', async () => {
    const r = await sourceKeyword('ox', {
      generateModelImage: async () => {
        throw new Error('quota exhausted')
      },
      searchImages: async () => ['https://web.example/ox.jpg'],
    })
    expect(r).toEqual({ urls: ['https://web.example/ox.jpg'], viaWeb: true })
  })

  it('model tier returning null (nothing generated) is rescued the same way', async () => {
    const r = await sourceKeyword('ox', {
      generateModelImage: async () => null,
      searchImages: async () => ['https://web.example/ox.jpg'],
    })
    expect(r).toEqual({ urls: ['https://web.example/ox.jpg'], viaWeb: true })
  })

  it('without a model tier the web search is the primary (never disclosed as a fallback)', async () => {
    const r = await sourceKeyword('ox', {
      searchImages: async () => ['https://web.example/ox.jpg'],
    })
    expect(r).toEqual({ urls: ['https://web.example/ox.jpg'], viaWeb: false })
  })

  it('both tiers failing degrades to a brief', async () => {
    const r = await sourceKeyword('ox', {
      generateModelImage: async () => {
        throw new Error('down')
      },
      searchImages: async () => {
        throw new Error('offline')
      },
    })
    expect(r).toEqual({ urls: [], viaWeb: false })
  })

  it('model tier failing with no search tier wired degrades to a brief too', async () => {
    const r = await sourceKeyword('ox', {
      generateModelImage: async () => null,
    })
    expect(r).toEqual({ urls: [], viaWeb: false })
  })

  it('zero web results count as no rescue', async () => {
    const r = await sourceKeyword('ox', {
      generateModelImage: async () => null,
      searchImages: async () => [],
    })
    expect(r).toEqual({ urls: [], viaWeb: false })
  })
})
