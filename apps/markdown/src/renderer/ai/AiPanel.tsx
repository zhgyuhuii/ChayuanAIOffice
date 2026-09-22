import { useEffect, useRef, useState, lazy, Suspense } from 'react'
import { createMarkdownMediaSkill } from './media-skill'
import type { ReactElement, ReactNode } from 'react'
import { AgentLoop, composeSkills, streamText } from '@chatoffice/agent-core'
import type { AiSettingsV2 } from '@chatoffice/ai-provider'
import {
  AiComposer,
  AiTypingIndicator,
  Markdown,
  KbPickerButton,
  ModelPickerButton,
  useKbAugment,
  PanelTabs,
  usePanelTab,
  useAiConversations,
  AiConversationsEmpty,
  AiHistoryPopover,
  AiTabConfirm,
  AI_CONTINUE_INSTRUCTION,
  type AiActiveTab,
  AiScopeQuote,
  KbCitePreview,
  type AiScopeQuoteData,
  type KbCitation,
} from '@chatoffice/ui'
import { defaultSettingsV2, pickImageModel } from '@chatoffice/ai-provider/browser'
import { markdownModelBridge } from './model-bridge'
import type { DockChrome } from '@chatoffice/ui'
import type { Editor } from '@tiptap/core'
import { aiLangDirective, t as tGlobal, useI18n } from '../i18n/locale'
import { clearAiHighlights } from '../editor/aiHighlight'
import { setInactiveSelectionShown } from '../editor/inactiveSelection'
import { createMarkdownSkill, MARKDOWN_RULES } from './markdown-skill'
import {
  buildDocWriterRequest,
  countMarkdownBlocks,
  DOC_MAX_CHARS,
  extractMarkdown,
  type DocWriteResult,
  type DocWriteSpec,
} from './doc-writer'
import { createSearchSkill } from './search-skill'
import { createElectronTransport } from './transport'
import { EditQueueCard } from './EditQueueCard'
import {
  buildQueueInstruction,
  buildQueueSummary,
  liveItems,
  resolveQueue,
  type EditQueueItem,
} from './edit-queue'
import { DOC_NAV_SCHEME, navigateToBlock, parseDocNavHref } from './doc-nav'
import { AiFeatureIcon, AssistantTab } from './AssistantTab'

// 惰性加载:模型设置页(含厂商 logo 组)只在打开时拉取,不进启动图
const ModelSettingsPage = lazy(() =>
  import('@chatoffice/ui/ModelSettingsPage').then((m) => ({ default: m.ModelSettingsPage })),
)

// Word-parity count (docs word-count.ts): Asian chars one by one + non-Asian words
const ASIAN_RE =
  /[ᄀ-ᇿ⺀-⿟、-〿぀-ヿ㄀-ㄯ㄰-㆏㇀-ㇿ㐀-䶿一-鿿가-힯豈-﫿！-｠￠-￦]|[\uD840-\uD87F][\uDC00-\uDFFF]/g
