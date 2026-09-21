import { describe, expect, it } from 'vitest'
import {
  createHarnessSource,
  parseHarnessCredentials,
  parseHarnessDefaultModel,
  profileToHarnessMutation,
  resolveHarnessSecret,
} from '../src/settings-source'
import { createAiRuntime } from '../src/runtime'
import { migrateSettingsV2 } from '../src/settings-v2'
import type { AiSettingsV2 } from '../src/types'

const HARNESS_YAML = [
  'llm-pi-ai:',
  '  providers:',
  '    zhipu:',
  '      apiKeyEnv: ZHIPU_API_KEY',
  '      api: openai-completions',
  '      baseURL: https://open.bigmodel.cn/api/paas/v4/',
  '      models:',
  '        - id: glm-5.2',
  '      displayName: 质谱',
  '    chatop-zhipu:',
  '      displayName: 智谱开放平台',
  '      apiKeyEnv: CHATOP_ZHIPU_API_KEY',
  '      api: openai-completions',
  '      baseURL: https://open.bigmodel.cn/api/paas/v4',
  '      models:',
  '        - id: glm-5.2',
  '    chatop-ollama:',
  '      displayName: Ollama',
  '      apiKeyEnv: CHATOP_OLLAMA_API_KEY',
  '      api: openai-completions',
  '      baseURL: http://127.0.0.1:11434/v1',
  '      models:',
  '        - id: llama3',
  '    chatop-custom-relay:',
  '      displayName: 自建中转',
  '      apiKeyEnv: CHATOP_CUSTOM_RELAY_API_KEY',
  '      api: anthropic-messages',
  '      baseURL: https://relay.example.com',
  '      models:',
  '        - id: claude-sonnet',
  'agent-default-model:',
  '  provider: chatop-zhipu',
  '  model: glm-5.2',
].join('\n')

const CREDENTIALS_YAML = ['version: 1', 'refs:', '  CHATOP_ZHIPU_API_KEY: sk-zp-real'].join('\n')

function makeSource(officeYaml?: { currentModel?: AiSettingsV2['currentModel'] }) {
  const rpcCalls: Array<{ method: string; payload: unknown }> = []
  let officeState: AiSettingsV2 = {
    version: 2,
    profiles: [],
    ...(officeYaml?.currentModel ? { currentModel: officeYaml.currentModel } : {}),
  }
  const source = createHarnessSource({
    rpc: async (method, payload) => {
      rpcCalls.push({ method, payload })
      return {}
    },
    readDshFile: async (path) => (path === 'settings.yaml' ? HARNESS_YAML : CREDENTIALS_YAML),
    officeStateSource: {
      read: async () => officeState,
      write: async (next) => {
        officeState = next
      },
    },
  })
  return { source, rpcCalls, officeStateGetter: () => officeState }
}

describe('parseHarnessDefaultModel', () => {
  it('parses the agent-default-model block', () => {
    expect(parseHarnessDefaultModel(HARNESS_YAML)).toEqual({
      provider: 'chatop-zhipu',
      model: 'glm-5.2',
    })
  })

  it('returns null when the block is absent', () => {
    expect(parseHarnessDefaultModel('ui-theme:\n  preference: dark')).toBeNull()
  })
})

describe('createHarnessSource read', () => {
  it('surfaces only chatop-* routes, restoring ollamaLike and catalog-free protocols', async () => {
    const { source } = makeSource()
    const s = await source.read()
    // the bare `zhipu` (dsh agent's own route) must not leak in as a twin profile
    expect(s.profiles.map((p) => p.id)).toEqual(['zhipu', 'ollama', 'custom-relay'])
    const zhipu = s.profiles.find((p) => p.id === 'zhipu')!
    expect(zhipu).toMatchObject({
      vendorId: 'zhipu',
      apiKeyRef: 'CHATOP_ZHIPU_API_KEY',
      enabled: true,
    })
    expect(zhipu.apiKey ?? '').toBe('')
    // catalog ollamaLike restoration: local endpoints keep the keyless-call path
    expect(s.profiles.find((p) => p.id === 'ollama')?.ollamaLike).toBe(true)
    // unknown vendor id: protocol from the route's api field, still usable
    const custom = s.profiles.find((p) => p.id === 'custom-relay')!
    expect(custom).toMatchObject({
      vendorId: 'custom-relay',
      protocol: 'anthropic-messages',
      baseUrl: 'https://relay.example.com',
    })
  })

  it('adopts the harness default model on first read, office selection wins later', async () => {
    const fresh = makeSource()
    const s1 = await fresh.source.read()
    expect(s1.currentModel).toEqual({ profileId: 'zhipu', modelId: 'glm-5.2' })

    const chosen = makeSource({ currentModel: { profileId: 'ollama', modelId: 'llama3' } })
    const s2 = await chosen.source.read()
    expect(s2.currentModel).toEqual({ profileId: 'ollama', modelId: 'llama3' })
  })
})

