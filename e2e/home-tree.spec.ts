import { test, expect } from '@playwright/test'
import { launchShell, closeAndSaveVideo, screenshotPath } from './helpers'
import type { HomeChatSession } from '../apps/shell/src/shared/home-api'

/**
 * ZCode 式左树（对话 | 项目 双 Tab）：
 * Tab 切换语义、面板头部过滤+归档、会话行归档/置顶/重命名/删除、
 * 项目行三钮与右键菜单、归档视图（收藏文档并入、归档会话可还原）。
 */

const seededSessions: HomeChatSession[] = [
  {
    id: 's-archive-target',
    title: '待归档的会话',
    createdAt: Date.now() - 5000,
    updatedAt: Date.now() - 5000,
    messages: [
      { id: 'm1', role: 'user', text: '写一份周报', ts: Date.now() - 6000 },
      { id: 'm2', role: 'assistant', text: '好的，这是周报草稿', ts: Date.now() - 5000 },
    ],
  },
  {
    id: 's-pin-target',
    title: '要置顶的会话',
    createdAt: Date.now() - 3000,
    updatedAt: Date.now() - 3000,
    messages: [{ id: 'm3', role: 'user', text: '帮我做个表格', ts: Date.now() - 4000 }],
  },
  {
    id: 's-archived-already',
    title: '已在归档的会话',
    createdAt: Date.now() - 8000,
    updatedAt: Date.now() - 8000,
    archived: true,
    messages: [{ id: 'm4', role: 'user', text: '旧需求', ts: Date.now() - 9000 }],
  },
]

