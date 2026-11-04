// adapted: R40 #2484 — SearchApi 双 tier 用例改编到本地 keys/prefer 检索链
// （上游版走 SearchOptions/testSearchProvider 架构，本地为 SearchKeys+prefer 串联链）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { imageSearch, webSearch } from '../src/index'

const endpoint = 'https://www.searchapi.io/api/v1/search'
const webResponse = () =>
  Response.json({
    search_metadata: { status: 'Success' },
    organic_results: [
      {
        position: 1,
        title: 'ChaAI Office',
        link: 'https://example.com/',
        snippet: 'A free, open-source office suite.',
      },
      { position: 2, title: 'Not a page', link: 'javascript:void(0)', snippet: 'dropped' },
      { position: 3, title: 'Docs', link: 'https://example.com/docs', snippet: 'Documentation.' },
    ],
  })
const image = (title: string, link: string, sourceLink: string, sourceName: string) => ({
  position: 1,
  title,
  source: { name: sourceName, link: sourceLink },
  original: { link, width: 330, height: 550 },
  thumbnail: 'https://encrypted-tbn0.gstatic.com/thumb',
})
const fallback = () =>
  new Response('<a class="result__a" href="https://fallback.example.com">Fallback</a>')

beforeEach(() => {
  for (const key of [
    'SERPER_API_KEY',
    'SEARCHAPI_API_KEY',
    'TAVILY_API_KEY',
    'PARALLEL_API_KEY',
    'KEENABLE_API_KEY',
  ])
    vi.stubEnv(key, '')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('SearchApi web search', () => {
  it('sends a GET with a Bearer token and maps organic_results[]', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => webResponse())
    vi.stubGlobal('fetch', fetch)
    const r = await webSearch('chaoffice', 5, undefined, { searchapi: 'user-key', serper: 'serper-key' }, 'searchapi')
    expect(r).toEqual({
      results: [
        {
          title: 'ChaAI Office',
          url: 'https://example.com/',
          snippet: 'A free, open-source office suite.',
        },
        { title: 'Docs', url: 'https://example.com/docs', snippet: 'Documentation.' },
      ],
      method: 'searchapi',
    })
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0]!
    const parsed = new URL(String(url))
    expect(`${parsed.origin}${parsed.pathname}`).toBe(endpoint)
    expect(parsed.searchParams.get('engine')).toBe('google')
    expect(parsed.searchParams.get('q')).toBe('chaoffice')
    // Google ignores a result count, so none is sent; the cap is applied locally
    expect(parsed.searchParams.get('num')).toBeNull()
    expect(parsed.searchParams.get('api_key')).toBeNull()
    expect(init?.method).toBeUndefined()
    expect(init?.headers).toEqual({
      Authorization: 'Bearer user-key',
      'User-Agent': 'chaoffice',
    })
  })

  it('reads SEARCHAPI_API_KEY and caps the mapped results at maxResults', async () => {
    vi.stubEnv('SEARCHAPI_API_KEY', 'environment-key')
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>(async () => webResponse()),
    )
    const r = await webSearch('chaoffice', 1)
    expect(r.method).toBe('searchapi')
    expect(r.results.map((x) => x.url)).toEqual(['https://example.com/'])
  })

  it('falls through to the next backend when SearchApi rejects the key', async () => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = String(input)
        urls.push(url)
        if (url.startsWith(endpoint))
          return Response.json({ error: 'Invalid API key.' }, { status: 401 })
        if (url === 'https://search.parallel.ai/mcp') return new Response(null, { status: 503 })
        return fallback()
      }),
    )
    const r = await webSearch('chaoffice', 3, undefined, { searchapi: 'bad-key' }, 'searchapi')
    expect(urls[0]!.startsWith(endpoint)).toBe(true)
    expect(r.method).toBe('duckduckgo')
  })

  it('treats an empty page as no answer so the next backend runs', async () => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = String(input)
        urls.push(url)
        if (url.startsWith(endpoint)) return Response.json({ organic_results: [] })
        if (url.startsWith('https://google.serper.dev/'))
          return Response.json({
            organic: [{ title: 'S', link: 'https://s.example.com', snippet: 's' }],
          })
        return fallback()
      }),
    )
    const r = await webSearch('chaoffice', 3, undefined, { searchapi: 'k', serper: 'serper-key' }, 'searchapi')
    expect(r.method).toBe('serper')
    expect(urls[0]!.startsWith(endpoint)).toBe(true)
  })
})

describe('SearchApi image search', () => {
  it('maps images[], keeps numeric dimensions and filters stock hosts', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        images: [
          image(
            'Tower',
            'https://upload.example.org/tower.jpg',
            'https://example.org/t',
            'Example',
          ),
          image('Stock', 'https://media.gettyimages.com/x.jpg', 'https://gettyimages.com', 'Getty'),
          image('Second', 'https://cdn.example.com/b.jpg', 'https://example.com/b', 'Example 2'),
          image('Third', 'https://cdn.example.com/c.jpg', 'https://example.com/c', 'Example 3'),
        ],
      }),
    )
    vi.stubGlobal('fetch', fetch)
    vi.stubEnv('SEARCHAPI_API_KEY', 'user-key')
    const r = await imageSearch('eiffel tower', 2)
    expect(r.method).toBe('searchapi')
    expect(r.images).toEqual([
      {
        title: 'Tower',
        imageUrl: 'https://upload.example.org/tower.jpg',
        sourceUrl: 'https://example.org/t',
        source: 'Example',
        width: 330,
        height: 550,
      },
      {
        title: 'Second',
        imageUrl: 'https://cdn.example.com/b.jpg',
        sourceUrl: 'https://example.com/b',
        source: 'Example 2',
        width: 330,
        height: 550,
      },
    ])
    expect(fetch).toHaveBeenCalledOnce()
    const parsed = new URL(String(fetch.mock.calls[0]![0]))
    expect(`${parsed.origin}${parsed.pathname}`).toBe(endpoint)
    expect(parsed.searchParams.get('engine')).toBe('google_images')
    expect(parsed.searchParams.get('q')).toBe('eiffel tower')
  })

  it('keeps Serper first for images unless SearchApi is the only key', async () => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = String(input)
        urls.push(url)
        return Response.json({
          images: [
            { title: 'S', imageUrl: 'https://cdn.example.com/s.jpg', link: 'https://s.com' },
          ],
        })
      }),
    )
    vi.stubEnv('SEARCHAPI_API_KEY', 'a')
    const r = await imageSearch('cats', 3, undefined, 'b')
    expect(r.method).toBe('serper')
    expect(urls[0]!.startsWith('https://google.serper.dev/')).toBe(true)
  })
})
