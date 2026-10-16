/**
 * AssistantTab — the AI panel's 助手 tab: one-click actions as a list
 * (icon + name + description).
 * Clicking an item sends its prompt immediately; the panel switches back to
 * the chat tab to follow the run (handled by the caller).
 */
import React from 'react'
import { AssistantLibraryBrowser } from '@chaoffice/ui/assistant-library'
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
  libraryApp,
  onRunPrompt,
}: {
  items: AssistantAction[]
  hidden?: boolean
  /** 助手库所在端(整体要求: 每类 ≥100 助手) */
  libraryApp?: 'sheets' | 'slides' | 'pdf' | 'markdown' | 'html'
  /** 库内助手点击 → 送入对话 */
  onRunPrompt?: (prompt: string) => void
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
      {libraryApp && onRunPrompt && (
        <div className="ai-assist-library-slot">
          <AssistantLibraryBrowser app={libraryApp} onRun={onRunPrompt} />
        </div>
      )}
    </div>
  )
}

export { IconAiAskSelection, IconAiBeautify, IconAiFactCheck, IconAiImage }
