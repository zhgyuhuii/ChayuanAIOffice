import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openLocalArea } from '@chatoffice/storage-adapter'
import { buildServer } from '../src/app.ts'

const dirs: string[] = []

function tempArea() {
  const dir = mkdtempSync(join(tmpdir(), 'chatoffice-bff-'))
  dirs.push(dir)
  return openLocalArea({ rootDir: dir })
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('GET /healthz', () => {
  it('reports ok', async () => {
    const { app } = buildServer({ area: tempArea() })
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
  })
})

describe('POST /rpc/:service/:method', () => {
  it('forwards to the chatHistory service and returns its result', async () => {
    const { app } = buildServer({ area: tempArea() })
    const res = await app.inject({
      method: 'POST',
      url: '/rpc/chatHistory/resolveChat',
      payload: { args: [{ filePath: '/tmp/a.md' }] },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.result.projectId).toBe('default')
  })

  it('round-trips append + loadChat', async () => {
    const area = tempArea()
    const { app } = buildServer({ area })
    const resolved = await app.inject({
      method: 'POST',
      url: '/rpc/chatHistory/resolveChat',
      payload: { args: [{ filePath: '/tmp/b.md' }] },
    })
    const { projectId, chatId } = resolved.json().result
    await app.inject({
      method: 'POST',
      url: '/rpc/chatHistory/appendChat',
      payload: { args: [{ projectId, chatId, role: 'user', text: 'via bff' }] },
    })
    const loaded = await app.inject({
      method: 'POST',
      url: '/rpc/chatHistory/loadChat',
      payload: { args: [{ projectId, chatId }] },
    })
    expect(loaded.json().result).toHaveLength(1)
    expect(loaded.json().result[0].text).toBe('via bff')
  })

  it('404s unknown service or method', async () => {
    const { app } = buildServer({ area: tempArea() })
    expect(
      (await app.inject({ method: 'POST', url: '/rpc/nope/list', payload: {} })).statusCode,
    ).toBe(404)
    expect(
      (await app.inject({ method: 'POST', url: '/rpc/chatHistory/nope', payload: {} })).statusCode,
    ).toBe(404)
  })

  it('400s with the error message when the service throws', async () => {
    const { app } = buildServer({ area: tempArea() })
    const res = await app.inject({
      method: 'POST',
      url: '/rpc/chatHistory/rebindChat',
      payload: { args: [{ projectId: 'default', tempChatId: 't1' }] },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().ok).toBe(false)
  })

  it('serves the settings service too', async () => {
    const area = tempArea()
    const { app } = buildServer({ area })
    await app.inject({
      method: 'POST',
      url: '/rpc/settings/set',
      payload: { args: ['theme', 'dark'] },
    })
    const got = await app.inject({
      method: 'POST',
      url: '/rpc/settings/get',
      payload: { args: ['theme'] },
    })
    expect(got.json().result).toBe('dark')
  })
})

describe('auth (jwt mode)', () => {
  function tokenFor(sub: string, aud?: string): string {
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
    return `.${enc({ sub, ...(aud ? { aud } : {}) })}.`
  }

  it('rejects missing/invalid tokens on rpc routes and accepts a valid sub', async () => {
    const { app } = buildServer({ area: tempArea(), auth: { mode: 'jwt', audience: 'chatoffice' } })
    const noToken = await app.inject({
      method: 'POST',
      url: '/rpc/settings/get',
      payload: { args: ['x'] },
    })
    expect(noToken.statusCode).toBe(401)

    const badAud = await app.inject({
      method: 'POST',
      url: '/rpc/settings/get',
      payload: { args: ['x'] },
      headers: { authorization: `Bearer ${tokenFor('u1', 'other')}` },
    })
    expect(badAud.statusCode).toBe(401)

    const ok = await app.inject({
      method: 'POST',
      url: '/rpc/settings/get',
      payload: { args: ['x'] },
      headers: { authorization: `Bearer ${tokenFor('u1', 'chatoffice')}` },
    })
    expect(ok.statusCode).toBe(200)

    const health = await app.inject({ method: 'GET', url: '/healthz' })
    expect(health.statusCode).toBe(200)
  })
})

describe('AI endpoints', () => {
  it('serves v2 settings defaults and round-trips a saved view with KEEP_KEY', async () => {
    const dataDir = await Promise.resolve(mkdtempSync(join(tmpdir(), 'chatoffice-ai-')))
    const { app } = buildServer({ area: tempArea(), ai: { dataDir } })
    const first = await app.inject({ method: 'GET', url: '/ai/settings' })
    expect(first.json().version).toBe(2)
    // web form filters the chatoffice-login profile: the default view is an empty, configure-first list
    expect(first.json().profiles).toEqual([])

    const view = first.json()
    view.profiles.push({
      id: 'openai',
      vendorId: 'openai',
      displayName: 'OpenAI',
      protocol: 'openai-responses',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      auth: 'api-key',
      enabled: true,
      models: [{ id: 'gpt-5.6-sol' }],
    })
    const saved = await app.inject({ method: 'PUT', url: '/ai/settings', payload: view })
    expect(saved.json().ok).toBe(true)

    const readBack = await app.inject({ method: 'GET', url: '/ai/settings' })
    const profile = readBack.json().profiles.find((p: { id: string }) => p.id === 'openai')
    // renderer-facing view redacts the key to the sentinel
    expect(profile.apiKey).toBe('__keep__')

    // saving the redacted view back keeps the stored key (KEEP_KEY merge)
    const again = await app.inject({ method: 'PUT', url: '/ai/settings', payload: readBack.json() })
    expect(again.json().ok).toBe(true)
    const stored = JSON.parse(await readFile(join(dataDir, 'ai-settings.json'), 'utf8'))
    expect(stored.profiles.find((p: { id: string }) => p.id === 'openai').apiKey).toBe('sk-test')
  })

  it('rejects malformed stream requests without metering', async () => {
    const seen: Array<Record<string, unknown>> = []
    const { app } = buildServer({
      area: tempArea(),
      ai: {
        dataDir: mkdtempSync(join(tmpdir(), 'chatoffice-ai-')),
        onCall: (r) => seen.push(r as unknown as Record<string, unknown>),
      },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/ai/stream',
      payload: { requestId: 'r1', settings: { profileId: '', modelId: '' }, messages: [] },
    })
    expect(res.statusCode).toBe(400)
    expect(seen).toHaveLength(0)
  })

  it('streams an error chunk (SSE) when the selection has no key', async () => {
    const dataDir = await Promise.resolve(mkdtempSync(join(tmpdir(), 'chatoffice-ai-')))
    const { app } = buildServer({ area: tempArea(), ai: { dataDir } })
    const view = (await app.inject({ method: 'GET', url: '/ai/settings' })).json()
    view.profiles.push({
      id: 'zhipu',
      vendorId: 'zhipu',
      displayName: 'Zhipu GLM',
      protocol: 'openai-completions',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: '',
      auth: 'api-key',
      enabled: true,
      models: [{ id: 'glm-5.3' }],
    })
    view.currentModel = { profileId: 'zhipu', modelId: 'glm-5.3' }
    await app.inject({ method: 'PUT', url: '/ai/settings', payload: view })

    const res = await app.inject({
      method: 'POST',
      url: '/ai/stream',
      payload: {
        requestId: 'r2',
        settings: { profileId: 'zhipu', modelId: 'glm-5.3' },
        system: 's',
        messages: [{ role: 'user', text: 'hi' }],
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/event-stream')
    const chunk = JSON.parse(res.body.split('\n\n')[0].replace(/^data: /, ''))
    expect(chunk.type).toBe('error')
    expect(chunk.requestId).toBe('r2')
    expect(chunk.error).toContain('API Key')
  })
})

describe('AI harness fusion (dsh plugin form)', () => {
  it('reads chatop-* profiles from the dsh settings file, keys resolved from credentials', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'chatoffice-ai-'))
    const dshHome = mkdtempSync(join(tmpdir(), 'chatoffice-dsh-'))
    writeFileSync(
      join(dshHome, 'settings.yaml'),
      [
        'llm-pi-ai:',
        '  providers:',
        '    chatop-zhipu:',
        '      displayName: 智谱开放平台',
        '      apiKeyEnv: CHATOP_ZHIPU_API_KEY',
        '      api: openai-completions',
        '      baseURL: https://open.bigmodel.cn/api/paas/v4',
        '      models:',
        '        - id: glm-5.3',
        'llm-deepseek:',
        '  baseURL: https://api.deepseek.com',
      ].join('\n'),
    )
    writeFileSync(
      join(dshHome, '.credentials.yaml'),
      ['credentials:', '  CHATOP_ZHIPU_API_KEY: sk-dsh'].join('\n'),
    )
    // the office-side state file records the current model
    writeFileSync(
      join(dataDir, 'ai-settings.json'),
      JSON.stringify({
        version: 2,
        profiles: [],
        currentModel: { profileId: 'zhipu', modelId: 'glm-5.3' },
      }),
    )
    const { app } = buildServer({
      area: tempArea(),
      ai: { dataDir, harness: { dshHome, rpcOrigin: '' } },
    })
    const view = await app.inject({ method: 'GET', url: '/ai/settings' })
    const profile = view.json().profiles.find((p: { id: string }) => p.id === 'zhipu')
    expect(profile).toMatchObject({
      vendorId: 'zhipu',
      protocol: 'openai-completions',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      models: [{ id: 'glm-5.3' }],
    })
    expect(view.json().currentModel).toEqual({ profileId: 'zhipu', modelId: 'glm-5.3' })
  })
})

describe('AI harness fusion: chatop-models local models', () => {
  it('surfaces installed local chat models as the chatop-local group and defaults to the running one', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'chatoffice-ai-'))
    const dshHome = mkdtempSync(join(tmpdir(), 'chatoffice-dsh-'))
    writeFileSync(
      join(dshHome, 'settings.yaml'),
      [
        'llm-pi-ai:',
        '  providers:',
        '    chatop-moonshot:',
        '      displayName: 月之暗面 Kimi',
        '      apiKeyEnv: MOONSHOT_API_KEY',
        '      api: openai-completions',
        '      baseURL: https://api.moonshot.cn/v1',
        '      models:',
        '        - id: kimi-k3',
        'agent-default-model:',
        '  provider: chatop-moonshot',
        '  model: kimi-k3',
      ].join('\n'),
    )
    const modelsDir = join(dshHome, 'storages', 'chatop-models')
    mkdirSync(modelsDir, { recursive: true })
    writeFileSync(
      join(modelsDir, 'state.json'),
      JSON.stringify({
        proxyPort: 18100,
        instances: [
          { modelId: 'bge-m3', port: 18080, caps: ['embedding'] },
          { modelId: 'qwen3-4b', port: 18082, caps: ['chat'] },
        ],
      }),
    )
    writeFileSync(
      join(modelsDir, 'registry.json'),
      JSON.stringify({ installed: ['qwen3-4b', 'bge-m3'] }),
    )
    const { app } = buildServer({
      area: tempArea(),
      ai: { dataDir, harness: { dshHome, rpcOrigin: '' } },
    })
    const view = await app.inject({ method: 'GET', url: '/ai/settings' })
    const body = view.json()
    expect(body.profiles[0]).toMatchObject({
      id: 'chatop-local',
      baseUrl: 'http://127.0.0.1:18100/v1',
      models: [{ id: 'local/qwen3-4b', type: 'chat', running: true }],
    })
    // running local chat model outranks the vendor-backed harness default
    expect(body.currentModel).toEqual({ profileId: 'chatop-local', modelId: 'local/qwen3-4b' })
    expect(body.profiles.some((p: { id: string }) => p.id === 'moonshot')).toBe(true)
  })
})

