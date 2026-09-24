import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import {
  AiComposer,
  AiTypingIndicator,
  KbCitePreview,
  KbPickerButton,
  ModelPickerButton,
  kbRetrieve,
  kbStrings,
  renderCitationChips,
  useDismissablePopover,
  useKbSelection,
} from '@chatoffice/ui'
import attachIcon from '../assets/attach-icon.png'
import qrCodeIcon from '../assets/qrcode.png'
import wxpayIcon from '../assets/wxpay.png'
import type { AiModelSelection, AiSettingsV2, KbCitation } from '@chatoffice/ai-provider'
import { useI18n } from '../locale'
import { openPurchaseDialog } from '../PurchaseModal'
import { MonoFileIcon } from '../file-icons'
import { HomeChatController } from './controller'
import type { HomeChatControllerTexts } from './controller'
import { deriveTitle, useHomeChatStore } from './store'
import { markdownToHtml } from './mini-markdown'
import { sanitizeDocHtml } from './sanitize-html'
import { splitDocumentBody } from './doc-body'
import { TurnNavigator, deriveTurnNavEntries, toPlainText } from './TurnNavigator'
import { groupSessionsByTree, groupNameOf } from './tree-groups'
import { AssistantChip, AssistantPicker } from './AssistantPicker'
import { WelcomeLanding } from './WelcomeLanding'
import {
  findById,
  getDomainAssistants,
  type DocAssistant,
} from '../../../../../docs/src/renderer/ai/assistants'
import { createHomeChatBridge, refreshHomeModelCache } from './bridge'
import type {
  HomeChatAttachment,
  HomeChatCard,
  HomeChatMessage,
  HomeChatSession,
  HomeChatSessionScope,
  ProjectSummaryEntry,
} from '../../../shared/home-api'

/** the chat needs stream + session IPC; the web shim degrades both for now */
function chatSupported(): boolean {
  return (
    typeof window.chatOffice.aiStream === 'function' &&
    typeof window.chatOffice.chatSessionsSave === 'function'
  )
}

/** domino exit budget: last keyframe (greeting fade) lands at ~720ms; the
 * landing and footer unmount at this mark */
const EXIT_MS = 760

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

/** P2-7 确认门卡片:挂起中的大纲/计划请用户裁决;决议后原地留痕 */
function RelayConfirmCard({
  m,
  onConfirm,
}: {
  m: HomeChatMessage
  onConfirm?: (m: HomeChatMessage, approved: boolean, feedback?: string) => void
}): ReactElement | null {
  const { t } = useI18n()
  const c = m.relayConfirm
  const [feedback, setFeedback] = useState('')
  if (!c) return null
  const titleKey =
    c.kind === 'outline'
      ? 'chatConfirmOutline'
      : c.kind === 'plan'
        ? 'chatConfirmPlan'
        : 'chatConfirmOps'
  const decide = (approved: boolean) => {
    onConfirm?.(m, approved, feedback.trim() || undefined)
    setFeedback('')
  }
  return (
    <div className={`chat-confirm-card ${c.state}`}>
      <div className="chat-confirm-title">{t(titleKey)}</div>
      <div
        className="chat-confirm-payload"
        // payload is model-authored markdown; mini-markdown escapes raw HTML
        dangerouslySetInnerHTML={{ __html: markdownToHtml(c.payload) }}
      />
      {c.state === 'pending' ? (
        <>
          <input
            className="chat-confirm-feedback"
            placeholder={t('chatConfirmFeedback')}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <div className="chat-confirm-actions">
            <button className="btn btn-secondary" onClick={() => decide(false)}>
              {t('chatConfirmReject')}
            </button>
            <button className="btn chat-confirm-approve" onClick={() => decide(true)}>
              {t('chatConfirmApprove')}
            </button>
          </div>
        </>
      ) : (
        <div className={`chat-confirm-result ${c.state}`}>
          {c.state === 'approved'
            ? t('chatConfirmApproved')
            : c.state === 'rejected'
              ? t('chatConfirmRejected')
              : t('chatConfirmExpired')}
          {c.feedback ? <span className="chat-confirm-feedback echo">{c.feedback}</span> : null}
        </div>
      )}
    </div>
  )
}

