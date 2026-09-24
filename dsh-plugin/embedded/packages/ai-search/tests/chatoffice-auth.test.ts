import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  chatofficeAuthPath,
  chatofficeLoginInFlight,
  chatofficeLogout,
  chatofficeProxyFallbackPreferred,
  loadChatofficeAuth,
  resetChatofficeAuthCache,
  startChatofficeLogin,
  type ChatOfficeLoginProgress,
} from '../src/chatoffice-auth'
import { chatofficeCliApiKey, setChatOfficeProxyUrl } from '../src/chatoffice'

const CODE = 'a'.repeat(64)
const AUTH_URL = `https://www.genspark.ai/api/office_addin_auth/verify?code=${CODE}`

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'chatoffice-auth-'))
  process.env.CHATOFFICE_AUTH_DIR = dir
  delete process.env.CHATOFFICE_API_KEY
  resetChatofficeAuthCache()
})

afterEach(() => {
  vi.unstubAllGlobals()
  rmSync(dir, { recursive: true, force: true })
  delete process.env.CHATOFFICE_AUTH_DIR
  delete process.env.CHATOFFICE_API_KEY
  setChatOfficeProxyUrl('')
  resetChatofficeAuthCache()
})

function jsonResponse(json: unknown, opts: { status?: number; setCookie?: string } = {}): Response {
  const headers = new Headers()
  if (opts.setCookie) headers.append('set-cookie', opts.setCookie)
  return {
    ok: (opts.status ?? 200) < 400,
    status: opts.status ?? 200,
    json: async () => json,
    headers,
  } as unknown as Response
}

