import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAiRuntime } from '../src/runtime'
import type { AiSettingsSource } from '../src/settings-source'
import type { AiSettingsV2 } from '../src/types'
import { okResponse, sseStream } from './test-utils'

/**
 * The per-turn output budget resolved on the wire when the request carries no
 * explicit maxTokens: the stored user setting wins, otherwise the shipped
 * 32768 default is the floor and the per-vendor map only raises it (deepseek
 * v3+ 65536). This is the guard for the "long output stops mid-way" symptom —
 * reasoning models bill their thinking against this same budget, so the
 * historic flat 8192 left only ~3.5k chars of prose.
 */

afterEach(() => {
  vi.unstubAllGlobals()
})

function byokProfile(overrides: {
  id: string
  vendorId: string
  baseUrl: string
  modelId: string
  apiKey?: string
}) {
  return {
    id: overrides.id,
    vendorId: overrides.vendorId,
    displayName: overrides.id,
    protocol: 'openai-completions' as const,
    baseUrl: overrides.baseUrl,
    apiKey: overrides.apiKey ?? 'sk-1',
    auth: 'api-key' as const,
    enabled: true,
    models: [{ id: overrides.modelId }],
  }
}

function makeSource(stored: AiSettingsV2): AiSettingsSource {
  return {
    async read() {
      return stored
    },
    async write() {},
    subscribe: undefined,
  }
}

const noChaOffice = {
  apiKey: () => '',
  hasAuth: () => false,
  status: async () => ({ loggedIn: false }),
}

const translate = (key: string) => key

async function sentMaxTokens(
  stored: AiSettingsV2,
  selection: { profileId: string; modelId: string },
): Promise<number> {
  const fetchMock = vi.fn().mockResolvedValue(okResponse(sseStream(['data: [DONE]'])))
  vi.stubGlobal('fetch', fetchMock)
  const runtime = createAiRuntime({ source: makeSource(stored), chaoffice: noChaOffice, translate })
  await runtime.runStream(
    {
      requestId: 'r1',
      selection,
      system: '',
      messages: [{ role: 'user', text: 'hi' }],
    },
    () => {},
  )
  expect(fetchMock).toHaveBeenCalled()
  const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string)
  return body.max_tokens
}

describe('runtime per-turn output budget', () => {
  it('uses the shipped 32768 default when no setting is stored (was 8192)', async () => {
    const zhipu = byokProfile({
      id: 'zhipu',
      vendorId: 'zhipu',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      modelId: 'glm-5.3',
    })
    const n = await sentMaxTokens(
      { version: 2, profiles: [zhipu], currentModel: { profileId: 'zhipu', modelId: 'glm-5.3' } },
      { profileId: 'zhipu', modelId: 'glm-5.3' },
    )
    expect(n).toBe(32768)
  })

  it('a stored user setting wins over the default', async () => {
    const zhipu = byokProfile({
      id: 'zhipu',
      vendorId: 'zhipu',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      modelId: 'glm-5.3',
    })
    const n = await sentMaxTokens(
      {
        version: 2,
        profiles: [zhipu],
        currentModel: { profileId: 'zhipu', modelId: 'glm-5.3' },
        maxOutputTokens: 4096,
      },
      { profileId: 'zhipu', modelId: 'glm-5.3' },
    )
    expect(n).toBe(4096)
  })

  it('the per-vendor verified cap raises the default (deepseek v3+ 65536)', async () => {
    const deepseek = byokProfile({
      id: 'deepseek',
      vendorId: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      modelId: 'deepseek-v3',
    })
    const n = await sentMaxTokens(
      {
        version: 2,
        profiles: [deepseek],
        currentModel: { profileId: 'deepseek', modelId: 'deepseek-v3' },
      },
      { profileId: 'deepseek', modelId: 'deepseek-v3' },
    )
    expect(n).toBe(65536)
  })
})
