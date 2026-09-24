import { describe, expect, it } from 'vitest'
import {
  defaultSettingsV2,
  enabledChatModels,
  migrateSettingsV2,
  pickImageModel,
  resolveCurrentModel,
  resolveModelCall,
} from '../src/settings-v2'
import { parseHarnessCredentials, parseHarnessProviders } from '../src/settings-source'

describe('migrateSettingsV2', () => {
  it('returns defaults for a missing file: nothing enabled, no default model', () => {
    const s = migrateSettingsV2(null)
    expect(s.version).toBe(2)
    expect(s.profiles[0]?.id).toBe('chatoffice')
    expect(s.profiles.every((p) => !p.enabled)).toBe(true)
    expect(s.currentModel).toBeUndefined()
    expect(resolveCurrentModel(s)).toBeUndefined()
  })

  it('migrates a v1 BYOK selection with key + custom base URL', () => {
    const v1 = {
      provider: 'kimi' as const,
      providers: {
        kimi: { apiKey: ' sk-1 ', model: 'kimi-k3', baseUrl: 'https://api.moonshot.ai/v1 ' },
        glm: { apiKey: '', model: 'glm-5.3' },
      },
    }
    const s = migrateSettingsV2(v1)
    const kimi = s.profiles.find((p) => p.id === 'moonshot')
    expect(kimi).toMatchObject({
      vendorId: 'moonshot',
      apiKey: 'sk-1',
      baseUrl: 'https://api.moonshot.ai/v1',
      protocol: 'openai-completions',
      auth: 'api-key',
      enabled: true,
    })
    // keyless glm did not migrate
    expect(s.profiles.find((p) => p.id === 'zhipu')).toBeUndefined()
    expect(s.currentModel).toEqual({ profileId: 'moonshot', modelId: 'kimi-k3' })
    // chatoffice profile always present
    expect(s.profiles.some((p) => p.id === 'chatoffice')).toBe(true)
  })

  it('migrates a v1 anthropic selection onto the anthropic-messages protocol', () => {
    const v1 = {
      provider: 'anthropic' as const,
      providers: { anthropic: { apiKey: 'sk-ant', model: 'claude-sonnet-5' } },
    }
    const s = migrateSettingsV2(v1)
    expect(s.profiles.find((p) => p.id === 'anthropic')?.protocol).toBe('anthropic-messages')
    expect(s.currentModel).toEqual({ profileId: 'anthropic', modelId: 'claude-sonnet-5' })
  })

  it('migrates the pre-provider legacy shape into a custom profile', () => {
    const s = migrateSettingsV2({ baseUrl: 'https://gw.example/v1', apiKey: 'k', model: 'm1' })
    const custom = s.profiles.find((p) => p.id === 'custom')
    expect(custom).toMatchObject({ baseUrl: 'https://gw.example/v1', apiKey: 'k' })
    expect(s.currentModel).toEqual({ profileId: 'custom', modelId: 'm1' })
  })

  it('remaps retired deepseek model ids during migration', () => {
    const s = migrateSettingsV2({
      provider: 'deepseek',
      providers: { deepseek: { apiKey: 'k', model: 'deepseek-chat' } },
    })
    expect(s.currentModel?.modelId).toBe('deepseek-v4-flash')
  })

  it('normalizes an existing v2 blob and drops stale selections', () => {
    const v2 = defaultSettingsV2()
    v2.profiles.push({
      id: 'openai',
      vendorId: 'openai',
      displayName: 'OpenAI',
      protocol: 'openai-responses',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk',
      auth: 'api-key',
      enabled: true,
      models: [{ id: 'gpt-5.6-sol' }],
    })
    v2.currentModel = { profileId: 'vanished', modelId: 'x' }
    const s = migrateSettingsV2(v2)
    expect(s.currentModel).toBeTruthy()
    expect(s.profiles.map((p) => p.id)).toEqual(['chatoffice', 'openai'])
  })

  it('carries stock/search sidecar keys through v2 normalization (save would otherwise wipe them)', () => {
    const v2 = defaultSettingsV2()
    v2.stockApiKeys = { pexels: 'px-key', pixabay: 'pb-key' }
    v2.searchApiKeys = { serper: 'serper-key' }
    const s = migrateSettingsV2(v2)
    expect(s.stockApiKeys).toEqual({ pexels: 'px-key', pixabay: 'pb-key' })
    expect(s.searchApiKeys).toEqual({ serper: 'serper-key' })
  })
})

