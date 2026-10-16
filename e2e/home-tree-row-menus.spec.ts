import { test, expect } from '@playwright/test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { launchShell, closeAndSaveVideo, screenshotPath } from './helpers'

/**
 * 左侧树「文件/文件夹行 … 菜单」几何回归：
 *  - 菜单从按钮右缘向左展开，必须整体留在树条宽度内——文档标签页上
 *    .app-frame-content.doc-active 的 clip-path 会把越界的 fixed 菜单硬裁掉
 *    （历史事故：文件菜单按静态位置向右伸出树条 ~100px，在文档标签页
 *    只剩左缘 40px 可见）；
 *  - 长树底部行：下方空间不足菜单整高时上翻到按钮上方，不得伸出窗口底。
 * 判定用 elementFromPoint（clip-path 连 hit-test 一起裁，能抓住回归）。
 */

const TREE_STRIP = 232 // home-layout SIDEBAR_DEFAULT；menu 必须 x+w ≤ 树条

test.describe('home tree row menus', () => {
  let root: string

  test.beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'chaoffice-e2e-root-')))
    mkdirSync(join(root, 'Clients', 'Contracts'), { recursive: true })
    for (let i = 1; i <= 14; i++) mkdirSync(join(root, `f${String(i).padStart(2, '0')}`))
    writeFileSync(join(root, 'report.docx'), 'x')
    writeFileSync(join(root, 'Clients', 'Contracts', 'deal.md'), '# deal')
  })

  test.afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  /** 展开 Clients、选中 Contracts，让 deal.md 内联出现 */
  async function selectContracts(page: Page) {
    const tree = page.locator('.folder-panel .tree')
    const clientsRow = tree.locator('.tree-row', {
      has: page.locator('.tree-name', { hasText: 'Clients' }),
    })
    await clientsRow.waitFor({ timeout: 20_000 })
    await clientsRow.locator('.tree-chevron').click()
    await tree.locator('.tree-name', { hasText: 'Contracts' }).click()
    const dealRow = page.locator('.tree-file-row', { hasText: 'deal.md' })
    await dealRow.waitFor({ timeout: 10_000 })
    return { tree, clientsRow, dealRow }
  }

  /** 菜单中心/四缘的最顶层元素都必须落在菜单自身之内（未被任何层遮挡/裁剪） */
  async function expectMenuOnTop(page: Page, sel: string) {
    const menu = page.locator(sel)
    await expect(menu).toBeVisible()
    const box = await menu.boundingBox()
    expect(box, `${sel} boundingBox`).toBeTruthy()
    await expect
      .poll(async () =>
        page.evaluate(
          ({ x, y, w, h }: { x: number; y: number; w: number; h: number }) => {
            const menu = document.querySelector('.folder-menu')
            const pts: [number, number][] = [
              [x + w / 2, y + h / 2],
              [x + w - 4, y + h / 2],
              [x + 4, y + h / 2],
              [x + w / 2, Math.min(y + h - 4, innerHeight - 1)],
            ]
            return pts.every(([px, py]) => {
              const el = document.elementFromPoint(px, py)
              return el instanceof Element && menu?.contains(el)
            })
          },
          { x: box!.x, y: box!.y, w: box!.width, h: box!.height },
        ),
      )
      .toBe(true)
    return box!
  }

  test('home tab: file menu stays inside the tree strip', async () => {
    const launched = await launchShell({
      onboardingSeen: true,
      settings: { defaultSaveDir: root },
      videoDir: 'tree-row-menus',
    })
    const { page } = launched
    try {
      const { clientsRow, dealRow } = await selectContracts(page)
      await page.waitForTimeout(400)

      // 文件夹菜单：右锚定向左展开，在树条内
      await clientsRow.locator('.folder-more-btn').click()
      const folderBox = await expectMenuOnTop(page, '.folder-menu')
      expect(folderBox.x).toBeGreaterThanOrEqual(0)
      expect(folderBox.x + folderBox.width).toBeLessThanOrEqual(TREE_STRIP)
      await clientsRow.locator('.folder-more-btn').click()

      // 文件菜单：同锚定方案（回归点：旧静态位置向右越出树条）
      await dealRow.hover()
      await dealRow.locator('.folder-more-btn').click()
      const fileBox = await expectMenuOnTop(page, '.tree-file-menu')
      expect(fileBox.x).toBeGreaterThanOrEqual(0)
      expect(fileBox.x + fileBox.width).toBeLessThanOrEqual(TREE_STRIP)
      await page.screenshot({ path: screenshotPath('tree-row-menu-home-file') })
      await dealRow.locator('.folder-more-btn').click()
    } finally {
      await closeAndSaveVideo(launched)
    }
  })

  test('short window: bottom row menu flips up and stays on-screen', async () => {
    const launched = await launchShell({
      onboardingSeen: true,
      settings: { defaultSaveDir: root },
      videoDir: 'tree-row-menus-flip',
    })
    const { page } = launched
    try {
      // 窗口钳到最小高（600）：树长于视口，底部行距窗底不足菜单高
      await launched.app.evaluate(({ BrowserWindow }) => {
        for (const w of BrowserWindow.getAllWindows()) w.setContentSize(1360, 600)
      })
      await page.waitForTimeout(400)
      await expect(page.locator('.tree-row', { hasText: 'Clients' })).toBeVisible()
      await page
        .locator('.folder-panel .tree')
        .evaluate((el: HTMLElement) => el.scrollTo(0, el.scrollHeight))
      await page.waitForTimeout(200)
      const clients = page.locator('.tree-row', { hasText: 'Clients' })
      await clients.hover()
      await clients.locator('.folder-more-btn').click()
      const box = await expectMenuOnTop(page, '.folder-menu')
      const innerH = await page.evaluate(() => window.innerHeight)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.y + box.height).toBeLessThanOrEqual(innerH - 8)
      await page.screenshot({ path: screenshotPath('tree-row-menu-flip') })
    } finally {
      await closeAndSaveVideo(launched)
    }
  })

  test('document tab: menus survive the editor clip-path', async () => {
    const launched = await launchShell({
      onboardingSeen: true,
      settings: { defaultSaveDir: root },
      openFile: join(root, 'report.docx'),
      videoDir: 'tree-row-menus-doc',
    })
    const { page } = launched
    try {
      const { clientsRow, dealRow } = await selectContracts(page)
      await page.waitForTimeout(1000)

      // 文件菜单（历史事故现场：文档标签页 clip-path 裁掉越界部分）
      await dealRow.hover()
      await dealRow.locator('.folder-more-btn').click()
      const fileBox = await expectMenuOnTop(page, '.tree-file-menu')
      expect(fileBox.x + fileBox.width).toBeLessThanOrEqual(TREE_STRIP)
      await page.screenshot({ path: screenshotPath('tree-row-menu-doc-file') })
      await dealRow.locator('.folder-more-btn').click()

      // 文件夹菜单（右键路径同锚定）
      await clientsRow.click({ button: 'right' })
      const folderBox = await expectMenuOnTop(page, '.folder-menu')
      expect(folderBox.x + folderBox.width).toBeLessThanOrEqual(TREE_STRIP)
    } finally {
      await closeAndSaveVideo(launched)
    }
  })
})
