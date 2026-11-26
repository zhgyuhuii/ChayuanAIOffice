/**
 * WeChat scan-code login backed by the aidooo.com website (LOCAL module —
 * upstream has no account surface here). Renderer CSP forbids remote img src
 * and cross-origin fetch, so everything HTTP happens main-side and images are
 * converted to data: URLs before crossing IPC.
 *
 * Server contract (website/server/market/wx-auth-routes.js):
 *   GET /api/auth/wx/qr-start?client=desktop → { mode:'mpqrcode'|'qrconnect',
 *     state, url, expiresIn }  — desktop forces the 公众号 scene-QR mode so
 *     "follow the official account to log in" is enforced (subscribe event
 *     completes the ticket; qrconnect has no follow gate and is only a
 *     fallback when the MP credentials are not configured).
 *   GET /api/auth/wx/poll?state=&client=desktop → { status:'pending'|'ok'|
 *     'expired', token?, user? }  — `token` is a wx-user JWT only present for
 *     desktop (browsers get an HttpOnly cookie we cannot hold).
 *   GET /api/auth/wx/me  with `Authorization: Bearer <token>` → { user } —
 *     session validation + profile refresh (real nickname/avatar arrive later
 *     via the snsapi_userinfo "complete profile" QR; the scene-QR event only
 *     carries the openid, so fresh accounts start with an anonymous nickname).
 *
 * Session persistence: ~/.chaoffice/wx-user.json (0600), same pattern as
 * chaoffice-auth.ts. The token TTL is 7 days server-side; /me 401 clears it.
 */

import { ipcMain } from 'electron'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { HOME_CHANNELS } from '../shared/home-api'
import type { WxLoginPollResult, WxLoginQr, WxLoginSession, WxLoginUser } from '../shared/home-api'

const DEFAULT_WX_BASE = 'https://aidooo.com'
const FETCH_TIMEOUT_MS = 15_000
/** how long a completed login's avatar keeps its data: URL cache in memory */
const AVATAR_CACHE_LIMIT = 8

/** dev/local-联调 override, e.g. CHAOFFICE_WX_BASE_URL=http://localhost:8787 */
function wxBase(): string {
  return (process.env.CHAOFFICE_WX_BASE_URL || DEFAULT_WX_BASE).replace(/\/+$/, '')
}

/** Override dir via CHAOFFICE_WX_AUTH_DIR (test isolation), like CHAOFFICE_AUTH_DIR. */
export function wxAuthPath(): string {
  return join(process.env.CHAOFFICE_WX_AUTH_DIR || join(homedir(), '.chaoffice'), 'wx-user.json')
}

interface StoredWxSession {
  token: string
  user: WxLoginUser
  /** cached so the avatar still renders offline (data: URL) */
  avatarDataUrl?: string
  savedAt: number
}

let cachedSession: StoredWxSession | null | undefined

function readSessionFile(): StoredWxSession | null {
  try {
    const raw = JSON.parse(readFileSync(wxAuthPath(), 'utf-8')) as Record<string, unknown>
    const token = typeof raw.token === 'string' ? raw.token : ''
    const user = raw.user as Record<string, unknown> | undefined
    const id = Number(user?.id)
    if (!token || !user || !Number.isFinite(id)) return null
    return {
      token,
      user: {
        id,
        nickname: typeof user.nickname === 'string' ? user.nickname : '',
        avatarUrl: typeof user.avatarUrl === 'string' ? user.avatarUrl : '',
        ...(Number.isFinite(Number(user.loginCount)) ? { loginCount: Number(user.loginCount) } : {}),
      },
      ...(typeof raw.avatarDataUrl === 'string' && raw.avatarDataUrl ? { avatarDataUrl: raw.avatarDataUrl } : {}),
      savedAt: Number(raw.savedAt) || 0,
    }
  } catch {
    return null
  }
}

function loadSession(): StoredWxSession | null {
  if (cachedSession === undefined) cachedSession = readSessionFile()
  return cachedSession
}

function saveSessionFile(session: StoredWxSession): void {
  const path = wxAuthPath()
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(session, null, 2) + '\n', { mode: 0o600 })
  cachedSession = session
}

function clearSessionFile(): void {
  cachedSession = null
  try {
    if (existsSync(wxAuthPath())) unlinkSync(wxAuthPath())
  } catch {
    /* best-effort */
  }
}

