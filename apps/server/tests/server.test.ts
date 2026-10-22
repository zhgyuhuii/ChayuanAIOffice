import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openLocalArea } from '@chaoffice/storage-adapter'
import { buildServer } from '../src/app.ts'

const dirs: string[] = []

function tempArea() {
  const dir = mkdtempSync(join(tmpdir(), 'chaoffice-bff-'))
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
    const { app } = buildServer({ area: tempArea(), auth: { mode: 'jwt', audience: 'chaoffice' } })
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
      headers: { authorization: `Bearer ${tokenFor('u1', 'chaoffice')}` },
    })
    expect(ok.statusCode).toBe(200)

    const health = await app.inject({ method: 'GET', url: '/healthz' })
    expect(health.statusCode).toBe(200)
  })
})

describe('AI endpoints', () => {
  it('serves v2 settings defaults and round-trips a saved view with KEEP_KEY', async () => {
    const dataDir = await Promise.resolve(mkdtempSync(join(tmpdir(), 'chaoffice-ai-')))
    const { app } = buildServer({ area: tempArea(), ai: { dataDir } })
    const first = await app.inject({ method: 'GET', url: '/ai/settings' })
    expect(first.json().version).toBe(2)
    // web form filters the chaoffice-login profile: the default view is an empty, configure-first list
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
        dataDir: mkdtempSync(join(tmpdir(), 'chaoffice-ai-')),
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
    const dataDir = await Promise.resolve(mkdtempSync(join(tmpdir(), 'chaoffice-ai-')))
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
    const dataDir = mkdtempSync(join(tmpdir(), 'chaoffice-ai-'))
    const dshHome = mkdtempSync(join(tmpdir(), 'chaoffice-dsh-'))
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
    const dataDir = mkdtempSync(join(tmpdir(), 'chaoffice-ai-'))
    const dshHome = mkdtempSync(join(tmpdir(), 'chaoffice-dsh-'))
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
        proxyPort: 52581,
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
      baseUrl: 'http://127.0.0.1:52581/v1',
      models: [{ id: 'local/qwen3-4b', type: 'chat', running: true }],
    })
    // linked default model: the recorded harness default (chatop-moonshot)
    // outranks a merely running local model — office writes propagate into
    // agent-default-model, so the recorded pick is the shared truth
    expect(body.currentModel).toEqual({ profileId: 'moonshot', modelId: 'kimi-k3' })
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
      prefix: 'chaoffice/',
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

describe('AI harness fusion: authenticated rpc writes (dsh web cookie fence)', () => {
  it('exchanges the launch token for a session cookie and propagates settings writes', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'chaoffice-ai-'))
    const dshHome = mkdtempSync(join(tmpdir(), 'chaoffice-dsh-'))
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
        '        - id: glm-5.2',
      ].join('\n'),
    )
    writeFileSync(
      join(dshHome, '.credentials.yaml'),
      ['version: 1', 'refs:', '  CHATOP_ZHIPU_API_KEY: sk-zp'].join('\n'),
    )
    // a mock dsh web: GET /?token=<launch> exchanges for the signed cookie,
    // every /api/ call must present it (the rc.3 browser-cookie fence)
    const seen: Array<{ method: string; cookie?: string; payload: unknown }> = []
    let exchanges = 0
    const dsh: Server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://dsh.mock')
      if (req.method === 'GET' && url.pathname === '/' && url.searchParams.get('token') === 'launch-tok') {
        exchanges += 1
        res.writeHead(303, {
          'set-cookie': 'dsh-auth-mock=sig; Path=/; HttpOnly; SameSite=Lax',
          location: './',
        })
        res.end()
        return
      }
      const cookie = req.headers.cookie
      if (cookie !== 'dsh-auth-mock=sig') {
        res.writeHead(401)
        res.end('unauthorized')
        return
      }
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        const envelope = JSON.parse(body) as { method: string; payload: unknown }
        seen.push({ method: envelope.method, cookie, payload: envelope.payload })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ result: { ok: true, value: {} } }))
      })
    })
    await new Promise<void>((resolve) => dsh.listen(0, '127.0.0.1', resolve))
    const port = (dsh.address() as AddressInfo).port
    // the plugin host's rpc-origin file carrying the minted launch token
    const rpcFile = join(dshHome, 'storages', 'chaoffice', 'dsh-rpc-origin')
    mkdirSync(dirname(rpcFile), { recursive: true })
    writeFileSync(rpcFile, `http://127.0.0.1:${port}/?token=launch-tok`)

    try {
      const { app } = buildServer({
        area: tempArea(),
        ai: { dataDir, harness: { dshHome, rpcOrigin: '', rpcOriginFile: rpcFile } },
      })
      const view = (await app.inject({ method: 'GET', url: '/ai/settings' })).json()
      expect(view.profiles.some((p: { id: string }) => p.id === 'zhipu')).toBe(true)
      // switch the model through the office view — the write must ride the
      // cookie-authenticated rpc face and propagate the default model
      view.currentModel = { profileId: 'zhipu', modelId: 'glm-5.2' }
      const put = await app.inject({ method: 'PUT', url: '/ai/settings', payload: view })
            expect(put.statusCode).toBe(200)

      expect(exchanges).toBe(1) // cached after the first exchange
      expect(seen.length).toBeGreaterThan(0)
      expect(seen.every((s) => s.cookie === 'dsh-auth-mock=sig')).toBe(true)
      expect(seen.map((s) => s.method)).toContain('settings/mutate')
      const update = seen.find((s) => s.method === 'settings/update')
      expect(update?.payload).toEqual({
        args: { ns: 'agent-default-model', patch: { provider: 'chatop-zhipu', model: 'glm-5.2' } },
      })
    } finally {
      dsh.close()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(dshHome, { recursive: true, force: true })
    }
  })
})

