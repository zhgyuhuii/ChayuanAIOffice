import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  chatofficeApiKey,
  chatofficeAuthPath,
  chatofficeLoginInFlight,
  chatofficeLogout,
  chatofficeProxyFallbackPreferred,
  classifyMintResponse,
  FRESH_AUTH_REQUIRED,
  invalidateChatofficeKey,
  loadChatofficeAuth,
  recoverFromRejectedChatofficeKey,
  resetChatofficeAuthCache,
  setChaOfficeLoginOpener,
  startChatofficeLogin,
  type ChaOfficeLoginProgress,
} from '../src/chatoffice-auth'
import {
  chatofficeCliApiKey,
  setChaOfficeProxyUrl,
  watchChatofficeApiKey,
} from '../src/chatoffice'

const CODE = 'a'.repeat(64)
const AUTH_URL = `https://www.genspark.ai/api/office_addin_auth/verify?code=${CODE}`

const deviceCodeOk = {
  device_code: CODE,
  auth_url: AUTH_URL,
  expires_in: 600,
  poll_interval: 0.001,
}

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
  setChaOfficeProxyUrl('')
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

async function loginAndCollect(): Promise<ChaOfficeLoginProgress[]> {
  const events: ChaOfficeLoginProgress[] = []
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
    setChaOfficeProxyUrl('http://127.0.0.1:7890')
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
    setChaOfficeProxyUrl('http://127.0.0.1:7890')
    const fetchMock = vi.fn(async () => jsonResponse({}, { status: 502 }))
    vi.stubGlobal('fetch', fetchMock)
    const events = await loginAndCollect()
    expect(events).toEqual([{ phase: 'error', error: 'network' }])
    // both channels tried, neither adopted
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(chatofficeProxyFallbackPreferred()).toBe(false)
  })

  it('counts an endpoint 4xx (authorization_pending) as channel success', async () => {
    setChaOfficeProxyUrl('http://127.0.0.1:7890')
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
    const first: ChaOfficeLoginProgress[] = []
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

describe('watchChatofficeApiKey', () => {
  it('drops the cached key and reports the new one when another process rewrites auth.json', async () => {
    const write = (key: string) =>
      writeFileSync(join(dir, 'auth.json'), JSON.stringify({ api_key: key, key_id: key }))
    write('gsk-old')
    expect(chatofficeCliApiKey()).toBe('gsk-old')
    const seen: string[] = []
    const stop = watchChatofficeApiKey((key) => seen.push(key), 20)
    try {
      // the first stat runs off-thread; a write that lands before it becomes the baseline
      await new Promise((r) => setTimeout(r, 100))
      write('gsk-new')
      await vi.waitFor(() => expect(seen).toEqual(['gsk-new']), { timeout: 3000 })
      expect(chatofficeCliApiKey()).toBe('gsk-new')
    } finally {
      stop()
    }
  })
})

describe('classifyMintResponse', () => {
  it('reads a minted key', () => {
    expect(
      classifyMintResponse(200, { status: 0, data: { key_id: 'kid', token: 'chatoffice-x' } }),
    ).toEqual({ kind: 'ok', apiKey: 'chatoffice-x', keyId: 'kid' })
  })

  it('recognises the fresh-login refusal', () => {
    expect(classifyMintResponse(403, { detail: FRESH_AUTH_REQUIRED })).toEqual({
      kind: 'fresh_auth_required',
    })
  })

  it('keeps other refusals plain errors', () => {
    expect(classifyMintResponse(403, { detail: 'forbidden' })).toEqual({
      kind: 'error',
      reason: 'forbidden',
    })
    expect(classifyMintResponse(500, {})).toEqual({
      kind: 'error',
      reason: 'API key creation failed (HTTP 500)',
    })
    expect(classifyMintResponse(200, { status: -1, message: 'nope' })).toEqual({
      kind: 'error',
      reason: 'nope',
    })
  })
})

describe('login mint refused with fresh_browser_authentication_required', () => {
  it('reports fresh_auth_required and stores nothing', async () => {
    const flow = stubFlow()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        if (String(input).includes('/api_tokens/create')) {
          return jsonResponse({ detail: FRESH_AUTH_REQUIRED }, { status: 403 })
        }
        return flow(input, init)
      }),
    )
    const events = await loginAndCollect()
    expect(events.at(-1)).toEqual({ phase: 'error', error: 'fresh_auth_required' })
    expect(loadChatofficeAuth()).toBeNull()
  })
})

