import { describe, expect, it } from 'vitest'
import {
  createHarnessSource,
  harnessDefaultPatch,
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

/** yaml with the agent-default-model block swapped (what the stateful rpc mock
 *  serves after office propagates a pick via settings.update) */
function yamlWithDefault(provider: string, model: string): string {
  const lines = HARNESS_YAML.split('\n')
  const at = lines.indexOf('agent-default-model:')
  return [
    ...(at === -1 ? lines : lines.slice(0, at)),
    'agent-default-model:',
    `  provider: ${provider}`,
    `  model: ${model}`,
  ].join('\n')
}

const CREDENTIALS_YAML = ['version: 1', 'refs:', '  CHATOP_ZHIPU_API_KEY: sk-zp-real'].join('\n')

function makeSource(
  officeYaml?: { currentModel?: AiSettingsV2['currentModel'] },
  opts: { rpc?: boolean } = {},
) {
  const rpcCalls: Array<{ method: string; payload: unknown }> = []
  // stateful yaml: a propagated agent-default-model write is what the next
  // read sees in production (dsh persists settings.update immediately)
  let yaml = HARNESS_YAML
  let officeState: AiSettingsV2 = {
    version: 2,
    profiles: [],
    ...(officeYaml?.currentModel ? { currentModel: officeYaml.currentModel } : {}),
  }
  const source = createHarnessSource({
    ...(opts.rpc === false
      ? {}
      : {
          rpc: async (method: string, payload: unknown) => {
            rpcCalls.push({ method, payload })
            if (method === 'settings.update') {
              const p = payload as { ns?: string; patch?: { provider?: string; model?: string } }
              if (p.ns === 'agent-default-model' && p.patch?.provider)
                yaml = yamlWithDefault(p.patch.provider, p.patch.model ?? '')
            }
            return {}
          },
        }),
    readDshFile: async (path) => (path === 'settings.yaml' ? yaml : CREDENTIALS_YAML),
    officeStateSource: {
      read: async () => officeState,
      write: async (next) => {
        officeState = next
      },
    },
  })
  return { source, rpcCalls, officeStateGetter: () => officeState, yamlGetter: () => yaml }
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

  it('linked read: the harness default is authoritative over representable office picks', async () => {
    const fresh = makeSource()
    const s1 = await fresh.source.read()
    expect(s1.currentModel).toEqual({ profileId: 'zhipu', modelId: 'glm-5.2' })

    // a representable office pick (a chatop- route) loses to the harness
    // default: write() propagates office picks into agent-default-model, so a
    // divergence means the harness side switched last
    const representable = makeSource({ currentModel: { profileId: 'ollama', modelId: 'llama3' } })
    const s2 = await representable.source.read()
    expect(s2.currentModel).toEqual({ profileId: 'zhipu', modelId: 'glm-5.2' })

    // desktop (no rpc): the office selection stays authoritative
    const desktop = makeSource({ currentModel: { profileId: 'ollama', modelId: 'llama3' } }, {
      rpc: false,
    })
    const s3 = await desktop.source.read()
    expect(s3.currentModel).toEqual({ profileId: 'ollama', modelId: 'llama3' })
  })

  it('linked read: a custom office pick the harness cannot represent still wins', async () => {
    const custom = makeSource({ currentModel: { profileId: 'custom-x', modelId: 'm' } })
    const s = await custom.source.read()
    expect(s.currentModel).toEqual({ profileId: 'custom-x', modelId: 'm' })
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
        // vendor-less entry (must never become a chatop-dsh-* route; it is
        // office-local custom content and persists verbatim)
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
    // office-local state: chaoffice-login profiles + the selection anchor
    // (verbatim copy of the backing harness profile, key stripped) so the
    // file's normalize pass cannot drop the selection — plus the office-local
    // custom profile riding along verbatim
    const office = officeStateGetter()
    expect(office.profiles.map((p) => p.id).sort()).toEqual(['something-else', 'zhipu'])
    const anchor = office.profiles.find((p) => p.id === 'zhipu')!
    expect(anchor.apiKey ?? '').toBe('')
    expect(anchor.models.map((m) => m.id)).toContain('glm-5.2')
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

  it('propagates a representable selection into agent-default-model; unchanged values are skipped', async () => {
    const { source, rpcCalls } = makeSource()
    const current = await source.read()
    // saving the view unchanged: dsh already carries zhipu/glm-5.2 → no update
    await source.write(current)
    expect(rpcCalls.some((c) => c.method === 'settings.update')).toBe(false)

    // switching to ollama/llama3 propagates through the chatop- route form
    await source.write({ ...current, currentModel: { profileId: 'ollama', modelId: 'llama3' } })
    const update = rpcCalls.find((c) => c.method === 'settings.update')!
    expect(update.payload).toEqual({
      ns: 'agent-default-model',
      patch: { provider: 'chatop-ollama', model: 'llama3' },
    })
  })

  it('a selection the harness cannot represent never touches agent-default-model', async () => {
    const { source, rpcCalls } = makeSource()
    const current = await source.read()
    await source.write({
      ...current,
      profiles: [
        ...current.profiles,
        {
          id: 'custom-x',
          displayName: 'x',
          protocol: 'openai-completions',
          baseUrl: 'https://x.example.com',
          auth: 'api-key',
          enabled: true,
          models: [{ id: 'm' }],
        },
      ],
      currentModel: { profileId: 'custom-x', modelId: 'm' },
    })
    expect(rpcCalls.some((c) => c.method === 'settings.update')).toBe(false)
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

describe('harnessDefaultPatch', () => {
  const profiles = [
    {
      id: 'zhipu',
      vendorId: 'zhipu',
      displayName: '智谱开放平台',
      protocol: 'openai-completions' as const,
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      auth: 'api-key' as const,
      enabled: true,
      models: [{ id: 'glm-5.2' }],
    },
    {
      id: 'chatop-local',
      displayName: '本地模型',
      protocol: 'openai-completions' as const,
      baseUrl: 'http://127.0.0.1:52581/v1',
      auth: 'api-key' as const,
      enabled: true,
      models: [{ id: 'local/qwen3-4b' }],
    },
    {
      id: 'custom-x',
      displayName: '自定义',
      protocol: 'openai-completions' as const,
      baseUrl: 'https://x.example.com',
      auth: 'api-key' as const,
      enabled: true,
      models: [{ id: 'm' }],
    },
    {
      // office-local BYOK profiles carry a vendorId too — without a dsh route
      // behind it the pick is still not harness-expressible
      id: 'custom-muwpb51k',
      vendorId: 'custom-muwpb51k',
      displayName: '察元本地模型',
      protocol: 'openai-completions' as const,
      baseUrl: 'http://127.0.0.1:52581/v1',
      auth: 'api-key' as const,
      enabled: true,
      models: [{ id: 'local/qwen3-4b' }],
    },
  ]
  const routes = new Set(['zhipu'])
  it('maps vendor picks to chatop- routes and local picks to the bare-id local form', () => {
    expect(harnessDefaultPatch({ profileId: 'zhipu', modelId: 'glm-5.2' }, profiles, routes)).toEqual(
      {
        provider: 'chatop-zhipu',
        model: 'glm-5.2',
      },
    )
    expect(
      harnessDefaultPatch({ profileId: 'chatop-local', modelId: 'local/qwen3-4b' }, profiles, routes),
    ).toEqual({ provider: 'chatop-local', model: 'qwen3-4b' })
  })
  it('returns null for custom profiles, unknown picks, and models the route does not serve', () => {
    expect(harnessDefaultPatch({ profileId: 'custom-x', modelId: 'm' }, profiles, routes)).toBeNull()
    expect(
      harnessDefaultPatch({ profileId: 'custom-muwpb51k', modelId: 'local/qwen3-4b' }, profiles, routes),
    ).toBeNull()
    expect(harnessDefaultPatch({ profileId: 'nope', modelId: 'm' }, profiles, routes)).toBeNull()
    expect(harnessDefaultPatch(undefined, profiles, routes)).toBeNull()
    expect(harnessDefaultPatch({ profileId: 'zhipu', modelId: 'not-served' }, profiles, routes)).toBeNull()
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
      chaoffice: {
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

  it('an empty resolved secret falls back to the inline key; a resolved key overrides it', async () => {
    const settings: AiSettingsV2 = {
      version: 2,
      profiles: [
        {
          id: 'custom-proxy',
          displayName: '自定义代理',
          protocol: 'openai-completions',
          baseUrl: 'http://127.0.0.1:52581/v1',
          apiKey: 'chatop-POISONED',
          auth: 'api-key',
          enabled: true,
          models: [{ id: 'local/qwen3-4b' }],
        },
      ],
    }
    const make = (resolved: string) =>
      createAiRuntime({
        source: { read: async () => settings, write: async () => {} },
        chaoffice: {
          apiKey: () => '',
          hasAuth: () => false,
          status: async () => ({ loggedIn: false }),
        },
        translate: (key) => key,
        resolveSecret: async () => resolved,
      })
    const fallback = await make('').resolveForRun({ profileId: 'custom-proxy', modelId: 'local/qwen3-4b' })
    expect(fallback.apiKey).toBe('chatop-POISONED')
    const override = await make('chatop-agent-chaoffice-LIVE').resolveForRun({
      profileId: 'custom-proxy',
      modelId: 'local/qwen3-4b',
    })
    expect(override.apiKey).toBe('chatop-agent-chaoffice-LIVE')
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
  opts: { rpc?: boolean } = {},
) {
  const rpcCalls: Array<{ method: string; payload: unknown }> = []
  let liveYaml = yaml
  let officeState: AiSettingsV2 = {
    version: 2,
    profiles: [],
    ...(office.currentModel ? { currentModel: office.currentModel } : {}),
  }
  const read = (path: string): string => {
    if (path in files) return files[path] as string
    if (path === 'settings.yaml') return liveYaml
    if (path === '.credentials.yaml') return CREDENTIALS_YAML
    throw new Error('missing')
  }
  const source = createHarnessSource({
    ...(opts.rpc === false
      ? {}
      : {
          rpc: async (method: string, payload: unknown) => {
            rpcCalls.push({ method, payload })
            if (method === 'settings.update') {
              const p = payload as { ns?: string; patch?: { provider?: string; model?: string } }
              if (p.ns === 'agent-default-model' && p.patch?.provider)
                liveYaml = yamlWithDefault(p.patch.provider, p.patch.model ?? '')
            }
            return {}
          },
        }),
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
  it('local group first; linked: the vendor harness default outranks a merely running local model', async () => {
    // HARNESS_YAML carries agent-default-model chatop-zhipu/glm-5.2 — linked
    // mode honors the recorded default; the running local model is only a
    // cold-start fallback, not an override
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
    expect(s.currentModel).toEqual({ profileId: 'zhipu', modelId: 'glm-5.2' })
    // vendor groups still follow
    expect(s.profiles.map((p) => p.id).slice(1)).toEqual(['zhipu', 'ollama', 'custom-relay'])
  })

  it('desktop (no rpc): a running local chat model still wins the vendor default', async () => {
    const { source } = makeLocalSource(
      {
        'storages/chatop-models/state.json': LOCAL_STATE_RUNNING,
        'storages/chatop-models/registry.json': LOCAL_REGISTRY,
      },
      {},
      HARNESS_YAML,
      { rpc: false },
    )
    const s = await source.read()
    expect(s.currentModel).toEqual({ profileId: 'chatop-local', modelId: 'local/qwen3-4b' })
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
    // and the next read keeps it: the write propagated the pick into dsh's
    // agent-default-model, which the linked read then honors
    const propagated = rpcCalls.find((c) => c.method === 'settings.update')!
    expect(propagated.payload).toEqual({
      ns: 'agent-default-model',
      patch: { provider: 'chatop-local', model: 'qwen3-4b' },
    })
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

// ── read-only fusion（桌面形态:rpc 缺席,只读融合 + office-local 保留）────────

describe('createHarnessSource read-only (desktop) mode', () => {
  /** office sidecar carrying the user's hand-built custom profile at the
   *  harness model proxy with a poisoned pasted virtual key (the 401 incident) */
  const OFFICE_WITH_CUSTOM = {
    version: 2,
    profiles: [
      {
        id: 'custom-muwpb51k',
        vendorId: 'custom-muwpb51k',
        displayName: '察元本地模型',
        protocol: 'openai-completions' as const,
        baseUrl: 'http://127.0.0.1:52581/v1',
        apiKey: 'chatop-INVALIDATED',
        auth: 'api-key' as const,
        enabled: true,
        models: [{ id: 'local/qwen3-4b', type: 'chat' as const }],
      },
    ],
    currentModel: { profileId: 'custom-muwpb51k', modelId: 'local/qwen3-4b' },
  }

  function makeReadOnly(
    files: Record<string, string>,
    office: { currentModel?: AiSettingsV2['currentModel']; profiles?: AiSettingsV2['profiles'] } = {},
  ) {
    let officeState: AiSettingsV2 = {
      version: 2,
      ...(office.profiles ? { profiles: office.profiles } : { profiles: [] }),
      ...(office.currentModel ? { currentModel: office.currentModel } : {}),
    }
    const source = createHarnessSource({
      readDshFile: async (path) => {
        if (path in files) return files[path] as string
        throw new Error('missing')
      },
      officeStateSource: {
        read: async () => officeState,
        write: async (next) => {
          officeState = next
        },
      },
    })
    return { source, officeStateGetter: () => officeState }
  }

  it('surfaces harness groups next to the office-local custom profile; the pick survives', async () => {
    const { source } = makeReadOnly(
      {
        'settings.yaml': HARNESS_YAML,
        'storages/chatop-models/state.json': LOCAL_STATE_RUNNING,
        'storages/chatop-models/registry.json': LOCAL_REGISTRY,
      },
      { profiles: OFFICE_WITH_CUSTOM.profiles, currentModel: OFFICE_WITH_CUSTOM.currentModel },
    )
    const s = await source.read()
    expect(s.profiles.map((p) => p.id)).toEqual([
      'chatop-local',
      'zhipu',
      'ollama',
      'custom-relay',
      'custom-muwpb51k',
    ])
    expect(s.currentModel).toEqual({ profileId: 'custom-muwpb51k', modelId: 'local/qwen3-4b' })
  })

  it('write persists office state (custom profile + anchors) and never mutates harness routes', async () => {
    const files: Record<string, string> = {
      'settings.yaml': HARNESS_YAML,
      'storages/chatop-models/state.json': LOCAL_STATE_RUNNING,
      'storages/chatop-models/registry.json': LOCAL_REGISTRY,
    }
    const { source, officeStateGetter } = makeReadOnly(files, {
      profiles: OFFICE_WITH_CUSTOM.profiles,
      currentModel: OFFICE_WITH_CUSTOM.currentModel,
    })
    const current = await source.read()
    await source.write(current)
    const office = officeStateGetter()
    // the custom profile persists verbatim (inline key included — it is
    // office-owned content, the managed-key override happens at call time)
    const custom = office.profiles.find((p) => p.id === 'custom-muwpb51k')
    expect(custom?.apiKey).toBe('chatop-INVALIDATED')
    // the selection validates through its anchor
    const normalized = migrateSettingsV2(office)
    expect(normalized.currentModel).toEqual({ profileId: 'custom-muwpb51k', modelId: 'local/qwen3-4b' })
    // readDshFile never received a settings.yaml write path — nothing to
    // assert directly; the harness files are untouched because no rpc exists
  })

  it('root fields (stock/search keys, maxOutputTokens) survive the write round-trip', async () => {
    const { source, officeStateGetter } = makeReadOnly(
      { 'settings.yaml': HARNESS_YAML },
      {},
    )
    const current = await source.read()
    await source.write({
      ...current,
      stockApiKeys: { pexels: 'px-key', pixabay: 'pb-key' },
      searchApiKeys: { serper: 'sp-key' },
      maxOutputTokens: 4096,
      currentModel: { profileId: 'zhipu', modelId: 'glm-5.2' },
    })
    const office = officeStateGetter()
    expect(office.stockApiKeys).toEqual({ pexels: 'px-key', pixabay: 'pb-key' })
    expect(office.searchApiKeys).toEqual({ serper: 'sp-key' })
    expect(office.maxOutputTokens).toBe(4096)
  })
})

// ── 新版 dsh：settings.yaml 已迁移为 profile Cordis patch（文件被导入后移除）──
// 读侧走 settings.describe RPC 兜底 ─────────────────────────────────────────

describe('createHarnessSource × settings.describe fallback (post-migration dsh)', () => {
  function makeDescribeSource(describe: unknown) {
    let officeState: AiSettingsV2 = { version: 2, profiles: [] }
    const rpcCalls: Array<{ method: string; payload: unknown }> = []
    const source = createHarnessSource({
      rpc: async (method, payload) => {
        rpcCalls.push({ method, payload })
        if (method === 'settings.describe') return describe
        return {}
      },
      // settings.yaml gone: dsh imported and removed it at boot
      readDshFile: async () => {
        throw new Error('ENOENT')
      },
      officeStateSource: {
        read: async () => officeState,
        write: async (next) => {
          officeState = next
        },
      },
    })
    return { source, rpcCalls, officeStateGetter: () => officeState }
  }

  const DESCRIBE = {
    namespaces: [
      {
        ns: 'ui-theme',
        value: { preference: 'dark' },
      },
      {
        ns: 'llm-pi-ai',
        value: {
          providers: {
            'chatop-zhipu': {
              displayName: '智谱开放平台',
              apiKeyEnv: 'CHATOP_ZHIPU_API_KEY',
              api: 'openai-completions',
              baseURL: 'https://open.bigmodel.cn/api/paas/v4',
              models: [{ id: 'glm-5.2' }],
            },
          },
        },
      },
      {
        ns: 'agent-default-model',
        value: { provider: 'chatop-zhipu', model: 'glm-5.2' },
      },
    ],
  }

  it('reads profiles and the default pick from settings.describe when the yaml is gone', async () => {
    const { source, rpcCalls } = makeDescribeSource(DESCRIBE)
    const s = await source.read()
    expect(s.profiles.map((p) => p.id)).toEqual(['zhipu'])
    expect(s.profiles[0]).toMatchObject({
      vendorId: 'zhipu',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKeyRef: 'CHATOP_ZHIPU_API_KEY',
    })
    // linked read: the described default model wins
    expect(s.currentModel).toEqual({ profileId: 'zhipu', modelId: 'glm-5.2' })
    expect(rpcCalls.some((c) => c.method === 'settings.describe')).toBe(true)
  })

  it('write propagates through describe-read routes and skips an unchanged default', async () => {
    const { source, rpcCalls } = makeDescribeSource(DESCRIBE)
    const current = await source.read()
    await source.write({ ...current, currentModel: { profileId: 'zhipu', modelId: 'glm-5.2' } })
    // same pick as the described default → no settings.update, only route rewrite
    expect(rpcCalls.some((c) => c.method === 'settings.update')).toBe(false)
    // add glm-5.3 to the route, then switch to it → propagates through describe
    const withModel = {
      ...current,
      profiles: [{ ...current.profiles[0]!, models: [{ id: 'glm-5.2' }, { id: 'glm-5.3' }] }],
    }
    await source.write({ ...withModel, currentModel: { profileId: 'zhipu', modelId: 'glm-5.3' } })
    const update = rpcCalls.find((c) => c.method === 'settings.update')
    expect(update?.payload).toEqual({
      ns: 'agent-default-model',
      patch: { provider: 'chatop-zhipu', model: 'glm-5.3' },
    })
  })

  it('desktop (no rpc) with no yaml → no vendor groups, office state only', async () => {
    let officeState: AiSettingsV2 = { version: 2, profiles: [] }
    const source = createHarnessSource({
      readDshFile: async () => {
        throw new Error('ENOENT')
      },
      officeStateSource: {
        read: async () => officeState,
        write: async (next) => {
          officeState = next
        },
      },
    })
    const s = await source.read()
    expect(s.profiles).toEqual([])
  })
})
