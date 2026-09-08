import { describe, it, expect } from 'vitest'
import { parseBingImagesHtml } from '../src/bing'
import { openverseImageSearch } from '../src/openverse'

const BING_HTML =
  '<div class="dg_u"><a class="iusc" href="#" m="{&quot;murl&quot;:&quot;https://cdn.example.com/cat.jpg&quot;,&quot;turl&quot;:&quot;https://tse.mm.bing.net/th?id=1&quot;,&quot;purl&quot;:&quot;https://example.com/cats&quot;,&quot;t&quot;:&quot;A cat&quot;}"></a></div>' +
  '<a class="iusc" m="{&quot;murl&quot;:&quot;https://www.gettyimages.com/paid.jpg&quot;,&quot;purl&quot;:&quot;https://gettyimages.com/x&quot;}"></a>' +
  // watermark-preview stock sites (intl + China) must be filtered, not just the classic four
  '<a class="iusc" m="{&quot;murl&quot;:&quot;https://img.vcg.com/preview/wm.jpg&quot;,&quot;purl&quot;:&quot;https://vcg.com/x&quot;}"></a>' +
  '<a class="iusc" m="{&quot;murl&quot;:&quot;https://www.699pic.com/thumb.jpg&quot;,&quot;purl&quot;:&quot;https://699pic.com/y&quot;}"></a>' +
  '<a class="iusc" m="{&quot;murl&quot;:&quot;https://us.123rf.com/preview.jpg&quot;,&quot;purl&quot;:&quot;https://123rf.com/z&quot;}"></a>' +
  '<a class="iusc" m="{broken"></a>'

describe('parseBingImagesHtml', () => {
  it('decodes escaped m JSON and filters copyright hosts / broken tiles', () => {
    const out = parseBingImagesHtml(BING_HTML, 10)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      imageUrl: 'https://cdn.example.com/cat.jpg',
      sourceUrl: 'https://example.com/cats',
      title: 'A cat',
      source: 'example.com',
    })
    expect((out[0] as { thumbnail?: string }).thumbnail).toBe('https://tse.mm.bing.net/th?id=1')
  })

  it('caps results at maxResults', () => {
    const out = parseBingImagesHtml(BING_HTML + BING_HTML, 1)
    expect(out).toHaveLength(1)
  })

  it('filters watermark-preview stock hosts (intl + China)', () => {
    const out = parseBingImagesHtml(BING_HTML, 10)
    expect(out.map((i) => i.imageUrl)).toEqual(['https://cdn.example.com/cat.jpg'])
  })
})

describe('openverseImageSearch', () => {
  it('maps results with attribution and throws when empty', async () => {
    const realFetch = globalThis.fetch
    try {
      globalThis.fetch = (async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            results: [
              {
                title: 'Sunset',
                url: 'https://upload.openverse.example/s.jpg',
                thumbnail: 'https://upload.openverse.example/s_thumb.jpg',
                creator: 'Ada',
                license: 'cc0',
                foreign_landing_url: 'https://openverse.example/s',
                width: 800,
                height: 600,
              },
            ],
          }),
        }) as any) as any
      const out = await openverseImageSearch('sunset', 5)
      expect(out).toHaveLength(1)
      expect(out[0]?.attribution).toBe('Ada · CC CC0')
      expect(out[0]?.width).toBe(800)
      expect((out[0] as { thumbnail?: string }).thumbnail).toContain('_thumb')

      globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) })) as any
      await expect(openverseImageSearch('nothing', 5)).rejects.toThrow('openverse: no results')
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
