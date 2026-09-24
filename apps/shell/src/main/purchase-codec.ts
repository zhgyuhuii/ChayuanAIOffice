/**
 * Offline purchase pure layer (LOCAL feature, B-zone): no Electron imports,
 * fully unit-testable. Mirrors the harness implementation
 * (chayuan-harness desktop/src/main/purchase-codec.ts), which in turn is
 * bit-compatible with the store-side signer (aidooo.com server/license/):
 *  - Crockford base32 + mod-37 check char
 *  - v1 (6-byte header, 24 chars) / v2 (7-byte header, 25 chars) unpacking
 *  - tag = HMAC-SHA256(header || fingerprint, key)[:8], timing-safe compare
 *  - free-period / popup scheduling predicates (2026-09-20 consensus Q5)
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/** Free period length: three months of total silence from first run (Q5). */
export const FREE_PERIOD_MS = 90 * 86400_000
/** Serial module bitmap bits — the store's modules table is authoritative:
 * bit 10 is already taken by skillpack, so Chayuan AI OS = bit 11 and
 * Chayuan AI Office = bit 12 (v2 header carries 16 bits; production signs
 * ver=activeKeyId=1 with the v2 layout whenever modules > 0xff). */
export const PRODUCT_BIT_OS = 1 << 11
export const PRODUCT_BIT_OFFICE = 1 << 12

const ENC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const CHECK = ENC + '*~$=U'
const DEC: Record<string, number> = {}
for (let i = 0; i < ENC.length; i++) DEC[ENC[i]] = i
DEC['O'] = 0
DEC['I'] = 1
DEC['L'] = 1

function base32Decode(str: string): Buffer {
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const raw of str.toUpperCase()) {
    if (raw === '-') continue
    const v = DEC[raw]
    if (v === undefined) throw new Error(`invalid base32 symbol: ${raw}`)
    value = (value << 5) | v
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
      value &= (1 << bits) - 1
    }
  }
  return Buffer.from(out)
}

function checkChar(buf: Buffer): string {
  let n = 0n
  for (const b of buf) n = (n * 256n + BigInt(b)) % 37n
  return CHECK[Number(n)]
}

export interface SerialFields {
  ver: number
  kind: number
  modules: number
  value: number
  issueDate: number
  nonce: number
}

const ORDER = ['ver', 'kind', 'modules', 'value', 'issueDate', 'nonce'] as const
const WIDTHS_V1 = [4, 1, 8, 14, 13, 8]
const WIDTHS_V2 = [4, 1, 16, 14, 13, 8]

function unpack(buf: Buffer): SerialFields {
  const widths = buf.length === 7 ? WIDTHS_V2 : buf.length === 6 ? WIDTHS_V1 : null
  if (widths === null) throw new Error('bad header length')
  let v = 0n
  for (const b of buf) v = (v << 8n) | BigInt(b)
  const out: Record<string, number> = {}
  for (let i = ORDER.length - 1; i >= 0; i--) {
    const w = BigInt(widths[i])
    out[ORDER[i]] = Number(v & ((1n << w) - 1n))
    v >>= w
  }
  return out as unknown as SerialFields
}

export type SerialVerifyReason =
  | 'length'
  | 'decode'
  | 'checksum'
  | 'unknown-key'
  | 'signature'
  | 'kind'

export interface SerialVerifyResult {
  valid: boolean
  reason?: SerialVerifyReason
  fields?: SerialFields
}

/**
 * Verify one short serial against this machine (machineFp) and key. Signature
 * check only — the caller decides which product bits entitle THIS app (the
 * office shell accepts OS|OFFICE, one-way coverage, consensus Q9) and how the
 * duration applies (both Chayuan shells use activation time + days; no
 * rollback guard by design — the license gates nothing functional).
 */
export function verifySerial(serial: string, machineFp: string, hmacKeyHex: string): SerialVerifyResult {
  const norm = serial.replace(/-/g, '').toUpperCase()
  const headerLen = norm.length === 24 ? 6 : norm.length === 25 ? 7 : 0
  if (!headerLen) return { valid: false, reason: 'length' }
  let body: Buffer
  try {
    body = base32Decode(norm.slice(0, norm.length - 1))
  } catch {
    return { valid: false, reason: 'decode' }
  }
  if (body.length !== headerLen + 8) return { valid: false, reason: 'decode' }
  if (checkChar(body) !== norm[norm.length - 1]) return { valid: false, reason: 'checksum' }
  const header = body.subarray(0, headerLen)
  const givenTag = body.subarray(headerLen)
  let fields: SerialFields
  try {
    fields = unpack(header)
  } catch {
    return { valid: false, reason: 'length' }
  }
  const key = Buffer.from(hmacKeyHex, 'hex')
  if (key.length !== 32) return { valid: false, reason: 'unknown-key' }
  // Store signing conventions differ by era/issuer path: the original
  // regular path fed the fingerprint as the utf8 hex string; the CURRENT
  // payment fulfillment path (server/payment/issue.js) feeds the
  // hex-DECODED bytes — verified against a real paid order on 2026-09-22.
  // Accept either; both compares timing-safe.
  const tagUtf8 = createHmac('sha256', key).update(header).update(machineFp).digest().subarray(0, 8)
  const tagBytes = createHmac('sha256', key).update(header).update(Buffer.from(machineFp, 'hex')).digest().subarray(0, 8)
  if (!timingSafeEqual(tagUtf8, givenTag) && !timingSafeEqual(tagBytes, givenTag)) return { valid: false, reason: 'signature' }
  if (fields.kind !== 0) return { valid: false, reason: 'kind' }
  return { valid: true, fields }
}

/** Stable per-machine fingerprint: sha256(OS machine id)[:16] hex. Both Chayuan
 * shells derive it the same way so one machine reports a single code to
 * support regardless of which app asks. */
export function fingerprintFromMachineId(osMachineId: string): string {
  return createHash('sha256').update(osMachineId).digest('hex').slice(0, 16)
}

// ── Scheduling predicates (consensus Q5) ──

export interface PurchaseSchedState {
  firstRunAt: string
  pageShownDate: string | null
  activation: { expireAt: string } | null
}

export function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Licensed = activation present and not expired; expiry resumes reminders
 * immediately (no second grace period). */
export function isEntitled(state: PurchaseSchedState, now = Date.now()): boolean {
  return state.activation !== null && Date.parse(state.activation.expireAt) > now
}

/** True once the 90-day free period is over. */
export function freePeriodOver(state: PurchaseSchedState, now = Date.now()): boolean {
  const firstRun = Date.parse(state.firstRunAt)
  return now - (Number.isNaN(firstRun) ? now : firstRun) >= FREE_PERIOD_MS
}

/** The once-per-day purchase dialog is due (past free period, unlicensed,
 * not shown yet today). */
export function pageDue(state: PurchaseSchedState, now = new Date()): boolean {
  return !isEntitled(state, now.getTime()) && freePeriodOver(state, now.getTime()) && state.pageShownDate !== localDateStr(now)
}

/** The 30-minute gentle toast is due (past free period, unlicensed). */
export function remindDue(state: PurchaseSchedState, now = Date.now()): boolean {
  return !isEntitled(state, now) && freePeriodOver(state, now)
}
