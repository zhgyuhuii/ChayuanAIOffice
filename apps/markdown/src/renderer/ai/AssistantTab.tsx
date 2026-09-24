/**
 * AssistantTab — the AI panel's 助手 tab: one-click actions as a list
 * (icon + name + description).
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

/** doc + sparkle / pen + sparkle / lines + sparkle, same glyphs as the docs ribbon */
export function AiFeatureIcon({ kind }: { kind: 'summarize' | 'polish' | 'tidy' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {kind === 'summarize' && (
        <>
          <path d="M13.875 21H6.5C5.39543 21 4.5 20.1046 4.5 19V5C4.5 3.89543 5.39543 3 6.5 3H17.5C18.6046 3 19.5 3.89543 19.5 5V13" />
          <path d="M8 7H16" />
          <path d="M8 10.2H14" />
          <path d="M8 13.4H12" />
        </>
      )}
      {kind === 'polish' && (
        <>
          <path d="M5.00012 20.7481L8.80319 20.7482L21.7482 7.80317L17.945 4L5 16.945L5.00012 20.7481Z" />
          <path d="M15.1406 6.80469L18.9438 10.6079" />
          <path d="M8 3L8.22106 3.59745C8.51094 4.38087 8.65589 4.77259 8.94166 5.05833C9.22743 5.34409 9.61914 5.48903 10.4026 5.77893L11 6L10.4026 6.22107C9.61914 6.51097 9.22743 6.65592 8.94166 6.94167C8.65589 7.22741 8.51094 7.61913 8.22106 8.40255L8 9L7.77894 8.40255C7.48906 7.61913 7.34411 7.22741 7.05834 6.94167C6.77257 6.65592 6.38086 6.51097 5.59743 6.22107L5 6L5.59743 5.77893C6.38086 5.48903 6.77257 5.34409 7.05834 5.05833C7.34411 4.77259 7.48906 4.38087 7.77894 3.59745L8 3Z" />
        </>
      )}
      {kind === 'tidy' && (
        <>
          <path d="M4 5H20" />
          <path d="M4 9H16" />
          <path d="M4 13H11" />
          <path d="M4 17H10" />
        </>
      )}
      {kind !== 'polish' && (
        <path d="M17 14L17.2579 14.697C17.5961 15.611 17.7652 16.068 18.0986 16.4014C18.432 16.7348 18.889 16.9039 19.803 17.2421L20.5 17.5L19.803 17.7579C18.889 18.0961 18.432 18.2652 18.0986 18.5986C17.7652 18.932 17.5961 19.389 17.2579 20.303L17 21L16.7421 20.303C16.4039 19.389 16.2348 18.932 15.9014 18.5986C15.568 18.2652 15.111 18.0961 14.197 17.7579L13.5 17.5L14.197 17.2421C15.111 16.9039 15.568 16.7348 15.9014 16.4014C16.2348 16.068 16.4039 15.611 16.7421 14.697L17 14Z" />
      )}
    </svg>
  )
}
