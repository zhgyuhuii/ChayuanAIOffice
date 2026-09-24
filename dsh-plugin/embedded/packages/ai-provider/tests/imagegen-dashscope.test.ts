/**
 * DashScope BYOK image generation: qwen-image / wanx watermark their output
 * with an "AI生成" mark unless `parameters.watermark: false` is sent — generated
 * slides must come out clean. flux on dashscope doesn't document the parameter
 * and must not receive it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../src/fetch', () => ({ aiFetch: vi.fn() }))
import { aiFetch } from '../src/fetch'
import { generateImageWithModel, type ImageGenRequest } from '../src/imagegen'
import type { ResolvedModelCall } from '../src/settings-v2'

const call = (model: string): ResolvedModelCall => ({
  protocol: 'openai-compatible',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: 'sk-test',
  model,
})

const req: ImageGenRequest = { prompt: 'a charging bull', aspectRatio: '16:9' }

const submitBody = (callIndex = 0): Record<string, unknown> =>
  JSON.parse((aiFetch as ReturnType<typeof vi.fn>).mock.calls[callIndex]![1].body as string)

beforeEach(() => {
  ;(aiFetch as ReturnType<typeof vi.fn>).mockReset()
  ;(aiFetch as ReturnType<typeof vi.fn>)
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ output: { task_id: 't1' } }),
    })
    .mockResolvedValue({
      ok: true,
      json: async () => ({
        output: { task_status: 'SUCCEEDED', results: [{ url: 'https://img/out.png' }] },
      }),
    })
})

describe('generateViaDashscope watermark parameter', () => {
  it('qwen-image requests watermark:false', async () => {
    await generateImageWithModel(call('qwen-image'), req)
    const body = submitBody()
    expect(body.parameters).toMatchObject({ watermark: false })
  })

  it('wanx requests watermark:false', async () => {
    await generateImageWithModel(call('wanx2.1-t2i-turbo'), req)
    expect(submitBody().parameters).toMatchObject({ watermark: false })
  })

  it('flux on dashscope does not receive the undocumented parameter', async () => {
    await generateImageWithModel(call('flux-schnell'), req)
    expect(submitBody().parameters).not.toHaveProperty('watermark')
  })
})
