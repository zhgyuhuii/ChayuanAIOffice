// 右键图片卡死 v5：冻结后杀渲染进程触发恢复，读取 rcProbeLog 环形缓冲
import { execSync } from 'node:child_process'
import { mkdtemp, writeFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { _electron as electron } from '@playwright/test'
import { parseDocx, saveDocx } from '../packages/docx-engine/src/index'
import { buildDocx } from '../packages/docx-engine/tests/helpers/build-docx'
import { createRequire } from 'node:module'

const LOG = join(process.cwd(), 'e2e/artifacts/rc5.log')
const log = (m: string) => {
  appendFile(LOG, m + '\n').catch(() => {})
  console.log(m)
}
await writeFile(LOG, '=== v5 start ===\n').catch(() => {})

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAWklEQVR4nO3PQQ2AMAwF0LcJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmLABa1wEg7QD2Dm1AAAAAElFTkSuQmCC'

const source = await buildDocx({ bodyXml: '<w:p><w:r><w:t>右键复现</w:t></w:r></w:p>' })
const parsed = await parseDocx(source)
const saved = await saveDocx(parsed, [{ kind: 'original', docxIndex: 0 }])
const dir = await mkdtemp(join(tmpdir(), 'chatoffice-rc5-'))
const file = join(dir, 'img-rc.docx')
const pngFile = join(dir, 'test-image.png')
await writeFile(file, saved)
await writeFile(pngFile, Buffer.from(PNG, 'base64'))

const require = createRequire(join(process.cwd(), 'apps/shell/package.json'))
const executablePath = require('electron') as unknown as string
const userData = await mkdtemp(join(tmpdir(), 'chatoffice-rc5-ud-'))
const app = await electron.launch({
  executablePath,
  args: [join(process.cwd(), 'apps/shell'), file],
  env: {
    ...process.env,
    CHATOFFICE_USER_DATA: userData,
    GENOFFICE_NO_SPARE_VIEW: '1',
    CHATOFFICE_LANG: 'zh',
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
await log('editor ready (dev renderer, instrumented)')

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
  await log('=== FROZEN — 采样 + 杀渲染进程读环形缓冲 ===')
  // 原生采样存证
  try {
    const pids = execSync(
      `ps aux | grep "type=renderer" | grep 察元AIOffice | grep -v grep | awk '$3 > 30 {print $2}'`,
    ).toString().trim().split('\n').filter(Boolean)
    await log(`busy renderers: ${pids.join(',') || '(none)'}`)
    for (const pid of pids.slice(0, 1)) {
      execSync(`sample ${pid} 2 -file /tmp/rc5-frozen-sample.txt`).toString()
      await log(`sampled ${pid} -> /tmp/rc5-frozen-sample.txt`)
    }
    if (pids[0]) {
      execSync(`kill -9 ${pids[0]}`)
      await log(`killed frozen renderer ${pids[0]} — 等待 shell 自动恢复`)
    }
  } catch (e) {
    await log(`sample/kill error: ${String(e).slice(0, 150)}`)
  }
  // 等恢复
  await page.waitForTimeout(8000)
  for (let i = 0; i < 10; i++) {
    const ok = await Promise.race([
      page.evaluate(() => !!document.querySelector('.ProseMirror')),
      new Promise<boolean>((r) => setTimeout(() => r(false), 3000)),
    ]).catch(() => false)
    if (ok) break
    await page.waitForTimeout(2000)
  }
  const ring = await Promise.race([
    page.evaluate(() => localStorage.getItem('rcProbeLog')),
    new Promise<string>((r) => setTimeout(() => r('READ-TIMEOUT'), 5000)),
  ]).catch(() => 'READ-ERR')
  await log('=== rcProbeLog (last 60) ===')
  try {
    const entries = JSON.parse(String(ring) || '[]') as string[]
    for (const e of entries.slice(-60)) await log(e)
  } catch {
    await log(`raw: ${String(ring).slice(0, 2000)}`)
  }
}
process.exit(0)
