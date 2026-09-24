/**
 * LOCAL(2026-09-22, d8201ad0): 历史对话下拉浮层(D13 增量,B 区,六端共用)。
 * 「历史对话」不再是 tab:🕘 图标按钮常驻 actions 槽([+][🕘],面板布局按钮左侧),
 * 点击在其下方弹出下拉浮层(交互模式照 DockShell 的 dockshell-menu:
 * useDismissablePopover 点外关闭/失焦关闭/chrome 按压中继,fixed 定位逃出裁剪)。
 * 条目点击 = 还原成 tab 并收起;单删/全删在浮层内经 AiTabConfirm 确认
 * (确认气泡的指针事件落在浮层内部,不会触发浮层自身关闭)。
 * 列表体复用 AiHistoryList(items 只含非空会话,由 hook 的 closed 保证,见 D12);
 * 文案一律 labels 端注入,组件内不取词。
 */
import React, { useEffect, useRef, useState } from 'react'
import { AiHistoryList, type AiHistoryListLabels } from './AiHistoryList'
import { AiTabConfirm } from './AiTabConfirm'
import { useDismissablePopover } from './popover-dismiss'
import type { AiConversationMeta } from './useAiConversations'

export interface AiHistoryPopoverLabels extends AiHistoryListLabels {
  /** single-delete confirm body */
  deleteOneConfirm: string
  /** delete-all confirm body */
  deleteAllConfirm: string
  /** cancel label of both confirms */
  cancel: string
}

/** 🕘 history-clock glyph (shared by the six panels' trigger buttons) */
function IconAiHistory({ size = 15 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3.5 5.5v4h4M3.9 9.5A8.5 8.5 0 1 1 3.5 13"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 8v4.5l3 1.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function AiHistoryPopover({
  open,
  onOpenChange,
  items,
  labels,
  tooltip,
  onRestore,
  onDelete,
  onDeleteAll,
}: {
  /** open state lives with the caller (the empty-state guide opens it too) */
  open: boolean
  onOpenChange: (open: boolean) => void
  items: readonly AiConversationMeta[]
  labels: AiHistoryPopoverLabels
  /** 🕘 trigger tooltip / aria-label */
  tooltip: string
  onRestore: (chatId: string) => void
  onDelete: (chatId: string) => void
  onDeleteAll: () => void
}): React.JSX.Element {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, right: 0 })
  const [confirm, setConfirm] = useState<{ kind: 'one'; chatId: string } | { kind: 'all' } | null>(
    null,
  )

  // anchor under the trigger button, right-aligned to the panel edge (fixed:
  // escapes the panel's overflow clipping, same as dockshell-menu)
  useEffect(() => {
    if (!open) {
      setConfirm(null)
      return
    }
    const el = anchorRef.current
    if (el) {
      const r = el.getBoundingClientRect()
      setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) })
    }
  }, [open])

  useDismissablePopover(open, () => onOpenChange(false), {
    inside: () => [panelRef.current, anchorRef.current],
  })

  return (
    <span className="ai-history-anchor" ref={anchorRef}>
      <button
        type="button"
        className="ai-header-btn"
        onClick={() => onOpenChange(!open)}
        data-tip={tooltip}
        aria-label={tooltip}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <IconAiHistory />
      </button>
      {open && (
        <div ref={panelRef} className="ai-history-popover" role="menu" style={pos}>
          <AiHistoryList
            items={items}
            labels={labels}
            onRestore={(chatId) => {
              onRestore(chatId)
              onOpenChange(false)
            }}
            onDelete={(chatId) => setConfirm({ kind: 'one', chatId })}
            onDeleteAll={() => setConfirm({ kind: 'all' })}
          />
          {confirm?.kind === 'one' && (
            <AiTabConfirm
              body={labels.deleteOneConfirm}
              confirmLabel={labels.deleteOne}
              cancelLabel={labels.cancel}
              onConfirm={() => {
                onDelete(confirm.chatId)
                setConfirm(null)
              }}
              onCancel={() => setConfirm(null)}
            />
          )}
          {confirm?.kind === 'all' && (
            <AiTabConfirm
              body={labels.deleteAllConfirm}
              confirmLabel={labels.deleteAll}
              cancelLabel={labels.cancel}
              onConfirm={() => {
                onDeleteAll()
                setConfirm(null)
              }}
              onCancel={() => setConfirm(null)}
            />
          )}
        </div>
      )}
    </span>
  )
}
