/**
 * Offline purchase / license side-effect layer (LOCAL feature, B-zone):
 * state file, machine fingerprint, scheduler and IPC handlers. Pure logic
 * lives in purchase-codec.ts; user-facing copy lives in the renderer i18n
 * (main only pushes event kinds, never text).
 *
 * Wiring contract (see 2026-09-20 purchase consensus):
 * - state: userData/purchase.json { firstRunAt, pageShownDate, activation }
 * - free period: 90 days of silence, then once-per-day purchase page + a
 *   gentle toast every 30 minutes; activation silences everything until
 *   expiry; expiry resumes immediately
 * - activation: offline HMAC short serial verified locally, accepted when it
 *   carries the OS bit OR the office bit (one-way coverage, Q9); duration =
 *   activation time + days
 * - signing key never enters git: packaged builds read Resources/
 *   license-key.txt (injected by electron-builder from CHATOP_LICENSE_HMAC_KEY);
 *   dev falls back to the same env var, then the shared dev test key. A
 *   packaged build without the key disables activation only — reminders keep
 *   their schedule.
 * - the scheduler must be started on the GUI path (it is a no-op without a
 *   visible shell window; the page popup catches up later the same day)
 */
import { app, ipcMain, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { PURCHASE_CHANNELS, type PurchaseActivateResult, type PurchaseSnapshot } from '../shared/purchase-api'
import {
  FREE_PERIOD_MS,
  PRODUCT_BIT_OFFICE,
  PRODUCT_BIT_OS,
  fingerprintFromMachineId,
  isEntitled,
  localDateStr,
  pageDue,
  remindDue,
  verifySerial,
} from './purchase-codec'

/** First toast lands 30 minutes after launch, then every 30 minutes (Q5). */
const FIRST_REMIND_MS = 30 * 60_000
const REMIND_EVERY_MS = 30 * 60_000
/** Re-check cadence for the once-per-day page popup (fires later the same
 * day when the shell window was not visible at boot). */
const PAGE_RECHECK_MS = 60_000

/** Same dev key as the harness build; never a production secret. */
const DEV_LICENSE_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'

export interface PurchaseActivation {
  serial: string
  modules: number
  days: number
  activatedAt: string
  expireAt: string
}

export interface PurchaseState {
  firstRunAt: string
  /** Local date (YYYY-MM-DD) the purchase page last popped; null = not today. */
  pageShownDate: string | null
  activation: PurchaseActivation | null
}

function purchaseStatePath(): string {
  return join(app.getPath('userData'), 'purchase.json')
}

export function loadPurchaseState(path = purchaseStatePath()): PurchaseState {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<PurchaseState>
    return {
      firstRunAt: typeof raw.firstRunAt === 'string' ? raw.firstRunAt : new Date().toISOString(),
      pageShownDate: typeof raw.pageShownDate === 'string' ? raw.pageShownDate : null,
      activation:
        raw.activation && typeof raw.activation === 'object' && typeof raw.activation.expireAt === 'string'
          ? raw.activation
          : null,
    }
  } catch {
    return { firstRunAt: new Date().toISOString(), pageShownDate: null, activation: null }
  }
}

export function savePurchaseState(state: PurchaseState, path = purchaseStatePath()): void {
  // Atomic replacement (temp beside destination, like app-settings/open-documents)
  const tempPath = `${path}.${process.pid}.tmp`
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    renameSync(tempPath, path)
  } catch {
    try {
      if (existsSync(tempPath)) renameSync(tempPath, path) // best effort again
    } catch {
      // Read-only disk: in-session state stays in memory, recomputed next boot
    }
  }
}

// ── Machine fingerprint (16-hex, same derivation as the harness build) ──

let fingerprintCache: string | null = null

function osMachineId(): Promise<string | null> {
  return new Promise((resolve) => {
    if (process.platform === 'darwin') {
      execFile('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { timeout: 4000 }, (err, stdout) => {
        if (err) return resolve(null)
        const m = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(stdout)
        resolve(m?.[1] ?? null)
      })
    } else if (process.platform === 'linux') {
      try {
        const direct = readFileSync('/etc/machine-id', 'utf8').trim()
        if (direct) return resolve(direct)
      } catch {
        // fall through to the dbus copy
      }
      try {
        const dbus = readFileSync('/var/lib/dbus/machine-id', 'utf8').trim()
        resolve(dbus || null)
      } catch {
        resolve(null)
      }
    } else if (process.platform === 'win32') {
      execFile('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { timeout: 4000 }, (err, stdout) => {
        if (err) return resolve(null)
        const m = /MachineGuid\s+REG_SZ\s+(\S+)/.exec(stdout)
        resolve(m?.[1] ?? null)
      })
    } else {
      resolve(null)
    }
  })
}

/** Cached in userData/purchase-fp (site-hid convention) so machines without a
 * readable OS id still get a stable random identity. */
export async function machineFingerprint(): Promise<string> {
  if (fingerprintCache !== null) return fingerprintCache
  const file = join(app.getPath('userData'), 'purchase-fp')
  try {
    const cached = readFileSync(file, 'utf8').trim()
    if (/^[0-9a-f]{16}$/.test(cached)) {
      fingerprintCache = cached
      return cached
    }
  } catch {
    // first run
  }
  const osId = await osMachineId()
  let fp = osId ? fingerprintFromMachineId(osId) : ''
  if (!/^[0-9a-f]{16}$/.test(fp)) fp = randomUUID().replace(/-/g, '').slice(0, 16)
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, fp, 'utf8')
  } catch {
    // read-only disk: process-wide cache only
  }
  fingerprintCache = fp
  return fp
}

