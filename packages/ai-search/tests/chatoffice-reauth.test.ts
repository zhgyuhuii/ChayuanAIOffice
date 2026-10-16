import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// the shared chatoffice CLI login (~/.chatoffice-tool-cli) is a key fallback: point
// homedir at an empty dir so the developer's real login cannot leak in
const home = vi.hoisted(() => ({ dir: '' }))
vi.mock('node:os', async (importOriginal) => {
  const os = await importOriginal<typeof import('node:os')>()
  return { ...os, homedir: () => home.dir || os.homedir() }
})

import {
  chatofficeApiKey,
  FRESH_AUTH_REQUIRED,
  resetChatofficeAuthCache,
  setChaOfficeLoginOpener,
} from '../src/chatoffice-auth'
import {
  ChaOfficeAuthError,
  chatofficeCliApiKey,
  chatofficeSlideGenerate,
  chatofficeWebSearch,
  hasChaOfficeAuth,
  isChatofficeUnauthorizedText,
  noteChatofficeCallFailure,
  noteChatofficeKeyRejected,
  resetChatofficeRejectedKeys,
} from '../src/chatoffice'

const AUTH_URL = `https://www.genspark.ai/api/office_addin_auth/verify?code=${'a'.repeat(64)}`

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'chatoffice-reauth-'))
  home.dir = dir
  process.env.CHATOFFICE_AUTH_DIR = dir
  process.env.GSK_CLI_PATH = '/fake/chatoffice.js'
  delete process.env.CHATOFFICE_API_KEY
  delete process.env.AI_SEARCH_DISABLE_GSK
  resetChatofficeAuthCache()
  resetChatofficeRejectedKeys()
  writeFileSync(
    join(dir, 'auth.json'),
    JSON.stringify({ api_key: 'gsk-expired', key_id: 'kid-1', access_token: 'bearer-old' }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  setChaOfficeLoginOpener(null)
  resetChatofficeAuthCache()
  resetChatofficeRejectedKeys()
  rmSync(dir, { recursive: true, force: true })
  home.dir = ''
  delete process.env.CHATOFFICE_AUTH_DIR
  delete process.env.GSK_CLI_PATH
})

function response(body: unknown, status = 200, setCookie?: string): Response {
  const headers = new Headers()
  if (setCookie) headers.append('set-cookie', setCookie)
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return new Response(text, { status, headers })
}

const ndjsonOk = (data: unknown) => response(`${JSON.stringify({ status: 'ok', data })}\n`)

/**
 * tool_cli answers 401 for the expired key and succeeds for any other; the
 * auth endpoints answer `create` for the silent re-mint.
 */
function stubServer(create: () => Response) {
  const toolKeys: string[] = []
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/tool_cli/')) {
      const key = (init?.headers as Record<string, string>)['X-Api-Key']!
      toolKeys.push(key)
      if (key === 'gsk-expired') return response('{"detail":"invalid api key"}', 401)
      if (url.endsWith('/slide_generate')) return ndjsonOk({ pptx_url: 'https://x/api/files/1' })
      return ndjsonOk({ download_url: 'https://93.184.216.34/deck.pptx' })
    }
    if (url.includes('/office_addin_auth/session')) {
      return response({ status: 'ok' }, 200, 'session_id=sess; Path=/')
    }
    if (url.includes('/api_tokens/create')) return create()
    if (url.includes('/office_addin_auth/device_code')) {
      return response({ device_code: 'a'.repeat(64), auth_url: AUTH_URL, expires_in: 600 })
    }
    if (url.includes('/office_addin_auth/token')) return response({ status: 'pending' })
    if (url.includes('/api_tokens/revoke')) return response({ status: 0 })
    if (url.endsWith('/deck.pptx')) return response('PK')
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, toolKeys }
}

describe('isChatofficeUnauthorizedText', () => {
  it('matches the 401 shapes of chatoffice CLI, tool_cli and the LLM proxy', () => {
    expect(isChatofficeUnauthorizedText('HTTP 401: Unauthorized')).toBe(true)
    expect(isChatofficeUnauthorizedText('tool_cli /x HTTP 401: {}')).toBe(true)
    expect(isChatofficeUnauthorizedText('Claude HTTP 401: {"error":"invalid key"}')).toBe(true)
    expect(isChatofficeUnauthorizedText('HTTP 4011')).toBe(false)
    expect(isChatofficeUnauthorizedText('HTTP 403: forbidden')).toBe(false)
  })
})

