import { test, expect } from '@playwright/test'
import { launchShell, closeAndSaveVideo, screenshotPath } from './helpers'

test.describe('home screen', () => {
  test('shows launcher, tree sections and tab bar', async () => {
    const launched = await launchShell({ onboardingSeen: true, videoDir: 'home-basics' })
    const { page } = launched
    try {
      // 左上 launcher：新建（菜单）+ 打开本地文件
      await expect(page.locator('.side-launcher .launch-btn.primary')).toBeVisible()
      await expect(page.locator('.side-launcher .launch-btn.secondary')).toBeVisible()
      // 新建菜单展开六个格式项
      await page.click('.side-launcher .launch-btn.primary')
      await expect(page.locator('.launch-item')).toHaveCount(6)
      await page.keyboard.press('Escape')
      // ZCode 式左树：对话 / 项目 两分组 + 最近
      await expect(page.locator('.side-sec-chats .side-files-title')).toHaveText('Chats')
      await expect(page.locator('.side-sec-projects .side-files-title')).toHaveText('Projects')
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
      // 左树两分组与最近分组的中文标题
      await expect(page.locator('.side-sec-chats .side-files-title')).toHaveText('对话')
      await expect(page.locator('.side-sec-projects .side-files-title')).toHaveText('项目')
      await expect(page.locator('.side-sec-recent .side-files-title')).toHaveText('最近使用')
      await page.screenshot({ path: screenshotPath('home-zh-cn') })
    } finally {
      await closeAndSaveVideo(launched, 'home-zh-cn')
    }
  })
})
