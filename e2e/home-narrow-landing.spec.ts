import { test, expect } from '@playwright/test'
import { launchShell, closeAndSaveVideo } from './helpers'

/**
 * THROWAWAY visual-verify spec for the narrow-landing overflow fix:
 * below the 919px container breakpoint the five cards stack vertically and
 * the showcase can exceed the pane height — the landing must scroll on its
 * own instead of painting over the composer.
 */
test('narrow landing scrolls, never covers the composer', async () => {
  const launched = await launchShell({ onboardingSeen: true, videoDir: 'narrow-landing' })
  const { app, page } = launched

  const win = await app.firstWindow()
  // 640×560: container well under the 919px breakpoint AND short enough that
  // the stacked showcase exceeds the pane height (the bug's exact condition)
  await win.setViewportSize({ width: 640, height: 560 })
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.setBounds({ width: 640, height: 560 })
    }
  })

  await expect(page.locator('.chat-landing.welcome')).toBeVisible()
  await expect(page.locator('.welcome-card')).toHaveCount(5)
  // the staggered entrance animations translateY cards mid-flight; measure
  // the settled layout, not the choreography
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForTimeout(300)

  // geometry: no card may VISUALLY intersect the composer. Rects report
  // layout positions, but the landing is a scroll container — overflow is
  // clipped, so each card rect must be clipped to the landing box first.
  const geo = await page.evaluate(() => {
    const composer = document.querySelector('.ai-input-box')?.getBoundingClientRect()
    const landing = document.querySelector('.chat-landing.welcome')
    const landRect = landing?.getBoundingClientRect()
    const cards = [...document.querySelectorAll('.welcome-card')].map((el) =>
      el.getBoundingClientRect(),
    )
    const overlap = composer
      ? cards.filter((b) => {
          const top = Math.max(b.top, landRect?.top ?? b.top)
          const bottom = Math.min(b.bottom, landRect?.bottom ?? b.bottom)
          return top < composer.bottom && bottom > composer.top
        }).length
      : -1
    let reachBottom: number | null = null
    if (landing) {
      landing.scrollTop = landing.scrollHeight
      reachBottom = landing.scrollTop
    }
    return {
      overlapCount: overlap,
      landingScrollHeight: landing?.scrollHeight ?? 0,
      landingClientHeight: landing?.clientHeight ?? 0,
      reachBottom,
    }
  })
  expect(geo.overlapCount, 'cards visually intersecting the composer').toBe(0)
  expect(geo.landingScrollHeight).toBeGreaterThan(geo.landingClientHeight)
  expect(geo.reachBottom).toBeGreaterThan(0)

  await page.screenshot({ path: 'e2e/artifacts/screenshots/narrow-landing-fixed.png' })

  await closeAndSaveVideo(launched, 'narrow-landing')
})
