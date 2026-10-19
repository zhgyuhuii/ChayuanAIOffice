import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  chaofficeApiKey,
  chaofficeAuthPath,
  chaofficeLoginInFlight,
  chaofficeLogout,
  chaofficeProxyFallbackPreferred,
  classifyMintResponse,
  FRESH_AUTH_REQUIRED,
  invalidateChaofficeKey,
  loadChaofficeAuth,
  recoverFromRejectedChaofficeKey,
  resetChaofficeAuthCache,
  setChaOfficeLoginOpener,
  startChaofficeLogin,
  type ChaOfficeLoginProgress,
} from '../src/chaoffice-auth'
import {
  chaofficeCliApiKey,
  setChaOfficeProxyUrl,
  watchChaofficeApiKey,
} from '../src/chaoffice'

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
  dir = mkdtempSync(join(tmpdir(), 'chaoffice-auth-'))
  process.env.CHAOFFICE_AUTH_DIR = dir
  delete process.env.CHAOFFICE_API_KEY
  delete process.env.GENOFFICE_NATIVE_WAF
  resetChaofficeAuthCache()
})

afterEach(() => {
  vi.unstubAllGlobals()
  rmSync(dir, { recursive: true, force: true })
  delete process.env.CHAOFFICE_AUTH_DIR
  delete process.env.CHAOFFICE_API_KEY
  delete process.env.GENOFFICE_NATIVE_WAF
  setChaOfficeProxyUrl('')
  resetChaofficeAuthCache()
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
function stubFlow(
  opts: {
    pendingPolls?: number
    createResponse?: unknown
    /** overrides fields of the device_code response (poll_interval, expires_in, …) */
    deviceCode?: Record<string, unknown>
    /** keep answering "pending", so only the expiry can end the flow */
    alwaysPending?: boolean
    nativePass?: string
  } = {},
) {
 let tokenPolls = 0
  const fetchMock = vi.fn(async (input: string | URL, _init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/api/native-waf/pass') && opts.nativePass) {
      return Response.json({ data: { token: opts.nativePass } })
    }
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
          data: { key_id: 'kid-1', key_name: 'chaoffice', token: 'chaoffice-chaoffice-key' },
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
  startChaofficeLogin((progress) => events.push(progress))
  await vi.waitFor(() => {
    expect(['success', 'error']).toContain(events.at(-1)?.phase)
  })
  return events
}

describe('startChaofficeLogin', () => {
  it('opt-in signs the cookie mint only and preserves Bearer session exchange', async () => {
    process.env.GENOFFICE_NATIVE_WAF = '1'
    const token = `${Math.floor(Date.now() / 1000)}-${'a'.repeat(43)}`
    const fetchMock = stubFlow({ nativePass: token, pendingPolls: 0 })
    const events = await loginAndCollect()
    expect(events.at(-1)?.phase).toBe('success')
    const calls = fetchMock.mock.calls
    const mint = calls.find(([u]) => String(u).includes('/api_tokens/create'))!
    expect(new Headers(mint[1]?.headers).get('X-Genspark-Native-Pass')).toBe(token)
    expect(new Headers(mint[1]?.headers).get('Cookie')).toBe('session_id=sess-abc')
    expect(mint[1]?.redirect).toBe('manual')
    const session = calls.find(([u]) => String(u).includes('/office_addin_auth/session'))!
    expect(new Headers(session[1]?.headers).get('Authorization')).toBe('Bearer bearer-token')
    expect(new Headers(session[1]?.headers).has('X-Genspark-Native-Pass')).toBe(false)
    expect(calls.filter(([u]) => String(u).endsWith('/api/native-waf/pass'))).toHaveLength(1)
  })
 it('runs device_code → poll → session → key create and stores the key', async () => {
    const fetchMock = stubFlow({ pendingPolls: 2 })
    const events = await loginAndCollect()

    expect(events[0]).toEqual({ phase: 'url', url: AUTH_URL, expiresInSec: 600 })
    expect(events.at(-1)).toEqual({ phase: 'success' })

    const saved = JSON.parse(readFileSync(chaofficeAuthPath(), 'utf-8'))
    expect(saved).toEqual({
      api_key: 'chaoffice-chaoffice-key',
      key_id: 'kid-1',
      access_token: 'bearer-token',
    })
    // POSIX-only: Windows maps chmod onto the read-only bit, so 0o600 reads back as 0o666
    if (process.platform !== 'win32') {
      expect(statSync(chaofficeAuthPath()).mode & 0o777).toBe(0o600)
    }
    expect(chaofficeCliApiKey()).toBe('chaoffice-chaoffice-key')
    expect(chaofficeLoginInFlight()).toBe(false)

    // the key create call must ride on the session cookie
    const createCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/api_tokens/create'))!
    const init = createCall[1]!
    expect((init.headers as Record<string, string>).Cookie).toBe('session_id=sess-abc')
    expect(JSON.parse(String(init.body))).toEqual({ key_name: 'chaoffice' })
  })

  it('feeds chaofficeCliApiKey(), losing only to an explicit CHAOFFICE_API_KEY env override', async () => {
    stubFlow()
    await loginAndCollect()
    expect(chaofficeCliApiKey()).toBe('chaoffice-chaoffice-key')
    process.env.CHAOFFICE_API_KEY = 'chaoffice-env-override'
    expect(chaofficeCliApiKey()).toBe('chaoffice-env-override')
  })

  it('reports a network failure at device_code as error "network"', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    vi.stubGlobal('fetch', fetchMock)
    const events = await loginAndCollect()
    expect(events).toEqual([{ phase: 'error', error: 'network' }])
    expect(loadChaofficeAuth()).toBeNull()
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
    expect(chaofficeCliApiKey()).toBe('chaoffice-chaoffice-key')
    expect(chaofficeProxyFallbackPreferred()).toBe(true)
  })

  it('treats a gateway status (502) as channel failure: fails over without adopting the channel', async () => {
    setChaOfficeProxyUrl('http://127.0.0.1:7890')
    const fetchMock = vi.fn(async () => jsonResponse({}, { status: 502 }))
    vi.stubGlobal('fetch', fetchMock)
    const events = await loginAndCollect()
    expect(events).toEqual([{ phase: 'error', error: 'network' }])
    // both channels tried, neither adopted
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(chaofficeProxyFallbackPreferred()).toBe(false)
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
    expect(chaofficeProxyFallbackPreferred()).toBe(true)
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
    expect(loadChaofficeAuth()).toBeNull()
  })

  it('re-login revokes the superseded key (best-effort)', async () => {
    stubFlow()
    await loginAndCollect()

    const fetchMock = stubFlow({
      createResponse: {
        status: 0,
        data: { key_id: 'kid-2', token: 'chaoffice-chaoffice-key-2' },
      },
    })
    await loginAndCollect()
    expect(loadChaofficeAuth()).toMatchObject({
      apiKey: 'chaoffice-chaoffice-key-2',
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
    startChaofficeLogin((progress) => first.push(progress))
    await vi.waitFor(() => expect(first.length).toBeGreaterThan(0))
    expect(chaofficeLoginInFlight()).toBe(true)

    stubFlow()
    const second = await loginAndCollect()
    expect(second.at(-1)).toEqual({ phase: 'success' })
    expect(first.every((e) => e.phase === 'url')).toBe(true)
  })
})

describe('chaofficeLogout', () => {
  it('revokes the key server-side and removes the local file', async () => {
    const fetchMock = stubFlow()
    await loginAndCollect()

    await chaofficeLogout()
    expect(existsSync(chaofficeAuthPath())).toBe(false)
    expect(chaofficeCliApiKey()).toBe('')
    const revokeCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/api_tokens/revoke'))!
    const init = revokeCall[1]!
    expect((init.headers as Record<string, string>).Cookie).toBe('session_id=sess-abc')
    expect(JSON.parse(String(init.body))).toEqual({ key_id: 'kid-1' })
  })

  it('still clears locally when the server revoke fails', async () => {
    stubFlow()
    await loginAndCollect()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await chaofficeLogout()
    expect(existsSync(chaofficeAuthPath())).toBe(false)
    expect(loadChaofficeAuth()).toBeNull()
  })

  it('is a no-op network-wise when not signed in', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await chaofficeLogout()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('watchChaofficeApiKey', () => {
  it('drops the cached key and reports the new one when another process rewrites auth.json', async () => {
    const write = (key: string) =>
      writeFileSync(join(dir, 'auth.json'), JSON.stringify({ api_key: key, key_id: key }))
    write('gsk-old')
    expect(chaofficeCliApiKey()).toBe('gsk-old')
    const seen: string[] = []
    const stop = watchChaofficeApiKey((key) => seen.push(key), 20)
    try {
      // the first stat runs off-thread; a write that lands before it becomes the baseline
      await new Promise((r) => setTimeout(r, 100))
      write('gsk-new')
      await vi.waitFor(() => expect(seen).toEqual(['gsk-new']), { timeout: 3000 })
      expect(chaofficeCliApiKey()).toBe('gsk-new')
    } finally {
      stop()
    }
  })
})

describe('classifyMintResponse', () => {
  it('reads a minted key', () => {
    expect(
      classifyMintResponse(200, { status: 0, data: { key_id: 'kid', token: 'chaoffice-x' } }),
    ).toEqual({ kind: 'ok', apiKey: 'chaoffice-x', keyId: 'kid' })
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
    expect(loadChaofficeAuth()).toBeNull()
  })
})

describe('recoverFromRejectedChaofficeKey', () => {
  afterEach(() => setChaOfficeLoginOpener(null))

  async function signIn(): Promise<void> {
    stubFlow()
    await loginAndCollect()
    expect(chaofficeApiKey()).toBe('chaoffice-chaoffice-key')
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
    expect(invalidateChaofficeKey('chaoffice-other')).toBe(false)
    expect(invalidateChaofficeKey('chaoffice-chaoffice-key')).toBe(true)
    expect(chaofficeApiKey()).toBe('')
    expect(existsSync(chaofficeAuthPath())).toBe(false)
  })

  it('re-mints with the stored session when the server still allows it (gate off)', async () => {
    await signIn()
    const opener = vi.fn()
    setChaOfficeLoginOpener(opener)
    const fetchMock = stubRemint(() =>
      jsonResponse({ status: 0, data: { key_id: 'kid-2', token: 'chaoffice-reminted' } }),
    )
    await expect(recoverFromRejectedChaofficeKey('chaoffice-chaoffice-key')).resolves.toBe(
      'reminted',
    )
    expect(chaofficeApiKey()).toBe('chaoffice-reminted')
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
      return jsonResponse({ status: 0, data: { key_id: 'kid-3', token: 'chaoffice-fresh' } })
    })
    await expect(recoverFromRejectedChaofficeKey('chaoffice-chaoffice-key')).resolves.toBe(
      'login_started',
    )
    expect(chaofficeApiKey()).toBe('')
    await vi.waitFor(() => expect(opener).toHaveBeenCalledWith(AUTH_URL))
    await vi.waitFor(() => expect(chaofficeApiKey()).toBe('chaoffice-fresh'))
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
      recoverFromRejectedChaofficeKey('chaoffice-chaoffice-key'),
      recoverFromRejectedChaofficeKey('chaoffice-chaoffice-key'),
    ])
    expect([a, b]).toEqual(['login_started', 'login_started'])
    await vi.waitFor(() => expect(chaofficeLoginInFlight()).toBe(false))
    // further rejected calls leave the inline sign-in button to the user
    await expect(recoverFromRejectedChaofficeKey('chaoffice-chaoffice-key')).resolves.toBe(
      'login_required',
    )
    await expect(recoverFromRejectedChaofficeKey('')).resolves.toBe('login_required')
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
        data: { key_id: `kid-${creates}`, token: 'chaoffice-reminted' },
      })
    })
    await expect(recoverFromRejectedChaofficeKey('chaoffice-chaoffice-key')).resolves.toBe(
      'reminted',
    )
    await expect(recoverFromRejectedChaofficeKey('chaoffice-reminted')).resolves.toBe(
      'login_started',
    )
    expect(creates).toBe(1)
  })

  it('without an opener only signs out locally', async () => {
    await signIn()
    stubRemint(() => jsonResponse({ detail: FRESH_AUTH_REQUIRED }, { status: 403 }))
    await expect(recoverFromRejectedChaofficeKey('chaoffice-chaoffice-key')).resolves.toBe(
      'login_required',
    )
    expect(chaofficeApiKey()).toBe('')
    expect(chaofficeLoginInFlight()).toBe(false)
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
    const pending = recoverFromRejectedChaofficeKey('chaoffice-chaoffice-key')
    // hold the re-mint at the create call, then sign out underneath it
    await vi.waitFor(() => expect(releaseCreate).not.toBeNull())
    await chaofficeLogout()
    releaseCreate!(jsonResponse({ status: 0, data: { key_id: 'kid-9', token: 'chaoffice-late' } }))
    await expect(pending).resolves.toBe('login_required')
    expect(chaofficeApiKey()).toBe('')
    expect(existsSync(chaofficeAuthPath())).toBe(false)
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
    const first = recoverFromRejectedChaofficeKey('chaoffice-chaoffice-key')
    const second = recoverFromRejectedChaofficeKey('chaoffice-chaoffice-key')
    await vi.waitFor(() => expect(releaseCreate).not.toBeNull())
    await chaofficeLogout()
    releaseCreate!(jsonResponse({ status: 0, data: { key_id: 'kid-9', token: 'chaoffice-late' } }))
    await expect(first).resolves.toBe('login_required')
    await expect(second).resolves.toBe('login_required')
    expect(opener).not.toHaveBeenCalled()
    expect(chaofficeLoginInFlight()).toBe(false)
    expect(chaofficeApiKey()).toBe('')
  })
})
