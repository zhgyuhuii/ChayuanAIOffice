/**
 * ChatOffice's own ChatOffice identity: device-code login (office_addin_auth,
 * app_type=chatoffice) minting a chatoffice API key named "chatoffice" — the key_name
 * lands in billing as billing_tag, attributing all traffic (incl. chatoffice CLI
 * subprocesses) to ChatOffice. Stored in ~/.chatoffice/auth.json, deliberately
 * NOT the shared config.json that Claw Desktop overwrites on every launch.
 *
 * Flow: POST /device_code → browser approve → poll /token for a 30-day Bearer
 * → POST /session for a cookie → POST /api/api_tokens/create. The Bearer is
 * kept to rebuild a session later (key revoke on logout).
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { asRecord, chatofficeProxyUrl } from './shared'

/** Progress event for the browser login flow. */
export interface ChatOfficeLoginProgress {
  phase: 'url' | 'success' | 'error'
  url?: string
  expiresInSec?: number
  /** 'network' | 'expired' | raw error text */
  error?: string
}

const APP_TYPE = 'chatoffice'
const KEY_NAME = 'chatoffice'
const HTTP_TIMEOUT_MS = 30_000

function baseUrl(): string {
  return (process.env.GSK_BASE_URL || 'https://www.genspark.ai').replace(/\/$/, '')
}

let cachedFetch: typeof fetch | undefined

/**
 * Cloudflare bot-challenges /api/office_addin_auth for non-browser clients;
 * Chromium's net.fetch passes (and exposes getSetCookie). Falls back to
 * global fetch outside the Electron main process (tests). Note net.fetch is
 * not spec fetch: an explicit Cookie header is forwarded, not stripped
 * (verified against a header-echo server).
 */
function resolveFetch(): typeof fetch {
  if (cachedFetch) return cachedFetch
  let impl: typeof fetch = (...args) => fetch(...args)
  if (process.versions.electron) {
    try {
      const require = createRequire(import.meta.url)
      const { net } = require('electron') as { net?: { fetch?: typeof fetch } }
      if (net?.fetch) impl = net.fetch.bind(net)
    } catch {
      /* non-main context: keep global fetch */
    }
  }
  cachedFetch = impl
  return impl
}

interface ProxySession {
  setProxy: (config: { proxyRules: string }) => Promise<void>
  fetch: typeof fetch
}

let proxyFetchCache: { url: string; impl: typeof fetch } | undefined
let proxyFallbackPreferred = false

// proxy/gateway rejections, not endpoint answers — must not mark a channel healthy
const GATEWAY_ERROR_STATUSES = new Set([407, 502, 504])

/**
 * Retry channel when the primary fetch cannot connect: net.fetch follows only
 * Chromium's own proxy config, so a proxy the bootstraps resolved from env
 * vars — or a system proxy Chromium failed to apply — never reaches it. Pin a
 * dedicated session to the registered proxy, keeping Chromium TLS (Node fetch
 * is bot-challenged, see resolveFetch). null when no proxy is registered.
 */
async function proxyFallbackFetch(): Promise<typeof fetch | null> {
  const proxyUrl = chatofficeProxyUrl()
  if (!proxyUrl) return null
  if (proxyFetchCache?.url === proxyUrl) return proxyFetchCache.impl
  let impl: typeof fetch = (...args) => fetch(...args)
  if (process.versions.electron) {
    try {
      const require = createRequire(import.meta.url)
      const { session } = require('electron') as {
        session?: { fromPartition: (partition: string) => ProxySession }
      }
      if (session) {
        const ses = session.fromPartition('chatoffice-login-proxy')
        await ses.setProxy({ proxyRules: proxyUrl })
        impl = ses.fetch.bind(ses)
      }
    } catch {
      /* non-main context: global fetch rides the bootstrap's undici dispatcher */
    }
  }
  proxyFetchCache = { url: proxyUrl, impl }
  return impl
}

/** Primary + fallback, ordered by which one last succeeded after a failover. */
async function loginFetchChannels(): Promise<(typeof fetch)[]> {
  const primary = resolveFetch()
  const fallback = await proxyFallbackFetch()
  if (!fallback) return [primary]
  return proxyFallbackPreferred ? [fallback, primary] : [primary, fallback]
}

/** Override dir via CHATOFFICE_AUTH_DIR (test isolation). */
export function chatofficeAuthPath(): string {
  return join(process.env.CHATOFFICE_AUTH_DIR || join(homedir(), '.chatoffice'), 'auth.json')
}

export interface ChatofficeAuth {
  apiKey: string
  keyId?: string
  accessToken?: string
}

let cachedAuth: ChatofficeAuth | null | undefined

