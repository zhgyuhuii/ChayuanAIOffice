import { describe, it, expect, vi, afterEach } from 'vitest'
import { imageSearch, searchStockImages } from '../src/index'
import { bingImageSearch } from '../src/bing'
import { openverseImageSearch } from '../src/openverse'

// "下一批" pagination: page passes through the imageSearch chain and each
// backend maps it to its own offset (serper body.page, bing first=,
// openverse &page=, pexels/pixabay &page=).

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
  delete process.env.SERPER_API_KEY
})

function mockFetch(
  handler: (url: string, init?: RequestInit) => { ok: boolean; json?: any; text?: string },
) {
  const calls: { url: string; init?: RequestInit }[] = []
  globalThis.fetch = vi.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), init })
    const r = handler(String(url), init)
    return {
      ok: r.ok,
      status: r.ok ? 200 : 500,
      headers: new Map(),
      json: async () => r.json,
      text: async () => r.text ?? '',
    } as any
  }) as any
  return calls
}

const serperBody = (init?: RequestInit) =>
  JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>

describe('imageSearch page passthrough (serper tier)', () => {
  it('page 2 lands in the request body', async () => {
    process.env.SERPER_API_KEY = 'test-key'
    const calls = mockFetch(() => ({
      ok: true,
      json: { images: [{ imageUrl: 'https://x.com/a.jpg', title: 'A', link: 'https://x.com' }] },
    }))
    const r = await imageSearch('cat', 12, false, undefined, 2)
    expect(r.method).toBe('serper')
    expect(calls[0]!.url).toBe('https://google.serper.dev/images')
    expect(serperBody(calls[0]!.init).page).toBe(2)
    expect(serperBody(calls[0]!.init).num).toBe(12)
  })

  it('page 1 omits the page field (first batch request unchanged)', async () => {
    process.env.SERPER_API_KEY = 'test-key'
    const calls = mockFetch(() => ({ ok: true, json: { images: [] } }))
    await imageSearch('cat', 12, false, undefined, 1)
    expect('page' in serperBody(calls[0]!.init)).toBe(false)
  })
})

describe('bingImageSearch page mapping', () => {
  it('page 2 shifts the result window via first=', async () => {
    const calls = mockFetch(() => ({ ok: true, text: '' })) // unparseable → chain moves on
    await expect(bingImageSearch('cat', 12, 2)).rejects.toThrow()
    expect(calls[0]!.url).toContain('first=13')
  })

  it('page 1 has no first param', async () => {
    const calls = mockFetch(() => ({ ok: true, text: '' }))
    await expect(bingImageSearch('cat', 12, 1)).rejects.toThrow()
    expect(calls[0]!.url).not.toContain('first=')
  })
})

describe('openverseImageSearch page mapping', () => {
  it('page 2 appends the native page param', async () => {
    const calls = mockFetch(() => ({ ok: true, json: { results: [] } }))
    await expect(openverseImageSearch('cat', 12, 2)).rejects.toThrow()
    expect(calls[0]!.url).toContain('&page=2')
    expect(calls[0]!.url).toContain('page_size=12')
  })

  it('page 1 omits it', async () => {
    const calls = mockFetch(() => ({ ok: true, json: { results: [] } }))
    await expect(openverseImageSearch('cat', 12, 1)).rejects.toThrow()
    expect(calls[0]!.url).not.toContain('&page=')
  })
})

describe('searchStockImages page mapping', () => {
  it('pexels page 2 appends page param', async () => {
    const calls = mockFetch(() => ({ ok: true, json: { photos: [] } }))
    const r = await searchStockImages('pexels', 'k', 'cat', 12, 2)
    expect(r).toEqual([])
    expect(calls[0]!.url).toContain('&page=2')
    expect(calls[0]!.url).toContain('per_page=12')
  })

  it('pexels page 1 omits it', async () => {
    const calls = mockFetch(() => ({ ok: true, json: { photos: [] } }))
    await searchStockImages('pexels', 'k', 'cat', 12, 1)
    expect(calls[0]!.url).not.toContain('&page=')
  })

  it('pixabay page 3 appends page param', async () => {
    const calls = mockFetch(() => ({ ok: true, json: { hits: [] } }))
    await searchStockImages('pixabay', 'k', 'cat', 12, 3)
    expect(calls[0]!.url).toContain('&page=3')
  })
})