describe('recoverFromRejectedChatofficeKey', () => {
  afterEach(() => setChaOfficeLoginOpener(null))

  async function signIn(): Promise<void> {
    stubFlow()
    await loginAndCollect()
    expect(chatofficeApiKey()).toBe('chatoffice-chatoffice-key')
  }

  /** fetch stub for the silent re-mint: session ok, create answers `create` */
  function stubRemint(create: () => Response) {
    const flow = stubFlow({ pendingPolls: 0 })
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (String(input).includes('/api_tokens/create')) return create()
      return flow(input, init)
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('drops the rejected key from memory and disk', async () => {
    await signIn()
    expect(invalidateChatofficeKey('chatoffice-other')).toBe(false)
    expect(invalidateChatofficeKey('chatoffice-chatoffice-key')).toBe(true)
    expect(chatofficeApiKey()).toBe('')
    expect(existsSync(chatofficeAuthPath())).toBe(false)
  })

  it('re-mints with the stored session when the server still allows it (gate off)', async () => {
    await signIn()
    const opener = vi.fn()
    setChaOfficeLoginOpener(opener)
    const fetchMock = stubRemint(() =>
      jsonResponse({ status: 0, data: { key_id: 'kid-2', token: 'chatoffice-reminted' } }),
    )
    await expect(recoverFromRejectedChatofficeKey('chatoffice-chatoffice-key')).resolves.toBe(
      'reminted',
    )
    expect(chatofficeApiKey()).toBe('chatoffice-reminted')
    expect(opener).not.toHaveBeenCalled()
    // no device code: the stored Bearer rebuilt the session
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/device_code'))).toBe(false)
  })

  it('falls back to one device-code login when the re-mint needs a fresh login', async () => {
    await signIn()
    const opener = vi.fn()
    setChaOfficeLoginOpener(opener)
    let creates = 0
    stubRemint(() => {
      // the silent re-mint is refused; the post-login mint (fresh session) succeeds
      if (++creates === 1) return jsonResponse({ detail: FRESH_AUTH_REQUIRED }, { status: 403 })
      return jsonResponse({ status: 0, data: { key_id: 'kid-3', token: 'chatoffice-fresh' } })
    })
    await expect(recoverFromRejectedChatofficeKey('chatoffice-chatoffice-key')).resolves.toBe(
      'login_started',
    )
    expect(chatofficeApiKey()).toBe('')
    await vi.waitFor(() => expect(opener).toHaveBeenCalledWith(AUTH_URL))
    await vi.waitFor(() => expect(chatofficeApiKey()).toBe('chatoffice-fresh'))
    expect(creates).toBe(2)
  })

  it('launches the login at most once per failure streak', async () => {
    await signIn()
    const opener = vi.fn()
    setChaOfficeLoginOpener(opener)
    // the device code is never approved: the user abandoned the browser
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input)
        if (url.includes('/office_addin_auth/session')) {
          return jsonResponse({}, { setCookie: 'session_id=old; Path=/' })
        }
        if (url.includes('/api_tokens/create')) {
          return jsonResponse({ detail: FRESH_AUTH_REQUIRED }, { status: 403 })
        }
        if (url.includes('/device_code')) return jsonResponse(deviceCodeOk)
        return jsonResponse({ status: 'expired' })
      }),
    )
    const [a, b] = await Promise.all([
      recoverFromRejectedChatofficeKey('chatoffice-chatoffice-key'),
      recoverFromRejectedChatofficeKey('chatoffice-chatoffice-key'),
    ])
    expect([a, b]).toEqual(['login_started', 'login_started'])
    await vi.waitFor(() => expect(chatofficeLoginInFlight()).toBe(false))
    // further rejected calls leave the inline sign-in button to the user
    await expect(recoverFromRejectedChatofficeKey('chatoffice-chatoffice-key')).resolves.toBe(
      'login_required',
    )
    await expect(recoverFromRejectedChatofficeKey('')).resolves.toBe('login_required')
    expect(opener).toHaveBeenCalledTimes(1)
  })

  it('a reminted key rejected again goes straight to login instead of re-minting forever', async () => {
    await signIn()
    const opener = vi.fn()
    setChaOfficeLoginOpener(opener)
    let creates = 0
    stubRemint(() => {
      creates++
      return jsonResponse({
        status: 0,
        data: { key_id: `kid-${creates}`, token: 'chatoffice-reminted' },
      })
    })
    await expect(recoverFromRejectedChatofficeKey('chatoffice-chatoffice-key')).resolves.toBe(
      'reminted',
    )
    await expect(recoverFromRejectedChatofficeKey('chatoffice-reminted')).resolves.toBe(
      'login_started',
    )
    expect(creates).toBe(1)
  })

  it('without an opener only signs out locally', async () => {
    await signIn()
    stubRemint(() => jsonResponse({ detail: FRESH_AUTH_REQUIRED }, { status: 403 }))
    await expect(recoverFromRejectedChatofficeKey('chatoffice-chatoffice-key')).resolves.toBe(
      'login_required',
    )
    expect(chatofficeApiKey()).toBe('')
    expect(chatofficeLoginInFlight()).toBe(false)
  })
})

