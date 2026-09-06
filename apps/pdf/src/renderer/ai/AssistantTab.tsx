/**
 * AssistantTab — the PDF AI panel's 助手 tab: one-click actions as a list
 * (icon + name + description), same pattern as the docs app's AssistantTab.
 * Clicking an item sends its prompt immediately; the panel switches back to
 * the chat tab to follow the run (handled by the caller).
 */
import React from 'react'

export interface AssistantAction {
  id: string
  label: string
  desc: string
  icon: React.ReactNode
  disabled?: boolean
  run: () => void
}

export function AssistantTab({
  items,
  hidden,
}: {
  items: AssistantAction[]
  hidden?: boolean
}): React.JSX.Element {
  return (
    <div className="ai-assistant" style={hidden ? { display: 'none' } : undefined}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="ai-assist-item"
          disabled={item.disabled}
          onClick={item.run}
        >
          <span className="ai-assist-icon" aria-hidden="true">
            {item.icon}
          </span>
          <span className="ai-assist-text">
            <span className="ai-assist-name">{item.label}</span>
            <span className="ai-assist-desc">{item.desc}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

const iconProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export function IconAiSummarize(): React.JSX.Element {
  return (
    <svg width="22" height="22" {...iconProps} aria-hidden>
      <path d="M13.875 21H12H6.5C5.39543 21 4.5 20.1046 4.5 19V5C4.5 3.89543 5.39543 3 6.5 3H17.5C18.6046 3 19.5 3.89543 19.5 5V9V12V13" />
      <path d="M8.00001 7H16" />
      <path d="M8.00007 10.2032H14.0001" />
      <path d="M8.00007 13.4062H12.0001" />
      <path d="M17 14L17.2579 14.697C17.5961 15.611 17.7652 16.068 18.0986 16.4014C18.432 16.7348 18.889 16.9039 19.803 17.2421L20.5 17.5L19.803 17.7579C18.889 18.0961 18.432 18.2652 18.0986 18.5986C17.7652 18.932 17.5961 19.389 17.2579 20.303L17 21L16.7421 20.303C16.4039 19.389 16.2348 18.932 15.9014 18.5986C15.568 18.2652 15.111 18.0961 14.197 17.7579L13.5 17.5L14.197 17.2421C15.111 16.9039 15.568 16.7348 15.9014 16.4014C16.2348 16.068 16.4039 15.611 16.7421 14.697L17 14Z" />
    </svg>
  )
}

export function IconAiKeyPoints(): React.JSX.Element {
  return (
    <svg width="22" height="22" {...iconProps} aria-hidden>
      <path d="M9 6h11" />
      <path d="M9 12h11" />
      <path d="M9 18h11" />
      <path d="M4.5 6h.01" />
      <path d="M4.5 12h.01" />
      <path d="M4.5 18h.01" />
    </svg>
  )
}
