import { describe, expect, it } from 'vitest'
import { imageParamSpec, videoParamSpec } from '../src/media-params'

describe('imageParamSpec', () => {
  it('gpt-image models get size/quality/background/count', () => {
    const spec = imageParamSpec('openai', 'gpt-image-1')
    expect(spec.fields.map((f) => f.id)).toEqual(['size', 'quality', 'background', 'n'])
  })

  it('dall-e-3 has no count field (API is single-image)', () => {
    const spec = imageParamSpec('openai', 'dall-e-3')
    expect(spec.fields.map((f) => f.id)).toEqual(['size', 'quality'])
  })

  it('qwen-image uses star-separated sizes; wanx keeps a text size', () => {
    const qwen = imageParamSpec('aliyun-bailian', 'qwen-image-plus')
    expect(qwen.fields.find((f) => f.id === 'size')?.options).toContain('1664*928')
    const wanx = imageParamSpec('aliyun-bailian', 'wanx2.1-t2i-turbo')
    expect(wanx.fields.find((f) => f.id === 'size')?.type).toBe('text')
  })

  it('imagen gets aspect ratio; gemini generateContent image models get none', () => {
    expect(imageParamSpec('gemini', 'imagen-4.0-generate-001').fields.map((f) => f.id)).toEqual([
      'aspectRatio',
    ])
    expect(imageParamSpec('gemini', 'gemini-3-pro-image').fields).toHaveLength(0)
  })

  it('unknown models fall back to the count field only', () => {
    const spec = imageParamSpec('aliyun-bailian', 'some-new-model')
    expect(spec.fields.map((f) => f.id)).toEqual(['n'])
    expect(spec.fields[0]?.default).toBe(1)
  })
})

describe('videoParamSpec', () => {
  it('kling offers 1:1 aspect + std/pro mode; per-vendor rules refine the generic shape', () => {
    expect(videoParamSpec('kling', 'kling-v2').fields.map((f) => f.id)).toEqual([
      'aspectRatio',
      'durationSeconds',
      'mode',
    ])
    expect(
      videoParamSpec('kling', 'kling-v2')
        .fields.find((f) => f.id === 'aspectRatio')
        ?.options?.includes('1:1'),
    ).toBe(true)
    expect(
      videoParamSpec('zhipu', 'cogvideox-3')
        .fields.find((f) => f.id === 'aspectRatio')
        ?.options,
    ).toEqual(['16:9', '9:16'])
  })

  it('vendor rules carry the ids their media-jobs adapters read', () => {
    // vidu: resolution travels through params.resolution
    expect(videoParamSpec('vidu', 'viduq1').fields.find((f) => f.id === 'resolution')?.options).toEqual([
      '540p',
      '720p',
      '1080p',
    ])
    // pixverse: quality select
    expect(videoParamSpec('pixverse', 'v4.5').fields.find((f) => f.id === 'quality')?.default).toBe('540p')
    // sora: 4/8/12 seconds
    expect(videoParamSpec('openai', 'sora-2').fields.find((f) => f.id === 'durationSeconds')?.options).toEqual([
      4, 8, 12,
    ])
    // veo-3.0 pins 8s (no duration field); veo-3.1 takes 4/6/8
    expect(
      videoParamSpec('gemini', 'veo-3.0-generate-001').fields.find((f) => f.id === 'durationSeconds'),
    ).toBeUndefined()
    expect(videoParamSpec('gemini', 'veo-3.1-generate-preview').fields.find((f) => f.id === 'durationSeconds')?.options).toEqual([
      4, 6, 8,
    ])
    // minimax pins 1280x720 — no aspect ratio
    expect(
      videoParamSpec('minimax', 'video-01').fields.find((f) => f.id === 'aspectRatio'),
    ).toBeUndefined()
    // seedance: resolution tag
    expect(videoParamSpec('volcengine', 'doubao-seedance-1-0-lite-t2v').fields.map((f) => f.id)).toEqual([
      'aspectRatio',
      'durationSeconds',
      'resolution',
    ])
  })

  it('unknown vendors fall back to the generic aspect/duration shape', () => {
    expect(videoParamSpec('chatoffice', 'some-video-model').fields.map((f) => f.id)).toEqual([
      'aspectRatio',
      'durationSeconds',
    ])
  })
})

describe('recraft image params (SVG-line channel)', () => {
  it('recraft models expose size + style (vector_illustration → native svg) + n', () => {
    const spec = imageParamSpec('recraft', 'recraftv3')
    const ids = spec.fields.map((f) => f.id)
    expect(ids).toEqual(['size', 'style', 'n'])
    const style = spec.fields.find((f) => f.id === 'style')!
    expect(style.type).toBe('select')
    expect((style as { options?: string[] }).options).toContain('vector_illustration')
  })

  it('imagegen forwards the style param on the openai-images channel', async () => {
    const { generateImageWithModel } = await import('../src/imagegen')
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    const origFetch = globalThis.fetch
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) })
      return new Response(JSON.stringify({ data: [{ url: 'https://x/img.svg' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch
    try {
      const r = await generateImageWithModel(
        { protocol: 'openai-compatible', baseUrl: 'https://external.api.recraft.ai/v1', apiKey: 'k', model: 'recraftv3', vendorId: 'recraft' },
        { prompt: 'flat icon', params: { style: 'vector_illustration', size: '1024x1024', n: 1 } },
      )
      expect(r.urls).toEqual(['https://x/img.svg'])
      expect(calls[0]!.url).toBe('https://external.api.recraft.ai/v1/images/generations')
      expect(calls[0]!.body.style).toBe('vector_illustration')
      expect(calls[0]!.body.size).toBe('1024x1024')
    } finally {
      globalThis.fetch = origFetch
    }
  })
})
