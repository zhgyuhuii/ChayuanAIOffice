/**
 * LOCAL(2026-09-21, d8201ad0): 「历史对话」tab 体(B 区,六端共用)。
 * 列出当前文档所有未打开会话(标题 + 最后活跃相对时间);hover 显单个删除;
 * 顶部「全部删除」;空历史显示 empty 文案。删除一律由调用方弹确认(计划 D3)。
 * 文案一律 labels props 端注入,组件内不取词。
 */
import React, { useState } from 'react'
import type { AiConversationMeta } from './useAiConversations'

export interface AiHistoryListLabels {
  deleteOne: string
  deleteAll: string
  empty: string
}

/** relative time for a history entry (minutes / hours / days; older = the date) */
export function formatRelativeTime(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts)
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(ts).toLocaleDateString()
}

export function AiHistoryList({
  items,
  labels,
  onRestore,
  onDelete,
  onDeleteAll,
}: {
  items: readonly AiConversationMeta[]
  labels: AiHistoryListLabels
  onRestore: (chatId: string) => void
  onDelete: (chatId: string) => void
  onDeleteAll: () => void
}): React.JSX.Element {
  const [, setTick] = useState(0)
  // relative labels go stale as time passes; refresh them once a minute
  React.useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(timer)
  }, [])

  if (items.length === 0) {
    return (
      <div className="ai-history ai-history-empty">
        <div className="ai-history-empty-text">{labels.empty}</div>
      </div>
    )
  }

  return (
    <div className="ai-history">
      <div className="ai-history-head">
        <button type="button" className="ai-history-delete-all" onClick={onDeleteAll}>
          {labels.deleteAll}
        </button>
      </div>
      <div className="ai-history-list">
        {items.map((item) => (
          <div key={item.chatId} className="ai-history-item" role="button" tabIndex={0}
            onClick={() => onRestore(item.chatId)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onRestore(item.chatId)
              }
            }}
          >
            <span className="ai-history-title" title={item.title || undefined}>
              {item.title}
            </span>
            <span className="ai-history-time">{formatRelativeTime(item.lastActiveAt)}</span>
            <button
              type="button"
              className="ai-history-delete"
              aria-label={labels.deleteOne}
              data-tip={labels.deleteOne}
              onClick={(e) => {
                e.stopPropagation()
                onDelete(item.chatId)
              }}
            >
              <svg width="12" height="12" viewBox="0 0 32 32" aria-hidden>
                <path
                  d="M24 9.4L22.6 8L16 14.6L9.4 8L8 9.4l6.6 6.6L8 22.6L9.4 24l6.6-6.6l6.6 6.6l1.4-1.4l-6.6-6.6L24 9.4z"
                  fill="currentColor"
                />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