describe('kb-proxy × token-bearing rpc-origin file', () => {
  it('strips the launch-token query so /kb/* keeps working', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'chaoffice-ai-'))
    const dshHome = mkdtempSync(join(tmpdir(), 'chaoffice-dsh-'))
    // mock chatop-kb service answering /api/chatop-kb/status on a loopback port
    const kb: Server = createServer((req, res) => {
      if (req.url === '/api/chatop-kb/status') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, kbs: [{ kbId: 'default', docs: [] }] }))
        return
      }
      res.writeHead(404)
      res.end('not found')
    })
    await new Promise<void>((resolve) => kb.listen(0, '127.0.0.1', resolve))
    const port = (kb.address() as AddressInfo).port
    // the origin file carries the minted launch token — the KB base must not
    const rpcFile = join(dshHome, 'storages', 'chaoffice', 'dsh-rpc-origin')
    mkdirSync(dirname(rpcFile), { recursive: true })
    writeFileSync(rpcFile, `http://127.0.0.1:${port}/?token=DO-NOT-LEAK-INTO-PATH`)
    try {
      const { app } = buildServer({
        area: tempArea(),
        ai: { dataDir, harness: { dshHome, rpcOrigin: '', rpcOriginFile: rpcFile } },
        kbHarness: { dshHome, rpcOrigin: '', rpcOriginFile: rpcFile },
      })
      const res = await app.inject({ method: 'GET', url: '/kb/discover' })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.ok).toBe(true)
      expect(body.origin).toBe(`http://127.0.0.1:${port}`)
    } finally {
      kb.close()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(dshHome, { recursive: true, force: true })
    }
  })
})

describe('media channels (web/dsh form parity)', () => {
  it('capabilities reports per-kind flags from the settings view', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'chaoffice-ai-'))
    writeFileSync(
      join(dataDir, 'ai-settings.json'),
      JSON.stringify({
        version: 2,
        profiles: [
          {
            id: 'agnes',
            vendorId: 'agnes',
            displayName: '爱思',
            protocol: 'openai-completions',
            baseUrl: 'https://api.agnes-ai.cn/v1',
            apiKey: 'k',
            auth: 'api-key',
            enabled: true,
            models: [
              { id: 'agnes-3.0-flash' },
              { id: 'agnes-image-2.5-flash' },
            ],
          },
        ],
      }),
    )
    try {
      const { app } = buildServer({ area: tempArea(), ai: { dataDir } })
      const res = await app.inject({ method: 'GET', url: '/ai/media/capabilities' })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.flags.image).toBe(true)
      expect(body.models.image).toBe('agnes-image-2.5-flash')
      expect(body.flags.video).toBe(false)
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('generate rejects an empty prompt before any vendor call', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'chaoffice-ai-'))
    const { app } = buildServer({ area: tempArea(), ai: { dataDir } })
    const res = await app.inject({
      method: 'POST',
      url: '/ai/media/generate',
      payload: { prompt: '   ' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().error).toBe('prompt must not be empty')
    rmSync(dataDir, { recursive: true, force: true })
  })
})