function readAuthFile(): ChatofficeAuth | null {
  try {
    const raw = asRecord(JSON.parse(readFileSync(chatofficeAuthPath(), 'utf-8')))
    if (typeof raw.api_key !== 'string' || !raw.api_key) return null
    return {
      apiKey: raw.api_key,
      ...(typeof raw.key_id === 'string' && raw.key_id ? { keyId: raw.key_id } : {}),
      ...(typeof raw.access_token === 'string' && raw.access_token
        ? { accessToken: raw.access_token }
        : {}),
    }
  } catch {
    return null
  }
}

export function loadChatofficeAuth(): ChatofficeAuth | null {
  if (cachedAuth === undefined) cachedAuth = readAuthFile()
  return cachedAuth
}

/** The ChatOffice-named api key; '' when not signed in. Cached (invalidated by login/logout). */
export function chatofficeApiKey(): string {
  return loadChatofficeAuth()?.apiKey ?? ''
}

function saveAuth(auth: ChatofficeAuth): void {
  const path = chatofficeAuthPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(
    path,
    JSON.stringify(
      { api_key: auth.apiKey, key_id: auth.keyId, access_token: auth.accessToken },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  )
  cachedAuth = auth
}

function clearAuth(): void {
  try {
    if (existsSync(chatofficeAuthPath())) unlinkSync(chatofficeAuthPath())
  } catch {
    /* local sign-out must not throw */
  }
  cachedAuth = null
}

// ── HTTP helpers ─────────────────────────────────────────────────────

class LoginFlowError extends Error {
  constructor(
    /** matches ChatOfficeLoginProgress.error conventions */
    public reason: 'network' | 'expired' | string,
  ) {
    super(reason)
  }
}

async function httpJson(
  url: string,
  init: RequestInit & { signal: AbortSignal },
): Promise<{ resp: Response; json: Record<string, unknown> }> {
  const flowSignal = init.signal
  let resp: Response | undefined
  const channels = await loginFetchChannels()
  for (const [i, impl] of channels.entries()) {
    try {
      // per-attempt timeout: a blackholed direct connection would otherwise
      // hang for the OS TCP timeout before the fallback ever runs
      resp = await impl(url, {
        ...init,
        signal: AbortSignal.any([flowSignal, AbortSignal.timeout(HTTP_TIMEOUT_MS)]),
      })
    } catch (e) {
      if (flowSignal.aborted) throw e
      continue
    }
    // gateway statuses fail over like connect errors (endpoint 4xx such as the
    // poll's authorization_pending still counts as a healthy channel)
    if (GATEWAY_ERROR_STATUSES.has(resp.status)) continue
    // the losing channel keeps losing on proxy-only networks — lead with the winner
    if (i > 0) proxyFallbackPreferred = !proxyFallbackPreferred
    break
  }
  if (!resp) throw new LoginFlowError('network')
  let json: Record<string, unknown> = {}
  try {
    json = asRecord(await resp.json())
  } catch {
    /* non-JSON body; status checks below carry the error */
  }
  return { resp, json }
}

function sessionCookie(resp: Response): string {
  const headers = resp.headers as Headers & { getSetCookie?: () => string[] }
  const cookies = headers.getSetCookie?.() ?? []
  if (cookies.length === 0) {
    const single = resp.headers.get('set-cookie')
    if (single) cookies.push(single)
  }
  return cookies.map((c) => c.split(';')[0]!).join('; ')
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('login cancelled', 'AbortError'))
    }
    // remove on resolve — the poll loop reuses one signal and would accumulate listeners
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

// ── Device-code login ────────────────────────────────────────────────

