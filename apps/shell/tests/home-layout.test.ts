// @vitest-environment jsdom
// 左树双 Tab（对话 | 项目）的持久化：activeTab 新键读写 + 旧折叠标志的
// 向后兼容迁移（chatsCollapsed/projectsCollapsed → activeTab）。
import { afterEach, describe, expect, it } from 'vitest'
import {
  getHomeLayout,
  setHomeLayout,
  treeTabFromStored,
  type HomeLayoutState,
} from '../src/renderer/src/home-layout'

const STORAGE_KEY = 'chatoffice.home-layout'

const DEFAULTS: HomeLayoutState = {
  leftCollapsed: false,
  rightCollapsed: true,
  activeTab: 'chats',
  recentCollapsed: false,
  sidebarWidth: 232,
  dockWidth: null,
}

describe('treeTabFromStored (pre-tab collapse-flag migration)', () => {
  it('reads the new activeTab key directly', () => {
    expect(treeTabFromStored({ activeTab: 'chats' })).toBe('chats')
    expect(treeTabFromStored({ activeTab: 'projects' })).toBe('projects')
  })

  it('migrates: folded chats + open projects → projects', () => {
    expect(treeTabFromStored({ chatsCollapsed: true, projectsCollapsed: false })).toBe('projects')
  })

  it('migrates: both expanded (or both folded) → chats default', () => {
    expect(treeTabFromStored({ chatsCollapsed: false, projectsCollapsed: false })).toBe('chats')
    expect(treeTabFromStored({ chatsCollapsed: true, projectsCollapsed: true })).toBe('chats')
    expect(treeTabFromStored({ chatsCollapsed: false, projectsCollapsed: true })).toBe('chats')
  })

  it('falls back to chats with no stored tree state at all', () => {
    expect(treeTabFromStored({})).toBe('chats')
  })
})

describe('home-layout activeTab persistence', () => {
  afterEach(() => {
    localStorage.clear()
    setHomeLayout(DEFAULTS)
    localStorage.removeItem(STORAGE_KEY)
  })

  it('writes the active tab and drops the retired collapse flags', () => {
    setHomeLayout({ activeTab: 'projects' })
    expect(getHomeLayout().activeTab).toBe('projects')
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as Record<string, unknown>
    expect(stored.activeTab).toBe('projects')
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
