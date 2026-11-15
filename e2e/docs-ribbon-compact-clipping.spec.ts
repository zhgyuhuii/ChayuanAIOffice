import { test, expect } from '@playwright/test'
import { launchShell, closeAndSaveVideo, waitForPageWithUrl, screenshotPath } from './helpers'

const MAC = process.platform === 'darwin'
/** ⌥⌘K on macOS, Ctrl+Alt+K elsewhere — CI runs Linux. */
const COMPACT_KEY = MAC ? 'Alt+Meta+KeyK' : 'Control+Alt+KeyK'

/**
 * The compact ribbon must fit what it holds (chaoffice#1891).
 *
 * `.ribbon-body` is a fixed-height band with `overflow-y: hidden`, and that is
 * deliberate: switching tabs must never resize the row. It is also a lid. The
 * first compact mode only wrote rules for `.rb-big`, so every other control —
 * the font and size pickers, the style gallery cards, the split carets, the
 * page-layout columns — kept its full height and `overflow-y: hidden` sliced
 * the difference off the top and bottom. The font picker came out cut through
 * the middle: visible, clickable, and useless.
 *
 * This walks every tab with the ribbon in compact density and asserts nothing
 * overflows. It is the guard for the next control someone adds without a
 * compact rule: jsdom cannot compute layout, so a unit test here would pass
 * happily while the real grid clipped.
 */

test('compact ribbon fits every tab without clipping', async () => {
  test.setTimeout(240_000)
  const launched = await launchShell({
    onboardingSeen: true,
    settings: { lang: 'en' },
    videoDir: 'ribbon-compact-clip',
  })
  try {
    // a blank document, from the home screen's own new-document action
    const shellPage = launched.page
    // adapted (LOCAL R24): 上游 window.chaOffice.newDoc() 桥本地不存在——
    // 经首页新建磁贴（本地树内联形态）等价创建
    await shellPage.waitForFunction((ext) => [...document.querySelectorAll('.side-new-tile')].some((b) => b.textContent?.trim() === `.${ext}`), 'docx', { timeout: 20_000 })
    await shellPage.evaluate((ext) => {
      const tile = [...document.querySelectorAll('.side-new-tile')].find((b) => b.textContent?.trim() === `.${ext}`)
      ;(tile as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    }, 'docx')
    const page = await waitForPageWithUrl(launched.app, '://docs/')
    await page.waitForFunction(() => document.body.textContent?.includes('Page') ?? false, null, {
      timeout: 30_000,
    })
    await page.waitForTimeout(1_500)

    // ⌥⌘K / Ctrl+Alt+K, sent the way the app receives it
    const compact = () => page.evaluate(() => !!document.querySelector('.ribbon-compact'))
    for (let i = 0; i < 3 && !(await compact()); i += 1) {
      await page.keyboard.press(COMPACT_KEY)
      await page.waitForTimeout(1_500)
    }
    expect(await compact(), 'compact density did not engage').toBe(true)

    const tabs = await page.evaluate(() =>
      [...document.querySelectorAll('.ribbon-tab')]
        .map((t) => t.textContent?.trim() ?? '')
        .filter(Boolean),
    )
    expect(tabs.length).toBeGreaterThan(3)

    for (const tab of tabs) {
      await page.evaluate((name) => {
        const el = [...document.querySelectorAll('.ribbon-tab')].find(
          (x) => x.textContent?.trim() === name,
        )
        ;(el as HTMLElement | undefined)?.click()
      }, tab)
      await page.waitForTimeout(600)
      // Switching tabs drops the density back to full — measure the band the
      // reader is actually in, so re-engage it before reading anything.
      if (!(await compact())) {
        await page.keyboard.press(COMPACT_KEY)
        await page.waitForTimeout(1_200)
      }
      expect(await compact(), `"${tab}" left compact density off`).toBe(true)

      const measured = await page.evaluate(() => {
        const body = document.querySelector('.ribbon-body')
        if (!body) return null
        const tallest = [...body.querySelectorAll('*')]
          .map((el) => Math.round(el.getBoundingClientRect().height))
          .reduce((a, b) => Math.max(a, b), 0)
        return {
          avail: body.clientHeight,
          scrollH: body.scrollHeight,
          tallest,
          clipped: body.scrollHeight > body.clientHeight + 1,
        }
      })
      expect(measured, `no ribbon on the "${tab}" tab`).not.toBeNull()
      const m = measured!
      expect(
        m.clipped,
        `"${tab}" overflows the compact band: tallest control ${m.tallest}px, content needs ` +
          `${m.scrollH}px, band has ${m.avail}px`,
      ).toBe(false)
      expect(m.scrollH, `"${tab}" needs more than the band holds`).toBeLessThanOrEqual(m.avail)
    }
    await page.screenshot({ path: screenshotPath('ribbon-compact-all-tabs') })
  } finally {
    await closeAndSaveVideo(launched, 'ribbon-compact-clip')
  }
})