describe('resolveModelCall', () => {
  // adapted: 9f971ed — the proxy's gemini endpoint was removed server-side
  // (405 as of 2026-08-31); gemini models now ride the OpenAI-compatible path
  it('routes chatoffice by model prefix: claude onto anthropic, rest onto openai-compatible', () => {
    const s = defaultSettingsV2()
    const claude = resolveModelCall(
      s,
      { profileId: 'chatoffice', modelId: 'claude-opus-4-7' },
      'chatoffice',
    )
    expect(claude.protocol).toBe('anthropic')
    expect(claude.baseUrl).toContain('genspark.ai')
    const gem = resolveModelCall(
      s,
      { profileId: 'chatoffice', modelId: 'gemini-3.7-flash' },
      'chatoffice',
    )
    expect(gem.protocol).toBe('openai-compatible')
    const gpt = resolveModelCall(s, { profileId: 'chatoffice', modelId: 'gpt-5.6' }, 'chatoffice')
    expect(gpt.protocol).toBe('openai-compatible')
  })

  it('maps wire protocols and vendor quirks onto the internal call', () => {
    const s = defaultSettingsV2()
    s.profiles.push({
      id: 'openai',
      vendorId: 'openai',
      displayName: 'OpenAI',
      protocol: 'openai-responses',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk',
      auth: 'api-key',
      enabled: true,
      models: [{ id: 'gpt-5.6-sol' }],
    })
    const call = resolveModelCall(s, { profileId: 'openai', modelId: 'gpt-5.6-sol' }, 'sk')
    expect(call.protocol).toBe('openai-responses')
    expect(call.useMaxCompletionTokens).toBe(true)
    expect(call.apiKey).toBe('sk')
  })

  it('keeps deepseek non-thinking and strips the gemini compat suffix', () => {
    const s = defaultSettingsV2()
    s.profiles.push(
      {
        id: 'deepseek',
        vendorId: 'deepseek',
        displayName: 'DeepSeek',
        protocol: 'openai-completions',
        baseUrl: 'https://api.deepseek.com',
        apiKey: 'k',
        auth: 'api-key',
        enabled: true,
        models: [{ id: 'deepseek-v4-pro' }],
      },
      {
        id: 'gemini',
        vendorId: 'gemini',
        displayName: 'Gemini',
        protocol: 'gemini-native',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: 'g',
        auth: 'api-key',
        enabled: true,
        models: [{ id: 'gemini-3.7-flash' }],
      },
    )
    const ds = resolveModelCall(s, { profileId: 'deepseek', modelId: 'deepseek-v4-pro' }, 'k')
    expect(ds.bodyExtras).toEqual({ thinking: { type: 'disabled' } })
    const gem = resolveModelCall(s, { profileId: 'gemini', modelId: 'gemini-3.7-flash' }, 'g')
    expect(gem.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta')
  })

  it('throws on unknown profiles and unlisted models', () => {
    const s = defaultSettingsV2()
    expect(() => resolveModelCall(s, { profileId: 'nope', modelId: 'x' }, 'k')).toThrow()
    expect(() =>
      resolveModelCall(s, { profileId: 'chatoffice', modelId: 'not-a-model' }, 'k'),
    ).toThrow()
  })
})

describe('selection helpers', () => {
  it('lists enabled chat models across profiles and skips embeddings/image models', () => {
    const s = defaultSettingsV2()
    s.profiles.push({
      id: 'aliyun-bailian',
      vendorId: 'aliyun-bailian',
      displayName: 'Bailian',
      protocol: 'openai-completions',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: 'k',
      auth: 'api-key',
      enabled: true,
      models: [{ id: 'qwen3.8-max' }, { id: 'text-embedding-v3' }, { id: 'qwen-image' }],
    })
    const chat = enabledChatModels(s)
    expect(chat.map((m) => m.modelId)).toContain('qwen3.8-max')
    expect(chat.map((m) => m.modelId)).not.toContain('text-embedding-v3')
    expect(pickImageModel(s)).toEqual({ profileId: 'aliyun-bailian', modelId: 'qwen-image' })
  })

  it('falls back to the first enabled chat model when the stored selection went stale', () => {
    const s = defaultSettingsV2()
    s.profiles.push({
      id: 'openai',
      vendorId: 'openai',
      displayName: 'OpenAI',
      protocol: 'openai-completions',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'k',
      auth: 'api-key',
      enabled: true,
      models: [{ id: 'gpt-5.6' }],
    })
    s.currentModel = { profileId: 'chatoffice', modelId: 'gone' }
    expect(resolveCurrentModel(s)).toEqual({
      profileId: 'openai',
      modelId: 'gpt-5.6',
    })
  })
})

describe('harness yaml parsing', () => {
  it('scrapes llm-pi-ai provider routes and credentials from dsh files', () => {
    const settings = [
      'llm-pi-ai:',
      '  providers:',
      '    chatop-zhipu:',
      '      displayName: 智谱开放平台',
      '      apiKeyEnv: CHATOP_ZHIPU_API_KEY',
      '      api: openai-completions',
      '      baseURL: https://open.bigmodel.cn/api/paas/v4',
      '      models:',
      '        - id: glm-5.2',
      'llm-deepseek:',
      '  baseURL: https://api.deepseek.com',
    ].join('\n')
    const providers = parseHarnessProviders(settings)
    expect(providers['chatop-zhipu']).toEqual({
      displayName: '智谱开放平台',
      apiKeyEnv: 'CHATOP_ZHIPU_API_KEY',
      api: 'openai-completions',
      baseURL: 'https://open.bigmodel.cn/api/paas/v4',
      models: [{ id: 'glm-5.2' }],
    })
    expect(Object.keys(providers)).toEqual(['chatop-zhipu'])

    const creds = parseHarnessCredentials(
      ['credentials:', '  CHATOP_ZHIPU_API_KEY: sk-zp', 'other: 1'].join('\n'),
    )
    expect(creds['CHATOP_ZHIPU_API_KEY']).toBe('sk-zp')
  })
})
