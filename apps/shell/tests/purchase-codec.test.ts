/**
 * Offline purchase pure layer tests:
 *  1) HMAC short-serial verification against real vectors produced by the
 *     store-side signer (aidooo.com server/license/shortcode.js sign()) —
 *     these are the cross-implementation regression anchor; regenerate with
 *     that signer whenever the store format changes.
 *  2) Rejection paths: tampered digit, wrong fingerprint, garbage input,
 *     wrong key.
 *  3) Scheduling predicates (consensus Q5): 90-day free period boundary,
 *     once-per-day page popup, reminder resume on expiry.
 */
import { describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  FREE_PERIOD_MS,
  PRODUCT_BIT_OFFICE,
  PRODUCT_BIT_OS,
  fingerprintFromMachineId,
  freePeriodOver,
  isEntitled,
  localDateStr,
  pageDue,
  remindDue,
  verifySerial,
} from '../src/main/purchase-codec'

// Shared with the vector set below. Note the key convention: the store signs
// and verifies with the hex-DECODED 32-byte buffer (fulfill.js), not the utf8
// hex string.
const KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'
const FP_A = '0123456789abcdef'
const FP_B = 'deadbeefcafebabe'

// Production convention: ver=activeKeyId=1; modules>0xff auto-switches to the
// v2 layout (25 chars). Vectors signed by the store signer.
// sign({ver:1,kind:0,modules:1<<11,value:365,issueDate:262,nonce:200}, FP_A, Buffer(KEY,'hex'))
const OS_YEAR_A = '21000-BD10V-43SGS-A1AW2-S64X~'
// sign({ver:1,kind:0,modules:1<<11,value:90,issueDate:262,nonce:201}, FP_A, Buffer(KEY,'hex'))
const OS_QUARTER_A = '21000-2T10V-4WQDJ-Q2ZKF-Z5SJ0'
// sign({ver:1,kind:0,modules:1<<12,value:365,issueDate:262,nonce:202}, FP_B, Buffer(KEY,'hex'))
const OFFICE_YEAR_B = '22000-BD10V-59HPB-RZ29Y-YK53S'
// sign({ver:1,kind:0,modules:1<<1,value:30,issueDate:262,nonce:203}, FP_A, Buffer(KEY,'hex'))
const CHAT_V1_A = '20807-G86SC-J6HRS-RCQFC-EDR1'

describe('verifySerial (store signer vectors)', () => {
  it('accepts an OS annual serial (v2 layout, ver=1) for the matching machine, fields intact', () => {
    const r = verifySerial(OS_YEAR_A, FP_A, KEY)
    expect(r.valid).toBe(true)
    expect(r.fields).toMatchObject({ ver: 1, kind: 0, modules: 1 << 11, value: 365, issueDate: 262, nonce: 200 })
  })

  it('accepts an OS quarterly serial (v2 layout, ver=1) with value=90', () => {
    const r = verifySerial(OS_QUARTER_A, FP_A, KEY)
    expect(r.valid).toBe(true)
    expect(r.fields?.value).toBe(90)
  })

  it('accepts a v2 OFFICE serial (office bit) for its machine', () => {
    const r = verifySerial(OFFICE_YEAR_B, FP_B, KEY)
    expect(r.valid).toBe(true)
    expect(r.fields?.modules & PRODUCT_BIT_OFFICE).not.toBe(0)
  })

  it('accepts legacy v1 (6-byte header, 24 chars)', () => {
    const r = verifySerial(CHAT_V1_A, FP_A, KEY)
    expect(r.valid).toBe(true)
    expect(r.fields).toMatchObject({ ver: 1, modules: 1 << 1, value: 30 })
  })

  it('tolerates lowercase input without dashes (manual typing)', () => {
    const r = verifySerial(OS_YEAR_A.toLowerCase().replaceAll('-', ''), FP_A, KEY)
    expect(r.valid).toBe(true)
  })

  it('rejects a serial from another machine (fingerprint binding)', () => {
    expect(verifySerial(OS_YEAR_A, FP_B, KEY)).toMatchObject({ valid: false, reason: 'signature' })
  })

  it('rejects a tampered digit on the check char', () => {
    const tampered = OS_YEAR_A.slice(0, -1) + (OS_YEAR_A.endsWith('3') ? '4' : '3')
    expect(verifySerial(tampered, FP_A, KEY)).toMatchObject({ valid: false, reason: 'checksum' })
  })

  it('rejects garbage, short and empty input', () => {
    expect(verifySerial('short', FP_A, KEY)).toMatchObject({ valid: false, reason: 'length' })
    expect(verifySerial('!!!!!-!!!!!-!!!!!-!!!!!-!!!!', FP_A, KEY)).toMatchObject({ valid: false, reason: 'decode' })
    expect(verifySerial('', FP_A, KEY)).toMatchObject({ valid: false, reason: 'length' })
  })

  it('rejects with a wrong key', () => {
    expect(verifySerial(OS_YEAR_A, FP_A, 'ff'.repeat(32))).toMatchObject({ valid: false, reason: 'signature' })
  })

  // The CURRENT store fulfillment path (server/payment/issue.js) feeds the
  // fingerprint hex-DECODED to tag8; the client accepts that convention too
  // (dual-convention verification, verified against a real paid order).
  it('accepts the store fulfillment convention (fingerprint as hex-decoded bytes)', () => {
    const ENC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
    const CHECK = ENC + '*~$=U'
    const fields = { ver: 1, kind: 0, modules: PRODUCT_BIT_OFFICE, value: 31, issueDate: 264, nonce: 94 }
    const widths = [4, 1, 16, 14, 13, 8]
    const vals = [fields.ver, fields.kind, fields.modules, fields.value, fields.issueDate, fields.nonce]
    let v = 0n
    for (let i = 0; i < vals.length; i++) v = (v << BigInt(widths[i])) | BigInt(vals[i])
    const header = Buffer.from(v.toString(16).padStart(14, '0'), 'hex')
    const tag = createHmac('sha256', Buffer.from(KEY, 'hex'))
      .update(header)
      .update(Buffer.from(FP_A, 'hex'))
      .digest()
      .subarray(0, 8)
    let bits = 0
    let acc = 0
    let enc = ''
    for (const b of Buffer.concat([header, tag])) {
      acc = (acc << 8) | b
      bits += 8
      while (bits >= 5) {
        enc += ENC[(acc >>> (bits - 5)) & 31]
        bits -= 5
      }
    }
    const body = Buffer.concat([header, tag])
    let n = 0n
    for (const b of body) n = (n * 256n + BigInt(b)) % 37n
    const serial = (enc + CHECK[Number(n)]).replace(/(.{5})/g, '$1-').replace(/-$/, '')
    const r = verifySerial(serial, FP_A, KEY)
    expect(r.valid).toBe(true)
    expect(r.fields).toMatchObject({ modules: PRODUCT_BIT_OFFICE, value: 31, nonce: 94 })
    // still bound to the machine: another fingerprint fails
    expect(verifySerial(serial, FP_B, KEY)).toMatchObject({ valid: false, reason: 'signature' })
  })

  it('entitlement bits: an OS serial carries bit10 and would also satisfy the office shell (Q9)', () => {
    const os = verifySerial(OS_YEAR_A, FP_A, KEY)
    expect(os.fields!.modules & PRODUCT_BIT_OS).not.toBe(0)
    // The office shell accepts OS|OFFICE; the reverse is not true — a pure
    // office serial must NOT be treated as an OS entitlement.
    const office = verifySerial(OFFICE_YEAR_B, FP_B, KEY)
    expect(office.fields!.modules & PRODUCT_BIT_OS).toBe(0)
    expect(office.fields!.modules & (PRODUCT_BIT_OS | PRODUCT_BIT_OFFICE)).not.toBe(0)
  })
})

