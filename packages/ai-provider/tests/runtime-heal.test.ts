import { describe, expect, it } from 'vitest'
import { createAiRuntime } from '../src/runtime'
import type { AiSettingsSource } from '../src/settings-source'
import type { AiSettingsV2, AiStreamChunk } from '../src/types'

/**
 * The login-gates-nothing heal: a current model parked on the chatoffice
 * profile while signed out falls through to the first usable BYOK chat
 * model (persisted), so chat keeps working. With no alternative the chatoffice
 * error stays as the sign-in guidance.
 */

const chatofficeProfile = {
  id: 'chatoffice',
  vendorId: 'chatoffice',
  displayName: 'ChatOffice',
  protocol: 'openai-completions' as const,
  baseUrl: '',
  auth: 'chatoffice-login' as const,
  enabled: true,
  models: [{ id: 'claude-opus-4-7' }],
}

function byokProfile(apiKey = 'sk-1') {
  return {
    id: 'zhipu',
    vendorId: 'zhipu',
    displayName: '智谱开放平台',
    protocol: 'openai-completions' as const,
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKey,
    auth: 'api-key' as const,
    enabled: true,
    models: [{ id: 'glm-5.3' }],
  }
}

function makeSource(stored: AiSettingsV2): AiSettingsSource & { writes: AiSettingsV2[] } {
  const writes: AiSettingsV2[] = []
  return {
    async read() {
      return writes.length ? writes[writes.length - 1]! : stored
    },
    async write(next) {
      writes.push(next)
    },
    subscribe: undefined,
    writes,
  }
}

const noChatOffice = {
  apiKey: () => '',
  hasAuth: () => false,
  status: async () => ({ loggedIn: false }),
}

const translate = (key: string) => key

describe('runtime chatoffice fallback heal', () => {
  it('switches the current model off the chatoffice profile when signed out and a BYOK chat model exists', async () => {
    const source = makeSource({
      version: 2,
      profiles: [chatofficeProfile, byokProfile()],
      currentModel: { profileId: 'chatoffice', modelId: 'claude-opus-4-7' },
    })
    const runtime = createAiRuntime({ source, chatoffice: noChatOffice, translate })

    const view = await runtime.getSettingsView()
    expect(view.currentModel).toEqual({ profileId: 'zhipu', modelId: 'glm-5.3' })
    // persisted: subsequent reads are stable (single write)
    const again = await runtime.getSettingsView()
    expect(again.currentModel).toEqual({ profileId: 'zhipu', modelId: 'glm-5.3' })
    expect(source.writes.length).toBe(1)
  })

  it('keeps the chatoffice selection (sign-in guidance) when no alternative exists', async () => {
    const source = makeSource({
      version: 2,
      profiles: [chatofficeProfile],
      currentModel: { profileId: 'chatoffice', modelId: 'claude-opus-4-7' },
    })
    const runtime = createAiRuntime({ source, chatoffice: noChatOffice, translate })

    const view = await runtime.getSettingsView()
    expect(view.currentModel).toEqual({ profileId: 'chatoffice', modelId: 'claude-opus-4-7' })
    expect(source.writes.length).toBe(0)
  })

  it('leaves the chatoffice selection alone while signed in', async () => {
    const source = makeSource({
      version: 2,
      profiles: [chatofficeProfile, byokProfile()],
      currentModel: { profileId: 'chatoffice', modelId: 'claude-opus-4-7' },
    })
    const runtime = createAiRuntime({
      source,
      chatoffice: { ...noChatOffice, hasAuth: () => true, apiKey: () => 'chatoffice-key' },
      translate,
    })
    const view = await runtime.getSettingsView()
    expect(view.currentModel).toEqual({ profileId: 'chatoffice', modelId: 'claude-opus-4-7' })
    expect(source.writes.length).toBe(0)
  })

  it('a run with a parked chatoffice selection resolves the BYOK fallback instead of erroring', async () => {
    const source = makeSource({
      version: 2,
      profiles: [chatofficeProfile, byokProfile()],
      currentModel: { profileId: 'chatoffice', modelId: 'claude-opus-4-7' },
    })
    const runtime = createAiRuntime({ source, chatoffice: noChatOffice, translate })
    const chunks: AiStreamChunk[] = []
    // the healed read swaps the selection before resolution; resolveForRun on
    // the stale selection would throw — verify via the healed view + resolve
    const view = await runtime.getSettingsView()
    await expect(runtime.resolveForRun(view.currentModel!)).resolves.toMatchObject({
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'sk-1',
      model: 'glm-5.3',
    })
    void chunks
  })
})
