import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoverModels } from '../src/discovery'

afterEach(() => {
  vi.unstubAllGlobals()
})

function blockPage(): Response {
  return new Response('<!doctype html><title>Attention Required! | Cloudflare</title>', {
    status: 403,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

describe('discoverModels', () => {
  it('answers an ollama-like target from /api/tags when the engine serves it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ models: [{ name: 'llama3:8b' }] }), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    const found = await discoverModels({
      protocol: 'openai-completions',
      baseUrl: 'http://127.0.0.1:11434',
      apiKey: '',
      ollamaLike: true,
    })
    expect(found).toEqual([{ id: 'llama3:8b' }])
  })

  it('falls back to the OpenAI-style /v1/models when /api/tags is blocked at the edge', async () => {
    // remote gateways lumped into ollama-like vendors serve only OpenAI paths;
    // their WAF answers unknown paths with a 403 HTML block page
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/api/tags')) return blockPage()
      return new Response(JSON.stringify({ data: [{ id: 'agnes-2.5-pro' }] }), {
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const found = await discoverModels({
      protocol: 'openai-completions',
      baseUrl: 'https://gw.example.cn/v1',
      apiKey: 'sk-x',
      ollamaLike: true,
    })
    expect(found).toEqual([{ id: 'agnes-2.5-pro' }])
    const urls = fetchMock.mock.calls.map((c) => c[0] as string)
    expect(urls[0]).toContain('/api/tags')
    expect(urls.at(-1)).toBe('https://gw.example.cn/v1/models')
  })

  it('fails when both the tags probe and the OpenAI-style list fail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(blockPage())),
    )
    await expect(
      discoverModels({
        protocol: 'openai-completions',
        baseUrl: 'https://gw.example.cn/v1',
        apiKey: 'sk-x',
        ollamaLike: true,
      }),
    ).rejects.toThrow('HTTP 403')
  })
})
