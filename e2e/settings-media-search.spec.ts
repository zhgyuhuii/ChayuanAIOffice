import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchShell, closeAndSaveVideo, screenshotPath } from './helpers'

/**
 * 本机文件搜索（Jev 重排）设置——LOCAL 形态：独立「本机文件搜索」分区
 * （上游 #757 为 Media & Search pane 内的小节；本地 V2 设置面无该 pane）。
 * 开关/端点/密钥即时持久化，测试按钮报告自己的判定结果。
 */
test('Jev reranking lives in its own settings section, saves instantly, and reports its test verdict', async () => {
  const launched = await launchShell({
    onboardingSeen: true,
    settings: { starPrompt: { resolved: true } },
    videoDir: 'settings-media-search',
  })
  const { page, userDataDir } = launched
  try {
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.locator('.set-nav-item').filter({ hasText: 'Local file search' }).click()

    const toggle = page.getByRole('switch', { name: 'Jev search reranking' })
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    // 即时持久化（本地无 Save 按钮）
    await expect
      .poll(async () => {
        const saved = JSON.parse(await readFile(join(userDataDir, 'app-settings.json'), 'utf8'))
        return saved.fileSearch?.rerank
      })
      .toBe(true)

    // 开关打开后出现端点下拉与密钥输入；切到 TypeSafe 端点
    await page.getByRole('button', { name: 'Jev endpoint', exact: true }).click()
    await page.getByRole('option', { name: 'TypeSafe', exact: true }).click()
    await expect
      .poll(async () => {
        const saved = JSON.parse(await readFile(join(userDataDir, 'app-settings.json'), 'utf8'))
        return saved.fileSearch?.jevEndpoint
      })
      .toBe('direct')

    // 测试按钮报告自己的判定：无密钥时不通过且错误就地显示（不离开本机）
    await page.getByRole('button', { name: 'Test connection', exact: true }).click()
    await expect(page.locator('[role="status"]')).not.toBeEmpty()
    await page.screenshot({ path: screenshotPath('settings-media-search-test') })

    // 密钥分端点保存
    await page.locator('#set-search-jev-key').fill('ts-key')
    await expect
      .poll(async () => {
        const saved = JSON.parse(await readFile(join(userDataDir, 'app-settings.json'), 'utf8'))
        return saved.fileSearch?.jevKeys
      })
      .toEqual({ openrouter: '', direct: 'ts-key' })
  } finally {
    await closeAndSaveVideo(launched, 'settings-media-search')
  }
})
