// 复现右键图片卡死 + CDP Debugger 抓递归调用栈（带函数名）
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { _electron as electron } from '@playwright/test'
import { parseDocx, saveDocx } from '../packages/docx-engine/src/index'
import { buildDocx } from '../packages/docx-engine/tests/helpers/build-docx'
import { createRequire } from 'node:module'

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAWklEQVR4nO3PQQ2AMAwF0LcJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmLABa1wEg7QD2Dm1AAAAAElFTkSuQmCC'

const source = await buildDocx({ bodyXml: '<w:p><w:r><w:t>右键复现</w:t></w:r></w:p>' })
const parsed = await parseDocx(source)
const saved = await saveDocx(parsed, [{ kind: 'original', docxIndex: 0 }])
const dir = await mkdtemp(join(tmpdir(), 'chatoffice-img-rc-'))
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
    CHATOFFICE_USER_DATA: await mkdtemp(join(tmpdir(), 'chatoffice-img-rc-ud-')),
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

// 真实插入图片
await page.locator('.ribbon-tab', { hasText: '插入' }).click()
await page.locator('.rb-big', { hasText: '图片' }).first().click()
await page.waitForTimeout(800)
await page.locator('input[type="file"]').first().setInputFiles(pngFile)
await page.waitForTimeout(800)
await page.locator('button', { hasText: /^插入/ }).last().click()
await page.waitForTimeout(2000)
console.log('imgs:', await page.evaluate(() => document.querySelectorAll('.ProseMirror img').length))

// 先左键选中图片（用户操作：选中图片）
const img = page.locator('.ProseMirror img').first()
const box = await img.boundingBox()
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
await page.waitForTimeout(500)
console.log('selected')

// 真实右键
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
console.log('right-clicked')

// 卡死检测
let frozen = false
for (let i = 1; i <= 4; i++) {
  const s = await Promise.race([
    page.evaluate((n: number) => `alive-${n}`, i),
    new Promise<string>((r) => setTimeout(() => r('FROZEN'), 4000)),
  ]).catch(() => 'FROZEN-ERR')
  console.log(`probe-${i}:`, s)
  if (s.startsWith('FROZEN')) {
    frozen = true
    break
  }
  await page.waitForTimeout(1200)
}

if (frozen) {
  console.log('=== FROZEN — 用 CDP Debugger 抓调用栈 ===')
  const cdp = await page.context().newCDPSession(page)
  const client = cdp as unknown as {
    send: (m: string, p?: object) => Promise<Record<string, unknown>>
    on: (e: string, f: (p: unknown) => void) => void
  }
  const stacks: unknown[] = []
  client.on('Debugger.paused', (p) => stacks.push(p))
  await client.send('Debugger.enable')
  await client.send('Debugger.pause')
  await page.waitForTimeout(2500)
  await client.send('Debugger.resume').catch(() => {})
  const paused = stacks[0] as { callFrames?: Array<{ functionName: string; url: string; lineNumber: number; columnNumber: number }> } | undefined
  const frames = paused?.callFrames ?? []
  console.log(`captured ${frames.length} frames; top 40:`)
  for (const f of frames.slice(0, 40)) {
    const url = f.url ? f.url.split('/').pop() : '(jit)'
    console.log(`  ${f.functionName || '(anon)'} @ ${url}:${f.lineNumber}:${f.columnNumber}`)
  }
  // 保存全栈供细看
  await writeFile(join(process.cwd(), 'e2e/artifacts/frozen-stack.json'), JSON.stringify(frames, null, 1))
  console.log('full stack -> e2e/artifacts/frozen-stack.json')
}
await app.close().catch(() => {})
