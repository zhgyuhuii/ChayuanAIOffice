/**
 * 会话↔停靠 tab 组记忆（P1,已签共识「会话切换=恢复该会话的 tab 组状态」）。
 * 纯逻辑与执行器分离:planRestore 可单测,restoreDockTabs 消费 DockApi。
 * 视图本身活在主进程;这里只记「哪些文档(tab)属于这个会话」并在切换回来时
 * 把缺的重新停靠(经 dock.open 的复用去重,不会重复开同一文件)。
 */

import type { DockApi, DockKind, DockTabSummary } from '../../shared/dock-api'
import type { HomeChatSession } from '../../shared/home-api'

/** what a session remembers about its dock pane */
export interface DockMemory {
  tabs: Array<{ kind: DockKind; file?: string | undefined }>
  /** which remembered tab fills the pane (index into tabs) */
  activeIndex?: number | undefined
}

/** snapshot the live dock list into the session record shape */
export function snapshotFromTabs(tabs: DockTabSummary[]): DockMemory {
  return {
    tabs: tabs.map((tab) => ({ kind: tab.kind, ...(tab.filePath ? { file: tab.filePath } : {}) })),
    ...(tabs.some((tab) => tab.active)
      ? {
          activeIndex: Math.max(
            0,
            tabs.findIndex((tab) => tab.active),
          ),
        }
      : {}),
  }
}

function matches(
  tab: { kind: DockKind; file?: string | undefined },
  live: DockTabSummary,
): boolean {
  return live.kind === tab.kind && (tab.file ? live.filePath === tab.file : !live.filePath)
}

/** pure reconciliation: what must open, and which live tab to activate */
export function planRestore(
  current: DockTabSummary[],
  remembered: DockMemory | undefined,
): {
  toOpen: Array<{ kind: DockKind; file?: string | undefined }>
  activateQuery: DockMemory['tabs'][number] | null
} {
  if (!remembered || remembered.tabs.length === 0) return { toOpen: [], activateQuery: null }
  const toOpen: Array<{ kind: DockKind; file?: string | undefined }> = []
  for (const tab of remembered.tabs) {
    if (!current.some((live) => matches(tab, live))) toOpen.push(tab)
  }
  const activeTab = remembered.tabs[remembered.activeIndex ?? 0] ?? null
  return { toOpen, activateQuery: activeTab }
}

/** re-dock the remembered tabs that are missing, then restore the active one */
export async function restoreDockTabs(
  dock: DockApi,
  remembered: DockMemory | undefined,
): Promise<void> {
  const current = await dock.list()
  const { toOpen, activateQuery } = planRestore(current, remembered)
  for (const tab of toOpen) {
    await dock.open(tab.kind, tab.file ? { file: tab.file } : {})
  }
  if (!activateQuery) return
  const live = (await dock.list()).find((tab) => matches(activateQuery, tab))
  if (live) await dock.activate(live.id)
}

/** session memory shape ⇄ HomeChatSession.dock (kept loose for persistence) */
export function memoryOf(session: HomeChatSession | null): DockMemory | undefined {
  return (session?.dock as DockMemory | undefined) ?? undefined
}
