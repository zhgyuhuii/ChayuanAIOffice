/* global window, document, MouseEvent */
// P2-8 铁律端到端验收 v2(隔离实例, 5299 端口)
// 命令捕获 = docs 页 console('[docs-relay] command:')——contextBridge 方法不可包装
// 状态断言 = DOM + dock.list() —— 不依赖会话持久化时序
import { chromium } from 'playwright-core'

let pass = 0
let fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) {
    pass++
    console.log(`PASS ${name}`)
  } else {
    fail++
    console.log(`FAIL ${name} :: ${detail}`)
  }
}

const browser = await chromium.connectOverCDP('http://127.0.0.1:5299')
const ctx = browser.contexts()[0]
const page = ctx.pages().find((p) => p.url().startsWith('file://'))
ok('A1 shell page up', !!page)
await page.waitForTimeout(1000)
// 新鲜实例会弹新手引导浮层,预落 seen 旗标避免挡点击
await page.evaluate(() => window.chatOffice.setOnboardingSeen())
await page.reload()
await page.waitForTimeout(1200)

const relayLog = []
const watchCommands = (p) => {
  p.on('console', (m) => {
    const t = m.text()
    if (t.includes('[docs-relay] command:')) relayLog.push(t)
  })
}
ctx.pages().forEach(watchCommands)
ctx.on('page', (p) => watchCommands(p))

const dockList = () =>
  page.evaluate(async () =>
    (await window.chatOfficeDock.list()).map((t) => [t.kind, t.title, t.active]),
  )

const MAINLINE = [
  { id: 'u1', role: 'user', text: '帮我写一份产品发布计划', ts: 1 },
  { id: 'a1', role: 'assistant', text: '好的,这是初稿大纲…', ts: 2 },
  { id: 'u2', role: 'user', text: '第二节再展开一点', ts: 3 },
  { id: 'a2', role: 'assistant', text: '模型断流', error: true, ts: 4 },
  { id: 'a3', role: 'assistant', text: '已展开第二节。', ts: 5 },
]
await page.evaluate(async (messages) => {
  const now = Date.now()
  await window.chatOffice.chatSessionsSave([
    { id: 'sess-iron', title: '铁律验收会话', createdAt: now, updatedAt: now, messages },
  ])
}, MAINLINE)
await page.reload()
await page.waitForTimeout(1500)
const tabSeen = await page.evaluate(() => {
  const tab = [...document.querySelectorAll('.chat-tab')].find((t) =>
    t.textContent?.includes('铁律验收会话'),
  )
  if (tab) {
    tab.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return true
  }
  return false
})
ok('A2 injected mainline session opens', tabSeen)

const opened = await page.evaluate(() => window.chatOfficeDock.open('docs', { newBlank: true }))
ok('A3 dock.open returns docs tab', !!opened?.id)
let docsPage = null
for (let i = 0; i < 20 && !docsPage; i++) {
  docsPage = ctx.pages().find((p) => p.url().includes('docs') && p.url().startsWith('file://'))
  if (!docsPage) await page.waitForTimeout(500)
}
await page.waitForTimeout(2500)
const seedLog = relayLog.filter((l) => l.includes('command: seed'))
ok(
  'A4 seed reached the doc loop, n = distilled mainline count (errors dropped)',
  seedLog.length === 1 && seedLog[0].includes('n=4'),
  JSON.stringify(relayLog),
)
ok(
  'A5 sync-docs reached the doc loop with the tab list',
  relayLog.some((l) => l.includes('command: sync-docs') && l.includes('docs=1')),
  JSON.stringify(relayLog),
)

const composerSel = '.chat-composer textarea'
await page.waitForSelector(composerSel)
const msgCountBefore = await page.evaluate(() => document.querySelectorAll('.chat-msg').length)
await page.fill(composerSel, '把标题改成加粗')
await page.keyboard.press('Enter')
await page.waitForTimeout(600)
ok(
  'A6 user message lands in transcript instantly',
  (await page.evaluate(() => document.querySelectorAll('.chat-msg').length)) >= msgCountBefore + 1,
)
await page.waitForTimeout(2000)
const sendLog = relayLog.filter((l) => l.includes('command: send'))
console.log(
  '  A6 diag msgs:',
  JSON.stringify(
    await page.evaluate(() =>
      [...document.querySelectorAll('.chat-msg')]
        .slice(-3)
        .map((m) => (m.getAttribute('data-mid') ?? '').slice(0, 14)),
    ),
  ),
)
console.log('  A6 diag relayLog:', JSON.stringify(relayLog))
ok('A6 send command reached the doc loop', sendLog.length === 1, JSON.stringify(sendLog))
await page.waitForTimeout(1000)
ok(
  'A7 busy cleared after the failed turn',
  await page.evaluate(() => !document.querySelector('.ai-stop-btn')),
)

if (docsPage) {
  await docsPage.evaluate(() => {
    window.desktop.relaySend({
      type: 'context',
      context: { text: '被圈选的段落文字', kind: 'selection' },
    })
  })
  await page.waitForTimeout(700)
  const hint = await page.evaluate(
    () => document.querySelector('.chat-selection-hint')?.textContent ?? '',
  )
  ok('A8 selection hint appears', hint.includes('被圈选'), hint)
  await docsPage.evaluate(() => {
    window.desktop.relaySend({ type: 'context', context: { text: '', kind: 'selection' } })
  })
  await page.waitForTimeout(700)
  ok(
    'A8 empty selection clears the hint',
    await page.evaluate(() => !document.querySelector('.chat-selection-hint')),
  )
}

