/**
 * LOCAL(2026-09-21, d8201ad0): 轻量确认气泡(B 区;仓库无通用 confirm 组件)。
 * 三处使用:关闭运行中会话(「停止并关闭/取消」)、历史单删、历史全删。
 * 定位 = 锚元素旁的行内卡片;文案一律 labels/children 端注入。
 */
import React, { useEffect, useRef } from 'react'

export function AiTabConfirm({
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  /** anchor element the bubble aligns to (defaults to the parent) */
  anchor,
}: {
  title?: string
  body?: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
  anchor?: HTMLElement | null
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDocPointerDown = (e: PointerEvent): void => {
      const target = e.target as Node
      if (ref.current?.contains(target)) return
      if (anchor?.contains(target)) return
      onCancel()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('pointerdown', onDocPointerDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchor, onCancel])

  return (
    <div className="ai-conv-confirm" ref={ref} role="alertdialog">
      {title && <div className="ai-conv-confirm-title">{title}</div>}
      {body && <div className="ai-conv-confirm-body">{body}</div>}
      <div className="ai-conv-confirm-actions">
        <button type="button" className="ai-conv-confirm-cancel" onClick={onCancel}>
          {cancelLabel}
        </button>
        <button type="button" className="ai-conv-confirm-ok" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </div>
  )
}