/** fetch stub for the full flow; token polls: pending × (pendingPolls) then approved */
function stubFlow(opts: { pendingPolls?: number; createResponse?: unknown } = {}) {
  let tokenPolls = 0
  const fetchMock = vi.fn(async (input: string | URL, _init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/office_addin_auth/device_code')) {
      return jsonResponse({
        device_code: CODE,
        auth_url: AUTH_URL,
        expires_in: 600,
        poll_interval: 0.001,
      })
    }
    if (url.includes('/office_addin_auth/token')) {
      tokenPolls++
      if (tokenPolls <= (opts.pendingPolls ?? 1)) return jsonResponse({ status: 'pending' })
      return jsonResponse({ status: 'approved', access_token: 'bearer-token' })
    }
    if (url.includes('/office_addin_auth/session')) {
      return jsonResponse(
        { status: 'ok', cogen_id: 'user-1' },
        { setCookie: 'session_id=sess-abc; Path=/; HttpOnly' },
      )
    }
    if (url.includes('/api_tokens/create')) {
      return jsonResponse(
        opts.createResponse ?? {
          status: 0,
          data: { key_id: 'kid-1', key_name: 'chatoffice', token: 'chatoffice-chatoffice-key' },
        },
      )
    }
    if (url.includes('/api_tokens/revoke')) return jsonResponse({ status: 0 })
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function loginAndCollect(): Promise<ChatOfficeLoginProgress[]> {
  const events: ChatOfficeLoginProgress[] = []
  startChatofficeLogin((progress) => events.push(progress))
  await vi.waitFor(() => {
    expect(['success', 'error']).toContain(events.at(-1)?.phase)
  })
  return events
}

describe('startChatofficeLogin', () => {
  it('runs device_code → poll → session → key create and stores the key', async () => {
    const fetchMock = stubFlow({ pendingPolls: 2 })
    const events = await loginAndCollect()

    expect(events[0]).toEqual({ phase: 'url', url: AUTH_URL, expiresInSec: 600 })
    expect(events.at(-1)).toEqual({ phase: 'success' })

    const saved = JSON.parse(readFileSync(chatofficeAuthPath(), 'utf-8'))
    expect(saved).toEqual({
      api_key: 'chatoffice-chatoffice-key',
      key_id: 'kid-1',
      access_token: 'bearer-token',
    })
    // POSIX-only: Windows maps chmod onto the read-only bit, so 0o600 reads back as 0o666
    if (process.platform !== 'win32') {
      expect(statSync(chatofficeAuthPath()).mode & 0o777).toBe(0o600)
    }
    expect(chatofficeCliApiKey()).toBe('chatoffice-chatoffice-key')
    expect(chatofficeLoginInFlight()).toBe(false)

    // the key create call must ride on the session cookie
    const createCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/api_tokens/create'))!
    const init = createCall[1]!
    expect((init.headers as Record<string, string>).Cookie).toBe('session_id=sess-abc')
    expect(JSON.parse(String(init.body))).toEqual({ key_name: 'chatoffice' })
  })

  it('feeds chatofficeCliApiKey(), losing only to an explicit CHATOFFICE_API_KEY env override', async () => {
    stubFlow()
    await loginAndCollect()
    expect(chatofficeCliApiKey()).toBe('chatoffice-chatoffice-key')
    process.env.CHATOFFICE_API_KEY = 'chatoffice-env-override'
    expect(chatofficeCliApiKey()).toBe('chatoffice-env-override')
  })

  it('reports a network failure at device_code as error "network"', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    vi.stubGlobal('fetch', fetchMock)
    const events = await loginAndCollect()
    expect(events).toEqual([{ phase: 'error', error: 'network' }])
    expect(loadChatofficeAuth()).toBeNull()
    // no proxy registered → nothing better to retry through
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries through the registered proxy channel when the direct fetch cannot connect', async () => {
    setChatOfficeProxyUrl('http://127.0.0.1:7890')
    const flow = stubFlow()
    let deviceCodeCalls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        if (String(input).includes('/device_code') && ++deviceCodeCalls === 1) {
          throw new Error('ECONNRESET')
        }
        return flow(input, init)
      }),
    )
    const events = await loginAndCollect()
    expect(deviceCodeCalls).toBe(2)
    expect(events.at(-1)).toEqual({ phase: 'success' })
    expect(chatofficeCliApiKey()).toBe('chatoffice-chatoffice-key')
    expect(chatofficeProxyFallbackPreferred()).toBe(true)
  })

  it('treats a gateway status (502) as channel failure: fails over without adopting the channel', async () => {
    setChatOfficeProxyUrl('http://127.0.0.1:7890')
    const fetchMock = vi.fn(async () => jsonResponse({}, { status: 502 }))
    vi.stubGlobal('fetch', fetchMock)
    const events = await loginAndCollect()
    expect(events).toEqual([{ phase: 'error', error: 'network' }])
    // both channels tried, neither adopted
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(chatofficeProxyFallbackPreferred()).toBe(false)
  })

  it('counts an endpoint 4xx (authorization_pending) as channel success', async () => {
    setChatOfficeProxyUrl('http://127.0.0.1:7890')
    const flow = stubFlow({ pendingPolls: 0 })
    let deviceCodeCalls = 0
    let tokenCalls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('/device_code') && ++deviceCodeCalls === 1) {
          throw new Error('ECONNRESET')
        }
        if (url.includes('/office_addin_auth/token') && ++tokenCalls === 1) {
          return jsonResponse({ status: 'pending' }, { status: 400 })
        }
        return flow(input, init)
      }),
    )
    const events = await loginAndCollect()
    expect(events.at(-1)).toEqual({ phase: 'success' })
    // the 400 poll neither failed over to a second attempt nor dropped the preference
    expect(tokenCalls).toBe(2)
    expect(chatofficeProxyFallbackPreferred()).toBe(true)
  })

  it('reports an expired device code as error "expired"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input)
        if (url.includes('/device_code')) {
          return jsonResponse({
            device_code: CODE,
            auth_url: AUTH_URL,
            expires_in: 600,
            poll_interval: 0.001,
          })
        }
        return jsonResponse({ status: 'expired' })
      }),
    )
    const events = await loginAndCollect()
    expect(events.at(-1)).toEqual({ phase: 'error', error: 'expired' })
  })

  it('surfaces the server message when key creation fails', async () => {
    stubFlow({ createResponse: { status: -1, message: 'Invalid API key name.' } })
    const events = await loginAndCollect()
    expect(events.at(-1)).toEqual({ phase: 'error', error: 'Invalid API key name.' })
    expect(loadChatofficeAuth()).toBeNull()
  })

  it('re-login revokes the superseded key (best-effort)', async () => {
    stubFlow()
    await loginAndCollect()

    const fetchMock = stubFlow({
      createResponse: {
        status: 0,
        data: { key_id: 'kid-2', token: 'chatoffice-chatoffice-key-2' },
      },
    })
    await loginAndCollect()
    expect(loadChatofficeAuth()).toMatchObject({
      apiKey: 'chatoffice-chatoffice-key-2',
      keyId: 'kid-2',
    })
    await vi.waitFor(() => {
      const revoke = fetchMock.mock.calls.find(([u]) => String(u).includes('/api_tokens/revoke'))
      expect(revoke).toBeDefined()
      expect(JSON.parse(String(revoke![1]!.body))).toEqual({ key_id: 'kid-1' })
    })
  })

  it('a new login cancels the in-flight one without emitting on it', async () => {
    // first flow polls pending forever
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input)
        if (url.includes('/device_code')) {
          return jsonResponse({
            device_code: CODE,
            auth_url: AUTH_URL,
            expires_in: 600,
            poll_interval: 0.001,
          })
        }
        return jsonResponse({ status: 'pending' })
      }),
    )
    const first: ChatOfficeLoginProgress[] = []
    startChatofficeLogin((progress) => first.push(progress))
    await vi.waitFor(() => expect(first.length).toBeGreaterThan(0))
    expect(chatofficeLoginInFlight()).toBe(true)

    stubFlow()
    const second = await loginAndCollect()
    expect(second.at(-1)).toEqual({ phase: 'success' })
    expect(first.every((e) => e.phase === 'url')).toBe(true)
  })
})

describe('chatofficeLogout', () => {
  it('revokes the key server-side and removes the local file', async () => {
    const fetchMock = stubFlow()
    await loginAndCollect()

    await chatofficeLogout()
    expect(existsSync(chatofficeAuthPath())).toBe(false)
    expect(chatofficeCliApiKey()).toBe('')
    const revokeCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/api_tokens/revoke'))!
    const init = revokeCall[1]!
    expect((init.headers as Record<string, string>).Cookie).toBe('session_id=sess-abc')
    expect(JSON.parse(String(init.body))).toEqual({ key_id: 'kid-1' })
  })

  it('still clears locally when the server revoke fails', async () => {
    stubFlow()
    await loginAndCollect()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await chatofficeLogout()
    expect(existsSync(chatofficeAuthPath())).toBe(false)
    expect(loadChatofficeAuth()).toBeNull()
  })

  it('is a no-op network-wise when not signed in', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await chatofficeLogout()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
