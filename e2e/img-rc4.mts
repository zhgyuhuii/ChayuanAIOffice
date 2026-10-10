// dev 渲染层(vite 未压缩) + Playwright pipe CDP：右键冻结后抓带函数名的递归栈
import { mkdtemp, writeFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { _electron as electron } from '@playwright/test'
import { parseDocx, saveDocx } from '../packages/docx-engine/src/index'
import { buildDocx } from '../packages/docx-engine/tests/helpers/build-docx'
import { createRequire } from 'node:module'

const LOG = join(process.cwd(), 'e2e/artifacts/rc4.log')
const log = (m: string) => {
  appendFile(LOG, m + '\n').catch(() => {})
  console.log(m)
}
await writeFile(LOG, '=== v4 dev-form start ===\n').catch(() => {})

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAWklEQVR4nO3PQQ2AMAwF0LcJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmLABa1wEg7QD2Dm1AAAAAElFTkSuQmCC'

const source = await buildDocx({ bodyXml: '<w:p><w:r><w:t>右键复现</w:t></w:r></w:p>' })
const parsed = await parseDocx(source)
const saved = await saveDocx(parsed, [{ kind: 'original', docxIndex: 0 }])
const dir = await mkdtemp(join(tmpdir(), 'chatoffice-rc4-'))
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
    CHATOFFICE_USER_DATA: await mkdtemp(join(tmpdir(), 'chatoffice-rc4-ud-')),
    GENOFFICE_NO_SPARE_VIEW: '1',
    CHATOFFICE_LANG: 'zh',
    // 渲染层指向正在运行的 dev vite（未压缩代码，CDP 栈带真实函数名）
    DOCS_RENDERER_URL: 'http://localhost:5173',
    SHEETS_RENDERER_URL: 'http://localhost:5174',
    SLIDES_RENDERER_URL: 'http://localhost:5175',
    PDF_RENDERER_URL: 'http://localhost:5176',
    MARKDOWN_RENDERER_URL: 'http://localhost:5177',
    HTML_RENDERER_URL: 'http://localhost:5178',
  },
})
const pages = app.windows()
let page = pages[0]
for (const w of pages) {
  if (w.url().includes('5173') || w.url().includes('mode=tab')) page = w
}
for (let i = 0; i < 15; i++) {
  await page.waitForTimeout(2000)
  const ok = await Promise.race([
    page.evaluate(() => !!document.querySelector('.ProseMirror')),
    new Promise<boolean>((r) => setTimeout(() => r(false), 3000)),
  ]).catch(() => false)
  if (ok) break
}
await log('editor ready (dev renderer)')

await page.locator('.ribbon-tab', { hasText: '插入' }).click()
await page.locator('.rb-big', { hasText: '图片' }).first().click()
await page.waitForTimeout(1000)
await page.locator('input[type="file"]').first().setInputFiles(pngFile)
await page.waitForTimeout(1000)
await page.locator('button', { hasText: /^插入/ }).last().click()
await page.waitForTimeout(2500)
await log(`imgs: ${await page.evaluate(() => document.querySelectorAll('.ProseMirror img').length)}`)

const box = await page.locator('.ProseMirror img').first().boundingBox()
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
await page.waitForTimeout(500)
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
  await log('=== FROZEN — Playwright pipe CDP 采样 ===')
  const cdp = await page.context().newCDPSession(page)
  type Frame = { functionName: string; url: string; location?: { lineNumber: number; columnNumber: number } }
  type Paused = { callFrames?: Frame[] }
  let pending: ((v: Paused) => void) | null = null
  ;(cdp as unknown as { on: (e: string, f: (p: unknown) => void) => void }).on('Debugger.paused', (p) => {
    const r = pending
    pending = null
    r?.(p as Paused)
  })
  const send = (m: string, p?: object) =>
    Promise.race([
      (cdp as unknown as { send: (m: string, p?: object) => Promise<unknown> }).send(m, p),
      new Promise((r) => setTimeout(() => r(null), 4000)),
    ])
  const all: Frame[][] = []
  for (let i = 0; i < 12; i++) {
    const got = new Promise<Paused>((r) => (pending = r))
    await send('Debugger.pause')
    const paused = await Promise.race([got, new Promise<Paused>((r) => setTimeout(() => r({}), 5000))])
    const frames = paused.callFrames ?? []
    await log(`sample-${i}: ${frames.length} frames`)
    for (const f of frames.slice(0, 18)) {
      const url = (f.url || 'jit').split('/').pop()
      await log(`   ${f.functionName || '(anon)'}  ${url}:${f.location?.lineNumber ?? '?'}:${f.location?.columnNumber ?? '?'}`)
    }
    if (frames.length) all.push(frames)
    if (!frames.length && i > 4) break
    await send('Debugger.resume').catch(() => {})
    await page.waitForTimeout(120)
  }
  await writeFile(join(process.cwd(), 'e2e/artifacts/rc4-stacks.json'), JSON.stringify(all, null, 1))
  await log(`saved ${all.length} stacks -> e2e/artifacts/rc4-stacks.json`)
}
process.exit(0)
