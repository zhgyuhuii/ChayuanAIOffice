import { test } from '@playwright/test'
import { launchShell, closeAndSaveVideo, screenshotPath } from './helpers'

/** 复现：窄窗下广场块遮挡输入框 */
test('repro narrow overlap', async () => {
  const launched = await launchShell({ onboardingSeen: true, videoDir: 'narrow-repro' })
  const { page, app } = launched
  try {
    // 三档验证：电脑(1280)/平板(900)/手机(620)——输入框在各档都不被遮挡
    await page.waitForTimeout(1500)
    await page.screenshot({ path: screenshotPath('narrow-wide-baseline') })
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      win.setContentSize(900, 760)
    })
    await page.waitForTimeout(1200)
    await page.screenshot({ path: screenshotPath('narrow-900') })
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      win.setContentSize(620, 760)
    })
    await page.waitForTimeout(1200)
    await page.screenshot({ path: screenshotPath('narrow-620') })
  } finally {
    await closeAndSaveVideo(launched, 'narrow-repro')
  }
})
