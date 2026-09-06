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
  it('kling/luma offer a 1:1 aspect; others 16:9/9:16 only; all carry duration', () => {
    expect(videoParamSpec('kling', 'kling-v2').fields.map((f) => f.id)).toEqual([
      'aspectRatio',
      'durationSeconds',
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
})
