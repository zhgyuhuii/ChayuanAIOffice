// 右键图片卡死 v3：Playwright CDP 多次 pause 采样递归栈
import { mkdtemp, writeFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { _electron as electron } from '@playwright/test'
import { parseDocx, saveDocx } from '../packages/docx-engine/src/index'
import { buildDocx } from '../packages/docx-engine/tests/helpers/build-docx'
import { createRequire } from 'node:module'

const LOG = join(process.cwd(), 'e2e/artifacts/rc3.log')
const log = (m: string) => {
  appendFile(LOG, m + '\n').catch(() => {})
  console.log(m)
}
await writeFile(LOG, '=== v3 start ===\n').catch(() => {})

// 程序生成 2000x1500 噪声 PNG（近似真实照片的数据量与解码开销）
import { deflateSync } from 'node:zlib'
function makeBigPng(w: number, h: number): Buffer {
  const raw = Buffer.alloc(h * (1 + w * 3))
  let seed = 12345
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3)
    raw[row] = 0
    for (let x = 0; x < w; x++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      const v = (seed >> 16) & 0xff
      const o = row + 1 + x * 3
      raw[o] = v
      raw[o + 1] = (v * 7) % 256
      raw[o + 2] = (v * 13) % 256
    }
  }
  const idat = deflateSync(raw, { level: 6 })
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crcTable: number[] = []
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
    let crc = 0xffffffff
    for (const b of body) crc = crcTable[(crc ^ b) & 0xff]! ^ (crc >>> 8)
    const crcB = Buffer.alloc(4)
    crcB.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
    return Buffer.concat([len, body, crcB])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
const PNG_B64 = makeBigPng(2000, 1500).toString('base64')

const source = await buildDocx({ bodyXml: '<w:p><w:r><w:t>右键复现</w:t></w:r></w:p>' })
const parsed = await parseDocx(source)
const saved = await saveDocx(parsed, [{ kind: 'original', docxIndex: 0 }])
const dir = await mkdtemp(join(tmpdir(), 'chatoffice-rc3-'))
const file = join(dir, 'img-rc.docx')
const pngFile = join(dir, 'test-image.png')
await writeFile(file, saved)
await writeFile(pngFile, Buffer.from(PNG_B64, 'base64'))

const require = createRequire(join(process.cwd(), 'apps/shell/package.json'))
const executablePath = require('electron') as unknown as string
const app = await electron.launch({
  executablePath,
  args: [join(process.cwd(), 'apps/shell'), file],
  env: {
    ...process.env,
    CHATOFFICE_USER_DATA: await mkdtemp(join(tmpdir(), 'chatoffice-rc3-ud-')),
    GENOFFICE_NO_SPARE_VIEW: '1',
    CHATOFFICE_LANG: 'zh',
  },
})
const pages = app.windows()
let page = pages[0]
for (const w of pages) {
  if (w.url().includes('mode=tab')) page = w
}
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(2000)
  const ok = await Promise.race([
    page.evaluate(() => !!document.querySelector('.ProseMirror')),
    new Promise<boolean>((r) => setTimeout(() => r(false), 3000)),
  ]).catch(() => false)
  if (ok) break
}
await log('editor ready')

await page.locator('.ribbon-tab', { hasText: '插入' }).click()
await page.locator('.rb-big', { hasText: '图片' }).first().click()
await page.waitForTimeout(800)
await page.locator('input[type="file"]').first().setInputFiles(pngFile)
await page.waitForTimeout(800)
await page.locator('button', { hasText: /^插入/ }).last().click()
await page.waitForTimeout(2000)
await log(`imgs: ${await page.evaluate(() => document.querySelectorAll('.ProseMirror img').length)}`)

const box = await page.locator('.ProseMirror img').first().boundingBox()
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
await page.waitForTimeout(400)
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
await log('right-clicked')

let frozen = false
for (let i = 1; i <= 4; i++) {
  const s = await Promise.race([
    page.evaluate((n: number) => `alive-${n}`, i),
    new Promise<string>((r) => setTimeout(() => r('FROZEN'), 4000)),
  ]).catch(() => 'FROZEN-ERR')
  await log(`probe-${i}: ${s}`)
  if (s.startsWith('FROZEN')) {
    frozen = true
    break
  }
  await page.waitForTimeout(900)
}

if (frozen) {
  await log('=== sampling via Playwright CDP ===')
  const cdp = await page.context().newCDPSession(page)
  type Frame = { functionName: string; url: string; location?: { lineNumber: number; columnNumber: number } }
  type Paused = { callFrames?: Frame[] }
  let pendingResolve: ((v: Paused) => void) | null = null
  ;(cdp as unknown as { on: (e: string, f: (p: unknown) => void) => void }).on('Debugger.paused', (p) => {
    const r = pendingResolve
    pendingResolve = null
    r?.(p as Paused)
  })
  const send = (m: string, p?: object) =>
    Promise.race([
      (cdp as unknown as { send: (m: string, p?: object) => Promise<unknown> }).send(m, p) as Promise<unknown>,
      new Promise((r) => setTimeout(() => r(null), 4000)),
    ])
  for (let i = 0; i < 12; i++) {
    const got = new Promise<Paused>((r) => (pendingResolve = r))
    await send('Debugger.pause')
    const paused = await Promise.race([
      got,
      new Promise<Paused>((r) => setTimeout(() => r({}), 5000)),
    ])
    const frames = paused.callFrames ?? []
    await log(`sample-${i}: ${frames.length} frames`)
    for (const f of frames.slice(0, 16)) {
      const url = (f.url || 'jit').split('/').pop()
      await log(`   ${f.functionName || '(anon)'}  ${url}:${f.location?.lineNumber ?? '?'}:${f.location?.columnNumber ?? '?'}`)
    }
    if (frames.length === 0 && i > 3) break
    await send('Debugger.resume').catch(() => {})
    await page.waitForTimeout(120)
  }
  await log('=== sampling done ===')
}
process.exit(0)
