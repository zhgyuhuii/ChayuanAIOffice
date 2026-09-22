import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { webSearch, imageSearch } from '../src/index'

// These cases test the Serper/DuckDuckGo paths (ChatOffice removed from search chain)
beforeAll(() => {
  process.env.AI_SEARCH_DISABLE_GSK = '1'
})

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
  delete process.env.SERPER_API_KEY
  delete process.env.TAVILY_API_KEY
})

function mockFetch(
  handler: (url: string, init?: RequestInit) => { ok: boolean; json?: any; text?: string },
) {
  globalThis.fetch = vi.fn(async (url: any, init: any) => {
    const r = handler(String(url), init)
    return {
      ok: r.ok,
      status: r.ok ? 200 : 500,
      headers: new Map(),
      json: async () => r.json,
      text: async () => r.text ?? '',
    } as any
  }) as any
}

describe('webSearch (Serper)', () => {
  it('parses organic results + answer box', async () => {
    process.env.SERPER_API_KEY = 'test-key'
    mockFetch((url) => {
      expect(url).toBe('https://google.serper.dev/search')
      return {
        ok: true,
        json: {
          answerBox: { answer: '42' },
          organic: [
            { title: 'A', link: 'https://a.com', snippet: 'sa' },
            { title: 'B', link: 'https://b.com', snippet: 'sb' },
          ],
        },
      }
    })
    const r = await webSearch('meaning of life', 5)
    expect(r.method).toBe('serper')
    expect(r.answer).toBe('42')
    expect(r.results).toHaveLength(2)
    expect(r.results[0]).toEqual({ title: 'A', url: 'https://a.com', snippet: 'sa' })
  })

  it('falls back to DuckDuckGo when no key', async () => {
    mockFetch((url) => {
      expect(url).toContain('duckduckgo.com')
      return {
        ok: true,
        text: '<a class="result__a" href="/l/?uddg=https%3A%2F%2Fx.com">X Title</a>',
      }
    })
    const r = await webSearch('q', 3)
    expect(r.method).toBe('duckduckgo')
    expect(r.results[0]?.url).toBe('https://x.com')
    expect(r.results[0]?.title).toBe('X Title')
  })

  it('clamps wild maxResults and truncates huge queries at entry', async () => {
    process.env.SERPER_API_KEY = 'test-key'
    let seen: { q: string; num: number } | undefined
    mockFetch((_url, init) => {
      seen = JSON.parse(String(init?.body)) as { q: string; num: number }
      return { ok: true, json: { organic: [] } }
    })
    await webSearch('x'.repeat(5000), 1e9)
    expect(seen!.num).toBeLessThanOrEqual(20)
    expect(seen!.q.length).toBeLessThanOrEqual(500)
    await webSearch('normal', NaN)
    expect(seen!.num).toBeGreaterThanOrEqual(1)
  })
})

describe('webSearch (Tavily)', () => {
  it('parses results + answer when Serper is unconfigured', async () => {
    process.env.TAVILY_API_KEY = 'test-key'
    mockFetch((url, init) => {
      expect(url).toBe('https://api.tavily.com/search')
      expect(JSON.parse(String((init as any)?.body ?? '{}')).api_key).toBe('test-key')
      return {
        ok: true,
        json: {
          answer: '42',
          results: [
            { title: 'A', url: 'https://a.com', content: 'sa' },
            { title: 'B', url: 'https://b.com', content: 'sb' },
          ],
        },
      }
    })
    const r = await webSearch('meaning of life', 5)
    expect(r.method).toBe('tavily')
    expect(r.answer).toBe('42')
    expect(r.results).toHaveLength(2)
    expect(r.results[0]).toEqual({ title: 'A', url: 'https://a.com', snippet: 'sa' })
  })

  it('prefers Serper over Tavily when both keys are set', async () => {
    process.env.SERPER_API_KEY = 'serper-key'
    process.env.TAVILY_API_KEY = 'tavily-key'
    mockFetch((url) => {
      expect(url).toBe('https://google.serper.dev/search')
      return { ok: true, json: { organic: [{ title: 'A', link: 'https://a.com' }] } }
    })
    const r = await webSearch('q', 3)
    expect(r.method).toBe('serper')
  })

  it('falls back to DuckDuckGo when Tavily returns nothing usable', async () => {
    process.env.TAVILY_API_KEY = 'test-key'
    mockFetch((url) => {
      if (url === 'https://api.tavily.com/search') return { ok: true, json: { results: [] } }
      expect(url).toContain('duckduckgo.com')
      return {
        ok: true,
        text: '<a class="result__a" href="/l/?uddg=https%3A%2F%2Fx.com">X Title</a>',
      }
    })
    const r = await webSearch('q', 3)
    expect(r.method).toBe('duckduckgo')
  })
})