describe('createHarnessSource write', () => {
  it('rewrites chatop routes, keeps the route credential ref, ignores vendor-less profiles', async () => {
    const { source, rpcCalls, officeStateGetter } = makeSource()
    const current = await source.read()
    await source.write({
      ...current,
      profiles: [
        // harness-managed profile round-tripped through the redacted view: no
        // apiKey, no apiKeyRef — the route's existing credential ref must survive
        {
          ...current.profiles[0]!,
          displayName: '智谱开放平台（改）',
        },
        // the untouched harness profiles ride along (the settings view round-trips all)
        ...current.profiles.slice(1),
        // vendor-less entry (must never become a chatop-dsh-* route)
        {
          id: 'something-else',
          displayName: 'x',
          protocol: 'openai-completions',
          baseUrl: 'https://x.example.com',
          auth: 'api-key',
          enabled: true,
          models: [{ id: 'm' }],
        },
      ],
    })
    const mutates = rpcCalls.filter((c) => c.method === 'settings.mutate')
    expect(mutates).toHaveLength(1)
    const ops = (mutates[0]!.payload as { ops: Array<{ op: string; path: string[] }> }).ops
    // every managed route rewrites; the vendor-less profile produces no op
    expect(ops.map((o) => o.path?.[1]).sort()).toEqual([
      'chatop-custom-relay',
      'chatop-ollama',
      'chatop-zhipu',
    ])
    const value = (mutates[0]!.payload as { ops: Array<{ value: { apiKeyEnv: string } }> }).ops[0]!
      .value
    expect(value.apiKeyEnv).toBe('CHATOP_ZHIPU_API_KEY')
    // no credentials.set fired: the view carried no fresh key
    expect(rpcCalls.some((c) => c.method === 'credentials.set')).toBe(false)
    // office-local state: chatoffice-login profiles + the selection anchor
    // (verbatim copy of the backing harness profile, key stripped) so the
    // file's normalize pass cannot drop the selection
    const office = officeStateGetter()
    expect(office.profiles.map((p) => p.id)).toEqual(['zhipu'])
    expect(office.profiles[0]!.apiKey ?? '').toBe('')
    expect(office.profiles[0]!.models.map((m) => m.id)).toContain('glm-5.2')
    expect(office.currentModel).toMatchObject({ profileId: 'zhipu', modelId: 'glm-5.2' })
  })

  it('selection survives normalize when it points at a harness-managed profile', async () => {
    const { source, officeStateGetter } = makeSource()
    const current = await source.read()
    await source.write({
      ...current,
      currentModel: { profileId: 'ollama', modelId: 'llama3' },
    })
    const office = officeStateGetter()
    // the anchor for ollama rides along, so normalizeV2's
    // resolveCurrentModel validation finds profile + model in the file
    const anchor = office.profiles.find((p) => p.id === 'ollama')
    expect(anchor?.models.map((m) => m.id)).toContain('llama3')
    expect(office.currentModel).toEqual({ profileId: 'ollama', modelId: 'llama3' })
    // the real migration pass (what officeStateSource.read() runs) keeps it
    const migrated = migrateSettingsV2(JSON.parse(JSON.stringify(office)) as AiSettingsV2)
    expect(migrated.currentModel).toEqual({ profileId: 'ollama', modelId: 'llama3' })
  })

  it('unsets routes removed from the view and stores fresh keys via credentials.set', async () => {
    const { source, rpcCalls } = makeSource()
    const current = await source.read()
    await source.write({
      ...current,
      profiles: [
        {
          ...current.profiles[0]!,
          apiKey: 'sk-fresh',
        },
      ],
    })
    const mutate = rpcCalls.find((c) => c.method === 'settings.mutate')!
    const ops = (mutate.payload as { ops: Array<{ op: string; path: string[] }> }).ops
    expect(ops.some((o) => o.op === 'unset' && o.path[1] === 'chatop-ollama')).toBe(true)
    expect(ops.some((o) => o.op === 'unset' && o.path[1] === 'chatop-custom-relay')).toBe(true)
    const cred = rpcCalls.find((c) => c.method === 'credentials.set')!
    expect(cred.payload).toMatchObject({ ref: 'CHATOP_ZHIPU_API_KEY', value: 'sk-fresh' })
  })
})

