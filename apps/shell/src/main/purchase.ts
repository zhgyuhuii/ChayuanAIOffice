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
import { homedir } from 'node:os'
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

// ── 同机 OS 侧授权联动（2026-09-23，chayuan-harness docs/desktop-28-fixes-plan.md M2）──
// 察元AI OS（harness）购买后，本机 Office 不再显示激活/提醒：只读 OS 侧
// userData/purchase.json，activation 未过期即视为已授权。两侧机器指纹同
// 算法（sha256(IOPlatformUUID)[:16]），串码 OS|OFFICE 位单向覆盖——OS 端
// 激活即全家桶授权（纯读取，绝不写对方文件；60s 缓存防高频读盘）。
let osEntitlementCache: { at: number; entitled: boolean } | null = null

function osPurchaseStateCandidates(): string[] {
  const home = homedir()
  const out: string[] = []
  const dataRoot = process.env.CHATOP_DATA_ROOT
  if (dataRoot) out.push(join(dataRoot, 'shell', 'purchase.json'))
  if (process.platform === 'darwin') {
    out.push(join(home, 'Library', 'Application Support', '察元AI OS', 'purchase.json'))
    out.push(join(home, 'Library', 'Application Support', 'chatop', 'purchase.json'))
  } else if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming')
    out.push(join(appData, '察元AI OS', 'purchase.json'))
    out.push(join(appData, 'chatop', 'purchase.json'))
  } else {
    out.push(join(home, '.config', '察元AI OS', 'purchase.json'))
    out.push(join(home, '.config', 'chatop', 'purchase.json'))
  }
  return out
}

/** True when the harness OS on this machine holds an unexpired activation. */
export function readOsSideEntitlement(now = Date.now()): boolean {
  if (osEntitlementCache !== null && now - osEntitlementCache.at < 60_000) return osEntitlementCache.entitled
  let entitled = false
  for (const file of osPurchaseStateCandidates()) {
    try {
      if (!existsSync(file)) continue
      const state = JSON.parse(readFileSync(file, 'utf8')) as { activation?: { expireAt?: string } | null }
      const expireAt = state?.activation?.expireAt
      if (state?.activation != null && typeof expireAt === 'string' && Date.parse(expireAt) > now) {
        entitled = true
        break
      }
    } catch { /* 单个候选损坏/不可读不连坐 */ }
  }
  osEntitlementCache = { at: now, entitled }
  return entitled
}

/** Effective entitlement = own activation OR the OS-side purchase (M2). */
export function isEntitledEffective(state: Parameters<typeof isEntitled>[0], now = Date.now()): boolean {
  return isEntitled(state, now) || readOsSideEntitlement(now)
}

/** First toast lands 30 minutes after launch, then every 30 minutes (Q5). */
const FIRST_REMIND_MS = 30 * 60_000
const REMIND_EVERY_MS = 30 * 60_000
/** Re-check cadence for the once-per-day page popup (fires later the same
 * day when the shell window was not visible at boot). */
const PAGE_RECHECK_MS = 60_000
/** Real-machine test hook: CHATOP_PURCHASE_NOW=1 pretends the 90-day free
 * period is already over — the purchase page pops ~2.5s after launch and the
 * 30-minute reminder cadence engages. Nothing extra is persisted: the page
 * still counts as shown once per day, and activation still silences both. */
const FORCE_DUE = process.env.CHATOP_PURCHASE_NOW === '1'
/** CHATOP_PURCHASE_SHOW=1: pop the dialog at boot even when already
 * entitled — for screenshotting the licensed (已激活) state during
 * real-machine tests. */
const SHOW_WHEN_ENTITLED = process.env.CHATOP_PURCHASE_SHOW === '1'

/** Same dev key as the harness build; never a production secret. */
const DEV_LICENSE_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'

/** Buy site base (aidooo.com store): where the QR points and where serials
 * come from. Env-overridable for staging, same convention as the harness /
 * chayuan-server buy_base_url. Read per call so tests can flip it. */
