import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { AiComposer, ModelPickerButton, useDismissablePopover } from '@chatoffice/ui'
import attachIcon from '../assets/attach-icon.png'
import type { AiModelSelection, AiSettingsV2 } from '@chatoffice/ai-provider'
import { useI18n } from '../locale'
import type { StringKey } from '../locale'
import { HomeChatController } from './controller'
import type { HomeChatControllerTexts } from './controller'
import { deriveTitle, useHomeChatStore } from './store'
import { markdownToHtml } from './mini-markdown'
import { sanitizeDocHtml } from './sanitize-html'
import { TurnNavigator, deriveTurnNavEntries, toPlainText } from './TurnNavigator'
import { groupSessionsByTree, groupNameOf } from './tree-groups'
import { createHomeChatBridge, refreshHomeModelCache } from './bridge'
import type {
  HomeChatAttachment,
  HomeChatCard,
  HomeChatMessage,
  HomeChatSession,
  HomeChatSessionScope,
  ProjectSummaryEntry,
} from '../../../shared/home-api'

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

function chatTime(ts: number, dateLocale: string): string {
  const date = new Date(ts)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  return sameDay
    ? date.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(dateLocale, { month: 'short', day: 'numeric' })
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
      <div className="chat-msg user" data-mid={m.id}>
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
    <div className="chat-msg assistant" data-mid={m.id}>
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
        <div className="chat-msg-time">{chatTime(m.ts, dateLocale)}</div>
      </div>
    </div>
  )
}