describe('profileToHarnessMutation', () => {
  it('prefers the profile ref, then the route ref, then the catalog derivation', () => {
    const base = {
      id: 'zhipu',
      vendorId: 'zhipu',
      displayName: '智谱',
      protocol: 'openai-completions' as const,
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      auth: 'api-key' as const,
      enabled: true,
      models: [{ id: 'glm-5.2' }],
    }
    expect(profileToHarnessMutation({ ...base, apiKeyRef: 'EXPLICIT_REF' }).keyRef).toBe(
      'EXPLICIT_REF',
    )
    expect(profileToHarnessMutation(base, 'PREV_REF').keyRef).toBe('PREV_REF')
    expect(profileToHarnessMutation(base).keyRef).toBe('CHATOP_ZHIPU_API_KEY')
  })
})

describe('resolveHarnessSecret', () => {
  it('inline key wins; otherwise the credentials file resolves the ref', async () => {
    const readDshFile = async (path: string) =>
      path === '.credentials.yaml' ? CREDENTIALS_YAML : ''
    const profile = {
      id: 'zhipu',
      vendorId: 'zhipu',
      displayName: '智谱',
      protocol: 'openai-completions' as const,
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKeyRef: 'CHATOP_ZHIPU_API_KEY',
      auth: 'api-key' as const,
      enabled: true,
      models: [],
    }
    expect(await resolveHarnessSecret(profile, readDshFile)).toBe('sk-zp-real')
    expect(await resolveHarnessSecret({ ...profile, apiKey: 'sk-inline' }, readDshFile)).toBe(
      'sk-inline',
    )
  })

  it('parseHarnessCredentials ignores the version line and non-ref keys', () => {
    const creds = parseHarnessCredentials('version: 1\nrefs:\n  A_KEY: v1\n  other: x')
    expect(creds).toEqual({ A_KEY: 'v1', other: 'x' })
  })
})

describe('runtime secret resolution', () => {
  it('resolveForRun resolves a referenced credential at call time', async () => {
    const settings: AiSettingsV2 = {
      version: 2,
      profiles: [
        {
          id: 'zhipu',
          vendorId: 'zhipu',
          displayName: '智谱开放平台',
          protocol: 'openai-completions',
          baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
          apiKeyRef: 'CHATOP_ZHIPU_API_KEY',
          auth: 'api-key',
          enabled: true,
          models: [{ id: 'glm-5.2' }],
        },
      ],
    }
    const runtime = createAiRuntime({
      source: {
        read: async () => settings,
        write: async () => {},
      },
      chatoffice: {
        apiKey: () => '',
        hasAuth: () => false,
        status: async () => ({ loggedIn: false }),
      },
      translate: (key) => key,
      resolveSecret: async () => 'sk-resolved',
    })
    const call = await runtime.resolveForRun({ profileId: 'zhipu', modelId: 'glm-5.2' })
    expect(call.apiKey).toBe('sk-resolved')
    expect(call.baseUrl).toBe('https://open.bigmodel.cn/api/paas/v4')
  })
})

// ── chatop-local fusion（harness 本地模型 → 合成 profile + 默认选中链）──────

const LOCAL_STATE_RUNNING = JSON.stringify({
  proxyPort: 52581,
  instances: [
    { modelId: 'bge-m3', port: 18080, caps: ['embedding'] },
    { modelId: 'qwen3-4b', port: 18082, caps: ['chat'] },
  ],
})
const LOCAL_STATE_STOPPED = JSON.stringify({ proxyPort: 52581, instances: [] })
const LOCAL_REGISTRY = JSON.stringify({
  installed: ['qwen3-4b', 'bge-m3', 'whisper-small-int8'],
})

/** harness source with injectable dsh-home files (chatop-models state etc.) */
function makeLocalSource(
  files: Record<string, string>,
  office: { currentModel?: AiSettingsV2['currentModel'] } = {},
  yaml = HARNESS_YAML,
) {
  const rpcCalls: Array<{ method: string; payload: unknown }> = []
  let officeState: AiSettingsV2 = {
    version: 2,
    profiles: [],
    ...(office.currentModel ? { currentModel: office.currentModel } : {}),
  }
  const read = (path: string): string => {
    if (path in files) return files[path] as string
    if (path === 'settings.yaml') return yaml
    if (path === '.credentials.yaml') return CREDENTIALS_YAML
    throw new Error('missing')
  }
  const source = createHarnessSource({
    rpc: async (method, payload) => {
      rpcCalls.push({ method, payload })
      return {}
    },
    readDshFile: async (path: string) => read(path),
    officeStateSource: {
      read: async () => officeState,
      write: async (next) => {
        officeState = next
      },
    },
  })
  return { source, rpcCalls, officeStateGetter: () => officeState }
}