function buyBaseUrl(): string {
  return (process.env.CHATOP_BUY_BASE_URL ?? 'https://aidooo.com').replace(/\/+$/, '')
}

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

// ── Signing key (packaged: Resources/license-key.txt; dev: env, then the
//    pinned store-key file, then the shared dev test key) ──

/**
 * Dev/test machines pin the REAL store signing key (64-hex, the aidooo.com
 * admin「支付配置」签发密钥 hmacKeyV1) in this file so local verification
 * behaves exactly like production — serials bought on the real buy page
 * activate in dev builds. Outside the repo on purpose: the key never enters
 * git; CHATOP_LICENSE_DEV_KEY_FILE overrides the path (tests use it to stay
 * machine-independent).
 */
function devLicenseKeyFile(): string {
  return process.env.CHATOP_LICENSE_DEV_KEY_FILE ?? join(homedir(), '.chatoffice', 'license-hmac-key.txt')
}

function readHexKeyFile(file: string): string | null {
  try {
    const raw = readFileSync(file, 'utf8').trim()
    return /^[0-9a-fA-F]{64}$/.test(raw) ? raw.toLowerCase() : null
  } catch {
    return null
  }
}

export function licenseKeyHex(isPackaged = app.isPackaged, resourcesPath = process.resourcesPath): string | null {
  const env = process.env.CHATOP_LICENSE_HMAC_KEY
  if (env && /^[0-9a-fA-F]{64}$/.test(env.trim())) return env.trim().toLowerCase()
  if (!isPackaged) return readHexKeyFile(devLicenseKeyFile()) ?? DEV_LICENSE_KEY
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
    entitled: isEntitledEffective(state),
    expireAt: state.activation?.expireAt ?? null,
    activatedAt: state.activation?.activatedAt ?? null,
    serialMasked: state.activation ? maskSerial(state.activation.serial) : null,
    keyConfigured: licenseKeyHex() !== null,
    buyUrl: `${buyBaseUrl()}/buy?app=office&mid=${fp}`,
    shareUrl: `${buyBaseUrl()}/share?mid=${fp}`,
  }
}

// ── Scheduler (GUI path only) ──

let started = false

/** pageDue with the FORCE_DUE test hook applied: forcing skips only the
 * free-period wait; entitlement and the once-per-day gate still hold. */
export function pageDueNow(state: PurchaseState, force: boolean, now = new Date()): boolean {
  return force
    ? !isEntitledEffective(state, now.getTime()) && state.pageShownDate !== localDateStr(now)
    : pageDue(state, now)
}

/** remindDue with the FORCE_DUE test hook applied (entitlement still holds). */
export function remindDueNow(state: PurchaseState, force: boolean, now = Date.now()): boolean {
  return force ? !isEntitledEffective(state, now) : remindDue(state, now)
}

let dbgConsoleWired = false

/** Menu/scheduler-facing opener: pushes {kind:'open-page'} to the shell
 * renderer, which opens the purchase dialog (QR + activation form). Shares
 * the scheduler fire() debug-capture hook (CHATOP_PURCHASE_SNAPSHOT_DIR). */
export function openPurchasePage(win: BrowserWindow | null): void {
  if (win === null || win.isDestroyed()) return
  fireWithDebug(win, 'open-page')
}

