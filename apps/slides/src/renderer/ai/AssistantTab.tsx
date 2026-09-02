/**
 * AssistantTab — the AI panel's 助手 tab: one-click actions as a list
 * (icon + name + description).
 * Clicking an item sends its prompt immediately; the panel switches back to
 * the chat tab to follow the run (handled by the caller).
 */
import React from 'react'
import { IconAiAskSelection, IconAiBeautify, IconAiFactCheck, IconAiImage } from '../components/icons'

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

export { IconAiAskSelection, IconAiBeautify, IconAiFactCheck, IconAiImage }
