import { test, expect } from '@playwright/test'
import { launchShell, closeAndSaveVideo, waitForPageWithUrl } from './helpers'

test.describe('tab bar', () => {
  test('middle-clicking a tab closes it', async () => {
    const launched = await launchShell({ onboardingSeen: true, videoDir: 'tab-middle-click-close' })
    const { app, page } = launched
    try {
            // adapted (LOCAL R24): 磁贴等价（.docx）
      page.waitForFunction(() => document.querySelectorAll('.side-new-tile').length > 0, undefined, { timeout: 20_000 }).catch(() => undefined)

      page.evaluate(() => [...document.querySelectorAll('.side-new-tile')].find((b) => b.textContent?.trim() === '.docx')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
      const editorTab = page.locator('.tab-bar .tab-item:not(.tab-home)')
      await expect(editorTab).toHaveCount(1)
      await waitForPageWithUrl(app, '://docs/')

      await page.locator('.tab-bar .tab-item.tab-home').click({ button: 'middle' })
      await expect(editorTab).toHaveCount(1)

      await editorTab.click({ button: 'middle' })
      await expect(editorTab).toHaveCount(0)
      await expect(page.locator('.tab-bar .tab-item.tab-home')).toHaveClass(/active/)
    } finally {
      await closeAndSaveVideo(launched, 'tab-middle-click-close')
    }
  })
})