/** 「完善头像昵称」still pending: scene-QR events only carry the openid, so the
 *  nickname is the server's anonymous placeholder until the user authorizes
 *  snsapi_userinfo from the QR shown in the logged-in pane. */
export function isProfileIncomplete(user: WxLoginUser): boolean {
  return !user.avatarUrl || /^微信用户\d+$/.test(user.nickname)
}

function toSession(stored: StoredWxSession): WxLoginSession {
  return {
    loggedIn: true,
    user: stored.user,
    ...(stored.avatarDataUrl ? { avatarDataUrl: stored.avatarDataUrl } : {}),
    profileIncomplete: isProfileIncomplete(stored.user),
  }
}

// ── HTTP (global fetch; the main-process undici proxy dispatcher applies) ──

type JsonBody = Record<string, unknown> | null

async function httpJson(url: string, init?: RequestInit): Promise<{ status: number; json: JsonBody }> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...init, signal: ac.signal })
    const json = (await res.json().catch(() => null)) as JsonBody
    return { status: res.status, json }
  } finally {
    clearTimeout(timer)
  }
}

const avatarCache = new Map<string, string>()

/** Download an image and wrap it as a data: URL (CSP-safe for the renderer). */
async function fetchDataUrl(url: string): Promise<string | undefined> {
  const cached = avatarCache.get(url)
  if (cached) return cached
  try {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)
    const res = await fetch(url, { signal: ac.signal })
    clearTimeout(timer)
    if (!res.ok) return undefined
    const mime = res.headers.get('content-type') || 'image/png'
    if (!mime.startsWith('image/')) return undefined
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length === 0 || buf.length > 2 * 1024 * 1024) return undefined
    const dataUrl = `data:${mime.split(';')[0]};base64,${buf.toString('base64')}`
    avatarCache.set(url, dataUrl)
    if (avatarCache.size > AVATAR_CACHE_LIMIT) {
      avatarCache.delete(avatarCache.keys().next().value as string)
    }
    return dataUrl
  } catch {
    return undefined
  }
}

// ── flows ────────────────────────────────────────────────────────────

export async function wxLoginQrStart(): Promise<WxLoginQr> {
  const { status, json } = await httpJson(`${wxBase()}/api/auth/wx/qr-start?client=desktop`)
  const state = typeof json?.state === 'string' ? json.state : ''
  console.log(`[wx-auth] qr-start ${status} mode=${String(json?.mode)} state=${state.slice(0, 8)}…`)
  if (status !== 200 || !state) {
    throw new Error(
      (typeof json?.message === 'string' && json.message) ||
        (typeof json?.error === 'string' && json.error) ||
        `qr-start HTTP ${status}`,
    )
  }
  const mode = json?.mode === 'qrconnect' ? 'qrconnect' : 'mpqrcode'
  // mpqrcode: url is WeChat's showqrcode image; qrconnect: an authorize-page URL
  // the website renders as a PNG via its own /api/qr endpoint
  const imgUrl =
    mode === 'mpqrcode'
      ? String(json?.url ?? '')
      : `${wxBase()}/api/qr?text=${encodeURIComponent(String(json?.url ?? ''))}`
  const qrDataUrl = imgUrl.startsWith('http') ? await fetchDataUrl(imgUrl) : undefined
  return {
    mode,
    state,
    qrDataUrl: qrDataUrl ?? '',
    expiresInSec: Number(json?.expiresIn) || 600,
  }
}

/** ticket states are 36-hex random bytes minted server-side; reject anything else */
function isValidState(state: string): boolean {
  return /^[0-9a-f]{36}$/.test(state)
}

async function acceptLogin(token: string, rawUser: unknown): Promise<WxLoginSession> {
  const u = (rawUser ?? {}) as Record<string, unknown>
  const user: WxLoginUser = {
    id: Number(u.id),
    nickname: typeof u.nickname === 'string' ? u.nickname : '',
    avatarUrl: typeof u.avatarUrl === 'string' ? u.avatarUrl : '',
    ...(Number.isFinite(Number(u.loginCount)) ? { loginCount: Number(u.loginCount) } : {}),
  }
  const avatarDataUrl = user.avatarUrl ? await fetchDataUrl(user.avatarUrl) : undefined
  saveSessionFile({
    token,
    user,
    ...(avatarDataUrl ? { avatarDataUrl } : {}),
    savedAt: Date.now(),
  })
  console.log(`[wx-auth] login ok, session saved for wx:${user.id} (${user.nickname})`)
  return toSession(loadSession()!)
}

