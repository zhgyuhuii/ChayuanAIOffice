/**
 * LOCAL(2026-09-21, d8201ad0): 多会话空态引导(B 区)。
 * tab 关到零时对话体区域显示:大「新建对话」按钮 + 「去历史对话还原」提示;
 * 新建或还原后由父级离开空态(计划 §2.1)。文案一律 labels 端注入。
 */
import React from 'react'

export interface AiConversationsEmptyLabels {
  title: string
  body: string
  create: string
  openHistory: string
}

export function AiConversationsEmpty({
  labels,
  onCreate,
  onOpenHistory,
}: {
  labels: AiConversationsEmptyLabels
  onCreate: () => void
  onOpenHistory: () => void
}): React.JSX.Element {
  return (
    <div className="ai-chat-empty ai-conv-empty">
      <div className="ai-conv-empty-title">{labels.title}</div>
      <div className="ai-conv-empty-body">{labels.body}</div>
      <button type="button" className="ai-conv-empty-create" onClick={onCreate}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M13.5 7.2v-3A1.7 1.7 0 0 0 11.8 2.5H4.2a1.7 1.7 0 0 0-1.7 1.7v6.1a1.7 1.7 0 0 0 1.7 1.7h1.1v2l2.6-2h1.3"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M12.2 9.4v4M10.2 11.4h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        {labels.create}
      </button>
      <button type="button" className="ai-conv-empty-history" onClick={onOpenHistory}>
        {labels.openHistory}
      </button>
    </div>
  )
}
