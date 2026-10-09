import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { registerSharedAiIpc } from '../src/index'
import type { FileSourceFs } from '@chatoffice/ai-provider'

/**
 * Desktop harness auto-recognition (自动识别): with a discovered/pinned dsh
 * home the registrar must (1) fuse the harness's models into the settings
 * view next to the office's own custom profiles, and (2) route ANY profile
 * pointing at the model proxy onto the managed virtual key — healing the
 * pasted-revoked-key 401 invalid_api_key incident without user action.
 */

const temps: string[] = []
afterAll(() => {
  for (const t of temps) rmSync(t, { recursive: true, force: true })
})

function tempRoot(): string {
  const t = mkdtempSync(join(tmpdir(), 'shared-ai-ipc-test-'))
  temps.push(t)
  return t
}

const realFs: FileSourceFs = {
  readFile: async (p) => (await import('node:fs/promises')).readFile(p, 'utf8'),
  writeFile: async (p, contents) => {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(p, contents, 'utf8')
  },
}

/** the incident-shaped office file: a custom profile at the model proxy with a
 *  poisoned inline virtual key, selected as the current model */
const OFFICE_SETTINGS = {
  version: 2,
  profiles: [
    {
      id: 'custom-muwpb51k',
      vendorId: 'custom-muwpb51k',
      displayName: '察元本地模型',
      protocol: 'openai-completions',
      baseUrl: 'http://127.0.0.1:52581/v1',
      apiKey: 'chatop-INVALIDATED0000000000000000000000',
      auth: 'api-key',
      enabled: true,
      models: [{ id: 'local/qwen3-4b-instruct-2507-q3ks' }],
    },
  ],
  currentModel: { profileId: 'custom-muwpb51k', modelId: 'local/qwen3-4b-instruct-2507-q3ks' },
}

function makeHarnessHome(root: string): string {
  const home = join(root, 'dsh-home')
  const models = join(home, 'storages', 'chatop-models')
  mkdirSync(models, { recursive: true })
  writeFileSync(
    join(models, 'state.json'),
    JSON.stringify({
      proxyPort: 52581,
      instances: [{ modelId: 'qwen3-4b-instruct-2507-q3ks', port: 52674, caps: ['chat'] }],
    }),
  )
  writeFileSync(join(models, 'registry.json'), JSON.stringify({ installed: ['qwen3-4b-instruct-2507-q3ks'] }))
  writeFileSync(
    join(models, 'proxy-keys.json'),
    JSON.stringify({
      keys: [
        { agentId: 'chatoffice', key: 'chatop-agent-chatoffice-REVOKED', revoked: true },
        { agentId: 'chatoffice', key: 'chatop-agent-chatoffice-LIVE', revoked: false },
      ],
    }),
  )
  return home
}

function makeRegistrar(root: string, home: string, officeSettings: unknown) {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const officeFile = join(root, 'ai-settings.json')
  writeFileSync(officeFile, JSON.stringify(officeSettings))
  const runtime = registerSharedAiIpc({
    ipcMain: {
      handle: (channel, listener) => {
        handlers.set(channel, listener)
      },
    },
    settingsPath: officeFile,
    fs: realFs,
    dshHome: home,
    chatoffice: {
      apiKey: () => '',
      hasAuth: () => false,
      status: async () => ({ loggedIn: false }),
    },
    chatofficeLogin: () => {},
    translate: (key, params) =>
      params && typeof params.provider === 'string' ? `${key}:${params.provider}` : key,
  })
  return { runtime, handlers }
}

