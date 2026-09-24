import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage()
p.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 300)))
p.on('pageerror', (e) => console.log('[pageerror]', String(e.message).slice(0, 300)))
await p.goto('http://localhost:5273/', { waitUntil: 'domcontentloaded' })
const r = await p.evaluate(async () => {
  try {
    const mod =
      await import('/@fs/Users/zyh/work/chayuan-office/packages/chart-kit/src/sandbox/runner.ts')
    const out = await mod.runOptionCode('option = { series: [{ type: "line", data: [1, 2, 3] }] };')
    return { ok: out.ok, error: out.error, optionKeys: out.option ? Object.keys(out.option) : null }
  } catch (e) {
    return { importError: String(e && e.message) }
  }
})
console.log('RESULT', JSON.stringify(r))
await b.close()
