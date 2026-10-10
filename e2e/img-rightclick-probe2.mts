// 右键图片卡死复现 v2：连续 Debugger.pause 采样递归栈
import { mkdtemp, writeFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { _electron as electron } from '@playwright/test'
import { parseDocx, saveDocx } from '../packages/docx-engine/src/index'
import { buildDocx } from '../packages/docx-engine/tests/helpers/build-docx'
import { createRequire } from 'node:module'

const LOG = join(process.cwd(), 'e2e/artifacts/rightclick-probe.log')
const log = (m: string) => appendFile(LOG, m + '\n').catch(() => {})
await writeFile(LOG, '=== probe start ===\n').catch(() => {})

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAWklEQVR4nO3PQQ2AMAwF0LcJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmLABa1wEg7QD2Dm1AAAAAElFTkSuQmCC'

const source = await buildDocx({ bodyXml: '<w:p><w:r><w:t>右键复现</w:t></w:r></w:p>' })
const parsed = await parseDocx(source)
const saved = await saveDocx(parsed, [{ kind: 'original', docxIndex: 0 }])
const dir = await mkdtemp(join(tmpdir(), 'chatoffice-img-rc2-'))
const file = join(dir, 'img-rc.docx')
const pngFile = join(dir, 'test-image.png')
await writeFile(file, saved)
await writeFile(pngFile, Buffer.from(PNG, 'base64'))

const require = createRequire(join(process.cwd(), 'apps/shell/package.json'))
const executablePath = require('electron') as unknown as string
const app = await electron.launch({
  executablePath,
  args: [join(process.cwd(), 'apps/shell'), file],
  env: {
    ...process.env,
    CHATOFFICE_USER_DATA: await mkdtemp(join(tmpdir(), 'chatoffice-img-rc2-ud-')),
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
await log(`imgs after insert: ${await page.evaluate(() => document.querySelectorAll('.ProseMirror img').length)}`)

const img = page.locator('.ProseMirror img').first()
const box = await img.boundingBox()
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
  await page.waitForTimeout(1000)
}

if (frozen) {
  await log('=== FROZEN — 连续采样调用栈 ===')
  const cdp = await page.context().newCDPSession(page)
  type Frame = { functionName: string; url: string; lineNumber: number; columnNumber: number }
  type Paused = { callFrames?: Frame[]; reason?: string }
  const events: Paused[] = []
  let waiter: ((v: Paused) => void) | null = null
  ;(cdp as unknown as {
    on: (e: string, f: (p: unknown) => void) => void
  }).on('Debugger.paused', (p) => {
    events.push(p as Paused)
    waiter?.(p as Paused)
    waiter = null
  })
  const client = cdp as unknown as { send: (m: string, p?: object) => Promise<Record<string, unknown>> }
  await client.send('Debugger.enable', { maxScriptsCacheSize: 1e9 })
  for (let i = 0; i < 10; i++) {
    const pending = new Promise<Paused>((r) => (waiter = r))
    await client.send('Debugger.pause').catch(() => {})
    const paused = await Promise.race([
      pending,
      new Promise<Paused>((r) => setTimeout(() => r({}), 2000)),
    ])
    const frames = paused.callFrames ?? []
    const chain = frames
      .slice(0, 60)
      .map((f) => `${f.functionName || '(anon)'}@${(f.url || 'jit').split('/').pop()}:${f.lineNumber}`)
      .join(' <- ')
    await log(`sample-${i}: ${frames.length} frames\n  ${chain}\n`)
    await client.send('Debugger.resume').catch(() => {})
    await page.waitForTimeout(150)
  }
  await log('=== done sampling ===')
}
process.exit(0)