describe('sign-out during recovery', () => {
  afterEach(() => setChaOfficeLoginOpener(null))

  it('a re-mint still in flight at logout neither saves a key nor opens the login', async () => {
    stubFlow()
    await loginAndCollect()
    const opener = vi.fn()
    setChaOfficeLoginOpener(opener)
    let releaseCreate: ((r: Response) => void) | null = null
    const flow = stubFlow({ pendingPolls: 0 })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        if (String(input).includes('/api_tokens/create')) {
          return new Promise<Response>((resolve) => (releaseCreate = resolve))
        }
        return flow(input, init)
      }),
    )
    const pending = recoverFromRejectedChatofficeKey('chatoffice-chatoffice-key')
    // hold the re-mint at the create call, then sign out underneath it
    await vi.waitFor(() => expect(releaseCreate).not.toBeNull())
    await chatofficeLogout()
    releaseCreate!(jsonResponse({ status: 0, data: { key_id: 'kid-9', token: 'chatoffice-late' } }))
    await expect(pending).resolves.toBe('login_required')
    expect(chatofficeApiKey()).toBe('')
    expect(existsSync(chatofficeAuthPath())).toBe(false)
    expect(opener).not.toHaveBeenCalled()
  })

  it('callers sharing the cancelled recovery do not relaunch the login after sign-out', async () => {
    stubFlow()
    await loginAndCollect()
    const opener = vi.fn()
    setChaOfficeLoginOpener(opener)
    let releaseCreate: ((r: Response) => void) | null = null
    const flow = stubFlow({ pendingPolls: 0 })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        if (String(input).includes('/api_tokens/create')) {
          return new Promise<Response>((resolve) => (releaseCreate = resolve))
        }
        return flow(input, init)
      }),
    )
    const first = recoverFromRejectedChatofficeKey('chatoffice-chatoffice-key')
    const second = recoverFromRejectedChatofficeKey('chatoffice-chatoffice-key')
    await vi.waitFor(() => expect(releaseCreate).not.toBeNull())
    await chatofficeLogout()
    releaseCreate!(jsonResponse({ status: 0, data: { key_id: 'kid-9', token: 'chatoffice-late' } }))
    await expect(first).resolves.toBe('login_required')
    await expect(second).resolves.toBe('login_required')
    expect(opener).not.toHaveBeenCalled()
    expect(chatofficeLoginInFlight()).toBe(false)
    expect(chatofficeApiKey()).toBe('')
  })
})
