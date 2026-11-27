import JSZip from 'jszip'
import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  assertDeclaredSizesWithinLimits,
  assertZipInflatesWithinLimits,
  DEFAULT_ZIP_LIMITS,
  inflateRawWithinCap,
  LOCAL_FILE_ZIP_LIMITS,
  type DeclaredPart,
} from '../src/index'

const KB = 1024
const MB = 1024 * KB

/** Small budgets so the tests stay fast; the shape of the check is the point. */
const LIMITS = { maxParts: 100, maxPartBytes: 2 * MB, maxTotalBytes: 8 * MB } as const

const NAME = 'word/document.xml'

/** A valid one-part archive whose real payload is `realBytes`, with the
 *  central directory's declared uncompressed size rewritten to `declares`. */
async function onePart(
  realBytes: number,
  declares: number,
  opts?: { method?: 'store'; name?: string },
): Promise<Buffer> {
  const zip = new JSZip()
  const name = opts?.name ?? NAME
  const content =
    opts?.method === 'store'
      ? zip.file(name, Buffer.alloc(realBytes), { compression: 'STORE' })
      : zip.file(name, Buffer.alloc(realBytes))
  void content
  const bytes = (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer
  // rewrite the *file* entry's declared size (JSZip also emits an auto-created
  // directory entry whose central record comes first)
  const centralName = bytes.lastIndexOf(Buffer.from(name))
  bytes.writeUInt32LE(declares, centralName - 46 + 24)
  return bytes
}

describe('assertZipInflatesWithinLimits', () => {
  it('refuses a part that declares less than it inflates to', async () => {
    // The #759 case: megabytes behind a 300-byte declaration. Every declared
    // number is inside the limits, so only inflating can find out.
    const archive = await onePart(1024 * KB, 300)
    await expect(assertZipInflatesWithinLimits(archive, LIMITS)).rejects.toThrow(
      new RegExp(
        `part ${NAME.replace(/\//g, '\\/')} declares 300 uncompressed bytes but inflates past that`,
      ),
    )
  })

  it('catches the lie at the declared size, not at the payload', async () => {
    const archive = await onePart(1024 * KB, 300)
    const before = process.memoryUsage().rss
    await expect(assertZipInflatesWithinLimits(archive, LIMITS)).rejects.toThrow(/inflates past/)
    // The budget is one byte past the claim, so nothing near the payload size
    // is ever allocated.
    expect(process.memoryUsage().rss - before).toBeLessThan(16 * MB)
  })

  it('accepts an honest part, and a stored part that tells the truth', async () => {
    await expect(
      assertZipInflatesWithinLimits(await onePart(300, 300), LIMITS),
    ).resolves.toBeUndefined()
    await expect(
      assertZipInflatesWithinLimits(
        await onePart(64 * KB, 64 * KB, { method: 'store', name: 'word/media/image1.png' }),
        LIMITS,
      ),
    ).resolves.toBeUndefined()
  })

  it('ignores an EOCD signature written inside the archive comment', async () => {
    // A comment may legally contain the EOCD signature. Taking the last bare
    // signature reads an empty directory from the comment, skips every real
    // entry, and lets a lying part through the gate unchecked.
    const good = await onePart(1024 * KB, 300)
    const eocd = good.length - 22
    const fake = Buffer.from('PK\u0005\u0006' + '\u0000'.repeat(18), 'latin1')
    const commented = Buffer.concat([good, fake])
    commented.writeUInt16LE(fake.length, eocd + 20)
    await expect(assertZipInflatesWithinLimits(commented, LIMITS)).rejects.toThrow(/inflates past/)
  })

  it('accepts an honest archive that has a comment', async () => {
    const good = await onePart(300, 300, { method: 'store' })
    const eocd = good.length - 22
    const comment = Buffer.from('genoffice', 'utf8')
    const commented = Buffer.concat([good, comment])
    commented.writeUInt16LE(comment.length, eocd + 20)
    await expect(assertZipInflatesWithinLimits(commented, LIMITS)).resolves.toBeUndefined()
  })

  it('refuses a stored part that holds more bytes than it declares', async () => {
    await expect(
      assertZipInflatesWithinLimits(await onePart(64 * KB, 300, { method: 'store' }), LIMITS),
    ).rejects.toThrow(/inflates past that/)
  })

  it('rejects oversized declarations before inflating anything', async () => {
    const big = await onePart(300, LIMITS.maxPartBytes + 1)
    await expect(assertZipInflatesWithinLimits(big, LIMITS)).rejects.toThrow(/limit 2097152/)
  })

  it('rejects excess totals from verified lengths, not claims', async () => {
    // Two stored 3 MB parts honestly declaring 3 MB each: the verified total
    // busts the 4 MB budget even though no single part is over maxPartBytes.
    const zip = new JSZip()
    zip.file('a.bin', Buffer.alloc(3 * MB), { compression: 'STORE' })
    zip.file('b.bin', Buffer.alloc(3 * MB), { compression: 'STORE' })
    const bytes = (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer
    await expect(
      assertZipInflatesWithinLimits(new Uint8Array(bytes), {
        ...LIMITS,
        maxPartBytes: 4 * MB,
        maxTotalBytes: 5 * MB,
      }),
    ).rejects.toThrow(/total uncompressed size/)
  })

  it('bounds every entry against the archive and refuses unsupported forms', async () => {
    // A declared csize past the end of the file must never reach a reader
    // that allocates from declarations.
    const good = await onePart(300, 300)
    const centralOfPart = good.lastIndexOf(Buffer.from(NAME)) - 46
    const oversized = Buffer.from(good)
    oversized.writeUInt32LE(0xffffff00, centralOfPart + 20)
    await expect(assertZipInflatesWithinLimits(oversized, LIMITS)).rejects.toThrow(
      /outside the .*-byte archive/,
    )

    // Encrypted flag in the central directory.
    const encrypted = Buffer.from(good)
    encrypted.writeUInt16LE(0x1, centralOfPart + 8)
    await expect(assertZipInflatesWithinLimits(encrypted, LIMITS)).rejects.toThrow(/encrypted/)

    // Garbage that is not a zip at all.
    await expect(assertZipInflatesWithinLimits(Buffer.from('not a zip'), LIMITS)).rejects.toThrow(
      /end of central directory/,
    )
  })

  it('keeps the default policy shared with the engines', () => {
    expect(DEFAULT_ZIP_LIMITS.maxParts).toBe(10000)
    expect(DEFAULT_ZIP_LIMITS.maxPartBytes).toBe(512 * 1024 * 1024)
    expect(DEFAULT_ZIP_LIMITS.maxTotalBytes).toBe(1.5 * 1024 * 1024 * 1024)
  })
})

describe('assertDeclaredSizesWithinLimits', () => {
  it('rejects too many parts by declared count alone', () => {
    const parts: DeclaredPart[] = Array.from({ length: LIMITS.maxParts + 1 }, (_, i) => ({
      name: `p/${i}`,
      usize: 1,
    }))
    expect(() => assertDeclaredSizesWithinLimits(parts, LIMITS)).toThrow(/parts exceeds/)
    expect(() =>
      assertDeclaredSizesWithinLimits([{ name: 'a.xml', usize: 10 }], LIMITS),
    ).not.toThrow()
  })
})

describe('inflateRawWithinCap', () => {
  it('returns the inflated bytes for an honest stream', async () => {
    const raw = deflateRawSync(Buffer.alloc(64 * KB))
    const out = await inflateRawWithinCap(raw, 128 * KB)
    expect(out).not.toBeNull()
    expect(out!.byteLength).toBe(64 * KB)
    expect(out![0]).toBe(0)
    expect(out![63 * KB]).toBe(0)
  })

  it('accepts output exactly at the cap and refuses one byte past it', async () => {
    const raw = deflateRawSync(Buffer.alloc(100))
    await expect(inflateRawWithinCap(raw, 100)).resolves.not.toBeNull()
    await expect(inflateRawWithinCap(raw, 99)).resolves.toBeNull()
  })

  it('refuses a non-finite or negative cap', async () => {
    // NaN makes `seen > maxBytes` false for every chunk, so the old gate let
    // the entire part through instead of refusing a meaningless budget
    const raw = deflateRawSync(Buffer.alloc(100))
    for (const cap of [NaN, Infinity, -Infinity, -1]) {
      await expect(inflateRawWithinCap(raw, cap)).resolves.toBeNull()
    }
  })

  it('cancels a lying stream at the cap instead of materialising the payload', async () => {
    // 1 MB of output behind a small compressed block — the serving-side twin
    // of the #759 bomb, where the caller never gate-checked the declaration.
    const raw = deflateRawSync(Buffer.alloc(1024 * KB))
    const before = process.memoryUsage().rss
    await expect(inflateRawWithinCap(raw, 128 * KB)).resolves.toBeNull()
    expect(process.memoryUsage().rss - before).toBeLessThan(32 * MB)
  })

  it('returns null for corrupt input instead of throwing', async () => {
    await expect(inflateRawWithinCap(Buffer.from('not a deflate stream'), 1024)).resolves.toBeNull()
  })
})

/** A minimal honest one-entry ZIP64 archive: the entry's usize and local
 *  offset are maxed in the central record and repointed by a 0x0001 extra
 *  field, the real counts live in an EOCD64 record behind a locator. */
function zip64OnePart(payload: Buffer): Buffer {
  const name = Buffer.from('word/document.xml')
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(45, 4)
  local.writeUInt16LE(0, 8) // method = STORE
  local.writeUInt32LE(0, 14) // crc
  local.writeUInt32LE(payload.length, 18) // local csize: real values are legal
  local.writeUInt32LE(payload.length, 22) // local usize
  local.writeUInt16LE(name.length, 26)
  const cdOffset = local.length + name.length + payload.length

  const extra = Buffer.alloc(4 + 16)
  extra.writeUInt16LE(0x0001, 0)
  extra.writeUInt16LE(16, 2)
  extra.writeBigUInt64LE(BigInt(payload.length), 4) // real usize
  extra.writeBigUInt64LE(0n, 12) // real local offset

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(45, 4)
  central.writeUInt16LE(45, 6)
  central.writeUInt16LE(0, 8) // method = STORE
  central.writeUInt32LE(payload.length, 20) // csize real
  central.writeUInt32LE(0xffffffff, 24) // usize maxed → extra field
  central.writeUInt16LE(name.length, 28)
  central.writeUInt16LE(extra.length, 30)
  central.writeUInt32LE(0xffffffff, 42) // local offset maxed → extra field
  const cdSize = central.length + name.length + extra.length

  const eocd64Offset = cdOffset + cdSize
  const eocd64 = Buffer.alloc(56)
  eocd64.writeUInt32LE(0x06064b50, 0)
  eocd64.writeBigUInt64LE(44n, 4) // bytes after the size field
  eocd64.writeUInt32LE(0, 16) // disk
  eocd64.writeUInt32LE(0, 20) // disk with CD
  eocd64.writeBigUInt64LE(1n, 24) // entries on disk
  eocd64.writeBigUInt64LE(1n, 32) // total entries
  eocd64.writeBigUInt64LE(BigInt(cdSize), 40)
  eocd64.writeBigUInt64LE(BigInt(cdOffset), 48)

  const locator = Buffer.alloc(20)
  locator.writeUInt32LE(0x07064b50, 0)
  locator.writeUInt32LE(0, 4)
  locator.writeBigUInt64LE(BigInt(eocd64Offset), 8)
  locator.writeUInt32LE(1, 16)

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0xffff, 8) // maxed → EOCD64 record carries the truth
  eocd.writeUInt16LE(0xffff, 10)
  eocd.writeUInt32LE(0xffffffff, 12)
  eocd.writeUInt32LE(0xffffffff, 16)

  return Buffer.concat([local, name, payload, central, name, extra, eocd64, locator, eocd])
}

describe('zip64', () => {
  it('accepts an honest zip64 archive', async () => {
    const archive = zip64OnePart(Buffer.alloc(4 * KB))
    await expect(assertZipInflatesWithinLimits(archive)).resolves.toBeUndefined()
  })

  it('accepts a zip64 part whose declared size passes the local-file profile', async () => {
    const archive = zip64OnePart(Buffer.alloc(3 * MB))
    // a tight per-part ceiling still rejects it...
    await expect(
      assertZipInflatesWithinLimits(archive, {
        maxParts: 100,
        maxPartBytes: 2 * MB,
        maxTotalBytes: 8 * MB,
        maxRatio: 250,
      }),
    ).rejects.toThrow(/declares .* uncompressed bytes/)
    // ...while the raised local-file ceiling with the ratio cap admits it
    await expect(
      assertZipInflatesWithinLimits(archive, {
        maxParts: 100,
        maxPartBytes: 4 * MB,
        maxTotalBytes: 8 * MB,
        maxRatio: 250,
      }),
    ).resolves.toBeUndefined()
  })

  it('still rejects maxed marker fields with no zip64 locator behind them', async () => {
    const archive = await onePart(KB, KB)
    const eocd = archive.length - 22
    archive.writeUInt16LE(0xffff, eocd + 10) // count maxed, no locator precedes
    await expect(assertZipInflatesWithinLimits(archive, LIMITS)).rejects.toThrow(/zip64/)
  })

  it('rejects a zip64 locator pointing outside the archive', async () => {
    const archive = zip64OnePart(Buffer.alloc(KB))
    const eocd = archive.length - 22
    archive.writeBigUInt64LE(0xffffffffn, eocd - 20 + 8) // bogus EOCD64 offset
    await expect(assertZipInflatesWithinLimits(archive)).rejects.toThrow(
      /corrupt zip64 end of central directory/,
    )
  })
})

describe('LOCAL_FILE_ZIP_LIMITS ratio gate', () => {
  it('rejects a high-ratio part once the absolute ceilings are gone', async () => {
    // 100 MB of zeros deflate to ~100 KB (JSZip defaults to STORE, so the
    // compression must be asked for): ratio ~1000:1, far past the cap.
    const zip = new JSZip()
    zip.file(NAME, Buffer.alloc(100 * MB), { compression: 'DEFLATE' })
    const archive = (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer
    await expect(assertZipInflatesWithinLimits(archive, LOCAL_FILE_ZIP_LIMITS)).rejects.toThrow(
      /ratio .* exceeds 250/,
    )
  })

  it('admits honest local-file-scale archives', async () => {
    const archive = await onePart(2 * MB, 2 * MB)
    await expect(assertZipInflatesWithinLimits(archive, LOCAL_FILE_ZIP_LIMITS)).resolves.toBeUndefined()
  })
})
