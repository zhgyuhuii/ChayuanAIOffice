import { test, expect } from '@playwright/test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { launchShell, closeAndSaveVideo, screenshotPath } from './helpers'

/**
 * Home "Folders" panel: the tree over the default save folder plus the
 * create / rename / move / delete actions against the real disk.
 * LOCAL 形态（2026-09-23 共识）：文件内联展开在树节点下（上游为主区表格），
 * 断言跟随树内联行；新建落点 = 树选中的文件夹（2×3 直钮网格）。
 */
test.describe('home folders panel', () => {
  let root: string

  test.beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'chatoffice-e2e-root-')))
    mkdirSync(join(root, 'Clients', 'A Corp'), { recursive: true })
    mkdirSync(join(root, 'Clients', 'Contracts'), { recursive: true })
    mkdirSync(join(root, 'Personal'))
    writeFileSync(join(root, 'report.docx'), 'x')
    writeFileSync(join(root, 'notes.md'), '# notes')
    writeFileSync(join(root, 'Clients', 'Contracts', 'deal.md'), '# deal')
  })

  test.afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  /** 等根目录自动展开出子节点（挂载后 listing 异步返回） */
  async function waitRootExpanded(
    page: Page,
    tree: ReturnType<Page['locator']>,
  ) {
    for (let i = 0; i < 12; i++) {
      if ((await tree.locator('.tree-children .tree-row').count()) > 0) return
      await page.waitForTimeout(500)
    }
  }

  test('shows the tree, opens a folder, then creates / moves / renames / deletes on disk', async () => {
    const launched = await launchShell({
      onboardingSeen: true,
      settings: { defaultSaveDir: root },
      videoDir: 'home-folders',
    })
    const { page } = launched
    try {
      const tree = page.locator('.folder-panel .tree')
      await expect(page.locator('.folder-panel-title')).toHaveText('Folders')
      const rootRow = tree.locator('.tree-row').first()
      await expect(rootRow).toContainText(root.split('/').pop()!)
      await waitRootExpanded(page, tree)
      // root is expanded by default: its first-level folders are listed
      await expect(tree.locator('.tree-name', { hasText: 'Clients' })).toBeVisible()
      await expect(tree.locator('.tree-name', { hasText: 'Personal' })).toBeVisible()
      await expect(tree.locator('.tree-name', { hasText: 'Contracts' })).toHaveCount(0)

      // expand Clients → its children appear
      const clientsRow = tree.locator('.tree-row', {
        has: page.locator('.tree-name', { hasText: 'Clients' }),
      })
      await clientsRow.locator('.tree-chevron').click()
      await expect(tree.locator('.tree-name', { hasText: 'Contracts' })).toBeVisible()

      // select Contracts → active tree row + its file inline under the node
      await tree.locator('.tree-name', { hasText: 'Contracts' }).click()
      await expect(tree.locator('.tree-row.active .tree-name')).toHaveText('Contracts')
      const dealRow = page.locator('.tree-file-row', { hasText: 'deal.md' })
      await expect(dealRow).toBeVisible()
      await page.screenshot({ path: screenshotPath('home-folders-contracts') })

      // new folder from the sidebar header: lands under the selected folder
      await page.locator('.folder-new-btn').click()
      const input = page.locator('.folder-panel .tree .folder-rename-input')
      await input.fill('Drafts')
      await input.press('Enter')
      await expect(tree.locator('.tree-name', { hasText: 'Drafts' })).toBeVisible()
      expect(existsSync(join(root, 'Clients', 'Contracts', 'Drafts'))).toBe(true)

      // move deal.md → Personal through the picker
      await dealRow.hover()
      await dealRow.locator('.folder-more-btn').click()
      await page.locator('.tree-file-menu button', { hasText: 'Move to folder' }).click()
      const picker = page.locator('.picker-modal')
      await expect(picker).toBeVisible()
      await picker
        .locator('.picker-row', { has: page.locator('.picker-name', { hasText: 'Personal' }) })
        .click()
      await picker.locator('.btn-primary').click()
      await expect(picker).toHaveCount(0)
      await expect(page.locator('.tree-file-row', { hasText: 'deal.md' })).toHaveCount(0)
      expect(existsSync(join(root, 'Personal', 'deal.md'))).toBe(true)
      expect(existsSync(join(root, 'Clients', 'Contracts', 'deal.md'))).toBe(false)

      // rename Drafts → Final from the sub-folder row menu
      const draftsRow = tree.locator('.tree-row', {
        has: page.locator('.tree-name', { hasText: 'Drafts' }),
      })
      await draftsRow.locator('.folder-more-btn').click()
      await page.locator('.folder-menu button', { hasText: 'Rename' }).click()
      const renameInput = page.locator('.folder-panel .folder-rename-input')
      await renameInput.fill('Final')
      await renameInput.press('Enter')
      await expect(tree.locator('.tree-name', { hasText: 'Final' })).toBeVisible()
      expect(existsSync(join(root, 'Clients', 'Contracts', 'Final'))).toBe(true)

      // delete Final (confirm dialog → trash)
      const finalRow = tree.locator('.tree-row', {
        has: page.locator('.tree-name', { hasText: 'Final' }),
      })
      await finalRow.locator('.folder-more-btn').click()
      await page.locator('.folder-menu button.danger').click()
      await page.locator('.modal .btn-danger').click()
      await expect(tree.locator('.tree-name', { hasText: 'Final' })).toHaveCount(0)
      expect(existsSync(join(root, 'Clients', 'Contracts', 'Final'))).toBe(false)

      // Personal now holds the moved file, listed inline under its node
      await tree.locator('.tree-name', { hasText: 'Personal' }).click()
      await expect(page.locator('.tree-file-row', { hasText: 'deal.md' })).toBeVisible()
      await page.screenshot({ path: screenshotPath('home-folders-personal') })
    } finally {
      await closeAndSaveVideo(launched, 'home-folders')
    }
  })

  test('an added folder joins the tree in place and leaves the list without touching disk', async () => {
    const extra = realpathSync(mkdtempSync(join(tmpdir(), 'chatoffice-e2e-extra-')))
    mkdirSync(join(extra, 'Projects', 'Alpha'), { recursive: true })
    writeFileSync(join(extra, 'Projects', 'plan.md'), '# plan')
    const launched = await launchShell({
      onboardingSeen: true,
      settings: { defaultSaveDir: root, folderRoots: [extra] },
      videoDir: 'home-folders-roots',
    })
    const { page, userDataDir } = launched
    try {
      const tree = page.locator('.folder-panel .tree')
      const rootRows = tree.locator(':scope > .tree-item > .tree-row')
      await waitRootExpanded(page, tree)
      await expect(rootRows).toHaveCount(2)
      await expect(rootRows.nth(0)).toContainText(root.split('/').pop()!)
      await expect(rootRows.nth(1)).toContainText(extra.split('/').pop()!)

      // every root row opens on a fresh profile, so the added root shows its real contents
      await expect(rootRows.nth(1)).toHaveAttribute('aria-expanded', 'true')
      await expect(tree.locator('.tree-name', { hasText: 'Projects' })).toBeVisible()
      await tree.locator('.tree-name', { hasText: 'Projects' }).click()
      await expect(page.locator('.tree-file-row', { hasText: 'plan.md' })).toBeVisible()
      await expect(tree.locator('.tree-row', { has: page.locator('.tree-name', { hasText: 'Alpha' }) })).toBeVisible()

      // edits happen where the folder really is
      await page.locator('.folder-new-btn').click()
      const input = page.locator('.folder-panel .tree .folder-rename-input')
      await input.fill('Beta')
      await input.press('Enter')
      await expect(tree.locator('.tree-name', { hasText: 'Beta' })).toBeVisible()
      expect(existsSync(join(extra, 'Projects', 'Beta'))).toBe(true)
      await page.screenshot({ path: screenshotPath('home-folders-extra-root') })

      // remove from the list: the row goes, the setting empties, the disk is untouched
      await rootRows.nth(1).hover()
      await rootRows.nth(1).locator('.folder-more-btn').click()
      await page.locator('.folder-menu button', { hasText: 'Remove from list' }).click()
      await expect(rootRows).toHaveCount(1)
      await expect(page.locator('.tree-file-row', { hasText: 'plan.md' })).toHaveCount(0)
      await expect
        .poll(() => {
          const settings = JSON.parse(readFileSync(join(userDataDir, 'app-settings.json'), 'utf8'))
          return settings.folderRoots
        })
        .toEqual([])
      expect(existsSync(join(extra, 'Projects', 'plan.md'))).toBe(true)
      expect(existsSync(join(extra, 'Projects', 'Beta'))).toBe(true)
    } finally {
      await closeAndSaveVideo(launched, 'home-folders-roots')
      rmSync(extra, { recursive: true, force: true })
    }
  })

  test('a file created from the new-file grid keeps the tree-selected folder as its save target', async () => {
    // LOCAL 延迟落盘架构（4327d4d 共识）：新建即未命名内存文档，首次保存才写盘，
    // 树选中的文件夹经 pending-dir 成为首存默认目录——这里断言 tab 打开与选中语义，
    // 磁盘落点由首存流程决定，不作同步写盘断言（上游规格按本仓架构改编）。
    const launched = await launchShell({
      onboardingSeen: true,
      settings: { defaultSaveDir: root },
      videoDir: 'home-folders-new-file',
    })
    const { page, app } = launched
    try {
      const tree = page.locator('.folder-panel .tree')
      await tree.locator('.tree-name', { hasText: 'Personal' }).click()
      await expect(tree.locator('.tree-row.active .tree-name')).toHaveText('Personal')
      await page.locator('.side-new-tile[title*=".pdf"]').click()
      // 未命名文档 tab 不以扩展名为题，断言出现非 Home 的激活编辑器 tab
      await expect(page.locator('.tab-bar .tab-item.active:not(.tab-home)')).toBeVisible({
        timeout: 15_000,
      })
      // back home: the folder selection survives the round trip (not a one-shot slot)
      await page.locator('.tab-bar .tab-item.tab-home').click()
      await expect(tree.locator('.tree-row.active .tree-name')).toHaveText('Personal')
      await page.locator('.side-new-tile[title*=".xlsx"]').click()
      await expect(page.locator('.tab-bar .tab-item.active:not(.tab-home)')).toBeVisible({
        timeout: 15_000,
      })
      // home still stands: the new tabs must not block shutdown
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.focus())
    } finally {
      await closeAndSaveVideo(launched, 'home-folders-new-file')
    }
  })
})