describe('createHarnessSource × chatop-local', () => {
  it('injects the local group first; running chat model wins the default over a vendor harness default', async () => {
    // HARNESS_YAML carries agent-default-model chatop-zhipu/glm-5.2 — the
    // running local model outranks it per the desktop's intent
    const { source } = makeLocalSource({
      'storages/chatop-models/state.json': LOCAL_STATE_RUNNING,
      'storages/chatop-models/registry.json': LOCAL_REGISTRY,
    })
    const s = await source.read()
    expect(s.profiles[0]).toMatchObject({
      id: 'chatop-local',
      baseUrl: 'http://127.0.0.1:52581/v1',
      models: [{ id: 'local/qwen3-4b', type: 'chat', running: true }],
    })
    expect(s.currentModel).toEqual({ profileId: 'chatop-local', modelId: 'local/qwen3-4b' })
    // vendor groups still follow
    expect(s.profiles.map((p) => p.id).slice(1)).toEqual(['zhipu', 'ollama', 'custom-relay'])
  })

  it('a harness default pointing at chatop-local maps to the lazy-load entry even when stopped', async () => {
    const yaml = HARNESS_YAML.replace(
      ['agent-default-model:', '  provider: chatop-zhipu', '  model: glm-5.2'].join('\n'),
      ['agent-default-model:', '  provider: chatop-local', '  model: qwen3-4b'].join('\n'),
    )
    const { source } = makeLocalSource(
      {
        'storages/chatop-models/state.json': LOCAL_STATE_STOPPED,
        'storages/chatop-models/registry.json': LOCAL_REGISTRY,
      },
      {},
      yaml,
    )
    const s = await source.read()
    expect(s.currentModel).toEqual({ profileId: 'chatop-local', modelId: 'local/qwen3-4b' })
  })

  it('stopped local model + vendor harness default → vendor default; office pick beats everything', async () => {
    const { source } = makeLocalSource({
      'storages/chatop-models/state.json': LOCAL_STATE_STOPPED,
      'storages/chatop-models/registry.json': LOCAL_REGISTRY,
    })
    const s = await source.read()
    expect(s.currentModel).toEqual({ profileId: 'zhipu', modelId: 'glm-5.2' })
    expect(s.profiles[0]!.id).toBe('chatop-local')

    const chosen = makeLocalSource(
      {
        'storages/chatop-models/state.json': LOCAL_STATE_RUNNING,
        'storages/chatop-models/registry.json': LOCAL_REGISTRY,
      },
      { currentModel: { profileId: 'zhipu', modelId: 'glm-5.2' } },
    )
    const s2 = await chosen.source.read()
    expect(s2.currentModel).toEqual({ profileId: 'zhipu', modelId: 'glm-5.2' })
  })

  it('local selection persists through write (anchor) while the diff never touches chatop-local', async () => {
    const { source, rpcCalls, officeStateGetter } = makeLocalSource({
      'storages/chatop-models/state.json': LOCAL_STATE_RUNNING,
      'storages/chatop-models/registry.json': LOCAL_REGISTRY,
    })
    const current = await source.read()
    // user picks a local model through the picker → save round-trip
    await source.write({
      ...current,
      currentModel: { profileId: 'chatop-local', modelId: 'local/qwen3-4b' },
    })
    const mutates = rpcCalls.filter((c) => c.method === 'settings.mutate')
    const ops = mutates.flatMap((c) => (c.payload as { ops: Array<{ path: string[] }> }).ops)
    expect(ops.map((o) => o.path?.[1]).sort()).toEqual([
      'chatop-custom-relay',
      'chatop-ollama',
      'chatop-zhipu',
    ])
    const office = officeStateGetter()
    const anchor = office.profiles.find((p) => p.id === 'chatop-local')
    expect(anchor?.models.map((m) => m.id)).toContain('local/qwen3-4b')
    // the selection survives the office file's own normalize pass
    const normalized = migrateSettingsV2(office)
    expect(normalized.currentModel).toEqual({
      profileId: 'chatop-local',
      modelId: 'local/qwen3-4b',
    })
    // and the next read keeps it (office pick wins over the running default)
    const again = await source.read()
    expect(again.currentModel).toEqual({ profileId: 'chatop-local', modelId: 'local/qwen3-4b' })
  })

  it('no chatop-models files at all → no local group, legacy behavior untouched', async () => {
    const { source } = makeLocalSource({})
    const s = await source.read()
    expect(s.profiles.map((p) => p.id)).toEqual(['zhipu', 'ollama', 'custom-relay'])
    expect(s.currentModel).toEqual({ profileId: 'zhipu', modelId: 'glm-5.2' })
  })
})
