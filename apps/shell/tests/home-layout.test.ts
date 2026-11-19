// @vitest-environment jsdom
// 左树三 Tab（对话 | 项目 | 最近）的持久化：activeTab 新键读写 + 旧折叠标志的
// 向后兼容迁移（chatsCollapsed/projectsCollapsed → activeTab）+ 2026-11-19
// 默认面裁定（recent→projects，homeLayoutV2 一次性迁移标记）。
import { afterEach, describe, expect, it } from 'vitest'
import {
  getHomeLayout,
  setHomeLayout,
  treeTabFromStored,
  type HomeLayoutState,
} from '../src/renderer/src/home-layout'

const STORAGE_KEY = 'chaoffice.home-layout'

const DEFAULTS: HomeLayoutState = {
  leftCollapsed: false,
  rightCollapsed: true,
  activeTab: 'projects',
  recentCollapsed: false,
  sidebarWidth: 232,
  dockWidth: null,
  homeLayoutV2: true,
}

describe('treeTabFromStored (pre-tab collapse-flag migration)', () => {
  it('reads the activeTab key directly once the v2 marker is present', () => {
    expect(treeTabFromStored({ activeTab: 'chats', homeLayoutV2: true })).toBe('chats')
    expect(treeTabFromStored({ activeTab: 'recent', homeLayoutV2: true })).toBe('recent')
    expect(treeTabFromStored({ activeTab: 'projects' })).toBe('projects')
  })

  it('v2 one-time switch: a pre-switch stored tab that is not projects resets to projects', () => {
    expect(treeTabFromStored({ activeTab: 'chats' })).toBe('projects')
    expect(treeTabFromStored({ activeTab: 'recent' })).toBe('projects')
  })

  it('migrates: folded chats + open projects → projects', () => {
    expect(treeTabFromStored({ chatsCollapsed: true, projectsCollapsed: false })).toBe('projects')
  })

  // 2026-11-19 默认面裁定：左树退役文件列表面板后，项目成为侧栏主入口，
  // 无历史标记的旧折叠组合与空态一律落到 projects
  it('migrates: both expanded (or both folded) → projects default', () => {
    expect(treeTabFromStored({ chatsCollapsed: false, projectsCollapsed: false })).toBe('projects')
    expect(treeTabFromStored({ chatsCollapsed: true, projectsCollapsed: true })).toBe('projects')
    expect(treeTabFromStored({ chatsCollapsed: false, projectsCollapsed: true })).toBe('projects')
  })

  it('falls back to projects with no stored tree state at all', () => {
    expect(treeTabFromStored({})).toBe('projects')
  })
})

describe('home-layout activeTab persistence', () => {
  afterEach(() => {
    localStorage.clear()
    setHomeLayout(DEFAULTS)
    localStorage.removeItem(STORAGE_KEY)
  })

  it('writes the active tab and drops the retired collapse flags', () => {
    setHomeLayout({ activeTab: 'recent' })
    expect(getHomeLayout().activeTab).toBe('recent')
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as Record<string, unknown>
    expect(stored.activeTab).toBe('recent')
    expect('chatsCollapsed' in stored).toBe(false)
    expect('projectsCollapsed' in stored).toBe(false)
  })

  it('a no-op patch does not rewrite storage', () => {
    setHomeLayout({ activeTab: 'chats' })
    const before = localStorage.getItem(STORAGE_KEY)
    setHomeLayout({ activeTab: 'chats' })
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before)
  })
})