describe('fingerprint derivation', () => {
  it('is sha256(machine id)[:16] hex', () => {
    expect(fingerprintFromMachineId('B61B72C6-C133-5291-BDA9-15317866F2BE')).toBe('c22e86ce6642e192')
  })
})

describe('scheduling predicates (consensus Q5)', () => {
  const day = 86400_000
  const firstRun = new Date('2026-09-20T08:00:00').getTime()
  const state = (over: { pageShown?: string | null; expireAt?: string | null } = {}) => ({
    firstRunAt: new Date(firstRun).toISOString(),
    pageShownDate: over.pageShown ?? null,
    activation: over.expireAt ? { expireAt: over.expireAt } : null,
  })

  it('free period (<90 days): page and reminder both silent', () => {
    const s = state()
    const t89 = new Date(firstRun + 89 * day)
    expect(freePeriodOver(s, t89.getTime())).toBe(false)
    expect(pageDue(s, t89)).toBe(false)
    expect(remindDue(s, t89.getTime())).toBe(false)
  })

  it('from the 90th day on: page and reminder activate together', () => {
    const s = state()
    const t90 = new Date(firstRun + FREE_PERIOD_MS)
    expect(freePeriodOver(s, t90.getTime())).toBe(true)
    expect(pageDue(s, t90)).toBe(true)
    expect(remindDue(s, t90.getTime())).toBe(true)
  })

  it('page already shown today: pageDue=false (once per day), reminders unaffected', () => {
    const s = state({ pageShown: localDateStr(new Date(firstRun + FREE_PERIOD_MS)) })
    expect(pageDue(s, new Date(firstRun + FREE_PERIOD_MS + 3600_000))).toBe(false)
    expect(remindDue(s, firstRun + FREE_PERIOD_MS + 3600_000)).toBe(true)
  })

  it('next day flips pageDue back to true (once per day)', () => {
    const shownDay = new Date(firstRun + FREE_PERIOD_MS)
    const s = state({ pageShown: localDateStr(shownDay) })
    const nextDay = new Date(shownDay.getTime() + day)
    expect(pageDue(s, nextDay)).toBe(true)
  })

  it('licensed and unexpired: everything silent', () => {
    const s = state({ expireAt: new Date(firstRun + FREE_PERIOD_MS + 30 * day).toISOString() })
    const t = new Date(firstRun + FREE_PERIOD_MS + day)
    expect(isEntitled(s, t.getTime())).toBe(true)
    expect(pageDue(s, t)).toBe(false)
    expect(remindDue(s, t.getTime())).toBe(false)
  })

  it('expiry resumes reminders immediately (no second grace period)', () => {
    const s = state({ expireAt: new Date(firstRun + FREE_PERIOD_MS + day).toISOString() })
    const afterExpire = new Date(firstRun + FREE_PERIOD_MS + day + 3600_000)
    expect(isEntitled(s, afterExpire.getTime())).toBe(false)
    expect(remindDue(s, afterExpire.getTime())).toBe(true)
  })

  it('corrupt firstRunAt recomputes from now instead of crashing', () => {
    const s = { firstRunAt: 'not-a-date', pageShownDate: null, activation: null }
    expect(freePeriodOver(s, Date.now())).toBe(false)
  })
})
