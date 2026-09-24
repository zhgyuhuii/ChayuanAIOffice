// @vitest-environment jsdom
// LOCAL(2026-09-22, d8201ad0): D13 历史对话下拉浮层单测(计划 §10 增量)——
// 图标点击开合、点外关闭、条目还原并收起、空历史文案、单删/全删走确认。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AiHistoryPopover, type AiHistoryPopoverLabels } from '../src/AiHistoryPopover'
import type { AiConversationMeta } from '../src/useAiConversations'

const ITEMS: AiConversationMeta[] = [
  { chatId: 'a', title: '合同风险条款', createdAt: 1, lastActiveAt: Date.now() - 60_000 },
  { chatId: 'b', title: '季度总结', createdAt: 1, lastActiveAt: Date.now() - 3_600_000 },
]

const LABELS: AiHistoryPopoverLabels = {
  deleteOne: '删除',
  deleteAll: '全部删除',
  empty: '暂无历史对话',
  deleteOneConfirm: '确定删除这条历史对话？',
  deleteAllConfirm: '确定删除全部历史对话？',
  cancel: '取消',
}

function renderPopover(over: {
  items?: AiConversationMeta[]
  labels?: AiHistoryPopoverLabels
  onRestore?: (id: string) => void
  onDelete?: (id: string) => void
  onDeleteAll?: () => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
} = {}): { container: HTMLElement; root: Root } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() =>
    root.render(
      createElement(AiHistoryPopover, {
        open: over.open ?? false,
        onOpenChange: over.onOpenChange ?? (() => {}),
        items: over.items ?? ITEMS,
        labels: over.labels ?? LABELS,
        tooltip: '历史对话',
        onRestore: over.onRestore ?? (() => {}),
        onDelete: over.onDelete ?? (() => {}),
        onDeleteAll: over.onDeleteAll ?? (() => {}),
      }),
    ),
  )
  return { container, root }
}

function press(el: Element): void {
  el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
}

afterEach(() => {
  for (const el of Array.from(document.body.children)) el.remove()
})

describe('AiHistoryPopover — trigger button (D13)', () => {
  it('the 🕘 button toggles open state through onOpenChange', () => {
    const onOpenChange = vi.fn()
    const { container } = renderPopover({ onOpenChange })
    const btn = container.querySelector('.ai-header-btn')!
    expect(btn).toBeTruthy()
    act(() => btn.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  it('closed popover renders no panel; open popover renders the list', () => {
    const closed = renderPopover({ open: false })
    expect(closed.container.querySelector('.ai-history-popover')).toBeNull()

    const opened = renderPopover({ open: true })
    expect(opened.container.querySelector('.ai-history-popover')).toBeTruthy()
    expect(opened.container.querySelectorAll('.ai-history-item')).toHaveLength(2)
  })
})

describe('AiHistoryPopover — open panel behavior', () => {
  it('clicking an item restores it and closes the popover', () => {
    const onRestore = vi.fn()
    const onOpenChange = vi.fn()
    const { container } = renderPopover({ open: true, onRestore, onOpenChange })
    const item = container.querySelector('.ai-history-item')!
    act(() => item.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onRestore).toHaveBeenCalledWith('a')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('an outside press closes the popover', () => {
    const onOpenChange = vi.fn()
    renderPopover({ open: true, onOpenChange })
    act(() => press(document.body))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('shows the empty text when there is no history', () => {
    const { container } = renderPopover({ open: true, items: [] })
    expect(container.querySelector('.ai-history-empty-text')!.textContent).toBe('暂无历史对话')
  })

  it('single delete asks for confirmation, then deletes', () => {
    const onDelete = vi.fn()
    const { container } = renderPopover({ open: true, onDelete })
    // hover affordance button of the first item
    const del = container.querySelector('.ai-history-item .ai-history-delete') as HTMLElement
    act(() => del.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    const confirm = container.querySelector('.ai-conv-confirm')!
    expect(confirm).toBeTruthy()
    expect(confirm.textContent).toContain('确定删除这条历史对话？')
    // confirm lives inside the popover panel (an outside press must NOT be
    // what executes it, and pressing it must not close the popover outright)
    act(() =>
      (confirm.querySelector('.ai-conv-confirm-ok') as HTMLElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      ),
    )
    expect(onDelete).toHaveBeenCalledWith('a')
    expect(container.querySelector('.ai-conv-confirm')).toBeNull()
  })

  it('delete-all asks for confirmation, then deletes', () => {
    const onDeleteAll = vi.fn()
    const { container } = renderPopover({ open: true, onDeleteAll })
    act(() =>
      (container.querySelector('.ai-history-delete-all') as HTMLElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      ),
    )
    expect(container.querySelector('.ai-conv-confirm')!.textContent).toContain('确定删除全部历史对话？')
    act(() =>
      (container.querySelector('.ai-conv-confirm-ok') as HTMLElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      ),
    )
    expect(onDeleteAll).toHaveBeenCalled()
  })

  it('cancel keeps the history intact and closes only the confirm bubble', () => {
    const onDelete = vi.fn()
    const { container } = renderPopover({ open: true, onDelete })
    const del = container.querySelector('.ai-history-item .ai-history-delete') as HTMLElement
    act(() => del.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    act(() =>
      (container.querySelector('.ai-conv-confirm-cancel') as HTMLElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      ),
    )
    expect(onDelete).not.toHaveBeenCalled()
    expect(container.querySelector('.ai-conv-confirm')).toBeNull()
    // the popover itself stays open
    expect(container.querySelector('.ai-history-popover')).toBeTruthy()
  })
})