describe('registerSharedAiIpc × harness 自动识别', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** hermetic proxy stub: /v1/models accepts only the given bearer; the
   *  management plane issues a fresh key on demand */
  function stubProxy(acceptKey: string | null, issued = 'chatop-agent-chatoffice-ISSUED'): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith('/models')) {
          const bearer = String(init?.headers ? (init.headers as Record<string, string>).authorization : '')
          const ok = bearer === `Bearer ${acceptKey}`
          return new Response(ok ? '{"data":[]}' : '{"error":"invalid_api_key"}', {
            status: ok ? 200 : 401,
          })
        }
        if (url.includes('/api/chatop-models/proxy/keys/issue')) {
          return new Response(JSON.stringify({ ok: true, key: issued }), { status: 200 })
        }
        throw new Error(`unexpected fetch in test: ${url}`)
      }),
    )
  }

  it('fuses the chatop-local group, keeps the custom profile, and overrides the poisoned proxy key', async () => {
    stubProxy('chatop-agent-chatoffice-LIVE')
    const root = tempRoot()
    const home = makeHarnessHome(root)
    const { runtime } = makeRegistrar(root, home, OFFICE_SETTINGS)
    // let the async source upgrade settle (explicit dshHome pin → one read)
    await new Promise((r) => setTimeout(r, 20))

    const view = await runtime.getSettingsView()
    const ids = view.profiles.map((p) => p.id)
    expect(ids).toContain('chatop-local')
    expect(ids).toContain('custom-muwpb51k')
    const local = view.profiles.find((p) => p.id === 'chatop-local')
    expect(local?.baseUrl).toBe('http://127.0.0.1:52581/v1')
    expect(local?.models.map((m) => m.id)).toEqual(['local/qwen3-4b-instruct-2507-q3ks'])
    // the office pick survives the fusion
    expect(view.currentModel).toEqual({
      profileId: 'custom-muwpb51k',
      modelId: 'local/qwen3-4b-instruct-2507-q3ks',
    })

    // the poisoned inline key must lose to the managed live virtual key
    const call = await runtime.resolveForRun({
      profileId: 'custom-muwpb51k',
      modelId: 'local/qwen3-4b-instruct-2507-q3ks',
    })
    expect(call.apiKey).toBe('chatop-agent-chatoffice-LIVE')
    expect(call.baseUrl).toBe('http://127.0.0.1:52581/v1')

    // the synthetic chatop-local profile resolves to the same managed key
    const localCall = await runtime.resolveForRun({
      profileId: 'chatop-local',
      modelId: 'local/qwen3-4b-instruct-2507-q3ks',
    })
    expect(localCall.apiKey).toBe('chatop-agent-chatoffice-LIVE')
  })

  it('self-heals when the file-recorded live key is rejected: reissues through the management plane', async () => {
    // the file's non-revoked key is stale (proxy restarted); the management
    // plane mints a fresh one — no user action, no 401 surfaces
    stubProxy(null)
    const root = tempRoot()
    const home = makeHarnessHome(root)
    const { runtime } = makeRegistrar(root, home, OFFICE_SETTINGS)
    await new Promise((r) => setTimeout(r, 20))

    const call = await runtime.resolveForRun({
      profileId: 'custom-muwpb51k',
      modelId: 'local/qwen3-4b-instruct-2507-q3ks',
    })
    expect(call.apiKey).toBe('chatop-agent-chatoffice-ISSUED')
  })

  it('writes keep the office-local custom profile and the selection (read-only fusion)', async () => {
    const root = tempRoot()
    const home = makeHarnessHome(root)
    const { runtime } = makeRegistrar(root, home, OFFICE_SETTINGS)
    await new Promise((r) => setTimeout(r, 20))

    const view = await runtime.getSettingsView()
    // a settings save round-trip (KEEP_KEY sentinels merge the stored key back)
    await runtime.saveSettings(view)
    const again = await runtime.getSettingsView()
    expect(again.profiles.map((p) => p.id)).toEqual(
      expect.arrayContaining(['chatop-local', 'custom-muwpb51k']),
    )
    expect(again.currentModel).toEqual({
      profileId: 'custom-muwpb51k',
      modelId: 'local/qwen3-4b-instruct-2507-q3ks',
    })
  })

  it('no harness home → legacy pure-BYOK behavior (no synthetic group, inline key used)', async () => {
    const root = tempRoot()
    const { runtime } = makeRegistrar(root, join(root, 'absent-home'), OFFICE_SETTINGS)
    await new Promise((r) => setTimeout(r, 20))
    const view = await runtime.getSettingsView()
    expect(view.profiles.map((p) => p.id)).toEqual(['custom-muwpb51k'])
    // inline key path (poisoned or not) stays authoritative without a home
    const call = await runtime.resolveForRun({
      profileId: 'custom-muwpb51k',
      modelId: 'local/qwen3-4b-instruct-2507-q3ks',
    })
    expect(call.apiKey).toBe('chatop-INVALIDATED0000000000000000000000')
  })
})
