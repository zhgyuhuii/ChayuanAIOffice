// GUI smoke: 察元 AI tab renders with its 5 groups, dropdown menus hold the
// wps contracts (14/6), a docops dialog opens, and the context menu shows the
// AI 文本助手 submenu. Headless Chrome over the built web bundle (port 5180).
import { chromium } from 'playwright-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = process.env.DOCS_URL || 'http://localhost:5180/editors/docs/'

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const page = await browser.newPage({ viewport: { width: 1560, height: 1000 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

await page.goto(URL, { waitUntil: 'networkidle' })
// the docs editor needs a moment for the boot state; wait for the ribbon tab strip
await page.waitForSelector('.rb-tab, [class*="tab"]', { timeout: 20000 }).catch(() => {})
await page.waitForTimeout(2500)

const report = {}
report.title = await page.title()

// 1) the 察元 AI tab appears in the tab strip
const tabs = await page.evaluate(() => document.body.innerText.includes('察元 AI'))
report.tabPresent = tabs

// 2) click it and read the group labels
if (tabs) {
  const el = await page.evaluateHandle(() => {
    const nodes = [...document.querySelectorAll('button, [role="tab"], .rb-tab')]
    return nodes.find((n) => (n.textContent || '').trim() === '察元 AI')
  })
  await el.asElement()?.click()
  await page.waitForTimeout(800)
  report.groups = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('.ribbon-group-label, [class*="group-label"]')]
    return labels.map((l) => l.textContent?.trim()).filter(Boolean)
  })
  await page.screenshot({ path: '/tmp/gui-chayuan-tab.png' })

  // 3) dropdown contracts: 表格批量操作 14 / 图像批量操作 6
  const dd = await page.evaluateHandle(() => {
    const nodes = [...document.querySelectorAll('button')]
    return nodes.find((n) => (n.textContent || '').includes('表格批量操作'))
  })
  await dd.asElement()?.click()
  await page.waitForTimeout(600)
  const tableItems = await page.evaluate(() => {
    const items = [...document.querySelectorAll('[data-rb-panel] button, .layout-menu button, [class*="menu"] [class*="item"], .gs-dd-item, [role="menuitem"]')]
    return items.map((i) => i.textContent?.trim()).filter(Boolean)
  })
  report.tableMenuItems = tableItems.length
  report.tableMenuSample = tableItems.slice(0, 5)
  await page.screenshot({ path: '/tmp/gui-table-menu.png' })
  await page.keyboard.press('Escape')

  // 4) docops dialog: open 手动列宽度 from the still-open menu, then a direct-button dialog
  const mi = await page.evaluateHandle(() => {
    const nodes = [...document.querySelectorAll('button')]
    return [...nodes].find((n) => (n.textContent || '').trim() === '手动列宽度')
  })
  await page.evaluate((el) => el?.click(), await mi.asElement())
  await page.waitForTimeout(700)
  report.manualWidthDialog = await page.evaluate(() =>
    document.body.innerText.includes('列宽（磅）'),
  )
  await page.screenshot({ path: '/tmp/gui-manual-width.png' })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  const stats = await page.evaluateHandle(() => {
    const nodes = [...document.querySelectorAll('button')]
    return [...nodes].find((n) => (n.textContent || '').includes('统计已使用的样式'))
  })
  await page.evaluate((el) => el?.click(), await stats.asElement())
  await page.waitForTimeout(700)
  report.styleStatsDialog = await page.evaluate(() =>
    document.body.innerText.includes('使用次数'),
  )
  await page.screenshot({ path: '/tmp/gui-style-stats.png' })
  await page.keyboard.press('Escape')
}

// 5) context menu AI 文本助手 (needs a document with selection)
const editor = await page.evaluateHandle(() => document.querySelector('.ProseMirror'))
if (editor.asElement()) {
  await page.evaluate(() => {
    const ed = document.querySelector('.ProseMirror')
    if (ed) ed.innerHTML = '<p>这是察元AI功能冒烟测试段落。</p>'
  })
  await page.evaluate(() => {
    const ed = document.querySelector('.ProseMirror')
    if (!ed) return
    const range = document.createRange()
    range.selectNodeContents(ed.querySelector('p') ?? ed)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  })
  await page.click('.ProseMirror p', { button: 'right', force: true })
  await page.waitForTimeout(600)
  const ctxItems = await page.evaluate(() =>
    [...document.querySelectorAll('.ctx-item .ctx-label')].map((n) => n.textContent?.trim()),
  )
  report.contextMenuHasAi = ctxItems.includes('AI 文本助手')
  report.contextMenuSample = ctxItems.slice(0, 12)
  await page.screenshot({ path: '/tmp/gui-context-menu.png' })
}

report.pageErrors = errors.slice(0, 5)
console.log(JSON.stringify(report, null, 2))
await browser.close()