async function revokeKey(cookie: string, keyId: string, signal: AbortSignal): Promise<void> {
  await resolveFetch()(`${baseUrl()}/api/api_tokens/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ key_id: keyId }),
    signal,
  })
}

/** Bearer token → session cookie. Shared by login (key create) and logout (key revoke). */
async function establishSession(accessToken: string, signal: AbortSignal): Promise<string> {
  const { resp } = await httpJson(`${baseUrl()}/api/office_addin_auth/session`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  })
  const cookie = sessionCookie(resp)
  if (!resp.ok || !cookie) throw new LoginFlowError(`session failed (HTTP ${resp.status})`)
  return cookie
}

async function runDeviceLogin(
  signal: AbortSignal,
  emit: (progress: ChatOfficeLoginProgress) => void,
): Promise<void> {
  const { resp, json } = await httpJson(
    `${baseUrl()}/api/office_addin_auth/device_code?app_type=${APP_TYPE}`,
    { method: 'POST', signal },
  )
  const code = String(json.device_code ?? '')
  const authUrl = String(json.auth_url ?? '')
  if (!resp.ok || !code || !authUrl) throw new LoginFlowError('network')
  const expiresInSec = Number(json.expires_in) > 0 ? Number(json.expires_in) : 600
  const pollMs = Number(json.poll_interval) > 0 ? Number(json.poll_interval) * 1000 : 2000
  emit({ phase: 'url', url: authUrl, expiresInSec })

  const deadline = Date.now() + expiresInSec * 1000
  let accessToken: string
  for (;;) {
    if (Date.now() >= deadline) throw new LoginFlowError('expired')
    await sleep(pollMs, signal)
    const { json: poll } = await httpJson(`${baseUrl()}/api/office_addin_auth/token?code=${code}`, {
      method: 'GET',
      signal,
    })
    const status = String(poll.status ?? '')
    if (status === 'pending') continue
    if (status === 'approved') {
      accessToken = String(poll.access_token ?? '')
      if (!accessToken) throw new LoginFlowError('expired')
      break
    }
    throw new LoginFlowError('expired')
  }

  const cookie = await establishSession(accessToken, signal)
  const { json: created } = await httpJson(`${baseUrl()}/api/api_tokens/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ key_name: KEY_NAME }),
    signal,
  })
  const data = asRecord(created.data)
  const apiKey = typeof data.token === 'string' ? data.token : ''
  if (!apiKey) {
    throw new LoginFlowError(String(created.message ?? 'API key creation failed'))
  }
  const previousKeyId = loadChatofficeAuth()?.keyId
  saveAuth({
    apiKey,
    ...(typeof data.key_id === 'string' ? { keyId: data.key_id } : {}),
    accessToken,
  })
  emit({ phase: 'success' })
  // re-login replaces the key: revoke the superseded one so it can't pile up
  // server-side (best-effort — the new login must not fail on this)
  if (previousKeyId && previousKeyId !== data.key_id) {
    try {
      await revokeKey(cookie, previousKeyId, signal)
    } catch {
      /* ignore */
    }
  }
}

let activeLogin: { cancel: () => void } | null = null

/**
 * Starts the ChatOffice device-code login, cancelling a previous in-flight one
 * (its device code would otherwise be approved into a dead flow). The caller
 * opens `url` in the system browser. Returns whether the flow was started.
 */
export function startChatofficeLogin(
  onEvent?: (progress: ChatOfficeLoginProgress) => void,
): boolean {
  activeLogin?.cancel()
  const emit = onEvent ?? (() => {})
  const controller = new AbortController()
  let done = false
  const self = {
    cancel: () => {
      done = true
      controller.abort()
    },
  }
  activeLogin = self
  const finish = (progress: ChatOfficeLoginProgress) => {
    if (done) return
    done = true
    if (activeLogin === self) activeLogin = null
    emit(progress)
  }
  void runDeviceLogin(controller.signal, (progress) => {
    if (done) return
    if (progress.phase === 'url') emit(progress)
    else finish(progress)
  }).catch((e: unknown) => {
    if (controller.signal.aborted) return
    finish({
      phase: 'error',
      error: e instanceof LoginFlowError ? e.reason : String((e as Error)?.message ?? e),
    })
  })
  return true
}

/** True while a login started via startChatofficeLogin is in flight. */
export function chatofficeLoginInFlight(): boolean {
  return activeLogin !== null
}

/**
 * Fire-and-forget login for entry points without progress UI. Reuses an
 * in-flight flow (restarting would strand it on a dead device code); openUrl
 * is the caller's browser opener (this module is Electron-free).
 */
export function ensureChatofficeLogin(openUrl: (url: string) => void): void {
  if (chatofficeLoginInFlight()) return
  startChatofficeLogin((progress) => {
    if (progress.url) openUrl(progress.url)
  })
}

/**
 * Signs out of ChatOffice only: best-effort server-side revoke of the
 * chatoffice key, then local removal. The shared chatoffice CLI login
 * (~/.chatoffice-tool-cli) is untouched — terminal chatoffice and Claw keep working.
 */
export async function chatofficeLogout(): Promise<void> {
  const auth = loadChatofficeAuth()
  if (auth?.accessToken && auth.keyId) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)
    try {
      const cookie = await establishSession(auth.accessToken, controller.signal)
      await revokeKey(cookie, auth.keyId, controller.signal)
    } catch {
      /* revoke is best-effort; the local key removal below is the contract */
    } finally {
      clearTimeout(timer)
    }
  }
  clearAuth()
}

/** Test hook: drop the auth cache and fetch-channel state. */
export function resetChatofficeAuthCache(): void {
  cachedAuth = undefined
  proxyFetchCache = undefined
  proxyFallbackPreferred = false
}

/** Test hook: whether the proxy fallback channel is currently preferred. */
export function chatofficeProxyFallbackPreferred(): boolean {
  return proxyFallbackPreferred
}