describe('DuckDuckGo fallback error surfacing', () => {
  it('web: reports method error when the backend is unreachable', async () => {
    mockFetch(() => {
      throw new Error('network down')
    })
    const r = await webSearch('q', 3)
    expect(r.method).toBe('error')
    expect(r.results).toHaveLength(0)
    expect(r.error).toContain('duckduckgo')
  })

  it('web: stays a plain empty result when the backend responds with nothing', async () => {
    mockFetch(() => ({ ok: true, text: '<html></html>' }))
    const r = await webSearch('q', 3)
    expect(r.method).toBe('duckduckgo')
    expect(r.results).toHaveLength(0)
    expect(r.error).toBeUndefined()
  })

  it('images: reports method error with per-tier attempts when all backends fail', async () => {
    mockFetch(() => {
      throw new Error('network down')
    })
    const r = await imageSearch('cats', 8)
    expect(r.method).toBe('error')
    expect(r.images).toHaveLength(0)
    expect(r.error).toContain('all image backends failed')
    const byBackend = Object.fromEntries(r.attempts.map((a) => [a.backend, a.status]))
    expect(byBackend.serper).toBe('skipped')
    expect(byBackend.bing).toBe('error')
    expect(byBackend.openverse).toBe('error')
  })

  it('images: serper hit short-circuits the chain and reports the attempt', async () => {
    process.env.SERPER_API_KEY = 'test-key'
    mockFetch((url) => {
      expect(String(url)).toBe('https://google.serper.dev/images')
      return {
        ok: true,
        json: {
          images: [
            {
              title: 'a',
              imageUrl: 'https://cdn.example.com/1.jpg',
              link: 'https://example.com',
            },
          ],
        },
      }
    })
    const r = await imageSearch('cats', 8)
    expect(r.method).toBe('serper')
    expect(r.images).toHaveLength(1)
    expect(r.attempts.find((a) => a.backend === 'serper')?.status).toBe('ok')
  })
})

describe('imageSearch (Serper)', () => {
  it('parses images + filters copyright hosts', async () => {
    process.env.SERPER_API_KEY = 'test-key'
    mockFetch((url) => {
      expect(url).toBe('https://google.serper.dev/images')
      return {
        ok: true,
        json: {
          images: [
            {
              title: 'good',
              imageUrl: 'https://cdn.example.com/a.jpg',
              link: 'https://example.com',
              imageWidth: 800,
              imageHeight: 600,
            },
            {
              title: 'paid',
              imageUrl: 'https://gettyimages.com/x.jpg',
              link: 'https://gettyimages.com',
            },
            {
              title: 'review',
              imageUrl: 'https://cdn.example.com/shutterstock-review.png',
              link: 'https://example.com/review',
            },
            {
              title: 'subdomain',
              imageUrl: 'https://media.shutterstock.com/y.jpg',
              link: 'https://media.shutterstock.com',
            },
          ],
        },
      }
    })
    const r = await imageSearch('cats', 8)
    expect(r.method).toBe('serper')
    // getty host + shutterstock subdomain filtered out; a mere path
    // mention of a stock host on an unrelated domain is kept
    expect(r.images.map((i) => i.title)).toEqual(['good', 'review'])
    expect(r.images[0]).toMatchObject({
      imageUrl: 'https://cdn.example.com/a.jpg',
      width: 800,
      height: 600,
    })
  })
})

describe('webSearch (Parallel)', () => {
  it('uses the REST API when PARALLEL_API_KEY is set', async () => {
    process.env.PARALLEL_API_KEY = 'pk-test'
    let seen: { url: string; headers?: Record<string, string> } | null = null
    mockFetch((url, init) => {
      if (url === 'https://api.parallel.ai/v1/search') {
        seen = { url, headers: (init?.headers ?? {}) as Record<string, string> }
        return {
          ok: true,
          json: {
            results: [
              { title: 'Parallel result', url: 'https://example.com/a', excerpts: ['one', 'two'] },
              { title: '', url: 'ftp://skip.example/x', excerpts: [] },
              { title: 'Titled', url: 'https://example.com/b', excerpts: [] },
            ],
          },
        }
      }
      return { ok: false, json: {} }
    })
    const r = await webSearch('parallel query', 5)
    expect(seen).not.toBeNull()
    expect(seen!.headers?.['x-api-key']).toBe('pk-test')
    expect(r.method).toBe('parallel')
    // non-http(s) URLs dropped; empty title falls back to the URL; excerpts joined
    expect(r.results.map((x) => x.url)).toEqual(['https://example.com/a', 'https://example.com/b'])
    expect(r.results[0]).toMatchObject({ title: 'Parallel result', snippet: 'one\ntwo' })
  })

  it('skips the tier without a key unless Parallel is the preferred provider', async () => {
    delete process.env.PARALLEL_API_KEY
    mockFetch((url) => (url.includes('duckduckgo') ? { ok: true, json: [] } : { ok: false, json: {} }))
    const r = await webSearch('no key', 3)
    expect(r.method).toBe('duckduckgo')
  })
})

describe('search-tools', () => {
  it('exports webSearchTool and imageSearchTool', async () => {
    const { webSearchTool, imageSearchTool } = await import('../src/search-tools')
    expect(typeof webSearchTool).toBe('function')
    expect(typeof imageSearchTool).toBe('function')
  })
})
