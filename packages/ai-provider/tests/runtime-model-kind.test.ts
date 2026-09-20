import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAiRuntime } from '../src/runtime'
import type { AiSettingsSource } from '../src/settings-source'
import type { AiSettingsV2, AiStreamChunk } from '../src/types'

/**
 * Type dispatch in the stream loop: the composer picker offers image/video
 * models as the current model, but only chat-shaped types speak
 * /chat/completions — gateways reject the rest (agnes answers 400 "是 image
 * 模型，请使用 /v1/images/generations"). Image models generate inline via the
 * images API; other non-chat kinds fail with their type named.
 */

function makeSource(
  profiles: AiSettingsV2['profiles'],
  currentModel: AiSettingsV2['currentModel'],
) {
  return {
    async read() {
      return { version: 2 as const, profiles, currentModel }
    },
    async write() {},
    subscribe: undefined,
  } as AiSettingsSource
}

const chatoffice = {
  apiKey: () => '',
  hasAuth: () => false,
  status: async () => ({ loggedIn: false }),
  generateImage: async () => ({ url: '' }),
}

const translate = (key: string) => key

function agnesProfile(modelId: string) {
  return {
    id: 'openai-compatible',
    vendorId: 'openai-compatible',
    displayName: '自定义 OpenAI 兼容',
    protocol: 'openai-completions' as const,
    baseUrl: 'https://api.agnes-ai.cn/v1',
    apiKey: 'sk-x',
    auth: 'api-key' as const,
    enabled: true,
    models: [{ id: modelId }],
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('runtime model-kind dispatch', () => {
  it('an image-generation current model generates via /images/generations and streams a markdown image', async () => {
    const urls: string[] = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      urls.push(url)
      expect(init?.method).toBe('POST')
      expect(String(init?.body)).toContain('"model":"agnes-image-2.5-flash"')
      expect(String(init?.body)).toContain('"prompt":"一只柴犬"')
      return new Response(JSON.stringify({ data: [{ b64_json: 'aW1n' }] }), {
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const runtime = createAiRuntime({
      source: makeSource([agnesProfile('agnes-image-2.5-flash')], {
        profileId: 'openai-compatible',
        modelId: 'agnes-image-2.5-flash',
      }),
      chatoffice,
      translate,
    })
    const chunks: AiStreamChunk[] = []
    await runtime.runStream(
      {
        requestId: 'r1',
        selection: { profileId: 'openai-compatible', modelId: 'agnes-image-2.5-flash' },
        system: '',
        messages: [{ role: 'user', text: '一只柴犬' }],
      },
      (c) => chunks.push(c),
    )
    expect(urls).toEqual(['https://api.agnes-ai.cn/v1/images/generations'])
    const text = chunks
      .filter((c) => c.type === 'delta')
      .map((c) => (c as { text: string }).text)
      .join('')
    expect(text).toContain('![一只柴犬](data:image/png;base64,aW1n)')
    expect(chunks.at(-1)).toMatchObject({ type: 'done' })
  })

  it('takes the prompt from the last user message, ignoring earlier turns and assistant text', async () => {
    const bodies: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        bodies.push(String(init?.body))
        return new Response(JSON.stringify({ data: [{ url: 'https://cdn/x.png' }] }), {
          headers: { 'content-type': 'application/json' },
        })
      }),
    )
    const runtime = createAiRuntime({
      source: makeSource([agnesProfile('agnes-image-2.5-flash')], {
        profileId: 'openai-compatible',
        modelId: 'agnes-image-2.5-flash',
      }),
      chatoffice,
      translate,
    })
    const chunks: AiStreamChunk[] = []
    await runtime.runStream(
      {
        requestId: 'r1',
        selection: { profileId: 'openai-compatible', modelId: 'agnes-image-2.5-flash' },
        system: '',
        messages: [
          { role: 'user', text: 'hello' },
          { role: 'assistant', text: 'hi' },
          { role: 'user', text: '画一只猫' },
        ],
      },
      (c) => chunks.push(c),
    )
    expect(bodies[0]).toContain('"prompt":"画一只猫"')
    expect(chunks.some((c) => c.type === 'done')).toBe(true)
  })

  it('a video-generation current model fails with its type named, not a wire 400', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const runtime = createAiRuntime({
      source: makeSource([agnesProfile('agnes-video-2.5')], {
        profileId: 'openai-compatible',
        modelId: 'agnes-video-2.5',
      }),
      chatoffice,
      translate,
    })
    const chunks: AiStreamChunk[] = []
    await runtime.runStream(
      {
        requestId: 'r1',
        selection: { profileId: 'openai-compatible', modelId: 'agnes-video-2.5' },
        system: '',
        messages: [{ role: 'user', text: 'hi' }],
      },
      (c) => chunks.push(c),
    )
    expect(fetchMock).not.toHaveBeenCalled()
    const err = chunks.find((c) => c.type === 'error') as { error: string }
    expect(err.error).toContain('video-generation')
  })

  it('a chat model is untouched by the dispatch', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
          headers: { 'content-type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const runtime = createAiRuntime({
      source: makeSource([agnesProfile('agnes-2.5-pro')], {
        profileId: 'openai-compatible',
        modelId: 'agnes-2.5-pro',
      }),
      chatoffice,
      translate,
    })
    await runtime.runStream(
      {
        requestId: 'r1',
        selection: { profileId: 'openai-compatible', modelId: 'agnes-2.5-pro' },
        system: '',
        messages: [{ role: 'user', text: 'hi' }],
      },
      () => {},
    )
    const calledUrl = fetchMock.mock.calls[0]?.[0] as string
    expect(calledUrl).toContain('/chat/completions')
  })

  it('materializes a url-only image response into a data: URL server-side (CSP/expiry-safe)', async () => {
    const calls: string[] = []
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url)
        if (url.includes('/images/generations')) {
          return new Response(
            JSON.stringify({ data: [{ url: 'https://cos.example.cn/out.png' }] }),
            {
              headers: { 'content-type': 'application/json' },
            },
          )
        }
        return new Response(png, { headers: { 'content-type': 'image/png' } })
      }),
    )
    const runtime = createAiRuntime({
      source: makeSource([agnesProfile('agnes-image-2.5-flash')], {
        profileId: 'openai-compatible',
        modelId: 'agnes-image-2.5-flash',
      }),
      chatoffice,
      translate,
    })
    const chunks: AiStreamChunk[] = []
    await runtime.runStream(
      {
        requestId: 'r1',
        selection: { profileId: 'openai-compatible', modelId: 'agnes-image-2.5-flash' },
        system: '',
        messages: [{ role: 'user', text: '女娲补天' }],
      },
      (c) => chunks.push(c),
    )
    expect(calls[1]).toBe('https://cos.example.cn/out.png')
    const text = chunks
      .filter((c) => c.type === 'delta')
      .map((c) => (c as { text: string }).text)
      .join('')
    expect(text).toContain('](data:image/png;base64,')
    expect(text).not.toContain('](https://cos.example.cn')
  })

  it('runChat (one-shot utilities) refuses non-chat models with a typed error', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const runtime = createAiRuntime({
      source: makeSource([agnesProfile('agnes-image-2.5-flash')], {
        profileId: 'openai-compatible',
        modelId: 'agnes-image-2.5-flash',
      }),
      chatoffice,
      translate,
    })
    const res = await runtime.runChat(
      { profileId: 'openai-compatible', modelId: 'agnes-image-2.5-flash' },
      '',
      'title?',
    )
    expect(res.ok).toBe(false)
    expect(res.error).toContain('image-generation')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
