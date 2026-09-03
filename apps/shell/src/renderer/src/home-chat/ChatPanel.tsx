import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { useI18n } from '../locale'
import type { StringKey } from '../locale'
import { useHomeChat } from './context'
import { markdownToHtml } from './mini-markdown'
import { sanitizeDocHtml } from './sanitize-html'
import type { HomeChatAttachment, HomeChatCard, HomeChatMessage } from '../../../shared/home-api'

/** greeting sublines on the landing screen: one is picked at random on mount */
const GREET_ASK_KEYS = [
  'greetAsk1',
  'greetAsk2',
  'greetAsk3',
  'greetAsk4',
  'greetAsk5',
  'greetAsk6',
] as const satisfies readonly StringKey[]

/** the chat needs stream + session IPC; the web shim degrades both for now */
function chatSupported(): boolean {
  return (
    typeof window.chatOffice.aiStream === 'function' &&
    typeof window.chatOffice.chatSessionsSave === 'function'
  )
}

function AttachmentChip({
  att,
  onRemove,
  removeLabel,
}: {
  att: HomeChatAttachment
  onRemove?: () => void
  removeLabel: string
}): ReactElement {
  return (
    <span className="chat-att-chip">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M13.5 7.5l-5.2 5.2a3.5 3.5 0 0 1-5-5l5.6-5.6a2.33 2.33 0 0 1 3.3 3.3L6.6 11a1.17 1.17 0 0 1-1.65-1.65l4.8-4.8"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="chat-att-name">{att.name}</span>
      {onRemove && (
        <button className="chat-att-remove" aria-label={removeLabel} onClick={onRemove}>
          <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M3 3l6 6M9 3l-6 6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </span>
  )
}

/** side card under an assistant message (created/opened doc, setup hint) */
function ChatCard({
  card,
  onOpenSettings,
}: {
  card: HomeChatCard
  onOpenSettings: () => void
}): ReactElement | null {
  const { t } = useI18n()
  if (card.kind === 'setup-required') {
    return (
      <div className="chat-card setup">
        <div className="chat-card-title">{t('chatSetupRequired')}</div>
        <p className="chat-card-body">{t('chatSetupHint')}</p>
        <button className="btn btn-secondary" onClick={onOpenSettings}>
          {t('chatSetupOpen')}
        </button>
      </div>
    )
  }
  const created = card.kind === 'doc-created'
  return (
    <div className={`chat-card ${created ? 'created' : 'opened'}`}>
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        {created ? (
          <>
            <path
              d="M9.5 1.5H4A1.5 1.5 0 0 0 2.5 3v10A1.5 1.5 0 0 0 4 14.5h8A1.5 1.5 0 0 0 13.5 13V5.5z"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
            <path
              d="M9.5 1.5V5.5h4"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
          </>
        ) : (
          <path
            d="M6.5 3.5H4a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 4 13.5h7A1.5 1.5 0 0 0 12.5 12V9.5M9.5 2.5h4v4M13 3l-5.5 5.5"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
      <span className="chat-card-text">
        {created
          ? t('chatDocCreated', { name: card.title })
          : t('chatDocOpened', { name: card.title })}
      </span>
    </div>
  )
}

function ChatMessageView({
  m,
  typing,
  onOpenSettings,
}: {
  m: HomeChatMessage
  typing: boolean
  onOpenSettings: () => void
}): ReactElement {
  const { t, dateLocale } = useI18n()
  if (m.role === 'user') {
    return (
      <div className="chat-msg user">
        {m.attachments && m.attachments.length > 0 && (
          <div className="chat-atts">
            {m.attachments.map((a) => (
              <AttachmentChip key={a.path} att={a} removeLabel={t('chatRemoveAttachment')} />
            ))}
          </div>
        )}
        <div className="chat-bubble user">
          <span className="chat-text-pre">{m.text}</span>
        </div>
      </div>
    )
  }
  const isHtml = m.text.trimStart().startsWith('<')
  return (
    <div className="chat-msg assistant">
      <span className="chat-avatar" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path
            d="M8 1.8l1.55 4.65L14.2 8l-4.65 1.55L8 14.2 6.45 9.55 1.8 8l4.65-1.55z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <div className="chat-bubble assistant">
        {typing && !m.text ? (
          <span className="chat-typing" role="status" aria-label={t('chatThinking')}>
            <span />
            <span />
            <span />
          </span>
        ) : m.text && !m.error ? (
          <div
            className="chat-md"
            // display-only render: markdownToHtml escapes raw HTML and
            // sanitizeDocHtml whitelists the doc-body subset
            dangerouslySetInnerHTML={{
              __html: isHtml ? sanitizeDocHtml(m.text) : markdownToHtml(m.text),
            }}
          />
        ) : null}
        {m.error && <div className="chat-err">{m.text}</div>}
        {m.card && <ChatCard card={m.card} onOpenSettings={onOpenSettings} />}
        <div className="chat-msg-time">
          {new Date(m.ts).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  )
}

/** the conversation surface (no header — the top strip owns session meta) */
export function ChatPanel(): ReactElement {
  const { t, lang } = useI18n()
  const { store, controller, busy, openSettings, bindPendingProject } = useHomeChat()
  const supported = useMemo(chatSupported, [])
  const active = store.active
  const hasMessages = (active?.messages.length ?? 0) > 0

  // ── composer state ──
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<HomeChatAttachment[]>([])
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const send = () => {
    const text = input.trim()
    if (!text && attachments.length === 0) return
    let session = store.active
    if (!session) session = store.createSession()
    // 一键成文落项目: bind AI-created docx/md to the session's project
    if (session.projectId) bindPendingProject(session.projectId)
    const atts = attachments
    setInput('')
    setAttachments([])
    if (inputRef.current) inputRef.current.style.height = 'auto'
    controller.send(session.id, session.messages, text, atts)
  }

  const stop = () => {
    if (active) controller.stop(active.id)
  }

  const pickAttachments = async () => {
    try {
      const result = await window.chatOffice.pickAttachments?.()
      if (!result) return
      if (result.rejected.length > 0) window.alert(result.rejected.join('\n'))
      if (result.accepted.length > 0) {
        setAttachments((prev) => {
          const seen = new Set(prev.map((a) => a.path))
          return [...prev, ...result.accepted.filter((a) => !seen.has(a.path))]
        })
      }
    } catch {
      // picker unavailable (web shim) — leave the composer as-is
    }
  }

  const growInput = () => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }

  // ── greeting (landing screen) ──
  const [greetAskKey] = useState(
    () => GREET_ASK_KEYS[Math.floor(Math.random() * GREET_ASK_KEYS.length)]!,
  )
  const hour = new Date().getHours()
  const greetKey =
    hour < 6
      ? 'greetEvening'
      : hour < 12
        ? 'greetMorning'
        : hour < 18
          ? 'greetAfternoon'
          : 'greetEvening'
  const cjk = lang === 'zh' || lang === 'zh-TW' || lang === 'ja'
  const greeting = `${t(greetKey)}${cjk ? '。' : '. '}`

  // ── stick-to-bottom auto scroll ──
  const listRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const onListScroll = () => {
    const el = listRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }
  useLayoutEffect(() => {
    const el = listRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [active?.messages, busy])

  // md/pdf created by 一键成文 are written to disk immediately — move them into
  // the session's project once the created card reports a path
  const movedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const pid = active?.projectId
    if (!pid) return
    for (const m of active?.messages ?? []) {
      if (m.card?.kind === 'doc-created' && m.card.filePath && !movedRef.current.has(m.id)) {
        movedRef.current.add(m.id)
        void window.chatOfficeProject?.moveFile(m.card.filePath, pid).catch(() => {})
      }
    }
  }, [active?.messages, active?.projectId])

  const renderComposer = () => (
    <div className="chat-composer">
      {attachments.length > 0 && (
        <div className="chat-atts composer">
          {attachments.map((a) => (
            <AttachmentChip
              key={a.path}
              att={a}
              removeLabel={t('chatRemoveAttachment')}
              onRemove={() => setAttachments((prev) => prev.filter((x) => x.path !== a.path))}
            />
          ))}
        </div>
      )}
      <div className="chat-input-row">
        <button
          className="chat-tool-btn"
          aria-label={t('chatAttach')}
          data-tip={t('chatAttach')}
          onClick={() => void pickAttachments()}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M13.5 7.5l-5.2 5.2a3.5 3.5 0 0 1-5-5l5.6-5.6a2.33 2.33 0 0 1 3.3 3.3L6.6 11a1.17 1.17 0 0 1-1.65-1.65l4.8-4.8"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <textarea
          ref={inputRef}
          className="chat-input"
          rows={1}
          placeholder={t('chatPlaceholder')}
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            growInput()
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        {busy ? (
          <button
            className="chat-send-btn stop"
            aria-label={t('chatStop')}
            data-tip={t('chatStop')}
            onClick={stop}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <rect x="2.5" y="2.5" width="9" height="9" rx="2" fill="currentColor" />
            </svg>
          </button>
        ) : (
          <button
            className="chat-send-btn"
            aria-label={t('chatSend')}
            data-tip={t('chatSend')}
            disabled={!input.trim() && attachments.length === 0}
            onClick={send}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M14 2L7 9M14 2L9.5 14 7 9 2 6.5 14 2z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  )

  if (!supported) {
    return (
      <main className="chat-stage">
        <div className="chat-landing">
          <div className="chat-card setup center">
            <div className="chat-card-title">{t('chatSetupRequired')}</div>
            <p className="chat-card-body">{t('chatUnsupported')}</p>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="chat-stage">
      {hasMessages ? (
        <div className="chat-msgs" ref={listRef} onScroll={onListScroll}>
          {active!.messages.map((m, i) => (
            <ChatMessageView
              key={m.id}
              m={m}
              typing={busy && i === active!.messages.length - 1 && m.role === 'assistant'}
              onOpenSettings={openSettings}
            />
          ))}
        </div>
      ) : (
        <div className="chat-landing">
          <h1 className="chat-greet">
            {greeting}
            <span className="hero-ask">{t(greetAskKey)}</span>
          </h1>
        </div>
      )}

      <div className={`chat-dock${hasMessages ? '' : ' landing'}`}>{renderComposer()}</div>
    </main>
  )
}
