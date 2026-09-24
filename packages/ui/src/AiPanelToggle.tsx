/**
 * AiPanelToggle — the top-right chat-bubble icon that opens/closes the AI panel.
 *
 * Sits at the far right of each editor's tab row (a frameless-window drag
 * region): quick-action button sizing with an explicit no-drag region and
 * margin-left:auto pushing it to the row's end, so on Windows it lands just
 * left of the reserved caption-button strip.
 *
 * When the panel closes (the `open` prop's true→false edge, whatever closed
 * it), the bubble plays a one-shot attention animation — pulse + wiggle — with
 * an arrowed "click here" hint, so the user knows where to reopen the panel.
 * Hover or click stops it early; prefers-reduced-motion keeps the hint static.
 */
import React, { useEffect, useRef, useState } from 'react'

export interface AiPanelToggleProps {
  open: boolean
  onToggle: () => void
  /** tooltip + aria label (the app's own wording, no brand); doubles as the attention hint */
  label: string
  /** attention animation length after close (ms) */
  attentionMs?: number
}

export function AiPanelToggle({
  open,
  onToggle,
  label,
  attentionMs = 1800,
}: AiPanelToggleProps): React.JSX.Element {
  const [attention, setAttention] = useState(false)
  const prevOpen = useRef(open)

  useEffect(() => {
    const wasOpen = prevOpen.current
    prevOpen.current = open
    if (wasOpen && !open) {
      setAttention(true)
      const timer = window.setTimeout(() => setAttention(false), attentionMs)
      return () => window.clearTimeout(timer)
    }
  }, [open, attentionMs])

  const stopAttention = () => setAttention(false)

  return (
    <span className="ai-toggle-wrap">
      <button
        type="button"
        className={`ai-panel-toggle${open ? ' active' : ''}${attention ? ' attention' : ''}`}
        data-tip={label}
        aria-label={label}
        aria-pressed={open}
        title={label}
        onClick={() => {
          stopAttention()
          onToggle()
        }}
        {...(attention ? { onPointerEnter: stopAttention } : {})}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      </button>
      {attention && (
        <span className="ai-toggle-hint" role="status">
          {label}
        </span>
      )}
    </span>
  )
}
