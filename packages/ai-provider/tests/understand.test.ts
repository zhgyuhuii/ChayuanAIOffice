import { afterEach, describe, expect, it, vi } from 'vitest'
import { understandMediaWithModel, type UnderstandMediaInput } from '../src/understand'
import type { ResolvedModelCall } from '../src/settings-v2'
import { jsonResponse } from './test-utils'

afterEach(() => {
  vi.unstubAllGlobals()
})

const CALL: ResolvedModelCall = {
  protocol: 'openai-compatible',
  baseUrl: 'https://api.agnes-ai.cn/v1',
  apiKey: 'k',
  model: 'agnes-3.0-flash',
}

const INPUT: UnderstandMediaInput = {
  media: [{ mime: 'image/png', base64: 'aGk=' }],
  requirements: 'describe',
}

describe('understandMediaWithModel: openai-compatible wire shape', () => {
  it('states stream:false — strict gateways 400 on a null stream', async () => {
    // Agnes's LiteLLM upstream rejects "stream": null (pydantic bool_type 400)
    // and relaying gateways re-serialize an absent bool as null; the one-shot
    // analysis body must carry an explicit boolean.
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'a red circle' } }] }))
    vi.stubGlobal('fetch', fetchMock)
    const text = await understandMediaWithModel(CALL, INPUT)
    expect(text).toBe('a red circle')
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string)
    expect(body.stream).toBe(false)
  })

  it('carries the image as an image_url data-URL part', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'ok' } }] }))
    vi.stubGlobal('fetch', fetchMock)
    await understandMediaWithModel(CALL, INPUT)
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string)
    const parts = body.messages[0].content
    expect(parts[0]).toEqual({ type: 'text', text: 'describe' })
    expect(parts[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,aGk=' },
    })
  })
})
