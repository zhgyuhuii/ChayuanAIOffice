// 连接冻结中的 dev 实例，对每个 docs 页面做 Debugger.pause 采样
import { chromium } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

const browser = await chromium.connectOverCDP('http://127.0.0.1:9341')
const contexts = browser.contexts()
const out: unknown[] = []
for (const ctx of contexts) {
  for (const page of ctx.pages()) {
    const url = page.url()
    if (!url.includes('5283')) continue
    console.log('probing', url.slice(0, 50))
    const alive = await Promise.race([
      page.evaluate(() => 'alive'),
      new Promise<string>((r) => setTimeout(() => r('FROZEN'), 3000)),
    ]).catch(() => 'FROZEN-ERR')
    console.log('  state:', alive)
    if (!String(alive).startsWith('FROZEN')) continue
    const cdp = await ctx.newCDPSession(page)
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
    for (let i = 0; i < 10; i++) {
      const got = new Promise<Paused>((r) => (pending = r))
      await send('Debugger.pause')
      const paused = await Promise.race([got, new Promise<Paused>((r) => setTimeout(() => r({}), 5000))])
      const frames = paused.callFrames ?? []
      console.log(`  sample-${i}: ${frames.length} frames`)
      for (const f of frames.slice(0, 20)) {
        const u = (f.url || 'jit').split('/').pop()
        console.log(`     ${f.functionName || '(anon)'}  ${u}:${f.location?.lineNumber ?? '?'}:${f.location?.columnNumber ?? '?'}`)
      }
      out.push({ page: url, sample: i, frames })
      if (!frames.length && i > 2) break
      await send('Debugger.resume').catch(() => {})
      await page.waitForTimeout(100)
    }
  }
}
await writeFile('e2e/artifacts/rc-frozen-dev-stacks.json', JSON.stringify(out, null, 1))
console.log('saved', (out as unknown[]).length, 'samples')
process.exit(0)
