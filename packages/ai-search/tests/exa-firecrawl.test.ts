import { afterEach, describe, expect, it, vi } from 'vitest'
import { exaWebSearch } from '../src/exa'
import { firecrawlWebSearch } from '../src/firecrawl'

afterEach(() => vi.unstubAllGlobals())

describe('exaWebSearch', () => {
  it('maps results with a text-snippet preference and caps at maxResults', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          results: [
            { title: 'A', url: 'https://a.example.com', text: 'alpha text' },
            { title: 'B', url: 'https://b.example.com', summary: 'beta summary' },
            { title: 'C', url: 'https://c.example.com' },
            { title: 'D', url: 'https://d.example.com' },
          ],
        }),
      })),
    )
    const r = await exaWebSearch('k', 'q', 3)
    expect(r?.method).toBe('exa')
    expect(r?.results).toHaveLength(3)
    expect(r?.results[0]).toEqual({
      title: 'A',
      url: 'https://a.example.com',
      snippet: 'alpha text',
    })
    expect(r?.results[1]?.snippet).toBe('beta summary')
  })

  it('skips non-http urls and returns null without a key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ results: [{ title: 'x', url: 'ftp://nope' }] }),
      })),
    )
    expect(await exaWebSearch('k', 'q', 5)).toBeNull()
    expect(await exaWebSearch('', 'q', 5)).toBeNull()
  })
})

describe('firecrawlWebSearch', () => {
  it('prefers the web list and falls through to news', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: {
            web: [{ title: 'W', url: 'https://w.example.com', description: 'web desc' }],
            news: [{ title: 'N', url: 'https://n.example.com', snippet: 'news desc' }],
          },
        }),
      })),
    )
    const r = await firecrawlWebSearch('k', 'q', 5)
    expect(r?.method).toBe('firecrawl')
    expect(r?.results[0]).toEqual({
      title: 'W',
      url: 'https://w.example.com',
      snippet: 'web desc',
    })
  })

  it('news serves as the fallback when the web list is empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: { web: [], news: [{ title: 'N', url: 'https://n.example.com', snippet: 'n' }] },
        }),
      })),
    )
    const r = await firecrawlWebSearch('k', 'q', 5)
    expect(r?.results[0]?.url).toBe('https://n.example.com')
  })

  it('returns null without a key', async () => {
    expect(await firecrawlWebSearch('', 'q', 5)).toBeNull()
  })
})
