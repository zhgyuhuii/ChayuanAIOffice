import { test, expect } from '@playwright/test'
import { launchShell, closeAndSaveVideo, screenshotPath } from './helpers'

test.describe('home screen', () => {
  test('shows launcher, tree sections and tab bar', async () => {
    const launched = await launchShell({ onboardingSeen: true, videoDir: 'home-basics' })
    const { page } = launched
    try {
      // 左上：2×3 新建直钮网格（六格式）+ 打开本地
      await expect(page.locator('.side-new-grid .side-new-tile')).toHaveCount(6)
      await expect(page.locator('.side-new-browse')).toBeVisible()
      // 胶囊三段 Tab：最近 | 对话 | 项目（默认选中最近）
      await expect(page.locator('.sidebar-seg [role="tab"]', { hasText: 'Recent' })).toBeVisible()
      await expect(page.locator('.sidebar-seg [role="tab"]', { hasText: 'Chats' })).toBeVisible()
      await expect(
        page.locator('.sidebar-seg [role="tab"]', { hasText: 'Projects' }),
      ).toBeVisible()
      await expect(page.locator('.sidebar-seg [role="tab"].active', { hasText: 'Recent' })).toBeVisible()
      await expect(page.locator('.side-sec-recent .side-files-title')).toBeVisible()
      await expect(page.locator('.tab-bar .tab-item.tab-home')).toBeVisible()
      await page.screenshot({ path: screenshotPath('home-overview') })
    } finally {
      await closeAndSaveVideo(launched, 'home-basics')
    }
  })

  test('renders localized UI when CHATOFFICE_LANG=zh-CN', async () => {
    const launched = await launchShell({
      onboardingSeen: true,
      lang: 'zh-CN',
      videoDir: 'home-zh-cn',
    })
    const { page } = launched
    try {
      // 左树双 Tab 与最近分组的中文标题
      await expect(page.locator('.sidebar-seg [role="tab"]', { hasText: '最近' })).toBeVisible()
      await expect(page.locator('.sidebar-seg [role="tab"]', { hasText: '对话' })).toBeVisible()
      await expect(page.locator('.sidebar-seg [role="tab"]', { hasText: '项目' })).toBeVisible()
      await expect(page.locator('.side-sec-recent .side-files-title')).toHaveText('最近')
      await page.screenshot({ path: screenshotPath('home-zh-cn') })
    } finally {
      await closeAndSaveVideo(launched, 'home-zh-cn')
    }
  })
})