const NON_ASIAN_WORD_RE = /[A-Za-z0-9À-ɏ]+(?:['-][A-Za-z0-9À-ɏ]+)*/g

function countWords(text: string): number {
  return (text.match(ASIAN_RE) ?? []).length + (text.match(NON_ASIAN_WORD_RE) ?? []).length
}

const MAX_SNAPSHOTS = 20
const TOOL_OUTPUT_MAX_CHARS = 2000
/** progress chip refresh while a write streams */
const CHIP_UPDATE_MS = 400

interface ToolActivity {
  name: string
  summary: string
  /** still executing: rendered as a spinner chip, replaced in place when the tool finishes */
  running?: boolean
  isError?: boolean
  output?: string
}

interface ChatEntry {
  role: 'user' | 'assistant'
  text: string
  /** LOCAL(2026-09-21, d8201ad0): D10 —— 恢复的被中断轮次(半截文本保留,渲染角标) */
  interrupted?: boolean
  /** model id that produced this assistant turn (display only) */
  model?: string
  streaming?: boolean
  isError?: boolean
  /** the run failed and this user message was rolled back out of the model context */
  undelivered?: boolean
  tools?: ToolActivity[]
  /** the selection this user message targeted, frozen at send */
  scope?: AiScopeQuoteData
  /** KB citations behind the [n] chips of this assistant turn */
  kbCitations?: KbCitation[]
}

/** longest selection excerpt echoed on a user bubble */
const SCOPE_TEXT_MAX = 200

/** structured, not the serialized file text: a body starting with `---` must
 *  never be re-parsed as a frontmatter block on rollback */
export interface DocSnapshot {
  /** document body as markdown */
  body: string
  /** raw frontmatter block (fences included), kept byte-for-byte */
  frontmatter: string
}

interface Snapshot {
  label: string
  time: string
  doc: DocSnapshot
}

/** Ribbon preset instruction; a new nonce triggers one auto-send */
export interface AiPreset {
  text: string
  nonce: number
}

export interface MarkdownAiDeps {
  getEditor(): Editor | null
  /** inner YAML of the properties block, read synchronously (write-then-read within one run) */
  getFrontmatter(): string
  /** replace the properties block; empty string removes it */
  setFrontmatter(inner: string): void
  /** document body + frontmatter, for pre-mutation snapshots */
  getSnapshot(): DocSnapshot
  /** rollback: replace the document (body and frontmatter) with a snapshot */
  restoreSnapshot(snapshot: DocSnapshot): void
  /** fired when a run with at least one mutation finishes (auto-save hook) */
  onRunDone(mutated: boolean): void
}

/** command handle the outer panel holds per conversation (plan §4.3) */
export interface MarkdownConversationHandle {
  stop(): Promise<void>
  send(text: string, displayText?: string): void
  /** busy 时落 composer,空闲直接发送(助手 tab 语义) */
  assist(text: string): void
  setDraft(text: string): void
}

function AiConversationBody({
  deps,
  filePath,
  preset,
  dockChrome,
  editQueue = [],
  onQueueEditInstruction,
  onQueueRemove,
  onQueueClear,
  onQueueFocus,
  onQueueConsume,
  conversation,
}: {
  deps: MarkdownAiDeps
  filePath: string | null
  preset?: AiPreset | null
  /** shared DockShell header chrome (drag-to-dock + layout buttons) */
  dockChrome?: DockChrome
  /** queued selection-scoped edits (owned by App, which also owns the anchors) */
  editQueue?: EditQueueItem[]
  onQueueEditInstruction?: (qid: string, instruction: string) => void
  onQueueRemove?: (qid: string) => void
  onQueueClear?: () => void
  onQueueFocus?: (qid: string) => void
  onQueueConsume?: (qids: string[]) => void
  /** LOCAL(2026-09-21, d8201ad0): 多会话——由外壳按会话实例化时传入(D9);tab 行/助手 tab 由外壳持有 */
  conversation?: {
    chatId: string
    projectId: string | null
    onRunningChange: (running: boolean) => void
    onFirstMessage: (text: string) => void
    onTurnEnd: () => void
    onRegister: (handle: MarkdownConversationHandle) => void
    onUnregister: () => void
  }
}): ReactElement {
  const { lang, t } = useI18n()
  // 知识库选库与发送前检索增强(共享选中态,与首页对话一致)
  const kb = useKbAugment()
  const [kbCiteView, setKbCiteView] = useState<KbCitation | null>(null)
  const aiTabs = [
    { id: 'chat', label: t('aiTabChat') },
    { id: 'assistant', label: t('aiTabAssistant') },
  ]
  // LOCAL(2026-09-21, d8201ad0): 会话实例下 tab 恒为对话(tabs 由外壳持有)
  const convMode = conversation !== undefined
  const [legacyTab, selectTab] = usePanelTab('aimarkdown.aiTab', aiTabs)
  const tab = convMode ? 'chat' : legacyTab
  const [chat, setChat] = useState<ChatEntry[]>([])
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  // bumped on selection/doc changes so the scope chip & queue rows stay fresh
  const [, setScopeTick] = useState(0)
  /** the scope chip's expandable preview of the selected text */
  const [scopePreviewOpen, setScopePreviewOpen] = useState(false)
  const chatRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stickToBottomRef = useRef(true)
  const mountedRef = useRef(true)

  const settingsRef = useRef<AiSettingsV2 | null>(null)
  /** ChatOffice login state for the generate_image gate (refreshed on mount and window focus) */
  const chatOfficeLoggedInRef = useRef(false)
  useEffect(() => {
    let alive = true
    const refresh = () => {
      void window.markdownApi
        .aiChatOfficeStatus?.()
        .then((s) => {
          if (alive) chatOfficeLoggedInRef.current = !!s?.loggedIn
        })
        .catch(() => {})
    }
    refresh()
    window.addEventListener('focus', refresh)
    return () => {
      alive = false
      window.removeEventListener('focus', refresh)
    }
  }, [])
  const [panelSettings, setPanelSettings] = useState<AiSettingsV2>(() => defaultSettingsV2())
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false)
  const refreshPanelSettings = async () => {
    try {
      setPanelSettings(await markdownModelBridge.getSettings())
    } catch {
      /* keep the last known settings */
    }
  }
  useEffect(() => {
    // 与 Home 同款重刷：sidecar 冷启动窗口期首拉可能失败（getSettings 拒绝
    // 时保持既有值），focus + 低频轮询保证服务就绪后自愈
    void refreshPanelSettings()
    window.addEventListener('focus', refreshPanelSettings)
    const timer = window.setInterval(() => void refreshPanelSettings(), 15000)
    return () => {
      window.removeEventListener('focus', refreshPanelSettings)
      window.clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const langRef = useRef(lang)
  langRef.current = lang
  const depsRef = useRef(deps)
  depsRef.current = deps
  const filePathRef = useRef(filePath)
  /** instruction of the in-flight run, labels its rollback snapshot */
  const runInstructionRef = useRef('')
  /** what the user saw for that instruction (queue submissions show a summary) */
  const runDisplayRef = useRef('')
  /** the scope quote of the last send, so a retry reuses it instead of re-reading the live selection */
  const lastScopeRef = useRef<AiScopeQuoteData | undefined>(undefined)
  const runMutatedRef = useRef(false)
  /** tool activity of the whole run, for transcript persistence */
  const runToolsRef = useRef<ToolActivity[]>([])
  const chatIdsRef = useRef<{ projectId: string; chatId: string } | null>(null)
  /** messages sent before resolveChat returned, flushed once the chat id is known */
  const pendingPersistRef = useRef<
    Array<{
      role: 'user' | 'assistant'
      text: string
      tools?: ToolActivity[]
      scope?: AiScopeQuoteData
    }>
  >([])

  const patchLast = (patch: Partial<ChatEntry> | ((last: ChatEntry) => Partial<ChatEntry>)) => {
    setChat((prev) => {
      const next = [...prev]
      const last = next[next.length - 1]
      if (!last || last.role !== 'assistant') return prev
      next[next.length - 1] = { ...last, ...(typeof patch === 'function' ? patch(last) : patch) }
      return next
    })
  }

  const persistMessage = (
    role: 'user' | 'assistant',
    text: string,
    tools?: ToolActivity[],
    scope?: AiScopeQuoteData,
    interrupted?: boolean,
  ) => {
    // LOCAL(2026-09-21, d8201ad0): 会话实例持久化走 conversation.chatId(immutable);
    // 单会话旧路径(独立使用)保留 resolveChat 的 ids
    const ids = conversation
      ? { projectId: conversation.projectId, chatId: conversation.chatId }
      : chatIdsRef.current
    if (!window.projectApi) return
    if (!ids || !ids.projectId) {
      if (!conversation) pendingPersistRef.current.push({ role, text, tools, scope })
      return
    }
    void window.projectApi
      .appendChat({
        projectId: ids.projectId,
        chatId: ids.chatId,
        role,
        text,
        ...(interrupted ? { interrupted: true } : {}),
        ...(tools && tools.length > 0 ? { tools } : {}),
        ...(scope ? { scope } : {}),
      })
      .catch(() => {
        /* persistence failures are silent */
      })
  }

  const transportRef = useRef<ReturnType<typeof createElectronTransport> | null>(null)
  if (!transportRef.current)
    // the request carries only the selection; the owning main process resolves profile + secret
    transportRef.current = createElectronTransport(() => settingsRef.current!.currentModel!)

  /** a streamed write stopped early: the draft stays in the document until the user keeps or discards it */
  const [activePartial, setActivePartial] = useState<{ blocks: number } | null>(null)
  const partialResolverRef = useRef<((keep: boolean) => void) | null>(null)
  /** bumped by unmount: a writer resuming after its abort must not open the keep card */
  const writerEpochRef = useRef(0)
  const decidePartial = (keep: boolean): void => {
    partialResolverRef.current?.(keep)
    partialResolverRef.current = null
    setActivePartial(null)
  }
  /**
   * Long-form writing (§4.5:markdown 助手体不使用 writer → 实例私有,随会话卸载清理):
   * one tool-less request whose reply is the markdown, streamed into the document
   * as a draft by the tool.
   */
  const runDocWriter = async (
    spec: DocWriteSpec,
    onProgress: (markdown: string) => void,
    signal?: AbortSignal,
  ): Promise<DocWriteResult> => {
    const { system, user } = buildDocWriterRequest(
      spec,
      MARKDOWN_RULES,
      aiLangDirective(langRef.current),
    )
    const epoch = writerEpochRef.current
    let closed = false
    let chipTimer: ReturnType<typeof setTimeout> | null = null
    let latest = ''
    const updateChip = () => {
      chipTimer = null
      if (closed) return
      const blocks = countMarkdownBlocks(latest)
      patchLast((last) => ({
        tools: last.tools?.map((tl) =>
          tl.running ? { ...tl, summary: tGlobal('aiWritingDocument', { blocks }) } : tl,
        ),
      }))
    }
    const attempt = () =>
      streamText({
        transport: transportRef.current!,
        system,
        user,
        signal,
        maxChars: DOC_MAX_CHARS,
        extract: (raw) => ({ text: extractMarkdown(raw) }),
        onProgress: (markdown) => {
          if (closed) return
          latest = markdown
          onProgress(markdown)
          if (chipTimer === null) chipTimer = setTimeout(updateChip, CHIP_UPDATE_MS)
        },
      })
    let outcome = await attempt()
    if (outcome.status === 'empty' && !signal?.aborted) outcome = await attempt()
    closed = true
    if (chipTimer !== null) clearTimeout(chipTimer)
    if (outcome.status === 'complete') return { ok: true, markdown: outcome.text }
    if (outcome.status === 'empty') return { ok: false, error: outcome.error }
    if (epoch !== writerEpochRef.current) return { ok: false, error: 'the chat was reset' }
    const keep = await new Promise<boolean>((resolve) => {
      partialResolverRef.current = resolve
      setActivePartial({ blocks: countMarkdownBlocks(outcome.text) })
    })
    return keep
      ? { ok: true, markdown: outcome.text, truncated: true }
      : {
          ok: false,
          error: `${outcome.reason}${outcome.error ? `: ${outcome.error}` : ''}; the user discarded the partial content`,
        }
  }
  const runDocWriterRef = useRef(runDocWriter)
  runDocWriterRef.current = runDocWriter

  /** New chat / unmount: discard an open keep card and keep a still-settling writer from opening one */
  useEffect(
    () => () => {
      writerEpochRef.current++
    },
    [],
  )

  // The loop is built once; every mutable value goes through a ref getter
  const loopRef = useRef<AgentLoop<DocSnapshot> | null>(null)
  /** messages buffered for the lazy loop (D10/D11 hard chain) */
  const bufferedRestoreRef = useRef<Array<{ role: 'user' | 'assistant'; text: string }> | null>(null)
  /** the loop's streamed text so far — the interrupted persist keeps this half turn (D10) */
  const halfTextRef = useRef('')
  /** LOCAL(2026-09-21, d8201ad0): loop 惰性构造(首次 send 才建) */
  const ensureLoop = (): AgentLoop<DocSnapshot> | null => {
    if (loopRef.current) return loopRef.current
    if (convMode && !conversation) return null
    loopRef.current = new AgentLoop<DocSnapshot>({
      // the request carries only the selection; the owning main process resolves profile + secret
      transport: createElectronTransport(() => settingsRef.current!.currentModel!),
      skill: composeSkills('markdown+search', '', [
        createMarkdownMediaSkill(),
        createMarkdownSkill(
          () => depsRef.current.getEditor(),
          {
            read: () => depsRef.current.getFrontmatter(),
            write: (inner) => depsRef.current.setFrontmatter(inner),
          },
          // 生图能力跟全局默认走:设置里能解析出生图模型即启用(登录态无关)
          () => !!pickImageModel(settingsRef.current ?? defaultSettingsV2()),
          () => ({
            write: (spec, onProgress, signal) => runDocWriterRef.current(spec, onProgress, signal),
          }),
        ),
        createSearchSkill(),
      ]),
      captureSnapshot: () => depsRef.current.getSnapshot(),
      systemSuffix: () => aiLangDirective(langRef.current),
      events: {
        onText: (text) => {
          if (text) halfTextRef.current = text
          patchLast({ text })
        },
        onToolStart: (call) => {
          // Live "running" chip: replaced in place by onToolExecuted
          patchLast((last) => ({
            tools: [
              ...(last.tools ?? []),
              { name: call.name, summary: call.name.replace(/[_-]+/g, ' '), running: true },
            ],
          }))
        },
        onToolExecuted: ({ call, execution, snapshotBefore }) => {
          if (execution.mutated) runMutatedRef.current = true
          if (snapshotBefore !== undefined) {
            const label = runInstructionRef.current.slice(0, 40)
            const time = new Date().toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })
            setSnapshots((prev) =>
              [...prev, { label, time, doc: snapshotBefore }].slice(-MAX_SNAPSHOTS),
            )
          }
          const activity: ToolActivity = {
            name: call.name,
            summary: execution.summary,
            isError: execution.isError,
            output: execution.output?.slice(0, TOOL_OUTPUT_MAX_CHARS),
          }
          runToolsRef.current.push(activity)
          patchLast((last) => {
            // Swap out the running placeholder pushed by onToolStart (parse-fail calls have none)
            const tools = [...(last.tools ?? [])]
            if (tools.at(-1)?.running) tools.pop()
            return { tools: [...tools, activity] }
          })
        },
        onTurnEnd: () => {
          patchLast({ streaming: false })
          setChat((prev) => [...prev, { role: 'assistant', text: '', streaming: true }])
        },
        onDone: ({ text, cancelled, turnLimit, truncated }) => {
          const base = turnLimit
            ? [text, tGlobal('aiTurnLimit')].filter(Boolean).join('\n\n')
            : text || (cancelled ? tGlobal('aiStopped') : '')
          // A reasoning model can spend the entire output budget on thinking and close the
          // turn with finish_reason=length and no prose at all — the bare "(no reply)" read
          // as the assistant ignoring the user. Name the truncation, as docs already does.
          const final = truncated
            ? [base, tGlobal('aiTruncatedNote')].filter(Boolean).join('\n\n')
            : base
          patchLast((last) => ({
            streaming: false,
            text: final || (last.tools?.length ? last.text : tGlobal('aiNoReply')),
            // A stop mid-tool can leave a running placeholder behind — drop it
            tools: last.tools?.filter((tl) => !tl.running),
          }))
          persistMessage('assistant', final, runToolsRef.current)
          // LOCAL(2026-09-21, d8201ad0): D10 —— 取消的轮次照常落盘(半截文本+工具活动)
          if (cancelled) {
            const half = halfTextRef.current
            if ((half && half.trim()) || runToolsRef.current.length > 0) {
              persistMessage('assistant', half, runToolsRef.current, undefined, true)
            }
          }
          if (conversation) conversation.onTurnEnd()
          const editor = depsRef.current.getEditor()
          if (editor) clearAiHighlights(editor)
          depsRef.current.onRunDone(runMutatedRef.current)
          setBusy(false)
        },
        onError: (error) => {
          setChat((prev) => {
            const next = [...prev]
            for (let i = next.length - 1; i >= 0; i--) {
              const entry = next[i]!
              if (entry.role === 'user') {
                next[i] = { ...entry, undelivered: true }
                break
              }
            }
            const last = next.at(-1)
            if (last?.role === 'assistant') {
              next[next.length - 1] = {
                ...last,
                streaming: false,
                text: error,
                isError: true,
                tools: last.tools?.filter((tl) => !tl.running),
              }
            }
            return next
          })
          setBusy(false)
        },
      },
    })
    const built = loopRef.current
    if (built && bufferedRestoreRef.current && bufferedRestoreRef.current.length > 0) {
      built.restore(bufferedRestoreRef.current)
      bufferedRestoreRef.current = null
    }
    return loopRef.current
  }
  const patchLastRef = useRef(patchLast)
  patchLastRef.current = patchLast

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      partialResolverRef.current?.(false)
      loopRef.current?.cancel()
      const editor = depsRef.current.getEditor()
      if (editor) clearAiHighlights(editor)
    }
  }, [])

  // ── chat-history persistence: bind to the file, restore prior transcript ──
  // LOCAL(2026-09-21, d8201ad0): 会话实例 loadChat limit 10_000 全量装载(D11)→
  // 缓冲 → 首次 send 建 loop 时 restore 灌回(D10)
  const historyLoadedRef = useRef(false)
  useEffect(() => {
    const api = window.projectApi
    if (!api) return
    if (conversation) {
      if (!conversation.projectId) return
      let disposed = false
      void api
        .loadChat({
          projectId: conversation.projectId,
          chatId: conversation.chatId,
          limit: 10_000,
        })
        .then((msgs) => {
          if (disposed || msgs.length === 0) return
          if (historyLoadedRef.current) return
          historyLoadedRef.current = true
          setChat(
            msgs.map((m) => ({
              role: m.role,
              text: m.text,
              interrupted: m.interrupted === true,
              tools: m.tools?.map((tool) => ({
                name: tool.name,
                summary: tool.summary,
                isError: tool.isError,
                output: tool.output ? tool.output.slice(0, TOOL_OUTPUT_MAX_CHARS) : undefined,
              })),
              ...(m.scope ? { scope: m.scope } : {}),
            })),
          )
          bufferedRestoreRef.current = msgs.map((m) => ({ role: m.role, text: m.text }))
          const firstUser = msgs.find((m) => m.role === 'user')
          if (firstUser) conversation.onFirstMessage(firstUser.text)
        })
        .catch(() => {
          /* history load failures are silent */
        })
      return () => {
        disposed = true
      }
    }
    const tempChatId = `unsaved-${Date.now()}`
    void api
      .resolveChat({ filePath: filePathRef.current ?? null, tempChatId })
      .then((ids) => {
        chatIdsRef.current = ids
        for (const msg of pendingPersistRef.current.splice(0)) {
          persistMessage(msg.role, msg.text, msg.tools, msg.scope)
        }
        return api.loadChat({ projectId: ids.projectId, chatId: ids.chatId, limit: 200 })
      })
      .then((msgs) => {
        if (msgs.length === 0) return
        // the user may have sent a message while history was loading — never
        // replace a live transcript (and don't clobber the loop context)
        let applied = false
        setChat((prev) => {
          if (prev.length > 0) return prev
          applied = true
          return msgs.map((m) => ({
            role: m.role,
            text: m.text,
            tools: m.tools?.map((tool) => ({
              name: tool.name,
              summary: tool.summary,
              isError: tool.isError,
              output: tool.output ? tool.output.slice(0, TOOL_OUTPUT_MAX_CHARS) : undefined,
            })),
            ...(m.scope ? { scope: m.scope } : {}),
          }))
        })
        if (applied && !loopRef.current?.busy) {
          loopRef.current?.restore(msgs.map((m) => ({ role: m.role, text: m.text })))
        }
      })
      .catch(() => {
        /* history load failures are silent */
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation?.projectId, conversation?.chatId])

  /** after an untitled document's first save, bind the unsaved-* history to the real path */
  useEffect(() => {
    filePathRef.current = filePath
    if (conversation) return
    const ids = chatIdsRef.current
    if (!window.projectApi || !ids || !filePath || !ids.chatId.startsWith('unsaved-')) return
    void window.projectApi
      .rebindChat({ projectId: ids.projectId, tempChatId: ids.chatId, newFilePath: filePath })
      .then((r) => {
        if (r?.chatId) chatIdsRef.current = r
      })
      .catch(() => {
        /* silent */
      })
  }, [filePath])

  useEffect(() => {
    if (stickToBottomRef.current) {
      chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight })
    }
  }, [chat, busy])

  const onChatScroll = (): void => {
    const el = chatRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }

  /** retryScope: null = a retry that had no scope; undefined = capture the live selection */
  const send = (text: string, displayText?: string, retryScope?: AiScopeQuoteData | null): void => {
    const instruction = text.trim()
    const loop = ensureLoop()
    if (!instruction || !loop || loop.busy) return
    stickToBottomRef.current = true
    runInstructionRef.current = instruction
    runDisplayRef.current = displayText ?? instruction
    runMutatedRef.current = false
    runToolsRef.current = []
    // a queue batch carries its own display text: no selection quote
    const scope =
      retryScope !== undefined
        ? (retryScope ?? undefined)
        : displayText === undefined
          ? selectionScopeQuote()
          : undefined
    lastScopeRef.current = scope
    // the popover input / composer own the DOM selection now: keep the targeted range visible until the run ends
    if (scope) setInactiveSelectionShown(depsRef.current.getEditor(), true)
    setChat((prev) => [
      ...prev,
      { role: 'user', text: displayText ?? instruction },
      { role: 'assistant', text: '', streaming: true, model: panelSettings.currentModel?.modelId },
    ])
    setPrompt('')
    setBusy(true)
    if (conversation) conversation.onFirstMessage(displayText ?? instruction)
    // persist what the user saw — a restored transcript must not surface the
    // internal batch protocol text behind a queue submission
    persistMessage('user', displayText ?? instruction, undefined, scope)
    void (async () => {
      try {
        settingsRef.current = await window.markdownApi.getAiSettings()
        if (!mountedRef.current) return
        const kbInstruction = await kb.augment(instruction)
        if (kb.lastCitations.current.length > 0)
          patchLast({ kbCitations: kb.lastCitations.current })
        await loop.run(kbInstruction)
      } catch (err) {
        if (!mountedRef.current) return
        patchLast({
          streaming: false,
          text: err instanceof Error ? err.message : String(err),
          isError: true,
        })
        setBusy(false)
      }
    })()
  }

  const stop = (): void => loopRef.current?.cancel()

  const busyRef = useRef(false)
  const idleWaitersRef = useRef<Array<() => void>>([])
  useEffect(() => {
    busyRef.current = busy
    if (conversation) conversation.onRunningChange(busy)
    if (!busy) {
      const waiters = idleWaitersRef.current
      idleWaitersRef.current = []
      for (const w of waiters) w()
    }
  }, [busy, conversation])

  // LOCAL(2026-09-21, d8201ad0): stop-then-close(D5/D10)——resolve 于 interrupted 落盘发起之后
  const stopConversation = async (): Promise<void> => {
    loopRef.current?.cancel()
    if (!busyRef.current) return
    await new Promise<void>((resolve) => idleWaitersRef.current.push(resolve))
  }
  const stopRef = useRef(stopConversation)
  stopRef.current = stopConversation

  const sendRef = useRef(send)
  sendRef.current = send
  const mdHandleRef = useRef<MarkdownConversationHandle | null>(null)
  if (!mdHandleRef.current) {
    mdHandleRef.current = {
      stop: () => stopRef.current(),
      send: (text, displayText) => sendRef.current(text, displayText),
      assist: (text) => {
        if (loopRef.current?.busy) setPrompt(text)
        else sendRef.current(text)
      },
      setDraft: (text) => {
        setPrompt(text)
        window.setTimeout(() => inputRef.current?.focus(), 0)
      },
    }
  }
  useEffect(() => {
    if (!conversation) return
    conversation.onRegister(mdHandleRef.current!)
    return () => conversation.onUnregister()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const retry = (): void =>
    send(runInstructionRef.current, runDisplayRef.current, lastScopeRef.current ?? null)

  // LOCAL(2026-09-21, d8201ad0): D10 续作入口(半截轮次恢复后「继续」)
  const continueRun = (): void => send(AI_CONTINUE_INSTRUCTION)

  // keep the scope chip & queue rows in sync with the editor selection/content
  useEffect(() => {
    const editor = depsRef.current.getEditor()
    if (!editor) return
    const bump = () => {
      if (editor.state.selection.empty) setScopePreviewOpen(false)
      setScopeTick((tick) => tick + 1)
    }
    editor.on('selectionUpdate', bump)
    editor.on('update', bump)
    return () => {
      editor.off('selectionUpdate', bump)
      editor.off('update', bump)
    }
  }, [])

  // scope chip data, recomputed per render (the scope tick above keeps it fresh)
  const editor = depsRef.current.getEditor()
  const liveSelection = editor?.state.selection
  const selectionText =
    !editor || !liveSelection || liveSelection.empty
      ? ''
      : editor.state.doc.textBetween(liveSelection.from, liveSelection.to, '\n', ' ').trim()
  const hasScopeSelection = selectionText.length > 0

  /** the × on the scope chip: collapse the selection so the run targets the whole document */
  const clearScopeSelection = (): void => {
    if (editor) editor.commands.setTextSelection(editor.state.selection.to)
  }

  const selectionScopeQuote = (): AiScopeQuoteData | undefined => {
    const ed = depsRef.current.getEditor()
    if (!ed || ed.state.selection.empty) return undefined
    const { from, to } = ed.state.selection
    const text = ed.state.doc.textBetween(from, to, ' ', ' ').replace(/\s+/g, ' ').trim()
    if (!text) return undefined
    return {
      label: t('aiScopeSelection', { words: countWords(text) }),
      text: text.length > SCOPE_TEXT_MAX ? `${text.slice(0, SCOPE_TEXT_MAX)}…` : text,
    }
  }

  // the frozen-range highlight ends with the run, or as soon as the editor is focused again
  useEffect(() => {
    if (!busy) setInactiveSelectionShown(depsRef.current.getEditor(), false)
  }, [busy])
  useEffect(() => {
    const ed = depsRef.current.getEditor()
    if (!ed) return
    const off = () => setInactiveSelectionShown(ed, false)
    ed.on('focus', off)
    return () => {
      ed.off('focus', off)
    }
  }, [])

  /** [label](mdnav://block/N) links in replies select and scroll to that block */
  const docNav = {
    scheme: DOC_NAV_SCHEME,
    onNavigate: (href: string) => {
      const index = parseDocNavHref(href)
      const current = depsRef.current.getEditor()
      if (index !== null && current) navigateToBlock(current, index)
    },
  }

  /** submit every still-anchored queued edit as one batch run */
  const sendQueue = (): void => {
    const loop = loopRef.current
    const current = depsRef.current.getEditor()
    if (!loop || loop.busy || editQueue.length === 0 || !current) return
    const entries = liveItems(resolveQueue(current, editQueue))
    if (entries.length === 0) {
      onQueueClear?.()
      return
    }
    const instruction = buildQueueInstruction(entries)
    const display = buildQueueSummary(t('aiQueueSubmitted', { count: entries.length }), entries)
    // consumed at send: the run rewrites the anchored passages, which would
    // orphan the anchors anyway; a failed run is retried via the retry action
    onQueueConsume?.(editQueue.map((item) => item.qid))
    send(instruction, display)
  }

  // one-click sends (assistant tab items, selection-popover "send now"); while
  // a run is active they land in the composer instead
  const presetNonceRef = useRef(0)
  useEffect(() => {
    if (!preset || preset.nonce === presetNonceRef.current || convMode) return
    presetNonceRef.current = preset.nonce
    selectTab('chat')
    if (loopRef.current?.busy) setPrompt(preset.text)
    else send(preset.text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset])

  // 助手 tab: the ribbon's one-click AI actions; polish/tidy act on the
  // selection when one exists (read at click time — the editor selection
  // survives clicks in the panel), summarize stays whole-doc
  const docEmpty = !editor || editor.isEmpty
  const runAssist = (text: string): void => {
    selectTab('chat')
    if (loopRef.current?.busy) setPrompt(text)
    else send(text)
  }
  void runAssist
  const assistItems = [
    {
      id: 'summarize',
      label: t('aiSummarizeBtn'),
      desc: t('aiSummarizeDesc'),
      icon: <AiFeatureIcon kind="summarize" />,
      disabled: docEmpty,
      run: () => runAssist(t('aiSummarizePrompt')),
    },
    {
      id: 'polish',
      label: t('aiPolishBtn'),
      desc: t('aiPolishDesc'),
      icon: <AiFeatureIcon kind="polish" />,
      disabled: docEmpty,
      run: () => {
        const sel = depsRef.current.getEditor()?.state.selection
        runAssist(t(!(sel?.empty ?? true) ? 'aiPolishSelectionPrompt' : 'aiPolishPrompt'))
      },
    },
    {
      id: 'tidy',
      label: t('aiTidyBtn'),
      desc: t('aiTidyDesc'),
      icon: <AiFeatureIcon kind="tidy" />,
      disabled: docEmpty,
      run: () => {
        const sel = depsRef.current.getEditor()?.state.selection
        runAssist(t(!(sel?.empty ?? true) ? 'aiTidySelectionPrompt' : 'aiTidyPrompt'))
      },
    },
  ]

  const copyMessage = (text: string, idx: number): void => {
    void navigator.clipboard.writeText(text)
    setCopiedIdx(idx)
    window.setTimeout(() => setCopiedIdx((cur) => (cur === idx ? null : cur)), 1200)
  }

  const rollback = (snapshot: Snapshot): void => {
    if (busy) return
    depsRef.current.restoreSnapshot(snapshot.doc)
    setSnapshots((prev) => prev.filter((s) => s !== snapshot))
  }

  // LOCAL(2026-09-21, d8201ad0): 会话实例以 div 容器渲染(外壳 aside 是面板根)
  const RootTag = (convMode ? 'div' : 'aside') as 'div'
  return (
    <RootTag
      className={convMode ? 'ai-conversation' : 'copilot'}
      dir={lang === 'ar' || lang === 'he' ? 'rtl' : undefined}
      style={convMode ? { display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 } : undefined}
    >
      {!convMode && (
        <PanelTabs
          tabs={aiTabs}
          activeId={tab}
          onTabChange={selectTab}
          actions={null /* LOCAL(2026-09-21, d8201ad0): 弃用销毁式「新对话」——由外壳「+」取代 */}
          chromeActions={dockChrome?.buttons}
          dragProps={dockChrome?.dragProps}
        />
      )}

      <div
        className="ai-chat"
        ref={chatRef}
        onScroll={onChatScroll}
        style={tab === 'chat' ? undefined : { display: 'none' }}
      >
        {chat.length === 0 && (
          <div className="ai-chat-empty">
            <div className="ai-chat-empty-title">{t('aiEmptyTitle')}</div>
            <div className="ai-chat-empty-body">{t('aiEmptyBody')}</div>
            <div className="ai-starter-list">
              <button
                className="ai-starter"
                onClick={() => {
                  setPrompt(t('aiQuickDraftPrompt'))
                  inputRef.current?.focus()
                }}
              >
                {t('aiQuickDraft')}
              </button>
              <button
                className="ai-starter"
                onClick={() => {
                  setPrompt(t('aiQuickPolishPrompt'))
                  inputRef.current?.focus()
                }}
              >
                {t('aiQuickPolish')}
              </button>
            </div>
          </div>
        )}
        {chat.map((entry, i) => {
          if (entry.role === 'user') {
            return (
              <div key={i} className="ai-msg ai-msg-user">
                {entry.scope && <AiScopeQuote scope={entry.scope} />}
                <span dir="auto">{entry.text}</span>
                {entry.undelivered && (
                  <div className="ai-msg-undelivered">
                    {t('aiUndelivered')}
                    {!busy && (
                      <button
                        className="ai-retry-btn"
                        onClick={() => send(entry.text, undefined, entry.scope ?? null)}
                      >
                        {t('aiRetry')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          }
          const hasTools = (entry.tools?.length ?? 0) > 0
          if (!entry.text && !entry.streaming && !hasTools) return null
          const isLast = i === chat.length - 1
          // Action row appears once per completed reply: on the turn's final segment only
          // (mid-turn segments have a following assistant entry; the live turn ends when !busy)
          const nextEntry = chat[i + 1]
          const turnEnded = nextEntry ? nextEntry.role === 'user' : !busy
          const showToolbar = !entry.streaming && turnEnded && !!entry.text && !entry.isError
          return (
            <div
              key={i}
              className={`ai-msg ai-msg-assistant${entry.isError ? ' ai-msg-error' : ''}${entry.streaming ? ' ai-msg-streaming' : ''}`}
            >
              {!entry.text && entry.streaming ? (
                <span className="ai-typing-row">
                  <AiTypingIndicator label={hasTools ? t('aiWorking') : t('aiThinking')} />
                </span>
              ) : (
                entry.text && (
                  <div dir="auto">
                    <Markdown
                      text={entry.text}
                      nav={docNav}
                      citations={entry.kbCitations}
                      onCitationClick={setKbCiteView}
                      onInsertImage={(src) =>
                        depsRef.current
                          .getEditor()
                          ?.chain()
                          .focus()
                          .setImage({
                            src,
                            alt: lang.startsWith('zh') ? 'AI 生成图片' : 'AI image',
                          })
                          .run()
                      }
                      insertImageLabel={lang.startsWith('zh') ? '插入文档' : 'Insert'}
                    />
                  </div>
                )
              )}
              {hasTools && <ToolChipList tools={entry.tools!} />}
              {showToolbar && (
                <div className="ai-msg-toolbar">
                  <button
                    className="ai-msg-tool-btn"
                    onClick={() => copyMessage(entry.text, i)}
                    aria-label={t('aiCopyReplyTitle')}
                    data-tip={t('aiCopyReplyTitle')}
                  >
                    {copiedIdx === i ? (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <path
                          d="M14.6113 5.34253C16.0608 5.3428 17.2363 6.518 17.2363 7.96753V15.5066C17.2361 16.956 16.0607 18.1313 14.6113 18.1316H7.07227C5.62267 18.1316 4.44751 16.9561 4.44727 15.5066V7.96753C4.44732 6.51783 5.62255 5.34253 7.07227 5.34253H14.6113ZM7.07227 6.59253C6.31291 6.59253 5.69732 7.20819 5.69727 7.96753V15.5066C5.69751 16.2658 6.31302 16.8816 7.07227 16.8816H14.6113C15.3703 16.8813 15.9861 16.2656 15.9863 15.5066V7.96753C15.9863 7.20835 15.3705 6.5928 14.6113 6.59253H7.07227ZM10.0176 2.8689C10.3626 2.86905 10.6426 3.14882 10.6426 3.4939C10.6425 3.83888 10.3626 4.11874 10.0176 4.1189H4.59961C3.84022 4.1189 3.22461 4.73451 3.22461 5.4939V11.324C3.22433 11.6689 2.94461 11.949 2.59961 11.949C2.25461 11.949 1.97489 11.6689 1.97461 11.324V5.4939C1.97461 4.04415 3.14987 2.8689 4.59961 2.8689H10.0176Z"
                          fill="currentColor"
                        />
                      </svg>
                    )}
                  </button>
                  {isLast && !busy && runInstructionRef.current && (
                    <button
                      className="ai-msg-tool-btn"
                      onClick={retry}
                      aria-label={t('aiRegenerateTitle')}
                      data-tip={t('aiRegenerateTitle')}
                    >
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <path d="M 12.68 6.65 a 4.86 4.86 0 0 0 -9 -1.08 M 3.32 9.35 a 4.86 4.86 0 0 0 9 1.08" />
                        <path d="M 12.95 3.05 v 2.7 h -2.7 M 3.05 12.95 v -2.7 h 2.7" />
                      </svg>
                    </button>
                  )}
                </div>
              )}
              {entry.interrupted && (
                <span className="ai-msg-interrupted-badge">{t('aiTurnInterrupted')}</span>
              )}
            </div>
          )
        })}
        {chat[chat.length - 1]?.interrupted && !busy && (
          <div className="ai-continue-row">
            <button className="ai-continue-btn" onClick={continueRun}>
              {t('aiContinue')}
            </button>
          </div>
        )}
      </div>

      {tab === 'chat' && snapshots.length > 0 && (
        <div className="ai-versions">
          <div className="ai-versions-title">
            <IconClock />
            {t('aiSnapshotsTitle')}
          </div>
          {snapshots.map((s, i) => (
            <div key={i} className="ai-version-row">
              <span className="ai-version-label" data-tip={s.label}>
                <span className="ai-version-time">{s.time}</span>
                {s.label}
              </span>
              <button className="ai-version-rollback" disabled={busy} onClick={() => rollback(s)}>
                {t('aiRollback')}
              </button>
            </div>
          ))}
        </div>
      )}

      {!convMode && <AssistantTab items={assistItems} hidden={tab !== 'assistant'} />}

      <div className="ai-composer" style={tab === 'chat' ? undefined : { display: 'none' }}>
        {activePartial && (
          <div className="ai-queue ai-partial-card" role="group" aria-label={t('aiPartialTitle')}>
            <div className="ai-queue-head">
              <span className="ai-queue-title">{t('aiPartialTitle')}</span>
            </div>
            <div className="ai-queue-hint">
              {t('aiPartialBody', { blocks: activePartial.blocks })}
            </div>
            <div className="ai-queue-foot">
              <button
                type="button"
                className="ai-queue-discard"
                onClick={() => decidePartial(false)}
              >
                {t('aiPartialDiscard')}
              </button>
              <button type="button" className="ai-queue-send" onClick={() => decidePartial(true)}>
                {t('aiPartialAdopt')}
              </button>
            </div>
          </div>
        )}
        {editor && editQueue.length > 0 && (
          <EditQueueCard
            items={editQueue}
            editor={editor}
            busy={busy}
            onEditInstruction={(qid, instruction) => onQueueEditInstruction?.(qid, instruction)}
            onRemove={(qid) => onQueueRemove?.(qid)}
            onDiscardAll={() => onQueueClear?.()}
            onSend={sendQueue}
            onFocus={(qid) => onQueueFocus?.(qid)}
          />
        )}
        <AiComposer
          value={prompt}
          busy={busy}
          header={
            hasScopeSelection && (
              <div className="ai-scope-row">
                <span className="ai-scope-hint">
                  <button
                    className="ai-scope-label"
                    onClick={() => setScopePreviewOpen((v) => !v)}
                    aria-expanded={scopePreviewOpen}
                    data-tip={t('aiScopeSelectionTip')}
                  >
                    {t('aiScopeSelection', { words: countWords(selectionText) })}
                  </button>
                  <button
                    className="ai-scope-clear"
                    onClick={clearScopeSelection}
                    data-tip={t('aiScopeClearTitle')}
                    aria-label={t('aiScopeClearTitle')}
                  >
                    <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden>
                      <path
                        d="M4 4l8 8M12 4l-8 8"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </span>
                {scopePreviewOpen && (
                  <div className="ai-scope-preview">
                    {selectionText.length > 400 ? `${selectionText.slice(0, 400)}…` : selectionText}
                  </div>
                )}
              </div>
            )
          }
          placeholder={t('aiComposerPlaceholder')}
          hintIdle={t('aiHintIdle')}
          hintBusy={t('aiHintBusy')}
          sendLabel={t('aiSend')}
          stopLabel={t('aiStop')}
          iconOnly
          footerStart={
            <>
              <KbPickerButton lang={lang} selected={kb.selected} onToggle={kb.toggle} />
              <ModelPickerButton
                settings={panelSettings}
                onPick={(selection) => {
                  void markdownModelBridge.setCurrentModel(selection).then(refreshPanelSettings)
                }}
                onOpenSettings={() => setModelSettingsOpen(true)}
              />
            </>
          }
          textareaRef={inputRef}
          onChange={setPrompt}
          onSend={() => send(prompt)}
          onStop={stop}
        />
      </div>
      {modelSettingsOpen && (
        <Suspense fallback={null}>
          <ModelSettingsPage
            bridge={markdownModelBridge}
            lang={lang}
            onClose={() => {
              setModelSettingsOpen(false)
              void refreshPanelSettings()
            }}
          />
        </Suspense>
      )}
      {kbCiteView && (
        <KbCitePreview citation={kbCiteView} lang={lang} onClose={() => setKbCiteView(null)} />
      )}
    </RootTag>
  )
}

/** Step-row status icons (timeline glyphs, unified with the other apps) */
function StepIcon({ status }: { status: 'running' | 'done' | 'error' }) {
  if (status === 'running') {
    return (
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M6.5 3.5h11M6.5 20.5h11M8 3.5v3.2c0 2.6 4 4.2 4 5.3 0 1.1 4 2.7 4 5.3v3.2M16 3.5v3.2c0 2.6-4 4.2-4 5.3 0 1.1-4 2.7-4 5.3v3.2" />
      </svg>
    )
  }
  if (status === 'error') {
    return (
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="12" cy="12" r="9" />
        <path d="m9.2 9.2 5.6 5.6M14.8 9.2l-5.6 5.6" />
      </svg>
    )
  }
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.4 2.4 2.4 4.6-5" />
    </svg>
  )
}

/** Tool activity group (docs parity): auto-opens while tools run, auto-collapses into
 *  "Worked · N steps" when they finish; a manual toggle always wins */
function ToolChipList({ tools }: { tools: ToolActivity[] }) {
  const { t: tr } = useI18n()
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [userOpen, setUserOpen] = useState<boolean | null>(null)

  const toggle = (j: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(j)) next.delete(j)
      else next.add(j)
      return next
    })
  }

  const anyRunning = tools.some((tool) => tool.running)
  const open = userOpen ?? anyRunning
  const label = anyRunning ? tr('aiGroupWorking') : tr('aiWorkedSteps', { n: tools.length })

  return (
    <div className="ai-work-group">
      <button
        type="button"
        className={`ai-work-group-summary${anyRunning ? ' running' : ''}`}
        aria-expanded={open}
        onClick={() => setUserOpen(!open)}
      >
        {anyRunning && !open && <span className="ai-tool-chip-spinner" aria-hidden />}
        <span className="ai-work-group-label">{label}</span>
        <span className={`ai-tool-chip-caret${open ? ' open' : ''}`} aria-hidden>
          ›
        </span>
      </button>
      <div className={`ai-work-group-body${open ? ' open' : ''}`}>
        <div className="ai-work-group-body-inner">
          {tools.map((tool, j) => {
            const hasOutput = !tool.running && !!tool.output
            const isOpen = expanded.has(j)
            const stepStatus = tool.running ? 'running' : tool.isError ? 'error' : 'done'
            return (
              <div key={j} className="ai-step-row">
                <span className={`ai-step-icon ${stepStatus}`} aria-hidden>
                  <StepIcon status={stepStatus} />
                </span>
                <div className="ai-step-content">
                  {hasOutput ? (
                    <button
                      type="button"
                      className="ai-step-title clickable"
                      data-tip={tool.name}
                      aria-expanded={isOpen}
                      onClick={() => toggle(j)}
                    >
                      {tool.summary}
                    </button>
                  ) : (
                    <span className="ai-step-title" data-tip={tool.name}>
                      {tool.summary}
                    </span>
                  )}
                  {hasOutput && isOpen && (
                    <div className="ai-step-detail">
                      <div className="ai-tool-output">
                        <div className="ai-tool-output-pre">{tool.output}</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Svg({ children }: { children: ReactNode }): ReactElement {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

function IconNewChat(): ReactElement {
  return (
    <Svg>
      <path
        d="M13.5 7.2v-3A1.7 1.7 0 0 0 11.8 2.5H4.2a1.7 1.7 0 0 0-1.7 1.7v6.1a1.7 1.7 0 0 0 1.7 1.7h1.1v2l2.6-2h1.3"
        strokeLinejoin="round"
      />
      <path d="M12.2 9.4v4M10.2 11.4h4" />
    </Svg>
  )
}

function IconClock(): ReactElement {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.8V8l2.2 1.6" />
    </svg>
  )
}


// ── LOCAL(2026-09-21, d8201ad0): 多会话外壳(D1/D5/D9)─────────────────────────
// tab 行 = [会话…][助手];「+」常驻;每会话一个 AiConversationBody 实例;
// writer(runDocWriter/epoch/partial 卡)为面板级共享,绝不随实例卸载(§4.5)。
// 上游无同类实现;收敛条件:上游若原生实现多会话,评估取上游并删除本地会话池。
// LOCAL(2026-09-22, d8201ad0): D12/D13 增量——历史不再是 tab:「🕘」改 actions 槽
// 常驻图标([+][🕘])的下拉浮层 AiHistoryPopover;空会话(从未发言)关闭直接丢弃、
// 不进历史(hook close() 内分流)。上游动向与收敛条件同上。
const isChatTabM = (tab: AiActiveTab): tab is string =>
  typeof tab === 'string' && tab !== 'assistant' && tab !== 'empty'

export function AiPanel(props: {
  deps: MarkdownAiDeps
  filePath: string | null
  preset?: AiPreset | null
  dockChrome?: DockChrome
  editQueue?: EditQueueItem[]
  onQueueEditInstruction?: (qid: string, instruction: string) => void
  onQueueRemove?: (qid: string) => void
  onQueueClear?: () => void
  onQueueFocus?: (qid: string) => void
  onQueueConsume?: (qids: string[]) => void
}) {
  const { deps, filePath, dockChrome } = props
  const { t } = useI18n()
  const tempChatIdRef = useRef(`unsaved-${Date.now()}`)
  const conv = useAiConversations(
    { filePath: filePath ?? null, tempChatId: tempChatIdRef.current },
    { persistKey: 'aimarkdown.aiTab' },
  )
  const bodyHandlesRef = useRef(new Map<string, MarkdownConversationHandle>())

  // 索引键换绑:未保存 → 已保存 / 重命名(chatId 不变)
  const prevFilePathRef = useRef(filePath ?? null)
  useEffect(() => {
    const prev = prevFilePathRef.current
    prevFilePathRef.current = filePath ?? null
    if (!filePath || prev === filePath) return
    conv.rebindIndex(prev ?? tempChatIdRef.current, filePath)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath])

  const [closeConfirmId, setCloseConfirmId] = useState<string | null>(null)
  // D13: 历史下拉浮层开关(空态引导的「从历史还原」也走它)
  const [historyOpen, setHistoryOpen] = useState(false)
  const closeConversation = async (chatId: string): Promise<void> => {
    const handle = bodyHandlesRef.current.get(chatId)
    if (handle) await handle.stop()
    conv.close(chatId)
  }
  const closeFlow = (chatId: string): void => {
    if (conv.runningIds.has(chatId)) {
      setCloseConfirmId(chatId)
      return
    }
    void closeConversation(chatId)
  }

  // 面板级入口(助手 tab / preset)→ 目标会话体
  const targetChatId = (): string | null => {
    if (isChatTabM(conv.activeTab) && conv.open.some((c) => c.chatId === conv.activeTab)) {
      return conv.activeTab
    }
    return conv.open[0]?.chatId ?? null
  }
  const pendingRef = useRef<{ text: string; assist?: boolean } | null>(null)
  useEffect(() => {
    const p = pendingRef.current
    if (!p) return
    const target = targetChatId()
    if (!target) {
      // the pool settled with zero open conversations: open one to deliver into
      if (conv.ready && conv.open.length === 0) conv.create()
      return
    }
    const handle = bodyHandlesRef.current.get(target)
    if (!handle) return
    pendingRef.current = null
    if (p.assist) handle.assist(p.text)
    else handle.send(p.text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.open.length, conv.activeTab, conv.ready])
  const routeText = (text: string, assist = false): void => {
    const target = targetChatId()
    const handle = target ? bodyHandlesRef.current.get(target) : undefined
    if (handle) {
      if (assist) handle.assist(text)
      else handle.send(text)
      return
    }
    // queued: the delivery effect runs it on the first ready conversation body
    pendingRef.current = { text, assist }
  }

  return (
    <aside className="copilot" style={{ position: 'relative' }}>
      <PanelTabs
        tabs={[
          ...conv.open.map((c) => ({
            id: c.chatId,
            label: c.title || t('aiConvUntitled'),
            onClose: () => closeFlow(c.chatId),
            running: conv.runningIds.has(c.chatId),
          })),
          { id: 'assistant', label: t('aiTabAssistant') },
        ]}
        activeId={conv.activeTab}
        onTabChange={conv.setActiveTab}
        actions={
          // LOCAL(2026-09-22, d8201ad0): D13——常驻两图标 [+][🕘];🕘 历史对话下拉浮层
          <>
            <button
              className="ai-header-btn"
              onClick={() => conv.create()}
              data-tip={t('aiNewChat')}
              aria-label={t('aiNewChat')}
            >
              <IconNewChat />
            </button>
            <AiHistoryPopover
              open={historyOpen}
              onOpenChange={setHistoryOpen}
              items={conv.closed}
              tooltip={t('aiHistoryTooltip')}
              labels={{
                deleteOne: t('aiHistoryDelete'),
                deleteAll: t('aiHistoryDeleteAll'),
                empty: t('aiHistoryEmpty'),
                deleteOneConfirm: t('aiHistoryDeleteOneConfirm'),
                deleteAllConfirm: t('aiHistoryDeleteAllConfirm'),
                cancel: t('aiConvCancel'),
              }}
              onRestore={(chatId) => conv.restore(chatId)}
              // 单删/全删只作用于历史(未打开)会话,确认在浮层内完成(D3)
              onDelete={(chatId) => conv.removeClosed(chatId)}
              onDeleteAll={() => conv.removeAllClosed()}
            />
          </>
        }
        chromeActions={dockChrome?.buttons}
        dragProps={dockChrome?.dragProps}
      />
      {closeConfirmId !== null && (
        <AiTabConfirm
          title={t('aiConvCloseRunningTitle')}
          body={t('aiConvCloseRunningBody')}
          confirmLabel={t('aiConvStopClose')}
          cancelLabel={t('aiConvCancel')}
          onConfirm={() => {
            const id = closeConfirmId
            setCloseConfirmId(null)
            if (id !== null) void closeConversation(id)
          }}
          onCancel={() => setCloseConfirmId(null)}
        />
      )}
      {conv.open.map((c) => (
        <div
          key={c.chatId}
          style={
            c.chatId === conv.activeTab
              ? { display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }
              : { display: 'none' }
          }
        >
          <AiConversationBody
            {...props}
            preset={null}
            conversation={{
              chatId: c.chatId,
              projectId: conv.projectId,
              onRunningChange: (running) => conv.setRunning(c.chatId, running),
              onFirstMessage: (text) => conv.reportTitle(c.chatId, text),
              onTurnEnd: () => conv.touch(c.chatId),
              onRegister: (handle) => bodyHandlesRef.current.set(c.chatId, handle),
              onUnregister: () => bodyHandlesRef.current.delete(c.chatId),
            }}
          />
        </div>
      ))}
      {/* 关到零:空态引导(§2.1);「从历史还原」走 🕘 浮层(D13) */}
      {conv.ready && conv.activeTab === 'empty' && (
        <AiConversationsEmpty
          labels={{
            title: t('aiConvEmptyTitle'),
            body: t('aiConvEmptyBody'),
            create: t('aiNewChat'),
            openHistory: t('aiConvOpenHistory'),
          }}
          onCreate={() => conv.create()}
          onOpenHistory={() => setHistoryOpen(true)}
        />
      )}
      {conv.activeTab === 'assistant' && (
        <AssistantTab
          items={[
            {
              id: 'summarize',
              label: t('aiSummarizeBtn'),
              desc: t('aiSummarizeDesc'),
              icon: <AiFeatureIcon kind="summarize" />,
              disabled: !deps.getEditor() || deps.getEditor()!.isEmpty,
              run: () => routeText(t('aiSummarizePrompt'), true),
            },
            {
              id: 'polish',
              label: t('aiPolishBtn'),
              desc: t('aiPolishDesc'),
              icon: <AiFeatureIcon kind="polish" />,
              disabled: !deps.getEditor() || deps.getEditor()!.isEmpty,
              run: () => {
                const sel = deps.getEditor()?.state.selection
                routeText(t(!(sel?.empty ?? true) ? 'aiPolishSelectionPrompt' : 'aiPolishPrompt'), true)
              },
            },
            {
              id: 'tidy',
              label: t('aiTidyBtn'),
              desc: t('aiTidyDesc'),
              icon: <AiFeatureIcon kind="tidy" />,
              disabled: !deps.getEditor() || deps.getEditor()!.isEmpty,
              run: () => {
                const sel = deps.getEditor()?.state.selection
                routeText(t(!(sel?.empty ?? true) ? 'aiTidySelectionPrompt' : 'aiTidyPrompt'), true)
              },
            },
          ]}
          hidden={conv.activeTab !== 'assistant'}
        />
      )}
    </aside>
  )
}