describe('tool_cli 401 recovery', () => {
  it('drops the key, re-mints with the stored session and retries once', async () => {
    const { toolKeys } = stubServer(() =>
      response({ status: 0, data: { key_id: 'kid-2', token: 'gsk-new' } }),
    )
    const opener = vi.fn()
    setChaOfficeLoginOpener(opener)
    await expect(chatofficeSlideGenerate({ brief: 'x' })).resolves.toMatchObject({
      bytes: expect.any(Uint8Array),
    })
    expect(toolKeys).toEqual(['gsk-expired', 'gsk-new', 'gsk-new'])
    expect(chatofficeApiKey()).toBe('gsk-new')
    expect(opener).not.toHaveBeenCalled()
  })

  it('signs out and opens the device-code login once when the re-mint needs a fresh login', async () => {
    const { toolKeys } = stubServer(() => response({ detail: FRESH_AUTH_REQUIRED }, 403))
    const opener = vi.fn()
    setChaOfficeLoginOpener(opener)
    await expect(chatofficeSlideGenerate({ brief: 'x' })).rejects.toBeInstanceOf(ChaOfficeAuthError)
    // the expired key is not retried and ai:chatoffice-status now reports signed-out
    expect(toolKeys).toEqual(['gsk-expired'])
    expect(chatofficeCliApiKey()).toBe('')
    expect(hasChaOfficeAuth()).toBe(false)
    await vi.waitFor(() => expect(opener).toHaveBeenCalledWith(AUTH_URL))
    // with no key left, the next action fails fast instead of looping
    await expect(chatofficeSlideGenerate({ brief: 'x' })).rejects.toThrow(/Not logged in/)
    expect(opener).toHaveBeenCalledTimes(1)
  })

  it('leaves non-401 failures alone', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response('boom', 500)),
    )
    await expect(chatofficeSlideGenerate({ brief: 'x' })).rejects.toThrow(/HTTP 500/)
    expect(chatofficeApiKey()).toBe('gsk-expired')
  })
})

describe('chatoffice CLI 401 recovery', () => {
  /** fake CLI: a 401 for the expired key (printed on stdout like the real CLI), results otherwise */
  function fakeCli(): string {
    const log = join(dir, 'cli-keys.log')
    const script = join(dir, 'fake-chatoffice.mjs')
    writeFileSync(
      script,
      [
        "import { appendFileSync } from 'node:fs'",
        `appendFileSync(${JSON.stringify(log)}, process.env.CHATOFFICE_API_KEY + '\\n')`,
        "if (process.env.CHATOFFICE_API_KEY === 'gsk-expired') {",
        "  console.log(JSON.stringify({ status: 'error', message: 'HTTP 401: Unauthorized', data: null }))",
        '  process.exit(1)',
        '}',
        "console.log(JSON.stringify({ status: 'ok', data: { organic_results: [{ title: 't', link: 'https://e.x', snippet: 's' }] } }))",
      ].join('\n'),
    )
    process.env.GSK_CLI_PATH = script
    return log
  }

  it('re-mints after a CLI 401 and reruns the command with the new key', async () => {
    const log = fakeCli()
    stubServer(() => response({ status: 0, data: { key_id: 'kid-2', token: 'gsk-new' } }))
    const out = await chatofficeWebSearch('q')
    expect(out.results).toHaveLength(1)
    expect(readFileSync(log, 'utf-8').trim().split('\n')).toEqual(['gsk-expired', 'gsk-new'])
  })

  it('reports the auth failure and signs out when a fresh login is required', async () => {
    fakeCli()
    stubServer(() => response({ detail: FRESH_AUTH_REQUIRED }, 403))
    await expect(chatofficeWebSearch('q')).rejects.toBeInstanceOf(ChaOfficeAuthError)
    expect(hasChaOfficeAuth()).toBe(false)
  })
})

describe('noteChatofficeCallFailure (LLM proxy chat/stream)', () => {
  it('marks the injected key invalid on a 401 so the sign-in button appears', () => {
    stubServer(() => response({ detail: FRESH_AUTH_REQUIRED }, 403))
    expect(noteChatofficeCallFailure('gsk-expired', new Error('Claude HTTP 401: invalid'))).toBe(
      true,
    )
    expect(hasChaOfficeAuth()).toBe(false)
  })

  it('ignores non-auth failures and calls made without the chatoffice key', () => {
    expect(noteChatofficeCallFailure('gsk-expired', new Error('HTTP 500: busy'))).toBe(false)
    expect(noteChatofficeCallFailure('', new Error('HTTP 401: bad byok key'))).toBe(false)
    expect(hasChaOfficeAuth()).toBe(true)
  })

  it('stops offering a rejected env key without touching anyone else’s file', () => {
    process.env.CHATOFFICE_API_KEY = 'gsk-env'
    try {
      stubServer(() => response({ detail: FRESH_AUTH_REQUIRED }, 403))
      expect(chatofficeCliApiKey()).toBe('gsk-env')
      noteChatofficeCallFailure('gsk-env', 'HTTP 401: Unauthorized')
      // falls through to ChaOffice's own (still valid) key
      expect(chatofficeCliApiKey()).toBe('gsk-expired')
    } finally {
      delete process.env.CHATOFFICE_API_KEY
    }
  })
})

describe('passive calls', () => {
  it('a 401 from a background call drops the key without opening the browser', async () => {
    stubServer(() => response({ detail: FRESH_AUTH_REQUIRED }, 403))
    const opener = vi.fn()
    setChaOfficeLoginOpener(opener)
    await expect(noteChatofficeKeyRejected('gsk-expired', { allowLogin: false })).resolves.toBe(
      'login_required',
    )
    expect(hasChaOfficeAuth()).toBe(false)
    expect(opener).not.toHaveBeenCalled()
  })
})
