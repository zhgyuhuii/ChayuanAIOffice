import { test, expect } from '@playwright/test'
import { launchShell, closeAndSaveVideo, screenshotPath, waitForPageWithUrl } from './helpers'

test.describe('home assistant picker (4.6k library)', () => {
  test('opens the library, drills a domain, picks an assistant, shows the chip', async () => {
    const launched = await launchShell({ onboardingSeen: true, videoDir: 'home-assistant' })
    const { page } = launched
    try {
      // the composer's assistant button opens the group-first popover
      await expect(page.locator('.chat-assistant-btn')).toBeVisible()
      await page.click('.chat-assistant-btn')
      await expect(page.locator('.chat-assistant-pop')).toBeVisible()
      // all 229 domain groups render from the static manifest
      await expect(page.locator('.chat-assistant-domain')).toHaveCount(229)
      await page.screenshot({ path: screenshotPath('assistant-groups') })

      // drill into a domain: its pack loads as its own chunk
      await page.locator('.chat-assistant-domain', { hasText: '报告生成' }).first().click()
      const rows = page.locator('.chat-assistant-row')
      await expect(rows.first()).toBeVisible()
      const count = await rows.count()
      expect(count).toBeGreaterThan(10)
      await page.screenshot({ path: screenshotPath('assistant-domain-list') })

      // picking an assistant attaches it to the composer as a chip
      await rows.first().click()
      await expect(page.locator('.chat-assistant-chip')).toBeVisible()
      await page.screenshot({ path: screenshotPath('assistant-chip') })

      // clearing the chip detaches the assistant again
      await page.click('.chat-assistant-chip-clear')
      await expect(page.locator('.chat-assistant-chip')).toHaveCount(0)
    } finally {
      await closeAndSaveVideo(launched, 'home-assistant')
    }
  })

  test('library search covers every domain after the background load', async () => {
    const launched = await launchShell({ onboardingSeen: true, videoDir: 'home-assistant-search' })
    const { page } = launched
    try {
      await page.click('.chat-assistant-btn')
      await page.fill('.chat-assistant-search input', '总结')
      // the whole library loads in the background once the popover opens;
      // results arrive after that (relaxed timeout for the 229 chunks)
      const rows = page.locator('.chat-assistant-row')
      await expect.poll(async () => rows.count(), { timeout: 30_000 }).toBeGreaterThan(5)
      await page.screenshot({ path: screenshotPath('assistant-search') })
    } finally {
      await closeAndSaveVideo(launched, 'home-assistant-search')
    }
  })
})

test.describe('docked editor carries no internal chat (P1 契约)', () => {
  test('a docked docs editor has no AI panel toggle; popping out restores it', async () => {
    const launched = await launchShell({ onboardingSeen: true, videoDir: 'dock-panel-policy' })
    const { page } = launched
    try {
      await page.evaluate(async () => {
        await window.chatOfficeDock.open('docs', { newBlank: true })
      })
      // the docked editor view boots with ?panel=0
      const dockPage = await waitForPageWithUrl(launched.app, 'panel=0')
      await dockPage.waitForLoadState('domcontentloaded')
      await dockPage.waitForTimeout(2500)
      // while docked the ribbon carries no AI panel toggle
      await expect(dockPage.locator('.ai-panel-toggle')).toHaveCount(0)
      await page.screenshot({ path: screenshotPath('docked-docs-no-internal-chat') })

      // pop out to a full tab: the shell pushes app:docked-state=false and
      // the toggle (the editor's own panel entrance) returns
      const tabs = page.locator('.tab-bar .tab-item')
      await expect(tabs).toHaveCount(2)
      await tabs.nth(1).click()
      await dockPage.waitForTimeout(1500)
      await expect(dockPage.locator('.ai-panel-toggle')).toHaveCount(1)
      await page.screenshot({ path: screenshotPath('fulltab-docs-toggle-returns') })
    } finally {
      await closeAndSaveVideo(launched, 'dock-panel-policy')
    }
  })
})