describe('POST /rpc/remoteStorage/*', () => {
  it('serves the empty settings document on a fresh data dir', async () => {
    const { app } = buildServer({ area: tempArea() })
    const res = await app.inject({
      method: 'POST',
      url: '/rpc/remoteStorage/getSettings',
      payload: { args: [] },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().result).toEqual({ version: 1, configs: [], defaultLocation: null })
  })

  it('persists saved configs and maps remote errors to status codes', async () => {
    const { app } = buildServer({ area: tempArea() })
    const config = {
      id: 'cfg-1',
      name: 'MinIO',
      protocol: 's3',
      endpoint: 'http://127.0.0.1:9000',
      region: 'us-east-1',
      bucket: 'docs',
      accessKeyId: 'AK',
      secretAccessKey: 'SK',
      prefix: 'chatoffice/',
      pathStyle: true,
      enabled: true,
    }
    const saved = await app.inject({
      method: 'POST',
      url: '/rpc/remoteStorage/saveSettings',
      payload: {
        args: [{ version: 1, configs: [config], defaultLocation: { configId: 'cfg-1' } }],
      },
    })
    expect(saved.statusCode).toBe(200)
    expect(saved.json().result.configs).toHaveLength(1)

    const listing = await app.inject({
      method: 'POST',
      url: '/rpc/remoteStorage/listFiles',
      payload: { args: ['cfg-1'] },
    })
    // no server listening on :9000 — the failure must surface as ok:false
    expect(listing.statusCode).toBe(400)
    expect(listing.json().ok).toBe(false)

    const unknown = await app.inject({
      method: 'POST',
      url: '/rpc/remoteStorage/listFiles',
      payload: { args: ['nope'] },
    })
    expect(unknown.statusCode).toBe(404)
    expect(unknown.json().code).toBe('UnknownStorageConfig')
  })
})