if (docsPage) {
  await docsPage.evaluate(() => {
    window.desktop.relaySend({ type: 'turn-started', turnId: 't-manual' })
    window.desktop.relaySend({
      type: 'confirm-request',
      turnId: 't-manual',
      request: { confirmId: 'cf-manual', kind: 'outline', payload: '# 发布计划大纲\n- 一、目标' },
    })
  })
  await page.waitForTimeout(700)
  const cardOk = await page.evaluate(() => {
    const card = document.querySelector('.chat-confirm-card')
    return (
      !!card && card.classList.contains('pending') && card.textContent?.includes('发布计划大纲')
    )
  })
  ok('A9 confirm card renders pending', cardOk)
  const confirmBefore = relayLog.filter((l) => l.includes('command: confirm')).length
  await page.click('.chat-confirm-approve')
  await page.waitForTimeout(800)
  const confirmed = relayLog.filter((l) => l.includes('command: confirm')).length > confirmBefore
  ok(
    'A9 approve reaches the doc loop (confirm command)',
    confirmed,
    JSON.stringify(relayLog.filter((l) => l.includes('confirm'))),
  )
  ok(
    'A9 card state = approved',
    await page.evaluate(() => !!document.querySelector('.chat-confirm-card.approved')),
  )
}

relayLog.length = 0
const md = await page.evaluate(() => window.chatOfficeDock.open('markdown', { newBlank: true }))
ok('A10 markdown dock tab opens', !!md?.id && md.id !== opened.id)
await page.waitForTimeout(2200)
console.log('  dock list after md:', JSON.stringify(await dockList()))
const sync2 = relayLog.filter((l) => l.includes('command: sync-docs'))
ok(
  'A10 sync-docs updates both docked loops',
  sync2.some((l) => l.includes('docs=2')),
  JSON.stringify(sync2),
)
await page.evaluate((id) => window.chatOfficeDock.activate(id), opened.id)
await page.waitForTimeout(1000)
console.log('  dock list after manual activate:', JSON.stringify(await dockList()))
relayLog.length = 0
if (docsPage) {
  await docsPage.evaluate((title) => {
    window.desktop.relaySend({ type: 'switch-request', turnId: 't-manual', switch: { title } })
  }, md.title)
  await page.waitForTimeout(1000)
}
const afterSwitch = await dockList()
console.log('  dock list after switch-request:', JSON.stringify(afterSwitch))
ok(
  'A10 switch-request activates the target tab',
  afterSwitch.some(([, title, active]) => title === md.title && active) &&
    !afterSwitch.some(([kind, , active]) => kind === 'docs' && active),
  JSON.stringify(afterSwitch),
)
// switch 已证激活切换;铁律的另一半=激活目标 loop 重种子(markdown 无中继
// 服务(P3 范围),以切回 docs 的同一路径断言:docs 页应再次收到 seed)
relayLog.length = 0
await page.evaluate((id) => window.chatOfficeDock.activate(id), opened.id)
await page.waitForTimeout(1200)
ok(
  'A10 target loop re-seeded on activation (iron rule: seed on switch, n = live mainline size)',
  relayLog.some((l) => l.includes('command: seed') && (l.includes('n=4') || l.includes('n=5'))),
  JSON.stringify(relayLog),
)

const paras = Array.from({ length: 250 }, (_, i) => `<p>流式段落 ${i + 1}:占位分块验证。</p>`)
const bigDoc = await page.evaluate(
  (html) =>
    window.chatOfficeDock.open('docs', {
      newBlank: true,
      aiContent: { title: 'phased-verify', html },
    }),
  paras.join(''),
)
let bigPage = null
for (let i = 0; i < 20 && !bigPage; i++) {
  await page.waitForTimeout(500)
  bigPage = ctx
    .pages()
    .filter((p) => p.url().includes('docs'))
    .at(-1)
}
let early = ''
if (bigPage) {
  for (let i = 0; i < 10; i++) {
    await bigPage.waitForTimeout(400)
    early = await bigPage.evaluate(() => {
      const txt = document.body.innerText
      if (txt.includes('流式段落 250')) return 'alldone'
      if (txt.includes('流式段落 1')) return 'first'
      return 'none'
    })
    if (early !== 'none') break
  }
}
const late = bigPage
  ? await bigPage.evaluate(() =>
      document.body.innerText.includes('流式段落 250') ? 'tail' : 'missing',
    )
  : 'nopage'
ok(
  'A11 phased mount: first blocks land, tail streams to completion',
  !!bigDoc?.id && (early === 'first' || early === 'alldone') && late === 'tail',
  `early=${early} late=${late}`,
)

await page.evaluate(async () => {
  for (const t of await window.chatOfficeDock.list()) await window.chatOfficeDock.close(t.id)
})
await page.waitForTimeout(1500)
const cleared = await page.evaluate(async () => {
  const sessions = await window.chatOffice.chatSessionsLoad()
  return sessions.find((x) => x.id === 'sess-iron')?.dock === undefined
})
ok('A12 session dock memory cleared when pane empties', cleared)

console.log(`\n==== ${pass} passed, ${fail} failed ====`)
await browser.close()
process.exit(fail > 0 ? 1 : 0)