// ── Signing key (packaged: Resources/license-key.txt; dev: env, then dev key) ──

export function licenseKeyHex(isPackaged = app.isPackaged, resourcesPath = process.resourcesPath): string | null {
  const env = process.env.CHATOP_LICENSE_HMAC_KEY
  if (env && /^[0-9a-fA-F]{64}$/.test(env.trim())) return env.trim().toLowerCase()
  if (!isPackaged) return DEV_LICENSE_KEY
  try {
    const raw = readFileSync(join(resourcesPath ?? '', 'license-key.txt'), 'utf8').trim()
    if (/^[0-9a-fA-F]{64}$/.test(raw)) return raw.toLowerCase()
  } catch {
    // not injected: activation entry disabled, reminders keep their schedule
  }
  return null
}

// ── Renderer snapshot ──

function maskSerial(serial: string): string {
  const norm = serial.replace(/-/g, '')
  if (norm.length <= 10) return norm
  return `${norm.slice(0, 5)}${'•'.repeat(norm.length - 10)}${norm.slice(-5)}`
}

export async function purchaseSnapshot(state = loadPurchaseState()): Promise<PurchaseSnapshot> {
  const fp = await machineFingerprint()
  const firstRun = Date.parse(state.firstRunAt)
  const freeUntil = (Number.isNaN(firstRun) ? Date.now() : firstRun) + FREE_PERIOD_MS
  const freeDaysLeft = Math.max(0, Math.ceil((freeUntil - Date.now()) / 86400_000))
  return {
    fingerprint: fp,
    firstRunAt: state.firstRunAt,
    freeUntil: new Date(freeUntil).toISOString(),
    freeDaysLeft,
    entitled: isEntitled(state),
    expireAt: state.activation?.expireAt ?? null,
    activatedAt: state.activation?.activatedAt ?? null,
    serialMasked: state.activation ? maskSerial(state.activation.serial) : null,
    keyConfigured: licenseKeyHex() !== null,
  }
}

// ── Scheduler (GUI path only) ──

let started = false

/**
 * @param targetWindow resolves the visible shell window; null (lock screen,
 *   no window) suppresses the event — the page popup catches up the same day.
 */
export function startPurchaseScheduler(targetWindow: () => BrowserWindow | null): void {
  if (started) return
  started = true
  const state = loadPurchaseState()
  savePurchaseState(state) // stamps firstRunAt on first run; fills defaults
  const fire = (kind: 'open-page' | 'reminder'): void => {
    const win = targetWindow()
    if (win === null) return
    win.webContents.send(PURCHASE_CHANNELS.event, { kind })
  }
  const pageTick = (): void => {
    const cur = loadPurchaseState()
    if (!pageDue(cur) || targetWindow() === null) return
    fire('open-page')
    savePurchaseState({ ...cur, pageShownDate: localDateStr(new Date()) })
  }
  const remindTick = (): void => {
    const cur = loadPurchaseState()
    if (!remindDue(cur) || targetWindow() === null) return
    fire('reminder')
  }
  const pageTimer = setInterval(pageTick, PAGE_RECHECK_MS)
  const firstRemind = setTimeout(remindTick, FIRST_REMIND_MS)
  const remindTimer = setInterval(remindTick, REMIND_EVERY_MS)
  app.on('will-quit', () => {
    clearInterval(pageTimer)
    clearTimeout(firstRemind)
    clearInterval(remindTimer)
  })
}

// ── IPC handlers (machine-level state; not session-scoped) ──

export function registerPurchaseIpc(): void {
  ipcMain.handle(PURCHASE_CHANNELS.state, async () => purchaseSnapshot())
  ipcMain.handle(PURCHASE_CHANNELS.activate, async (_event, serial: unknown): Promise<PurchaseActivateResult> => {
    const key = licenseKeyHex()
    if (key === null) return { ok: false, reason: 'keys_not_configured' }
    if (typeof serial !== 'string' || serial.trim() === '') return { ok: false, reason: 'length' }
    const fp = await machineFingerprint()
    const v = verifySerial(serial, fp, key)
    if (!v.valid || v.fields === undefined) return { ok: false, reason: v.reason ?? 'signature' }
    // One-way coverage (Q9): the office shell accepts OS-or-office serials.
    if ((v.fields.modules & (PRODUCT_BIT_OS | PRODUCT_BIT_OFFICE)) === 0) return { ok: false, reason: 'module' }
    const now = new Date()
    // Duration = activation time + days (no rollback guard, honor system)
    const expireAt = new Date(now.getTime() + v.fields.value * 86400_000)
    const cur = loadPurchaseState()
    cur.activation = {
      serial: serial.trim().toUpperCase(),
      modules: v.fields.modules,
      days: v.fields.value,
      activatedAt: now.toISOString(),
      expireAt: expireAt.toISOString(),
    }
    savePurchaseState(cur)
    return { ok: true, expireAt: expireAt.toISOString(), days: v.fields.value }
  })
}
