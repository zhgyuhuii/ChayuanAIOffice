import { test, expect } from '@playwright/test'
import { launchShell, closeAndSaveVideo, type LaunchedApp } from './helpers'

/**
 * Regression gate: target="_blank" links in the shell window's own renderer
 * (设置弹窗的「获取密钥」/「申请 Key ↗」) must reach the system browser.
 *
 * The app-wide navigation guard installs a default-deny window.open handler on
 * every webContents; the editor views replace it with the safeExternalUrl →
 * shell.openExternal handoff in tab-manager, but the shell main window kept
 * the deny — every get-key click in the settings modal died silently
 * (no browser, no window). The window now installs the same handoff.
 *
 * shell.openExternal is stubbed in the main process so the assertion observes
 * the handoff without popping the test machine's default browser.
 */

async function externalOpens(launched: LaunchedApp): Promise<string[]> {
  return launched.app.evaluate(() => {
    const g = globalThis as unknown as { __externalOpens?: string[] }
    return g.__externalOpens ?? []
  })
}

test('settings modal key links are handed to the system browser', async () => {
  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'settings-external-key-links',
  })
  const { app, page } = launched
  try {
    await app.evaluate(({ shell }) => {
      const g = globalThis as unknown as { __externalOpens?: string[] }
      g.__externalOpens = []
      shell.openExternal = ((url: string) => {
        g.__externalOpens!.push(url)
        return Promise.resolve()
      }) as typeof shell.openExternal
    })
    const windowCount = app.windows().length

    // 模型设置: guide landing → vendor card → form → 获取密钥
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.locator('[data-guide-card="deepseek"]').click()
    const keyLink = page.locator('[data-model-keyurl]')
    await expect(keyLink).toBeVisible()
    await keyLink.click()
    await expect.poll(() => externalOpens(launched)).toEqual([
      'https://platform.deepseek.com/api_keys',
    ])

    // 生图、媒体与搜索: search platform pane → 申请 Key ↗
    await page.locator('.set-nav button').nth(2).click()
    await page.locator('[data-capability-item="serper"]').click()
    const capLink = page.locator('[data-capability-platform="serper"] .csp-btn-link')
    await expect(capLink).toBeVisible()
    await capLink.click()
    await expect.poll(() => externalOpens(launched)).toEqual([
      'https://platform.deepseek.com/api_keys',
      'https://serper.dev/api-key',
    ])

    // the handler denies the Electron window itself — the click must not
    // spawn a bare child window either
    expect(app.windows().length).toBe(windowCount)
  } finally {
    await closeAndSaveVideo(launched, 'settings-external-key-links')
  }
})