/** ZCode 式任务清单:助手气泡右上角折叠框(update_task_list 全量快照) */
function TaskListPanel({ tasks }: { tasks: NonNullable<HomeChatMessage['tasks']> }): ReactElement {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const done = tasks.filter((x) => x.status === 'done').length
  return (
    <div className={`chat-tasks${open ? ' open' : ''}${done === tasks.length ? ' all-done' : ''}`}>
      <button
        className="chat-tasks-head"
        aria-expanded={open}
        aria-label={t('chatTasks')}
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M2.5 4h7M2.5 8h7M2.5 12h4M11.5 2.5v6M11.5 8.5l2 2 3-3"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
            transform="scale(0.95) translate(0.5,0)"
          />
        </svg>
        <span className="chat-tasks-label">{t('chatTasks')}</span>
        <span className="chat-tasks-progress">{`${done}/${tasks.length}`}</span>
        <span className="chat-tasks-chevron" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <ul className="chat-tasks-list">
          {tasks.map((task, i) => (
            <li key={i} className={`chat-task ${task.status}`}>
              <span className="chat-task-mark" aria-hidden>
                {task.status === 'done' ? (
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                    <rect
                      x="1.5"
                      y="1.5"
                      width="11"
                      height="11"
                      rx="3"
                      fill="currentColor"
                      opacity="0.9"
                    />
                    <path
                      d="M4.4 7.2l1.8 1.8 3.6-3.9"
                      stroke="var(--surface)"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : task.status === 'in_progress' ? (
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                    <rect
                      x="1.5"
                      y="1.5"
                      width="11"
                      height="11"
                      rx="3"
                      stroke="currentColor"
                      strokeWidth="1.3"
                    />
                    <circle cx="7" cy="7" r="2.2" fill="currentColor" className="chat-task-pulse" />
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                    <rect
                      x="1.5"
                      y="1.5"
                      width="11"
                      height="11"
                      rx="3"
                      stroke="currentColor"
                      strokeWidth="1.3"
                    />
                  </svg>
                )}
              </span>
              <span className="chat-task-title">{task.title}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** 文档正文折叠块:默认收起一行(字数随流式增长),展开渲染 sanitize 富文本预览 */
function DocBodyBlock({ html, streaming }: { html: string; streaming?: boolean }): ReactElement {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  return (
    <div className={`chat-doc-body${open ? ' open' : ''}${streaming ? ' streaming' : ''}`}>
      <button
        className="chat-doc-body-head"
        aria-expanded={open}
        aria-label={t('chatDocBody')}
        data-tip={t('chatDocPreview')}
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M9.5 1.5H4A1.5 1.5 0 0 0 2.5 3v10A1.5 1.5 0 0 0 4 14.5h8A1.5 1.5 0 0 0 13.5 13V5.5z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          <path d="M9.5 1.5V5.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          <path
            d="M5.5 8.5h5M5.5 11h3.5"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
        <span className="chat-doc-body-title">{t('chatDocBody')}</span>
        <span className="chat-doc-body-meta">{t('chatDocBodyCount', { n: html.length })}</span>
        <span className="chat-doc-body-chevron" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div
          className="chat-doc-body-preview chat-md"
          // display-only render: sanitizeDocHtml whitelists the doc-body subset;
          // the source here is the split-out restricted-HTML fragment itself
          dangerouslySetInnerHTML={{ __html: sanitizeDocHtml(html) }}
        />
      )}
    </div>
  )
}

/** 搜索命中的文件列表:一行一文件,点击经 openPath 在新标签页打开 */
function FoundFilesList({ files }: { files: Array<{ name: string; path: string }> }): ReactElement {
  const { t } = useI18n()
  return (
    <div className="chat-files" role="list" aria-label={t('chatFoundFiles')}>
      <div className="chat-files-title">
        {t('chatFoundFiles')} · {files.length}
      </div>
      {files.map((f) => (
        <button
          key={f.path}
          className="chat-file-row"
          role="listitem"
          title={f.path}
          aria-label={t('chatOpenFile')}
          onClick={() => void window.chatOffice.openPath(f.path, { dock: false })}
        >
          <MonoFileIcon ext={f.name.split('.').pop()?.toLowerCase() ?? ''} />
          <span className="chat-file-name">{f.name}</span>
        </button>
      ))}
    </div>
  )
}

function ChatMessageView({
  m,
  typing,
  onOpenSettings,
  onRelayConfirm,
  onOpenCitation,
}: {
  m: HomeChatMessage
  typing: boolean
  onOpenSettings: () => void
  /** P2-7 确认门:批准/驳回回调(无 dockRelay 的宿主不传) */
  onRelayConfirm?: (m: HomeChatMessage, approved: boolean, feedback?: string) => void
  /** KB 引用 chip 点击(无选库的宿主不传) */
  onOpenCitation?: (citation: KbCitation) => void
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
  // 文档正文(create_document 的受限 HTML)不进 markdown 渲染:拆出后折叠成
  // 一行,避免裸标签当文本显示成「乱码」;prose 部分照常 markdown
  const { prose, body } = m.error ? { prose: m.text, body: null } : splitDocumentBody(m.text)
  const foundFiles: Array<{ name: string; path: string }> = []
  const seenPaths = new Set<string>()
  for (const tool of m.relayTools ?? []) {
    for (const f of tool.files ?? []) {
      if (seenPaths.has(f.path)) continue
      seenPaths.add(f.path)
      foundFiles.push(f)
    }
  }
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
        {m.tasks && m.tasks.length > 0 && <TaskListPanel tasks={m.tasks} />}
        {m.relayTools && m.relayTools.length > 0 && (
          <div className="chat-relay-tools" role="list" aria-label={t('chatRelayTools')}>
            {m.relayTools.map((tool) => (
              <span
                key={tool.callId}
                className={`chat-tool-chip${tool.running ? ' running' : ''}${
                  tool.ok === false ? ' fail' : ''
                }`}
                role="listitem"
                title={tool.outputPreview || tool.name}
              >
                <span className="chat-tool-dot" aria-hidden="true" />
                <span className="chat-tool-name">{tool.name.replace(/_/g, ' ')}</span>
                {tool.image && (
                  <img
                    className="chat-tool-image"
                    src={tool.image}
                    alt={tool.summary || tool.name}
                  />
                )}
              </span>
            ))}
          </div>
        )}
        {foundFiles.length > 0 && <FoundFilesList files={foundFiles} />}
        {typing && !prose && !body ? (
          <AiTypingIndicator label={t('chatThinking')} />
        ) : prose && !m.error ? (
          <div
            className="chat-md"
            // display-only render: markdownToHtml escapes raw HTML; [n] chips
            // resolve against this turn's KB citations (final html only)
            dangerouslySetInnerHTML={{
              __html: renderCitationChips(markdownToHtml(prose), m.kbCitations),
            }}
            onClick={(e) => {
              const el = (e.target as HTMLElement).closest?.('.kb-cite') as HTMLElement | null
              if (!el) return
              const n = Number(el.dataset.kbN)
              const citation = m.kbCitations?.find((x) => x.n === n)
              if (citation) onOpenCitation?.(citation)
            }}
          />
        ) : null}
        {body && !m.error && <DocBodyBlock html={body} streaming={typing} />}
        {m.error && <div className="chat-err">{m.text}</div>}
        {m.relayConfirm && <RelayConfirmCard m={m} onConfirm={onRelayConfirm} />}
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
   *  returns true when the message was relayed (or queued) to the active dock */
  dockRelay?:
    | {
        trySend(sessionId: string, text: string): boolean
        stop(sessionId: string): void
        /** true when the session has an active dock: busy sends become queued */
        canQueue(sessionId: string): boolean
        confirm(sessionId: string, confirmId: string, approved: boolean, feedback?: string): void
        busySessions: Set<string>
        selectionHint?: string | undefined
        consumeSelection(): void
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

  // ── knowledge-base selection (composer, shared with editor panels) ──
  const { selected: kbSelected, toggle: kbToggle } = useKbSelection()
  const [kbCiteView, setKbCiteView] = useState<KbCitation | null>(null)
  const [kbNotice, setKbNotice] = useState<string | null>(null)
  useEffect(() => {
    if (!kbNotice) return
    const timer = window.setTimeout(() => setKbNotice(null), 5000)
    return () => window.clearTimeout(timer)
  }, [kbNotice])

  // ── composer mode + session-scoped model (ZCode-style) ──
  // drafts carry the choice before a session exists; an active session's
  // stored values are adopted on switch and every change is written back
  const [draftMode, setDraftMode] = useState<'default' | 'plan'>('default')
  const [draftModel, setDraftModel] = useState<AiModelSelection | null>(null)
  const [draftAssistant, setDraftAssistant] = useState<HomeChatSession['assistant'] | null>(null)
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
    setDraftAssistant(session?.assistant ?? null)
  }, [activeId])

  // ── assistant persona (session-scoped, from the 4.6k library) ──
  // full metadata (persona text + task template) per session; picked
  // assistants carry it immediately, restored sessions re-load it by id
  const personasRef = useRef<Map<string, { persona: string; template: string }>>(new Map())
  /** persona picked while sessionless (landing): carried into the session
   *  the next send creates */
  const draftPersonaRef = useRef<{ persona: string; template: string } | null>(null)
  const applyAssistant = (a: DocAssistant | null) => {
    setDraftAssistant(a ? { id: a.id, icon: a.icon, label: a.label } : null)
    const sid = storeRef.current?.activeId
    if (!sid) {
      draftPersonaRef.current = a
        ? { persona: a.systemPrompt, template: a.userPromptTemplate }
        : null
      return
    }
    storeRef.current?.updateSession(sid, (s) => {
      if (!a) {
        const { assistant: _drop, ...rest } = s
        return rest
      }
      return { ...s, assistant: { id: a.id, icon: a.icon, label: a.label } }
    })
    if (a) {
      personasRef.current.set(sid, { persona: a.systemPrompt, template: a.userPromptTemplate })
      controller.setAssistantPersona(sid, a.systemPrompt)
    } else {
      personasRef.current.delete(sid)
      controller.setAssistantPersona(sid, null)
    }
  }
  // re-hydrate a restored session's persona: the pack (one small chunk per
  // domain) loads on demand; until it arrives the chip shows from the
  // persisted identity, and sends fall back to no persona
  const draftAssistantId = draftAssistant?.id
  useEffect(() => {
    if (!activeId || !draftAssistantId) return
    if (personasRef.current.has(activeId)) return
    let alive = true
    const domain = draftAssistantId.split('.')[0] ?? ''
    void getDomainAssistants(domain)
      .then((list) => {
        if (!alive) return
        const full = findById(list, draftAssistantId)
        if (full) {
          personasRef.current.set(activeId, {
            persona: full.systemPrompt,
            template: full.userPromptTemplate,
          })
          controller.setAssistantPersona(activeId, full.systemPrompt)
        } else {
          // the assistant vanished from the library (packs regenerated):
          // drop the stale persona rather than silently running without it
          controller.setAssistantPersona(activeId, null)
        }
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [activeId, draftAssistantId, controller])

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
  /** 页脚二维码点击放大（对话栏内 absolute 遮罩，点任意处/Escape 关闭）：
   *  follow = 公众号单图；支持我们入口改为打开购买弹窗（openPurchaseDialog） */
  const [qrZoom, setQrZoom] = useState<'follow' | null>(null)
  useEffect(() => {
    if (!qrZoom) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setQrZoom(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [qrZoom])
  /** 页脚星标脉动记忆：点过一次后只保留静态按钮（可再点） */
  const [starDone, setStarDone] = useState(() => {
    try {
      return localStorage.getItem('chatoffice.welcomeStarDone') === '1'
    } catch {
      return false
    }
  })
  const goStar = () => {
    setStarDone(true)
    try {
      localStorage.setItem('chatoffice.welcomeStarDone', '1')
    } catch {
      // storage unavailable (private mode shim): the pulse simply stops for this run
    }
    void window.chatOffice.openGitHubRepo?.().catch(() => {})
  }
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
  /** 追加排队:停靠会话忙时 Enter 仍可发送(入队,忙→闲逐条投出) */
  const relayQueueable = !!(active && dockRelay?.canQueue(active.id))
  const hasMessages = (active?.messages.length ?? 0) > 0
  /** P2-6 圈选标注:当前会话激活 dock 报来的选区 */
  const selectionHint = active && dockRelay?.selectionHint ? dockRelay.selectionHint : null

  /** P2-7 确认门:决议经 dockRelay 发给文档 loop,卡片在 store 里原地留痕 */
  const handleRelayConfirm = useCallback(
    (m: HomeChatMessage, approved: boolean, feedback?: string) => {
      const sid = storeRef.current?.activeId
      if (!sid || !m.relayConfirm) return
      dockRelay?.confirm(sid, m.relayConfirm.confirmId, approved, feedback)
    },
    [dockRelay],
  )

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

  /** 一次性助手(用户裁定):发送即收起 chip——会话字段与草稿一并清掉;
   *  persona 由 controller 保管到本轮运行结束(中途清会让工具多轮掉出人设),
   *  结束时 finishOneShotPersona 落删。 */
  const clearAssistantAfterSend = (sessionId: string) => {
    setDraftAssistant(null)
    draftPersonaRef.current = null
    personasRef.current.delete(sessionId)
    storeRef.current?.updateSession(sessionId, (s) => {
      if (!s.assistant) return s
      const { assistant: _drop, ...rest } = s
      return rest
    })
  }

  const send = () => {
    const text = input.trim()
    if (!text && attachments.length === 0) return
    // P2-3 所见即所驱: an active dock takes the message (its loop replies
    // via the relay event stream; the assistant mirror arrives by event)
    if (store.active && text && dockRelay?.trySend(store.active.id, text)) {
      dockRelay.consumeSelection()
      const relaySession = store.active
      const now = Date.now()
      store.updateSession(relaySession.id, (s) => ({
        ...s,
        title: s.title || deriveTitle(text),
        messages: [
          ...s.messages,
          { id: crypto.randomUUID(), role: 'user', text, ts: now },
          { id: crypto.randomUUID(), role: 'assistant', text: '', ts: now },
        ],
      }))
      if (draftAssistant) clearAssistantAfterSend(relaySession.id)
      setInput('')
      setAttachments([])
      return
    }
    let session = store.active
    if (!session) {
      session = store.createSession(activeScope)
      // a fresh session inherits the composer's pending choices
      if (draftModel || draftMode !== 'default' || draftAssistant) {
        const modelId = draftModel
        const mode = draftMode
        const assistant = draftAssistant
        store.updateSession(session.id, (s) => ({
          ...s,
          ...(modelId ? { modelId } : {}),
          ...(mode === 'plan' ? { mode: 'plan' as const } : {}),
          ...(assistant ? { assistant } : {}),
        }))
      }
      if (draftAssistant && draftPersonaRef.current) {
        // the picked persona carries into the new session immediately
        personasRef.current.set(session.id, draftPersonaRef.current)
        controller.setAssistantPersona(session.id, draftPersonaRef.current.persona)
      }
    }
    const atts = attachments
    setInput('')
    setAttachments([])
    const personaInfo = personasRef.current.get(session.id)
    const dispatch = (kb?: { block: string; citations: KbCitation[] }) => {
      controller.send(session.id, session.messages, text, atts, {
        ...(draftModel ? { model: draftModel } : {}),
        ...(draftMode === 'plan' ? { mode: 'plan' as const } : {}),
        // presence (even without a hydrated template) marks the persona one-shot
        ...(draftAssistant ? { assistant: { template: personaInfo?.template } } : {}),
        ...(kb ? { kb } : {}),
      })
      // 新会话首条发送:controller 的 busy=true 回调跑在 setActiveId 重渲染
      // 之前,activeIdRef 还是旧值会被守卫吞掉——就地同步一次忙态,否则整轮
      // 无思考指示器、无停止按钮(输出区"毫无反应"的根因)
      setBusy(controller.isBusy(session.id))
      if (draftAssistant) clearAssistantAfterSend(session.id)
    }
    if (kbSelected.length > 0) {
      // KB 检索增强:检索失败降级为无知识库直答,一次性的顶部提示
      void kbRetrieve(kbSelected, text).then((result) => {
        if (!result) setKbNotice(t('kbUnavailableNotice'))
        dispatch(result ? { block: result.block, citations: result.citations } : undefined)
      })
    } else {
      dispatch()
    }
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

  // ── landing lifecycle (domino exit) ──
  // the first send flips hasMessages: the message list appears immediately
  // while the landing (and footer) play the exit choreography on top of it,
  // unmounting when it finishes — the animation never blocks the messages
  const [landingPhase, setLandingPhase] = useState<'steady' | 'out' | null>('steady')
  const prevHadMessages = useRef(hasMessages)
  useEffect(() => {
    if (hasMessages && !prevHadMessages.current) {
      prevHadMessages.current = true
      setLandingPhase('out')
      const timer = window.setTimeout(() => setLandingPhase(null), EXIT_MS)
      return () => window.clearTimeout(timer)
    }
    if (!hasMessages && prevHadMessages.current) {
      prevHadMessages.current = false
      setLandingPhase('steady')
    }
  }, [hasMessages])
  const showLanding = !hasMessages || landingPhase === 'out'

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
  // 窗口/分栏尺寸变化时,原本贴底的会话继续贴底(视口缩小不把新内容藏起来)
  useEffect(() => {
    if (!listEl) return
    const onResize = () => {
      if (stickRef.current) listEl.scrollTop = listEl.scrollHeight
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [listEl])

  // archived sessions live only in the left tree's archive view
  const sessions = (store.sessions ?? []).filter((s) => s.messages.length > 0 && !s.archived)

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
      {selectionHint && (
        <div className="chat-selection-hint">
          <span className="chat-selection-label">{t('chatSelectionContext')}</span>
          <span className="chat-selection-text">{selectionHint.slice(0, 80)}</span>
          <button
            className="chat-selection-clear"
            aria-label={t('cancel')}
            onClick={() => dockRelay?.consumeSelection()}
          >
            ×
          </button>
        </div>
      )}
      {draftAssistant && (
        <div className="chat-assistant-active">
          <AssistantChip
            icon={draftAssistant.icon}
            label={draftAssistant.label}
            onClear={() => applyAssistant(null)}
          />
        </div>
      )}
      {kbSelected.length > 0 && (
        <div className="chat-kb-row" role="list" aria-label={t('kbPickerLabel')}>
          {kbSelected.map((id) => (
            <span key={id} className="chat-kb-chip" role="listitem">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <ellipse
                  cx="8"
                  cy="3.6"
                  rx="5.2"
                  ry="1.9"
                  stroke="currentColor"
                  strokeWidth="1.3"
                />
                <path
                  d="M2.8 3.6v8.8c0 1.05 2.33 1.9 5.2 1.9s5.2-.85 5.2-1.9V3.6"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              </svg>
              <span className="chat-kb-chip-name">{id}</span>
              <button
                type="button"
                className="chat-kb-chip-x"
                aria-label={t('kbChipRemove')}
                onClick={() => kbToggle(id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {kbNotice && <div className="chat-kb-notice">{kbNotice}</div>}
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
        canSend={(input.trim().length > 0 || attachments.length > 0) && (!busy || relayQueueable)}
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
            <KbPickerButton lang={lang} selected={kbSelected} onToggle={kbToggle} />
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
            <AssistantPicker
              activeId={draftAssistant?.id ?? null}
              onPick={applyAssistant}
              onClear={() => applyAssistant(null)}
            />
          </>
        }
      />
      {kbCiteView && (
        <KbCitePreview citation={kbCiteView} lang={lang} onClose={() => setKbCiteView(null)} />
      )}
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
          <button
            className="chat-head-btn chat-head-icon primary"
            aria-label={t('chatNew')}
            title={t('chatNew')}
            onClick={newChat}
          >
            <svg width="16" height="16" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path
                d="M7 1v12M1 7h12"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <div className="chat-sessions-wrap" ref={menuWrapRef}>
            <button
              className="chat-head-btn chat-head-icon"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={t('chatHistory')}
              title={t('chatHistory')}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.3" />
                <path
                  d="M8 4.8V8l2.2 1.6"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              </svg>
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
        </div>
      </header>

      {hasMessages && (
        <div className="chat-msgs-wrap">
          <div className="chat-msgs" ref={listRefCb} onScroll={onListScroll}>
            {active!.messages.map((m, i) => (
              <ChatMessageView
                key={m.id}
                m={m}
                typing={busy && i === active!.messages.length - 1 && m.role === 'assistant'}
                onOpenSettings={onOpenSettings}
                onRelayConfirm={handleRelayConfirm}
                onOpenCitation={setKbCiteView}
              />
            ))}
          </div>
          <TurnNavigator entries={navEntries} listEl={listEl} />
        </div>
      )}
      {/* key on the active session: a fresh landing (new chat, switched-back
          empty session) remounts and replays the reverse-domino entrance */}
      {showLanding && (
        <WelcomeLanding
          key={active?.id ?? 'landing'}
          accountName={accountName}
          exiting={landingPhase === 'out'}
        />
      )}

      <div className={`chat-dock${hasMessages ? '' : ' landing'}`}>{renderComposer()}</div>

      {/* 企业信息页脚：仅欢迎屏（空会话）显示，开聊即隐。官网链接走
          openExternal IPC（https-only 校验在主进程） */}
      {showLanding && (
        <footer className={`chat-landing-footer${landingPhase === 'out' ? ' exiting' : ''}`}>
          <span className="chat-footer-text">
            {t('companyName')} © {new Date().getFullYear()}
            <span className="chat-footer-dot" aria-hidden="true">
              ·
            </span>
            <button
              className="chat-footer-link"
              onClick={() => void window.chatOffice.openExternal?.('https://aidooo.com')}
            >
              aidooo.com
            </button>
          </span>
          <button
            className="chat-footer-qr"
            aria-label={t('followUs')}
            data-tip={t('followUs')}
            onClick={() => setQrZoom('follow')}
          >
            <img src={qrCodeIcon} alt="" aria-hidden="true" />
          </button>
          <button
            className="chat-footer-qr"
            aria-label={t('supportUs')}
            data-tip={t('supportUs')}
            onClick={() => openPurchaseDialog()}
          >
            <img src={wxpayIcon} alt="" aria-hidden="true" />
          </button>
          <button
            className={`chat-footer-star${starDone ? '' : ' pulse'}`}
            aria-label={t('likeAria')}
            data-tip={t('goLike')}
            onClick={goStar}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.3l-5.8 3.1 1.1-6.5L2.6 9.3l6.5-.9L12 2.5z" />
            </svg>
            <span className="chat-footer-star-label">{t('goLike')}</span>
          </button>
        </footer>
      )}

      {/* 二维码放大层：absolute 罩在对话栏内（shell DOM 画在编辑器视图之下，
          不能 fixed 全窗，否则有停靠文档时被盖住），点任意处 / Escape 关闭 */}
      {qrZoom && (
        <div
          className="chat-qr-zoom"
          role="dialog"
          aria-label={t('followUs')}
          onClick={() => setQrZoom(null)}
        >
          <img src={qrCodeIcon} alt={t('followUs')} />
        </div>
      )}
    </main>
  )
}