test.describe('ZCode 式左树（对话|项目双 Tab）', () => {
  test('对话 Tab：清单/进入会话/右键菜单/置顶/重命名/行尾归档/过滤', async () => {
    const launched = await launchShell({ onboardingSeen: true, lang: 'zh', videoDir: 'home-tree' })
    const { page } = launched
    try {
      // 预写会话档案（含一条已归档），reload 让树读档
      await page.evaluate(async (sessions) => {
        await window.chatOffice.chatSessionsSave(sessions)
      }, seededSessions)
      await page.reload()
      // 双 Tab：默认落在「对话」，「项目」tab 待切换
      const chatsTab = page.locator('.sidebar-tabs [role="tab"]', { hasText: '对话' })
      await expect(chatsTab).toHaveAttribute('aria-selected', 'true')

      // 清单只列未归档会话；面板头部行尾有 过滤+归档 两钮
      await expect(page.locator('.side-sec-chats .tree-chat')).toHaveCount(2)
      await expect(page.locator('.side-sec-chats .tree-tab-head .side-head-btn')).toHaveCount(2)

      // 点击清单项进入会话（中栏出现该会话的消息）
      await page.locator('.side-sec-chats .tree-chat', { hasText: '待归档的会话' }).click()
      await expect(page.locator('.chat-msgs .chat-msg', { hasText: '写一份周报' })).toHaveCount(1)

      // 右键菜单七项：打开/重命名/置顶/复制标题/导出/归档/删除
      const row = page.locator('.side-sec-chats .tree-chat', { hasText: '待归档的会话' })
      await row.click({ button: 'right' })
      await expect(page.locator('.tree-ctx-menu')).toBeVisible()
      const items = await page.locator('.tree-ctx-menu button').allTextContents()
      expect(
        ['打开会话', '重命名', '置顶', '复制标题', '导出会话记录', '归档', '删除会话'].every((x) =>
          items.includes(x),
        ),
      ).toBe(true)

      // 置顶：行升至组内第一并带置顶标
      await page.locator('.tree-ctx-menu button', { hasText: '置顶' }).click()
      await expect(page.locator('.tree-chat-pin')).toHaveCount(1)
      await expect(page.locator('.side-sec-chats .tree-chat-title').first()).toHaveText(
        '待归档的会话',
      )

      // 重命名（行内输入）
      await row.click({ button: 'right' })
      await page.locator('.tree-ctx-menu button', { hasText: '重命名' }).click()
      await page.fill('.tree-chat-rename', '改名后的周报会话')
      await page.keyboard.press('Enter')
      await expect(
        page.locator('.side-sec-chats .tree-chat', { hasText: '改名后的周报会话' }),
      ).toHaveCount(1)

      // 行尾归档按钮：会话从清单消失
      const renamed = page.locator('.side-sec-chats .tree-chat', { hasText: '改名后的周报会话' })
      await renamed.hover()
      await page.locator('.side-sec-chats .tree-chat-archive').first().click()
      await expect(page.locator('.side-sec-chats .tree-chat')).toHaveCount(1)

      // 过滤按钮：搜索条过滤清单，Escape/× 收起
      await page.locator('.side-sec-chats .tree-tab-head .side-head-btn').first().click()
      await page.fill('.side-sec-chats .tree-filter input', '表格')
      await expect(page.locator('.side-sec-chats .tree-chat')).toHaveCount(1)
      await page.fill('.side-sec-chats .tree-filter input', '不存在的东西')
      await expect(page.locator('.side-sec-chats .side-files-empty')).toContainText(
        '没有匹配的对话',
      )
      // 非空时 ×＝清空，再按一次 ＝ 收起（与输入框内一致的行为）
      await page.locator('.side-sec-chats .tree-filter-clear').click()
      await page.locator('.side-sec-chats .tree-filter-clear').click()
      await expect(page.locator('.side-sec-chats .tree-filter')).toHaveCount(0)
      await page.screenshot({ path: screenshotPath('tree-chats') })
    } finally {
      await closeAndSaveVideo(launched, 'home-tree-chats')
    }
  })

  test('项目 Tab：切换语义/一级列表/展开对话清单/行尾新建任务/右键重命名', async () => {
    const launched = await launchShell({
      onboardingSeen: true,
      lang: 'zh',
      videoDir: 'home-tree-projects',
    })
    const { page } = launched
    try {
      await page.evaluate(async (sessions) => {
        await window.chatOffice.chatSessionsSave(sessions)
        await window.chatOfficeProject.createProject('验证项目甲')
        window.dispatchEvent(new Event('focus'))
      }, seededSessions)
      await page.reload()

      // Tab 切换语义：点「项目」tab → 项目面板出现、对话面板让位
      await page.locator('.sidebar-tabs [role="tab"]', { hasText: '项目' }).click()
      const projectsTab = page.locator('.sidebar-tabs [role="tab"]', { hasText: '项目' })
      await expect(projectsTab).toHaveAttribute('aria-selected', 'true')
      await expect(page.locator('.side-sec-projects .proj-item').first()).toBeVisible()
      await expect(page.locator('.side-sec-chats')).toHaveCount(0)
      await page.locator('.sidebar-tabs [role="tab"]', { hasText: '对话' }).click()
      await expect(page.locator('.side-sec-chats')).toBeVisible()
      await page.locator('.sidebar-tabs [role="tab"]', { hasText: '项目' }).click()

      // 一级是项目列表（默认项目 + 新建的一个）
      const projectRows = await page.locator('.side-sec-projects .proj-item').count()
      expect(projectRows).toBeGreaterThanOrEqual(2)

      // 点击项目行：展开，下面是该项目专属的对话清单
      const projRow = page.locator('.side-sec-projects .proj-item', { hasText: '验证项目甲' })
      await projRow.locator('.proj-item-main').click()
      await expect(projRow.locator('.proj-children')).toHaveCount(1)

      // 行尾 新建任务 / 更多（查看文件仅在绑定文件夹的项目上出现）
      await projRow.hover()
      await expect(projRow.locator('.proj-row-btn')).toHaveCount(1)
      await expect(projRow.locator('.proj-more-btn')).toHaveCount(1)
      await projRow.locator('.proj-row-btn').click()
      await expect(projRow.locator('.tree-chat')).toHaveCount(1)

      // 右键菜单：新建任务 / 重命名 / 删除项目（默认项目无删除项）
      await projRow.locator('.proj-item-main').click({ button: 'right' })
      await expect(page.locator('.tree-ctx-menu')).toBeVisible()
      const menu = await page.locator('.tree-ctx-menu button').allTextContents()
      expect(menu).toContain('新建任务')
      expect(menu).toContain('重命名')
      expect(menu.some((x) => x.startsWith('删除项目'))).toBe(true)

      // 项目重命名
      await page.locator('.tree-ctx-menu button', { hasText: '重命名' }).click()
      await page.fill('.proj-rename-input.inline', '验证项目乙')
      await page.keyboard.press('Enter')
      await expect(
        page.locator('.side-sec-projects .proj-item', { hasText: '验证项目乙' }),
      ).toHaveCount(1)
      await page.screenshot({ path: screenshotPath('tree-projects') })
    } finally {
      await closeAndSaveVideo(launched, 'home-tree-projects')
    }
  })

  test('归档视图：收藏文档并入/归档会话还原/收藏分组已移除', async () => {
    const launched = await launchShell({
      onboardingSeen: true,
      lang: 'zh',
      videoDir: 'home-tree-archive',
    })
    const { page } = launched
    try {
      await page.evaluate(async (sessions) => {
        await window.chatOffice.chatSessionsSave(sessions)
      }, seededSessions)
      await page.reload()

      // 面板头部归档按钮进入视图：归档的文档（原收藏）+ 归档的会话 两个子分组
      await page.locator('.side-sec-chats .tree-tab-head .side-head-btn').nth(1).click()
      await expect(page.locator('.archive-view')).toBeVisible()
      await expect(page.locator('.archive-sub', { hasText: '归档的文档' })).toHaveCount(1)
      await expect(page.locator('.archive-sub', { hasText: '归档的会话' })).toHaveCount(1)
      await expect(page.locator('.archive-view .tree-chat')).toHaveCount(1)

      // 收藏分组已移除；最近分组保留
      await expect(page.locator('.side-sec-starred')).toHaveCount(0)
      await expect(page.locator('.side-sec-recent')).toHaveCount(1)
      await page.screenshot({ path: screenshotPath('tree-archive') })

      // 归档会话行尾 = 取消归档：回到对话清单
      const archived = page.locator('.archive-view .tree-chat', { hasText: '已在归档的会话' })
      await archived.hover()
      await archived.locator('.tree-chat-archive').click()
      await page.locator('.archive-back').click()
      await expect(
        page.locator('.side-sec-chats .tree-chat', { hasText: '已在归档的会话' }),
      ).toHaveCount(1)

      // 会话删除走确认弹窗
      const victim = page.locator('.side-sec-chats .tree-chat', { hasText: '已在归档的会话' })
      await victim.click({ button: 'right' })
      await page.locator('.tree-ctx-menu button', { hasText: '删除会话' }).click()
      await expect(page.locator('.modal h3')).toContainText('删除会话')
      await page.locator('.modal .btn-danger').click()
      await expect(
        page.locator('.side-sec-chats .tree-chat', { hasText: '已在归档的会话' }),
      ).toHaveCount(0)
    } finally {
      await closeAndSaveVideo(launched, 'home-tree-archive')
    }
  })
})