export function ChatPanel({
  store,
  dockRelay,
  projectId,
  accountName,
  onOpenSettings,
  activeScope,
  openSignal,
  settingsRefreshNonce,
  projects,
}: {
  /** owned by Home so the left tree can read/drive the same sessions */
  store: ReturnType<typeof useHomeChatStore>
  /** P2-3 中继路由: present when this window has docked editors; trySend
   *  returns true when the message was relayed to the active dock's loop */
  dockRelay?:
    | {
        trySend(sessionId: string, text: string): boolean
        stop(sessionId: string): void
        busySessions: Set<string>
      }
    | undefined
  projectId: string | null
  accountName: string
  onOpenSettings: () => void
  /** scope new chats attach to when nothing else applies (the selected tree node) */
  activeScope?: HomeChatSessionScope
  /** the tree asks to open a session: nonce-bumped {sessionId} taps this effect */
  openSignal?: { sessionId: string; nonce: number } | null
  /** bumped by Home when the settings modal closes: re-read AiSettingsV2 */
  settingsRefreshNonce?: number
  /** known projects (for naming the history dropdown's tree groups) */
  projects?: ProjectSummaryEntry[]
}): ReactElement {
  const { t, lang, dateLocale } = useI18n()
  const supported = useMemo(chatSupported, [])

  // ── store (created by Home) + controller (created once) ──
  const storeRef = useRef<ReturnType<typeof useHomeChatStore> | null>(null)
  storeRef.current = store

  const activeIdRef = useRef<string | null>(null)
  activeIdRef.current = store.activeId
  const [busyState, setBusy] = useState(false)
  const projectIdRef = useRef(projectId)
  projectIdRef.current = projectId

  // texts read at send time, so a language switch applies without recreating agents
  const textsRef = useRef<HomeChatControllerTexts | null>(null)
  textsRef.current = {
    docBodyMissing: t('chatToolDocBodyMissing'),
    createFailed: (error) => t('chatToolCreateFailed', { e: error }),
    openFailed: (error) => t('chatToolOpenFailed', { e: error }),
    unsupportedHandoff: t('chatToolUnsupportedHandoff'),
    fileNotFound: t('chatToolFileNotFound'),
    unknownError: t('chatUnknownError'),
    docOpenedInTab: (title) => t('chatDocOpenedInTab', { title }),
  }
  // P1-7 项目中心模型: an unattached session's first created document lazily
  // creates a project named after the conversation and re-scopes the session,
  // so the document (and its first save) lands inside that project
  const ensureProjectRef = useRef<(title: string) => Promise<string | null>>(async () => null)
  ensureProjectRef.current = async (title) => {
    const existing = projectIdRef.current
    if (existing) return existing
    const api = window.chatOfficeProject
    if (!api?.createProject) return null
    const name = title.trim().slice(0, 40) || t('chatUnattached')
    const project = await api.createProject(name, undefined)
    if (!project?.id) return null
    const sid = activeIdRef.current
    if (sid) {
      storeRef.current?.updateSession(sid, (s) => ({
        ...s,
        scope: { kind: 'project', id: project.id },
      }))
    }
    projectIdRef.current = project.id
    return project.id
  }

  const controller = useMemo(
    () =>
      new HomeChatController(
        createHomeChatBridge(
          () => projectIdRef.current,
          (title) => ensureProjectRef.current(title),
        ),
        // stable facade: field reads delegate to the latest texts
        {
          get docBodyMissing() {
            return textsRef.current!.docBodyMissing
          },
          createFailed: (error) => textsRef.current!.createFailed(error),
          openFailed: (error) => textsRef.current!.openFailed(error),
          get unsupportedHandoff() {
            return textsRef.current!.unsupportedHandoff
          },
          get fileNotFound() {
            return textsRef.current!.fileNotFound
          },
          get unknownError() {
            return textsRef.current!.unknownError
          },
          docOpenedInTab: (title) => textsRef.current!.docOpenedInTab(title),
        },
        (id, mutate) => storeRef.current!.updateSession(id, mutate),
        undefined,
        (id, isBusy) => {
          if (id === activeIdRef.current) setBusy(isBusy)
        },
      ),
    [],
  )

  // refresh the model caches: mount, window focus (the settings modal close
  // path lives in Home and taps settingsRefreshNonce)
  const refreshAiSettings = useCallback(() => {
    window.chatOffice
      .getAiSettings()
      .then(setAiSettings)
      .catch(() => setAiSettings(null))
  }, [])
  useEffect(() => {
    void refreshHomeModelCache()
    refreshAiSettings()
    const onFocus = () => {
      void refreshHomeModelCache()
      refreshAiSettings()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshAiSettings])
  useEffect(() => {
    if (settingsRefreshNonce) refreshAiSettings()
  }, [settingsRefreshNonce, refreshAiSettings])

  // ── composer state ──
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<HomeChatAttachment[]>([])
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // ── composer mode + session-scoped model (ZCode-style) ──
  // drafts carry the choice before a session exists; an active session's
  // stored values are adopted on switch and every change is written back
  const [draftMode, setDraftMode] = useState<'default' | 'plan'>('default')
  const [draftModel, setDraftModel] = useState<AiModelSelection | null>(null)
  const [aiSettings, setAiSettings] = useState<AiSettingsV2 | null>(null)
  const [modeOpen, setModeOpen] = useState(false)
  const modeWrapRef = useRef<HTMLSpanElement>(null)
  useDismissablePopover(modeOpen, () => setModeOpen(false), {
    inside: () => [modeWrapRef.current],
  })

  const activeId = store.activeId
  useEffect(() => {
    const session = activeId ? storeRef.current?.sessions?.find((s) => s.id === activeId) : null
    setDraftMode(session?.mode ?? 'default')
    setDraftModel(session?.modelId ?? null)
  }, [activeId])

  const applyMode = (mode: 'default' | 'plan') => {
    setModeOpen(false)
    setDraftMode(mode)
    if (store.active) {
      store.updateSession(store.active.id, (s) => {
        // default drops the key so persisted JSON stays clean
        const { mode: _drop, ...rest } = s
        return mode === 'plan' ? { ...rest, mode } : rest
      })
    }
  }

  const applyModel = (selection: AiModelSelection) => {
    setDraftModel(selection)
    if (store.active) {
      store.updateSession(store.active.id, (s) => ({ ...s, modelId: selection }))
    }
  }

  // ── sessions dropdown ──
  const [menuOpen, setMenuOpen] = useState(false)
  const menuWrapRef = useRef<HTMLDivElement>(null)
  useDismissablePopover(menuOpen, () => setMenuOpen(false), {
    inside: () => [menuWrapRef.current],
  })
  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [menuOpen])

  const active = store.active
  const relayBusy = !!(active && dockRelay?.busySessions.has(active.id))
  const busy = busyState || relayBusy
  const hasMessages = (active?.messages.length ?? 0) > 0

  // the tree opened a session (task or file chat): sync busy and focus
  const openSignalNonce = openSignal?.nonce ?? 0
  useEffect(() => {
    if (!openSignal || openSignalNonce === 0) return
    setBusy(controller.isBusy(openSignal.sessionId))
    store.setActiveId(openSignal.sessionId)
    inputRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignalNonce])

  const openSession = (id: string) => {
    setMenuOpen(false)
    setBusy(controller.isBusy(id))
    store.setActiveId(id)
  }

  const newChat = () => {
    setMenuOpen(false)
    // an empty active session is reused instead of piling up blanks
    if (active && active.messages.length === 0) {
      inputRef.current?.focus()
      return
    }
    setBusy(false)
    store.createSession()
    inputRef.current?.focus()
  }

  const send = () => {
    const text = input.trim()
    if (!text && attachments.length === 0) return
    // P2-3 所见即所驱: an active dock takes the message (its loop replies
    // via the relay event stream; the assistant mirror arrives by event)
    if (store.active && text && dockRelay?.trySend(store.active.id, text)) {
      const relaySession = store.active
      store.updateSession(relaySession.id, (s) => ({
        ...s,
        title: s.title || deriveTitle(text),
        messages: [...s.messages, { id: crypto.randomUUID(), role: 'user', text, ts: Date.now() }],
      }))
      setInput('')
      setAttachments([])
      return
    }
    let session = store.active
    if (!session) {
      session = store.createSession(activeScope)
      // a fresh session inherits the composer's pending choices
      if (draftModel || draftMode !== 'default') {
        const modelId = draftModel
        const mode = draftMode
        store.updateSession(session.id, (s) => ({
          ...s,
          ...(modelId ? { modelId } : {}),
          ...(mode === 'plan' ? { mode: 'plan' as const } : {}),
        }))
      }
    }
    const atts = attachments
    setInput('')
    setAttachments([])
    controller.send(session.id, session.messages, text, atts, {
      ...(draftModel ? { model: draftModel } : {}),
      ...(draftMode === 'plan' ? { mode: 'plan' as const } : {}),
    })
  }

  const stop = () => {
    if (!active) return
    if (relayBusy) dockRelay?.stop(active.id)
    else controller.stop(active.id)
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
  const greeting = `${t(greetKey)}${accountName ? (cjk ? '，' : ', ') + accountName : ''}${cjk ? '。' : '. '}`

  // ── stick-to-bottom auto scroll ──
  const listRef = useRef<HTMLDivElement>(null)
  // TurnNavigator needs the element reactively (anchors + scroll driving)
  const [listEl, setListEl] = useState<HTMLDivElement | null>(null)
  const listRefCb = useCallback((el: HTMLDivElement | null) => {
    listRef.current = el
    setListEl(el)
  }, [])
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

  const sessions = (store.sessions ?? []).filter((s) => s.messages.length > 0)

  // history dropdown tree: project → file → unattached, groups collapsible
  const sessionGroups = useMemo(() => groupSessionsByTree(sessions), [sessions])
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  /** history-row preview: the first question, plain, ~2 lines */
  const sessionPreview = (s: HomeChatSession): string => {
    const first = s.messages.find((m) => m.role === 'user')
    if (!first) return ''
    const text = toPlainText(first.text)
    return text.length > 110 ? `${text.slice(0, 110)}…` : text
  }

  // tick rail data: one entry per user query, paired with its assistant reply
  const navEntries = useMemo(
    () => deriveTurnNavEntries(active?.messages ?? [], busy, t('chatNavUserFallback')),
    [active?.messages, busy, t],
  )

  const renderComposer = () => (
    <div className="chat-composer">
      <AiComposer
        value={input}
        busy={busy}
        header={
          attachments.length > 0 && (
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
          )
        }
        placeholder={t('chatPlaceholder')}
        sendLabel={t('chatSend')}
        stopLabel={t('chatStop')}
        canSend={(input.trim().length > 0 || attachments.length > 0) && !busy}
        iconOnly
        textareaRef={inputRef}
        onChange={setInput}
        onSend={send}
        onStop={stop}
        footerStart={
          <>
            <button
              className="ai-attach-btn"
              aria-label={t('chatAttach')}
              data-tip={t('chatAttach')}
              onClick={() => void pickAttachments()}
            >
              <img src={attachIcon} alt="" aria-hidden />
            </button>
            {aiSettings && (
              <span className="chat-model-slot">
                <ModelPickerButton
                  settings={draftModel ? { ...aiSettings, currentModel: draftModel } : aiSettings}
                  onPick={applyModel}
                  onOpenSettings={onOpenSettings}
                  lang={lang}
                />
              </span>
            )}
            <span className="chat-mode-wrap" ref={modeWrapRef}>
              <button
                className={`chat-tool-btn chat-mode-btn${draftMode === 'plan' ? ' active' : ''}`}
                aria-haspopup="menu"
                aria-expanded={modeOpen}
                aria-label={t('chatModeLabel')}
                data-tip={draftMode === 'plan' ? t('chatModePlanHint') : t('chatModeLabel')}
                onClick={() => setModeOpen((o) => !o)}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M2.5 4h8M2.5 8h5M2.5 12h8M13 6.5l1.8 1.8L11 12"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="chat-mode-value">
                  {draftMode === 'plan' ? t('chatModePlan') : t('chatModeDefault')}
                </span>
              </button>
              {modeOpen && (
                <div className="chat-mode-pop" role="menu">
                  <button
                    className={`chat-mode-item${draftMode === 'default' ? ' is-active' : ''}`}
                    role="menuitem"
                    data-mode="default"
                    onClick={() => applyMode('default')}
                  >
                    <span className="chat-mode-item-title">{t('chatModeDefault')}</span>
                    <span className="chat-mode-item-hint">{t('chatModeDefaultHint')}</span>
                  </button>
                  <button
                    className={`chat-mode-item${draftMode === 'plan' ? ' is-active' : ''}`}
                    role="menuitem"
                    data-mode="plan"
                    onClick={() => applyMode('plan')}
                  >
                    <span className="chat-mode-item-title">{t('chatModePlan')}</span>
                    <span className="chat-mode-item-hint">{t('chatModePlanHint')}</span>
                  </button>
                </div>
              )}
            </span>
          </>
        }
      />
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
      <header className="chat-head">
        <div className="chat-tabs" role="tablist" aria-label={t('chatTabList')}>
          {(store.sessions ?? []).map((s) => (
            <div
              key={s.id}
              role="tab"
              aria-selected={s.id === active?.id}
              className={`chat-tab${s.id === active?.id ? ' active' : ''}`}
              title={s.title || t('chatNew')}
              onClick={() => openSession(s.id)}
            >
              <span className="chat-tab-label">{s.title || t('chatNew')}</span>
              <button
                className="chat-tab-close"
                aria-label={t('chatDeleteSession')}
                title={t('chatDeleteSession')}
                onClick={(e) => {
                  e.stopPropagation()
                  store.removeSession(s.id)
                }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                  <path
                    d="M2 2l6 6M8 2l-6 6"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          ))}
        </div>
        <div className="chat-head-actions">
          <div className="chat-sessions-wrap" ref={menuWrapRef}>
            <button
              className="chat-head-btn"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.3" />
                <path
                  d="M8 4.8V8l2.2 1.6"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              </svg>
              {t('chatHistory')}
            </button>
            {menuOpen && (
              <div className="chat-sessions" role="menu">
                {sessionGroups.length === 0 ? (
                  <p className="chat-sessions-empty">{t('chatNoSessions')}</p>
                ) : (
                  sessionGroups.map((g) => {
                    const open = !collapsedGroups.has(g.key)
                    return (
                      <div key={g.key} className="chat-session-group">
                        <button
                          className={`chat-group-head${open ? ' is-open' : ''}`}
                          aria-expanded={open}
                          onClick={() => toggleGroup(g.key)}
                        >
                          <span className="chat-group-chev" aria-hidden>
                            ▾
                          </span>
                          {g.scope === null ? (
                            <svg
                              className="chat-group-icon"
                              width="12"
                              height="12"
                              viewBox="0 0 16 16"
                              fill="none"
                              aria-hidden="true"
                            >
                              <path
                                d="M14 2L7 9M14 2L9.5 14 7 9 2 6.5 14 2z"
                                stroke="currentColor"
                                strokeWidth="1.4"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          ) : g.scope.kind === 'project' ? (
                            <svg
                              className="chat-group-icon"
                              width="12"
                              height="12"
                              viewBox="0 0 16 16"
                              fill="none"
                              aria-hidden="true"
                            >
                              <path
                                d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3l1.5 2H13A1.5 1.5 0 0 1 14.5 6v6A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12V4z"
                                stroke="currentColor"
                                strokeWidth="1.2"
                                strokeLinejoin="round"
                              />
                            </svg>
                          ) : (
                            <svg
                              className="chat-group-icon"
                              width="12"
                              height="12"
                              viewBox="0 0 16 16"
                              fill="none"
                              aria-hidden="true"
                            >
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
                            </svg>
                          )}
                          <span className="chat-group-name">
                            {groupNameOf(g, projects ?? [], t('chatUnattached'))}
                          </span>
                          <span className="chat-group-count">{g.sessions.length}</span>
                        </button>
                        {open &&
                          g.sessions.map((s) => (
                            <div key={s.id} className="chat-session-row" role="none">
                              <button
                                className="chat-session-open"
                                role="menuitem"
                                onClick={() => openSession(s.id)}
                              >
                                <span className="chat-session-main">
                                  <span className="chat-session-title">
                                    {s.title || t('chatUntitled')}
                                  </span>
                                  <span className="chat-session-prev">{sessionPreview(s)}</span>
                                </span>
                                <span className="chat-session-time">
                                  {chatTime(s.updatedAt, dateLocale)}
                                </span>
                              </button>
                              <button
                                className="chat-session-del"
                                role="menuitem"
                                aria-label={t('chatDeleteSession')}
                                onClick={() => store.removeSession(s.id)}
                              >
                                <svg
                                  width="12"
                                  height="12"
                                  viewBox="0 0 16 16"
                                  fill="none"
                                  aria-hidden="true"
                                >
                                  <path
                                    d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1.5 1.5 0 0 0 1.5 1.4h3.6a1.5 1.5 0 0 0 1.5-1.4L12 4"
                                    stroke="currentColor"
                                    strokeWidth="1.2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              </button>
                            </div>
                          ))}
                      </div>
                    )
                  })
                )}
              </div>
            )}
          </div>
          <button className="chat-head-btn primary" onClick={newChat}>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path
                d="M7 1v12M1 7h12"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
            {t('chatNew')}
          </button>
        </div>
      </header>

      {hasMessages ? (
        <div className="chat-msgs-wrap">
          <div className="chat-msgs" ref={listRefCb} onScroll={onListScroll}>
            {active!.messages.map((m, i) => (
              <ChatMessageView
                key={m.id}
                m={m}
                typing={busy && i === active!.messages.length - 1 && m.role === 'assistant'}
                onOpenSettings={onOpenSettings}
              />
            ))}
          </div>
          <TurnNavigator entries={navEntries} listEl={listEl} />
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