export async function wxLoginPoll(state: string): Promise<WxLoginPollResult> {
  if (!isValidState(state)) return { status: 'error', error: 'invalid_state' }
  const { status, json } = await httpJson(
    `${wxBase()}/api/auth/wx/poll?state=${encodeURIComponent(state)}&client=desktop`,
  )
  console.log(`[wx-auth] poll ${state.slice(0, 8)}… http=${status} server=${String(json?.status)}`)
  if (status !== 200 || !json) return { status: 'error', error: `poll HTTP ${status}` }
  if (json.status === 'ok') {
    const token = typeof json.token === 'string' ? json.token : ''
    if (!token) {
      // poll answered ok without the desktop token — the website server is
      // running a build older than the client=desktop contract
      return { status: 'error', error: 'poll ok without token (website server needs the client=desktop update)' }
    }
    return { status: 'ok', session: await acceptLogin(token, json.user) }
  }
  if (json.status === 'expired') return { status: 'expired' }
  return { status: 'pending' }
}

export async function wxLoginStatus(): Promise<WxLoginSession> {
  const stored = loadSession()
  if (!stored) return { loggedIn: false }
  let status: number
  let json: JsonBody
  try {
    ;({ status, json } = await httpJson(`${wxBase()}/api/auth/wx/me`, {
      headers: { authorization: `Bearer ${stored.token}` },
    }))
  } catch (e) {
    console.warn('[wx-auth] /me unreachable, serving cached session:', e instanceof Error ? e.message : e)
    return toSession(stored)
  }
  // expired/revoked token → forget the local session; network failure → serve
  // the cached session so a flaky connection does not log the user out
  if (status === 401) {
    clearSessionFile()
    return { loggedIn: false }
  }
  if (status !== 200 || !json?.user) return toSession(stored)
  const u = (json.user ?? {}) as Record<string, unknown>
  const user: WxLoginUser = {
    id: Number(u.id),
    nickname: typeof u.nickname === 'string' ? u.nickname : '',
    avatarUrl: typeof u.avatarUrl === 'string' ? u.avatarUrl : '',
    ...(Number.isFinite(Number(u.loginCount)) ? { loginCount: Number(u.loginCount) } : {}),
  }
  if (user.avatarUrl && user.avatarUrl !== stored.user.avatarUrl) {
    const fresh = await fetchDataUrl(user.avatarUrl)
    saveSessionFile({ ...stored, user, ...(fresh ? { avatarDataUrl: fresh } : {}) })
  } else {
    saveSessionFile({ ...stored, user })
  }
  return toSession(loadSession()!)
}

export async function wxLogout(): Promise<void> {
  const stored = loadSession()
  clearSessionFile()
  // fire-and-forget: server-side the JWT is stateless, the event row is bookkeeping
  if (stored) {
    void httpJson(`${wxBase()}/api/auth/wx/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${stored.token}` },
    }).catch(() => undefined)
  }
}

/**
 * 「完善头像昵称」QR: the snsapi_userinfo authorize page (same entry the
 * website NavBar uses), rendered as a PNG by the website's own /api/qr —
 * the renderer has no qrcode dependency and CSP forbids remote img src.
 */
export async function wxProfileQrDataUrl(): Promise<string> {
  const url = `${wxBase()}/api/auth/wx/mp?scope=userinfo&return=${encodeURIComponent('/')}`
  return (await fetchDataUrl(`${wxBase()}/api/qr?text=${encodeURIComponent(url)}`)) ?? ''
}

// ── IPC surface (renderer never talks to aidooo.com directly) ───────

export function registerWxAuthIpc(): void {
  ipcMain.handle(HOME_CHANNELS.wxStatus, () => wxLoginStatus())
  ipcMain.handle(HOME_CHANNELS.wxQrStart, () => wxLoginQrStart())
  ipcMain.handle(HOME_CHANNELS.wxPoll, (_event, state: unknown) => wxLoginPoll(String(state ?? '')))
  ipcMain.handle(HOME_CHANNELS.wxProfileQr, () => wxProfileQrDataUrl())
  ipcMain.handle(HOME_CHANNELS.wxLogout, () => wxLogout())
}

/** test hook: drop the in-memory cache so the next read sees the file */
export function reloadWxAuth(): void {
  cachedSession = undefined
}
