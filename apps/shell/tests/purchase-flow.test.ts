/**
 * End-to-end purchase/activation flow through the real main-process layer
 * (src/main/purchase.ts) with Electron mocked down to a temp userData dir:
 * fresh-install snapshot → store-signed serial (signer mirrors aidooo.com
 * server/license/shortcode.js sign()) → IPC activate → purchase.json on disk
 * → entitled snapshot → reminders silenced. Plus the rejection branches a
 * customer can actually hit (wrong machine, wrong product, bad input,
 * missing key) and the key-resolution order.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PURCHASE_CHANNELS, type PurchaseActivateResult } from '../src/shared/purchase-api'
import { PRODUCT_BIT_OFFICE, PRODUCT_BIT_OS, pageDue, remindDue } from '../src/main/purchase-codec'

const electronState = { userData: '/nonexistent', isPackaged: false }
const ipcHandlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>())

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'userData' ? electronState.userData : `/tmp/chatoffice-${name}`),
    get isPackaged() {
      return electronState.isPackaged
    },
    on: () => {},
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcHandlers.set(channel, handler)
    },
  },
}))

// Same non-secret dev key purchase.ts falls back to in unpackaged runs.
const DEV_LICENSE_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'

const {
  loadPurchaseState,
  machineFingerprint,
  purchaseSnapshot,
  registerPurchaseIpc,
  readOsSideEntitlement,
  isEntitledEffective,
} = await import('../src/main/purchase')

const DAY = 86400_000

// ── Store-side signer (mirror of server/license/shortcode.js sign()): v2
// 7-byte header, HMAC-SHA256 tag over header||fingerprint-utf8, Crockford
// base32 + mod-37 check char, dashed 5-5-5-5-5. ──

const ENC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const CHECK = ENC + '*~$=U'

function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const b of buf) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += ENC[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ENC[(value << (5 - bits)) & 31]
  return out
}

function checkChar(buf: Buffer): string {
  let n = 0n
  for (const b of buf) n = (n * 256n + BigInt(b)) % 37n
  return CHECK[Number(n)]
}

interface SignFields {
  ver: number
  kind: number
  modules: number
  value: number
  issueDate: number
  nonce: number
}

function sign(fields: SignFields, machineFp: string, keyHex: string): string {
  const widths = [4, 1, 16, 14, 13, 8]
  const vals = [fields.ver, fields.kind, fields.modules, fields.value, fields.issueDate, fields.nonce]
  let v = 0n
  for (let i = 0; i < vals.length; i++) v = (v << BigInt(widths[i])) | BigInt(vals[i])
  const header = Buffer.from(v.toString(16).padStart(14, '0'), 'hex')
  const tag = createHmac('sha256', Buffer.from(keyHex, 'hex'))
    .update(header)
    .update(machineFp)
    .digest()
    .subarray(0, 8)
  const body = Buffer.concat([header, tag])
  return (base32Encode(body) + checkChar(body)).replace(/(.{5})/g, '$1-').replace(/-$/, '')
}

async function activate(serial: unknown): Promise<PurchaseActivateResult> {
  const handler = ipcHandlers.get(PURCHASE_CHANNELS.activate)
  if (!handler) throw new Error('activate handler not registered')
  return handler(undefined, serial) as Promise<PurchaseActivateResult>
}

describe('purchase flow (registerPurchaseIpc + state file)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'purchase-flow-'))
    electronState.userData = dir
    electronState.isPackaged = false
    delete process.env.CHATOP_LICENSE_HMAC_KEY
    delete process.env.CHATOP_BUY_BASE_URL
    // pin the dev-key file to an absent path: a real store key pinned on THIS
    // machine (~/.chatoffice/license-hmac-key.txt) must not leak into tests
    process.env.CHATOP_LICENSE_DEV_KEY_FILE = join(dir, 'absent-license-key.txt')
    registerPurchaseIpc()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('fresh install: snapshot reports a 16-hex fingerprint, ~90 free days, unentitled, dev key configured', async () => {
    const s = await purchaseSnapshot()
    expect(s.fingerprint).toMatch(/^[0-9a-f]{16}$/)
    expect(s.freeDaysLeft).toBeGreaterThanOrEqual(89)
    expect(s.freeDaysLeft).toBeLessThanOrEqual(90)
    expect(s.entitled).toBe(false)
    expect(s.expireAt).toBeNull()
    expect(s.serialMasked).toBeNull()
    expect(s.keyConfigured).toBe(true)
    // scan-to-buy URLs carry this machine's fingerprint (what the QR encodes)
    expect(s.buyUrl).toBe(`https://aidooo.com/buy?app=office&mid=${s.fingerprint}`)
    expect(s.shareUrl).toBe(`https://aidooo.com/share?mid=${s.fingerprint}`)
  })

  it('full journey: store-signed office serial activates, persists to purchase.json, snapshot flips to entitled, reminders silenced', async () => {
    const fp = await machineFingerprint()
    const serial = sign({ ver: 1, kind: 0, modules: PRODUCT_BIT_OFFICE, value: 365, issueDate: 262, nonce: 77 }, fp, DEV_LICENSE_KEY)
    const t0 = Date.now()

    const r = await activate(serial)
    expect(r).toMatchObject({ ok: true, days: 365, modules: PRODUCT_BIT_OFFICE })
    if (!r.ok) return
    expect(Date.parse(r.expireAt)).toBeGreaterThan(t0 + 364 * DAY)
    expect(Date.parse(r.expireAt)).toBeLessThan(t0 + 366 * DAY)

    const onDisk = JSON.parse(readFileSync(join(dir, 'purchase.json'), 'utf8'))
    expect(onDisk.activation).toMatchObject({ serial, modules: PRODUCT_BIT_OFFICE, days: 365, expireAt: r.expireAt })
    expect(Date.parse(onDisk.activation.activatedAt)).toBeGreaterThan(t0 - 5000)

    const snap = await purchaseSnapshot(loadPurchaseState())
    expect(snap.entitled).toBe(true)
    expect(snap.expireAt).toBe(r.expireAt)
    const norm = serial.replaceAll('-', '')
    expect(snap.serialMasked).toBe(`${norm.slice(0, 5)}${'•'.repeat(norm.length - 10)}${norm.slice(-5)}`)
    expect(snap.serialMasked).not.toContain(norm.slice(5, -5))

    // Entitlement must silence the scheduler even far past the free period.
    const pastFree = { ...onDisk, firstRunAt: new Date(Date.now() - 120 * DAY).toISOString() }
    expect(remindDue(pastFree)).toBe(false)
    expect(pageDue(pastFree)).toBe(false)
  })

  it('an OS-bit serial also activates the office shell (one-way coverage, Q9) with its own duration', async () => {
    const fp = await machineFingerprint()
    const serial = sign({ ver: 1, kind: 0, modules: PRODUCT_BIT_OS, value: 90, issueDate: 262, nonce: 78 }, fp, DEV_LICENSE_KEY)
    const r = await activate(serial)
    expect(r).toMatchObject({ ok: true, days: 90, modules: PRODUCT_BIT_OS })
    const s = await purchaseSnapshot(loadPurchaseState())
    expect(s.entitled).toBe(true)
  })

  it('rejections: other machine → signature, non-office module → module, bad input → length', async () => {
    const fp = await machineFingerprint()
    const otherMachine = sign({ ver: 1, kind: 0, modules: PRODUCT_BIT_OFFICE, value: 365, issueDate: 262, nonce: 79 }, 'ffffffffffffffff', DEV_LICENSE_KEY)
    expect(await activate(otherMachine)).toMatchObject({ ok: false, reason: 'signature' })

    const chatOnly = sign({ ver: 1, kind: 0, modules: 1 << 1, value: 30, issueDate: 262, nonce: 80 }, fp, DEV_LICENSE_KEY)
    expect(await activate(chatOnly)).toMatchObject({ ok: false, reason: 'module' })

    expect(await activate('')).toMatchObject({ ok: false, reason: 'length' })
    expect(await activate(12345)).toMatchObject({ ok: false, reason: 'length' })
    expect(await activate('not-a-serial')).toMatchObject({ ok: false, reason: 'length' })

    // None of the rejections above persisted an activation.
    expect((await purchaseSnapshot(loadPurchaseState())).entitled).toBe(false)
  })

  it('packaged build without license-key.txt: activation entry disabled (keys_not_configured), reminders keep their schedule', async () => {
    electronState.isPackaged = true
    const snap = await purchaseSnapshot()
    expect(snap.keyConfigured).toBe(false)
    const fp = await machineFingerprint()
    const serial = sign({ ver: 1, kind: 0, modules: PRODUCT_BIT_OFFICE, value: 365, issueDate: 262, nonce: 81 }, fp, DEV_LICENSE_KEY)
    expect(await activate(serial)).toMatchObject({ ok: false, reason: 'keys_not_configured' })
    electronState.isPackaged = false
  })

  it('CHATOP_LICENSE_HMAC_KEY env wins over the dev key in both directions', async () => {
    const envKey = 'ab'.repeat(32)
    process.env.CHATOP_LICENSE_HMAC_KEY = envKey
    const fp = await machineFingerprint()
    // Signed with the dev key: must now fail the signature check.
    const devSigned = sign({ ver: 1, kind: 0, modules: PRODUCT_BIT_OFFICE, value: 365, issueDate: 262, nonce: 82 }, fp, DEV_LICENSE_KEY)
    expect(await activate(devSigned)).toMatchObject({ ok: false, reason: 'signature' })
    // Signed with the env key: activates.
    const envSigned = sign({ ver: 1, kind: 0, modules: PRODUCT_BIT_OFFICE, value: 365, issueDate: 262, nonce: 83 }, fp, envKey)
    expect(await activate(envSigned)).toMatchObject({ ok: true, days: 365 })
  })

  it('CHATOP_BUY_BASE_URL overrides where the QR points (staging)', async () => {
    process.env.CHATOP_BUY_BASE_URL = 'https://staging.aidooo.com/'
    const s = await purchaseSnapshot()
    expect(s.buyUrl).toBe(`https://staging.aidooo.com/buy?app=office&mid=${s.fingerprint}`)
    expect(s.shareUrl).toBe(`https://staging.aidooo.com/share?mid=${s.fingerprint}`)
  })

  it('the pinned store-key file makes dev verification match production (old dev key stops working)', async () => {
    const storeKey = 'cd'.repeat(32)
    const keyFile = join(dir, 'pinned-key.txt')
    writeFileSync(keyFile, storeKey, 'utf8')
    process.env.CHATOP_LICENSE_DEV_KEY_FILE = keyFile

    const fp = await machineFingerprint()
    const fields = { ver: 1, kind: 0, modules: PRODUCT_BIT_OFFICE, value: 365, issueDate: 262, nonce: 88 }
    expect(await activate(sign(fields, fp, DEV_LICENSE_KEY))).toMatchObject({ ok: false, reason: 'signature' })
    expect(await activate(sign(fields, fp, storeKey))).toMatchObject({ ok: true, days: 365, modules: PRODUCT_BIT_OFFICE })
  })

  it('registerPurchaseIpc(onChanged) fires exactly after a successful activation; openPurchasePage pushes open-page to the window', async () => {
    const { openPurchasePage, registerPurchaseIpc } = await import('../src/main/purchase')
    let changes = 0
    registerPurchaseIpc(() => { changes++ })
    const fp = await machineFingerprint()
    const fields = { ver: 1, kind: 0, modules: PRODUCT_BIT_OFFICE, value: 30, issueDate: 262, nonce: 91 }
    expect(await activate(sign(fields, fp, DEV_LICENSE_KEY))).toMatchObject({ ok: true, days: 30 })
    expect(changes).toBe(1)
    // 失败路径不触发
    expect(await activate('short')).toMatchObject({ ok: false, reason: 'length' })
    expect(changes).toBe(1)

    const sends: Array<[string, unknown]> = []
    const fakeWin = {
      isDestroyed: () => false,
      webContents: { send: (ch: string, payload: unknown) => sends.push([ch, payload]) },
    }
    openPurchasePage(fakeWin as never)
    expect(sends).toEqual([['chatoffice/purchase:event', { kind: 'open-page' }]])
    openPurchasePage({ isDestroyed: () => true } as never)
    expect(sends).toHaveLength(1)
  })

  it('corrupt purchase.json falls back to fresh defaults instead of crashing', () => {
    writeFileSync(join(dir, 'purchase.json'), '{garbage', 'utf8')
    const s = loadPurchaseState()
    expect(s.activation).toBeNull()
    expect(s.pageShownDate).toBeNull()
    expect(Date.now() - Date.parse(s.firstRunAt)).toBeLessThan(5000)
  })
})

describe('OS-side entitlement linkage (M2: OS 购买覆盖同机 Office)', () => {
  const realNow = Date.now()
  afterEach(() => { vi.setSystemTime(realNow) })

  it('reads the harness OS purchase.json candidates and silences reminders', async () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'os-ent-'))
    process.env.CHATOP_DATA_ROOT = sandbox
    const { isEntitledEffective: eff, readOsSideEntitlement: readOs } = await import('../src/main/purchase')
    const state = loadPurchaseState()
    // 无 OS 激活文件：不授权
    expect(readOs()).toBe(false)
    // 写入一份 OS 侧激活（未过期）
    mkdirSync(join(sandbox, 'shell'), { recursive: true })
    writeFileSync(join(sandbox, 'shell', 'purchase.json'), JSON.stringify({
      firstRunAt: new Date(Date.now() - 100 * DAY).toISOString(),
      activation: { serial: 'XXXXX•••••XXXXX', days: 365, activatedAt: new Date().toISOString(), expireAt: new Date(Date.now() + 200 * DAY).toISOString(), modules: PRODUCT_BIT_OS },
    }), 'utf8')
    vi.setSystemTime(Date.now() + 61_000) // 翻过 60s 读缓存
    expect(readOs()).toBe(true)
    expect(eff(state)).toBe(true)
    // 到期 → 恢复本地免费期语义（不再联动）
    const expired = join(sandbox, 'shell', 'purchase.json')
    writeFileSync(expired, JSON.stringify({
      firstRunAt: new Date(Date.now() - 400 * DAY).toISOString(),
      activation: { serial: 'XXXXX•••••XXXXX', days: 30, activatedAt: new Date(Date.now() - 100 * DAY).toISOString(), expireAt: new Date(Date.now() - 50 * DAY).toISOString(), modules: PRODUCT_BIT_OS },
    }), 'utf8')
    // 缓存 60s 内仍为旧值 → 翻转时间强制重读
    vi.setSystemTime(Date.now() + 61_000)
    expect(readOs()).toBe(false)
    rmSync(sandbox, { recursive: true, force: true })
    delete process.env.CHATOP_DATA_ROOT
  })
})

