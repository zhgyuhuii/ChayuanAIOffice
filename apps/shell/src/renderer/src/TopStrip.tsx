import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { useDismissablePopover } from '@chatoffice/ui'
import { useI18n } from './locale'
import { useHomeChat } from './home-chat/context'
import type { PaneMode } from './EditorPane'

/**
 * The narrow strip across the whole wide area (ZCode-style): the active
 * conversation's title + project on the left; the ⋯ session menu and the
 * utility icons (export-as-md / help / maximize / collapse file panel) on the
 * right. Sits above both the chat and the tabbed file panel.
 */
export function TopStrip({
  mode,
  onModeChange,
}: {
  mode: PaneMode
  onModeChange: (mode: PaneMode) => void
}): ReactElement {
  const { t } = useI18n()
  const { store, busy, newSession } = useHomeChat()
  const active = store.active

  const [projectNames, setProjectNames] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    void window.chatOfficeProject?.listProjects().then((ps) => {
      setProjectNames(new Map(ps.map((p) => [p.id, p.name])))
    })
  }, [])

  // ⋯ session menu
  const [menuOpen, setMenuOpen] = useState(false)
  const menuWrapRef = useRef<HTMLDivElement>(null)
  useDismissablePopover(menuOpen, () => setMenuOpen(false), {
    inside: () => [menuWrapRef.current],
  })

  const hasMessages = (active?.messages.length ?? 0) > 0
  const projectName = active?.projectId
    ? (projectNames.get(active.projectId) ?? t('chatUnassigned'))
    : null

  const transcriptMd = (): string => {
    const lines: string[] = [`# ${active?.title || t('chatUntitled')}`, '']
    for (const m of active?.messages ?? []) {
      lines.push(m.role === 'user' ? `**${t('chatSend')}:**` : '**AI:**')
      lines.push(m.text)
      lines.push('')
    }
    return lines.join('\n')
  }

  const exportMarkdown = () => {
    setMenuOpen(false)
    if (!active || active.messages.length === 0) return
    void window.chatOffice
      .createDocument({
        type: 'md',
        title: active.title.slice(0, 40) || t('chatUntitled'),
        content: transcriptMd(),
      })
      .catch(() => {})
  }

  const copySessionId = () => {
    setMenuOpen(false)
    if (active) void navigator.clipboard.writeText(active.id)
  }

  const copyTranscript = () => {
    setMenuOpen(false)
    if (active) void navigator.clipboard.writeText(transcriptMd())
  }

  const deleteSession = () => {
    setMenuOpen(false)
    if (!active) return
    if (busy) return
    if (window.confirm(t('chatDeleteSession') + '?')) store.removeSession(active.id)
  }

  const iconBtn = (
    label: string,
    onClick: () => void,
    svg: ReactElement,
    expanded?: boolean,
  ): ReactElement => (
    <button
      className="top-icon-btn"
      title={label}
      aria-label={label}
      aria-expanded={expanded}
      onClick={onClick}
    >
      {svg}
    </button>
  )

  const chevron = useMemo(
    () => (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d={mode === 'collapsed' ? 'M6 3.5L9.5 8 6 12.5' : 'M10 3.5L6.5 8 10 12.5'}
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
    [mode],
  )

  return (
    <header className="top-strip">
      <div className="top-strip-left">
        <span className="top-strip-title">{active?.title || t('chatUntitled')}</span>
        {projectName && <span className="chat-proj-chip">{projectName}</span>}
      </div>
      <div className="top-strip-actions">
        <div className="top-menu-wrap" ref={menuWrapRef}>
          <button
            className="top-icon-btn"
            aria-label={t('moreActions')}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="3.2" cy="8" r="1.4" fill="currentColor" />
              <circle cx="8" cy="8" r="1.4" fill="currentColor" />
              <circle cx="12.8" cy="8" r="1.4" fill="currentColor" />
            </svg>
          </button>
          {menuOpen && (
            <div className="row-menu top-menu" role="menu">
              <button
                role="menuitem"
                disabled={!hasMessages}
                onClick={() => {
                  setMenuOpen(false)
                  if (active) newSession(active.projectId ?? null)
                }}
              >
                {t('chatNew')}
              </button>
              <button role="menuitem" disabled={!hasMessages} onClick={exportMarkdown}>
                {t('topExportMd')}
              </button>
              <button role="menuitem" disabled={!hasMessages} onClick={copyTranscript}>
                {t('topCopyTranscript')}
              </button>
              <button role="menuitem" disabled={!hasMessages} onClick={copySessionId}>
                {t('topCopySessionId')}
              </button>
              <div className="row-menu-divider" />
              <button
                role="menuitem"
                className="danger"
                disabled={!hasMessages}
                onClick={deleteSession}
              >
                {t('chatDeleteSession')}
              </button>
            </div>
          )}
        </div>
        {iconBtn(
          t('topExportMd'),
          exportMarkdown,
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13h10"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>,
        )}
        {iconBtn(
          t('topHelp'),
          () => void window.chatOffice.openGitHubRepo?.(),
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.3" />
            <path
              d="M6.2 6.2A1.9 1.9 0 1 1 8 8.6v1M8 12.1h.01"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>,
        )}
        {mode === 'maximized'
          ? iconBtn(t('paneRestore'), () => onModeChange('split'), <RestoreSvg />)
          : iconBtn(t('paneMaximize'), () => onModeChange('maximized'), <MaxSvg />)}
        {iconBtn(
          mode === 'collapsed' ? t('paneExpand') : t('paneCollapse'),
          () => onModeChange(mode === 'collapsed' ? 'split' : 'collapsed'),
          chevron,
        )}
      </div>
    </header>
  )
}

function MaxSvg(): ReactElement {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect
        x="2.5"
        y="2.5"
        width="11"
        height="11"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  )
}

function RestoreSvg(): ReactElement {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M5.5 10.5v-6A1.5 1.5 0 0 1 7 3h4.5A1.5 1.5 0 0 1 13 4.5V9a1.5 1.5 0 0 1-1.5 1.5h-6z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M3 5.5v5A1.5 1.5 0 0 0 4.5 12h5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}