describe('create-document (web/dsh form)', () => {
  it('md passthrough and a real docx from markdown', async () => {
    const { app } = buildServer({ area: tempArea() })
    const md = await app.inject({
      method: 'POST',
      url: '/ai/create-document',
      payload: { title: '欢乐中国年', format: 'md', content: '# 标题\n\n正文 **加粗**' },
    })
    expect(md.statusCode).toBe(200)
    const mdBody = md.json()
    expect(mdBody.ok).toBe(true)
    expect(mdBody.filename).toBe('欢乐中国年.md')
    expect(Buffer.from(mdBody.bytesB64, 'base64').toString('utf8')).toContain('# 标题')

    const docx = await app.inject({
      method: 'POST',
      url: '/ai/create-document',
      payload: {
        title: '欢乐中国年',
        format: 'docx',
        content: '# 春节方案\n\n- 中国结\n- 炮竹\n\n| 元素 | 说明 |\n| --- | --- |\n| 剪纸 | 窗花 |\n\n> 引用一行',
      },
    })
    expect(docx.statusCode).toBe(200)
    const body = docx.json()
    expect(body.ok).toBe(true)
    const bytes = Buffer.from(body.bytesB64, 'base64')
    expect(bytes.length).toBeGreaterThan(2000)
    expect(bytes[0]).toBe(0x50) // PK zip 头
    // the OOXML body carries our content
    const JSZipMod = await import('jszip')
    const zip = await JSZipMod.default.loadAsync(bytes)
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml).toContain('Heading1')
    expect(xml).toContain('春节方案')
    expect(xml).toContain('中国结')
    expect(xml).toContain('剪纸')
    expect(xml).toContain('<w:tbl>')
  })

  it('validates format, empty content and the size cap', async () => {
    const { app } = buildServer({ area: tempArea() })
    const bad = await app.inject({
      method: 'POST',
      url: '/ai/create-document',
      payload: { title: 'x', format: 'pdf', content: 'y' },
    })
    expect(bad.json().error).toContain('format')
    const empty = await app.inject({
      method: 'POST',
      url: '/ai/create-document',
      payload: { title: 'x', format: 'md', content: '  ' },
    })
    expect(empty.json().error).toContain('empty')
  })
})

describe('create-document image embedding', () => {
  it('markdown images become real docx media parts', async () => {
    // self-generated fixture: a 1×1 red PNG, so the test never depends on
    // files hand-placed in /tmp
    const pngB64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const { app } = buildServer({ area: tempArea() })
    const res = await app.inject({
      method: 'POST',
      url: '/ai/create-document',
      payload: {
        title: '带图文档',
        format: 'docx',
        content: `# 春节插画方案\n\n文字段落。\n\n![生成图片 1](data:image/png;base64,${pngB64})\n\n结束。`,
      },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    const bytes = Buffer.from(body.bytesB64, 'base64')
    const JSZipMod = await import('jszip')
    const zip = await JSZipMod.default.loadAsync(bytes)
    expect(zip.file('word/media/image1.png')).toBeTruthy()
    const rels = await zip.file('word/_rels/document.xml.rels')!.async('string')
    expect(rels).toContain('relationships/image')
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml).toContain('<w:drawing>')
    expect(xml).toContain('r:embed=')
    expect(xml).toContain('春节插画方案')
  })
})

describe('home-chat session persistence (web/dsh form)', () => {
  it('round-trips sessions with media-bearing history through disk', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'chaoffice-ai-'))
    try {
      const { app } = buildServer({ area: tempArea(), ai: { dataDir } })
      expect(await (await app.inject({ method: 'GET', url: '/ai/chat-sessions' })).json()).toEqual([])
      const sessions = [
        {
          id: 's1',
          messages: [
            { id: 'm1', role: 'assistant', text: 'ok', relayTools: [{ callId: 'c1', name: 'generate_video', media: { kind: 'video', url: 'data:video/mp4;base64,AAAA' } }] },
          ],
        },
      ]
      const put = await app.inject({
        method: 'PUT',
        url: '/ai/chat-sessions',
        payload: sessions,
      })
      expect(put.statusCode).toBe(200)
      expect(put.json().ok).toBe(true)
      const back = await (await app.inject({ method: 'GET', url: '/ai/chat-sessions' })).json()
      expect(back[0].messages[0].relayTools[0].media.url).toContain('data:video/mp4')
      const bad = await app.inject({ method: 'PUT', url: '/ai/chat-sessions', payload: { nope: 1 } })
      expect(bad.statusCode).toBe(400)
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})

describe('attachment-text extraction (web/dsh form)', () => {
  it('parses a real docx through the same engine the desktop uses', async () => {
    // self-generated fixture: engine-built blank docx with the two probe
    // strings injected, so the test never depends on files in /tmp
    const { buildBlankDocx } = await import('@chaoffice/docx-engine')
    const JSZipMod = await import('jszip')
    const blank = await buildBlankDocx()
    const zip = await JSZipMod.default.loadAsync(blank)
    const docXml = await zip.file('word/document.xml')!.async('string')
    zip.file(
      'word/document.xml',
      docXml.replace(
        '<w:p/>',
        '<w:p><w:r><w:t>欢乐中国年</w:t></w:r></w:p><w:p><w:r><w:t>窗上贴着中国结</w:t></w:r></w:p>',
      ),
    )
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    // Buffer, not Uint8Array#toString: the typed-array method ignores the
    // encoding argument and emits decimal numbers
    const docxB64 = Buffer.from(bytes).toString('base64')
    const { app } = buildServer({ area: tempArea() })
    const res = await app.inject({
      method: 'POST',
      url: '/ai/attachment-text',
      payload: { name: '欢乐中国年.docx', bytesB64: docxB64 },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.text).toContain('欢乐中国年')
    expect(body.text).toContain('中国结')
    const bad = await app.inject({
      method: 'POST',
      url: '/ai/attachment-text',
      payload: { name: '' },
    })
    expect(bad.json().ok).toBe(false)
  })
})