function fireWithDebug(win: BrowserWindow, kind: 'open-page' | 'reminder'): void {
  win.webContents.send(PURCHASE_CHANNELS.event, { kind })
  // CHATOP_PURCHASE_SNAPSHOT_DIR: real-machine debugging aid — after each
  // pushed event, capture what the renderer actually painted and mirror its
  // console to stdout, so a blank/broken dialog leaves a screenshot + logs.
  const snapDir = process.env.CHATOP_PURCHASE_SNAPSHOT_DIR
  if (!snapDir) return
  if (!dbgConsoleWired) {
    dbgConsoleWired = true
    win.webContents.on('console-message', (_e, _level, message, line, sourceId) => {
      console.log(`[purchase-dbg console] ${message} (${sourceId}:${line})`)
    })
  }
  setTimeout(() => {
    if (win.isDestroyed()) return
    win.webContents
      .capturePage()
      .then((img) => {
        mkdirSync(snapDir, { recursive: true })
        writeFileSync(join(snapDir, `purchase-${kind}-${Date.now()}.png`), img.toPNG())
        console.log(`[purchase-dbg] captured ${kind} → ${snapDir}`)
      })
      .catch((err) => console.log(`[purchase-dbg] capture failed:`, err))
  }, 3000)
}

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
    if (win === null || win.isDestroyed()) return
    fireWithDebug(win, kind)
  }
  const pageTick = (): void => {
    const cur = loadPurchaseState()
    if (!pageDueNow(cur, FORCE_DUE) || targetWindow() === null) return
    fire('open-page')
    savePurchaseState({ ...cur, pageShownDate: localDateStr(new Date()) })
  }
  const remindTick = (): void => {
    const cur = loadPurchaseState()
    if (!remindDueNow(cur, FORCE_DUE) || targetWindow() === null) return
    fire('reminder')
  }
  const pageTimer = setInterval(pageTick, PAGE_RECHECK_MS)
  // FORCE_DUE: pop the page once per launch ~2.5s after boot — deliberately
  // past the once-today gate (iterative real-machine testing relaunches the
  // app), still silenced by an entitlement. The minute-tick above keeps the
  // normal once-per-day semantics.
  const kickTimer = FORCE_DUE
    ? setTimeout(() => {
        const cur = loadPurchaseState()
        if ((isEntitledEffective(cur) && !SHOW_WHEN_ENTITLED) || targetWindow() === null) return
        fire('open-page')
        savePurchaseState({ ...cur, pageShownDate: localDateStr(new Date()) })
      }, 2500)
    : null
  const firstRemind = setTimeout(remindTick, FIRST_REMIND_MS)
  const remindTimer = setInterval(remindTick, REMIND_EVERY_MS)
  app.on('will-quit', () => {
    clearInterval(pageTimer)
    if (kickTimer !== null) clearTimeout(kickTimer)
    clearTimeout(firstRemind)
    clearInterval(remindTimer)
  })
}

// ── IPC handlers (machine-level state; not session-scoped) ──

async function activateSerial(serial: unknown): Promise<PurchaseActivateResult> {
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
  // modules rides along so the renderer can name what the serial covers
  // (office bit = 察元AI Office, OS bit = 察元AI OS one-way coverage).
  return { ok: true, expireAt: expireAt.toISOString(), days: v.fields.value, modules: v.fields.modules }
}

/** @param onChanged fired after a successful activation so menu labels and
 *   any other entitlement-derived UI can refresh immediately. */
export function registerPurchaseIpc(onChanged?: () => void): void {
  ipcMain.handle(PURCHASE_CHANNELS.state, async () => purchaseSnapshot())
  ipcMain.handle(PURCHASE_CHANNELS.activate, async (_event, serial: unknown) => {
    const r = await activateSerial(serial)
    if (r.ok) onChanged?.()
    return r
  })
  // CHATOP_PURCHASE_ACTIVATE: dev/e2e hook — at boot, run one serial through
  // the exact same verification path the dialog's IPC uses and log the
  // outcome, so a real-machine test can complete the loop without typing
  // into the dialog by hand.
  const bootSerial = process.env.CHATOP_PURCHASE_ACTIVATE
  if (bootSerial) {
    void activateSerial(bootSerial).then(
      (r) => {
        console.log(`[purchase] CHATOP_PURCHASE_ACTIVATE → ${JSON.stringify(r)}`)
        if (r.ok) onChanged?.()
      },
      (err) => console.log(`[purchase] CHATOP_PURCHASE_ACTIVATE failed:`, err),
    )
  }
}
