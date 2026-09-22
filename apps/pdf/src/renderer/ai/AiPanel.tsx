import { useEffect, useRef, useState, lazy, Suspense } from 'react'
import type { ReactElement } from 'react'
import { AgentLoop } from '@chatoffice/agent-core'
import type { AiSettingsV2 } from '@chatoffice/ai-provider'
import {
  AiComposer,
  AiTypingIndicator,
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
import type { DockChrome } from '@chatoffice/ui'
import { AssistantTab, IconAiKeyPoints, IconAiSummarize } from './AssistantTab'
import { defaultSettingsV2, pickImageModel } from '@chatoffice/ai-provider/browser'
import { pdfModelBridge } from './model-bridge'
import { aiLangDirective, t as tGlobal, useI18n } from '../i18n/locale'
import { Markdown } from '@chatoffice/ui'
import { createPdfSkill } from './pdf-skill'
import { createElectronTransport } from './transport'
import { PDF_NAV_SCHEME, parsePdfNavHref } from './pdf-nav'
import type { FileOpConfirm, PdfAiDeps, PdfAppDeps } from './tools'

// 惰性加载:模型设置页(含厂商 logo 组)只在打开时拉取,不进启动图
const ModelSettingsPage = lazy(() =>
  import('@chatoffice/ui/ModelSettingsPage').then((m) => ({ default: m.ModelSettingsPage })),
)

// Word-parity count (same as docs/markdown): Asian chars one by one + non-Asian words
const ASIAN_RE =
  /[ᄀ-ᇿ⺀-⿟、-〿぀-ヿ㄀-ㄯ㄰-㆏㇀-ㇿ㐀-䶿一-鿿가-힯豈-﫿！-｠￠-￦]|[\uD840-\uD87F][\uDC00-\uDFFF]/g
const NON_ASIAN_WORD_RE = /[A-Za-z0-9À-ɏ]+(?:['-][A-Za-z0-9À-ɏ]+)*/g

function countWords(text: string): number {
  return (text.match(ASIAN_RE) ?? []).length + (text.match(NON_ASIAN_WORD_RE) ?? []).length
}

interface ToolActivity {
  name: string
  summary: string
  isError?: boolean
  output?: string
}

/** command handle the outer panel holds per conversation (plan §4.3) */
export interface PdfConversationHandle {
  stop(): Promise<void>
  send(text: string): void
  /** busy 时落 composer,空闲直接发送(助手 tab 语义) */
  assist(text: string): void
  setDraft(text: string): void
}

interface ChatEntry {
  role: 'user' | 'assistant'
  text: string
  /** LOCAL(2026-09-21, d8201ad0): D10 —— 恢复的被中断轮次 */
  interrupted?: boolean
  /** model id that produced this assistant turn (display only) */
  model?: string
  streaming?: boolean
  isError?: boolean
  /** the run failed and this user message was rolled back out of the model context */
  undelivered?: boolean
  tools?: ToolActivity[]
  /** the passage this user message targeted, frozen at send */
  scope?: AiScopeQuoteData
  /** KB citations behind the [n] chips of this assistant turn */
  kbCitations?: KbCitation[]
}

/** longest selection excerpt echoed on a user bubble */
const SCOPE_TEXT_MAX = 200

type Phase = 'thinking' | 'replying' | 'working'

interface PendingConfirm {
  req: FileOpConfirm
  settle: (ok: boolean) => void
}

function AiConversationBody({
  api,
  filePath,
  dockChrome,
  preset,
  onRunDone,
  onClearSelection,
  conversation,
}: {
  api: PdfAppDeps
  /** Absolute path of the open PDF (chat history is keyed to it) */
  filePath?: string
  /** DockShell chrome (layout buttons + header drag) when hosted in the dock */
  dockChrome?: DockChrome
  /** Ribbon AI buttons push a one-shot prompt; a new nonce triggers an auto-run */
  preset?: { text: string; nonce: number } | null
  /** Fired when a run that mutated the document finishes (drives the untitled-blank auto-save) */
  onRunDone?: () => void
  /** The × on the scope chip: drop the cached selection so runs target the whole document */
  onClearSelection?: () => void  /** LOCAL(2026-09-21, d8201ad0): 多会话——由外壳按会话实例化时传入(D9) */
  conversation?: {
    chatId: string
    projectId: string | null
    onRunningChange: (running: boolean) => void
    onFirstMessage: (text: string) => void
    onTurnEnd: () => void
    onRegister: (handle: PdfConversationHandle) => void
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
  const [legacyTab, selectTab] = usePanelTab('aipdf.aiTab', aiTabs)
  const tab = convMode ? 'chat' : legacyTab
  const [chat, setChat] = useState<ChatEntry[]>([])
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<Phase>('thinking')
  /** the scope chip's expandable preview of the selected text */
  const [scopePreviewOpen, setScopePreviewOpen] = useState(false)
  const chatRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)

  // ── Chat-history persistence (r142): same shared store Docs/Sheets use ──
  const chatIdsRef = useRef<{ projectId: string; chatId: string } | null>(null)
  /** current turn's streamed text; completed turns collect into runTextsRef */
  const segTextRef = useRef('')
  /** whole-run accumulation: one stored assistant message per run (consecutive
      assistant rows would break restore() on strict-alternation providers) */
  const runTextsRef = useRef<string[]>([])
  const runToolsRef = useRef<ToolActivity[]>([])
  const chatStore = () =>
    (
      window as Window & {
        projectApi?: {
          resolveChat(args: {
            filePath: string | null
            tempChatId?: string
          }): Promise<{ projectId: string; chatId: string }>
          appendChat(args: {
            projectId: string
            chatId: string
            role: 'user' | 'assistant'
            text: string
            tools?: Array<{ name: string; summary: string; isError?: boolean; output?: string }>
            scope?: AiScopeQuoteData
            interrupted?: boolean
          }): Promise<void>
          loadChat(args: { projectId: string; chatId: string; limit?: number }): Promise<
            Array<{
              role: 'user' | 'assistant'
              text: string
              tools?: Array<{ name: string; summary: string; isError?: boolean; output?: string }>
              scope?: AiScopeQuoteData
            }>
          >
          rebindChat(args: {
            projectId: string
            tempChatId: string
            newFilePath: string
          }): Promise<{ projectId: string; chatId: string } | null>
        }
      }
    ).projectApi
  const persistMessage = (
    role: 'user' | 'assistant',
    text: string,
    tools?: ToolActivity[],
    scope?: AiScopeQuoteData,
    interrupted?: boolean,
  ): void => {
    // LOCAL(2026-09-21, d8201ad0): 会话实例持久化走 conversation.chatId(immutable)
    const ids = conversation
      ? { projectId: conversation.projectId, chatId: conversation.chatId }
      : chatIdsRef.current
    const store = chatStore()
    if (!ids || !ids.projectId || !store || (!text && !tools?.length)) return
    void store
      .appendChat({
        projectId: ids.projectId,
        chatId: ids.chatId,
        role,
        text,
        ...(interrupted ? { interrupted: true } : {}),
        ...(tools && tools.length > 0
          ? {
              tools: tools.map((tool) => ({
                name: tool.name,
                summary: tool.summary,
                isError: tool.isError,
                output: tool.output,
              })),
            }
          : {}),
        ...(scope ? { scope } : {}),
      })
      .catch(() => {
        /* silent */
      })
  }
  /** persist the whole run as ONE assistant message (docs parity: restore()
      feeds these back verbatim, and providers require user/assistant
      alternation; cancelled runs persist nothing — the unanswered user
      message is filtered out by restore()) */
  const persistRun = (interrupted?: boolean): void => {
    const texts = [...runTextsRef.current, segTextRef.current].filter(Boolean)
    const tools = runToolsRef.current
    segTextRef.current = ''
    runTextsRef.current = []
    runToolsRef.current = []
    if (texts.length > 0 || tools.length > 0) {
      persistMessage('assistant', texts.join('\n\n'), tools, undefined, interrupted)
    }
  }
  // LOCAL(2026-09-21, d8201ad0): 会话实例 loadChat limit 10_000 全量装载(D11)→
  // 缓冲 → 首次 send 建 loop 时 restore 灌回(D10)
  const historyLoadedRef = useRef(false)
  useEffect(() => {
    const store = chatStore()
    if (!store) return
    if (conversation) {
      if (!conversation.projectId) return
      let disposed = false
      void store
        .loadChat({
          projectId: conversation.projectId,
          chatId: conversation.chatId,
          limit: 10_000,
        })
        .then((msgs) => {
          if (disposed || msgs.length === 0) return
          if (historyLoadedRef.current) return
          historyLoadedRef.current = true
          setChat((prev) => [
            ...msgs.map((m) => ({
              role: m.role,
              text: m.text,
              interrupted: (m as { interrupted?: boolean }).interrupted === true,
              tools: m.tools?.map((tool) => ({
                name: tool.name,
                summary: tool.summary,
                isError: tool.isError,
                output: tool.output,
              })),
              ...(m.scope ? { scope: m.scope } : {}),
            })),
            ...prev,
          ])
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
    void store
      .resolveChat({ filePath: filePath || null, tempChatId })
      .then((ids) => {
        chatIdsRef.current = ids
        return store.loadChat({ projectId: ids.projectId, chatId: ids.chatId, limit: 200 })
      })
      .then((msgs) => {
        if (msgs.length === 0) return
        setChat((prev) => [
          ...msgs.map((m) => ({
            role: m.role,
            text: m.text,
            tools: m.tools?.map((tool) => ({
              name: tool.name,
              summary: tool.summary,
              isError: tool.isError,
              output: tool.output,
            })),
            ...(m.scope ? { scope: m.scope } : {}),
          })),
          ...prev,
        ])
        // follow-ups after reopening continue the previous conversation
        loopRef.current?.restore(msgs.map((m) => ({ role: m.role, text: m.text })))
      })
      .catch(() => {
        /* history load failures are silent */
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation?.projectId, conversation?.chatId])
  /** blank/generated PDFs get a path on first save: bind the unsaved-* history to it */
  useEffect(() => {
    if (conversation) return
    const ids = chatIdsRef.current
    const store = chatStore()
    if (!store || !ids || !filePath || !ids.chatId.startsWith('unsaved-')) return
    void store
      .rebindChat({ projectId: ids.projectId, tempChatId: ids.chatId, newFilePath: filePath })
      .then((rebound) => {
        if (rebound?.chatId) chatIdsRef.current = rebound
      })
      .catch(() => {
        /* silent */
      })
  }, [filePath])

  const settingsRef = useRef<AiSettingsV2 | null>(null)
  const [panelSettings, setPanelSettings] = useState<AiSettingsV2>(() => defaultSettingsV2())
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false)
  const refreshPanelSettings = async () => {
    try {
      setPanelSettings(await pdfModelBridge.getSettings())
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

  /** chatoffice login state for the cloud-tools gate (refreshed on mount and window focus) */
  const chatofficeLoggedInRef = useRef(false)
  useEffect(() => {
    let alive = true
    const refresh = () => {
      void window.pdfApi
        ?.chatofficeStatus()
        .then((s) => {
          if (alive) chatofficeLoggedInRef.current = !!s?.loggedIn
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
  const langRef = useRef(lang)
  langRef.current = lang
  const apiRef = useRef(api)
  apiRef.current = api
  const onRunDoneRef = useRef(onRunDone)
  onRunDoneRef.current = onRunDone
  /** Any tool in the current run reported mutated: true */
  const runMutatedRef = useRef(false)

  /** Confirmation card for irreversible file operations; one at a time, a second request is refused */
  const [fileOpConfirm, setFileOpConfirm] = useState<FileOpConfirm | null>(null)
  const confirmRef = useRef<PendingConfirm | null>(null)
  const requestFileOpConfirm = (req: FileOpConfirm, signal?: AbortSignal): Promise<boolean> =>
    new Promise((resolve) => {
      if (confirmRef.current || signal?.aborted) {
        resolve(false)
        return
      }
      const pending: PendingConfirm = {
        req,
        settle: (ok) => {
          if (confirmRef.current !== pending) return
          confirmRef.current = null
          setFileOpConfirm(null)
          resolve(ok)
        },
      }
      confirmRef.current = pending
      setFileOpConfirm(req)
      signal?.addEventListener('abort', () => pending.settle(false), { once: true })
    })
  // another document or the panel going away answers a pending card with "no"
  useEffect(() => () => confirmRef.current?.settle(false), [filePath])

  const patchLast = (patch: Partial<ChatEntry> | ((last: ChatEntry) => Partial<ChatEntry>)) => {
    setChat((prev) => {
      const next = [...prev]
      const last = next[next.length - 1]
      if (!last || last.role !== 'assistant') return prev
      next[next.length - 1] = { ...last, ...(typeof patch === 'function' ? patch(last) : patch) }
      return next
    })
  }

  // The loop is built once; every mutable value goes through a ref getter
  const loopRef = useRef<AgentLoop | null>(null)
  /** messages buffered for the lazy loop (D10/D11 hard chain) */
  const bufferedRestoreRef = useRef<Array<{ role: 'user' | 'assistant'; text: string }> | null>(null)
  /** LOCAL(2026-09-21, d8201ad0): loop 惰性构造(首次 send 才建) */
  const ensureLoop = (): AgentLoop | null => {
    if (loopRef.current) return loopRef.current
    if (convMode && !conversation) return null
    const deps: PdfAiDeps = {
      doc: () => apiRef.current.doc(),
      fileName: () => apiRef.current.fileName(),
      pageCount: () => apiRef.current.pageCount(),
      currentPage: () => apiRef.current.currentPage(),
      readOnly: () => apiRef.current.readOnly(),
      ocrText: (idx) => apiRef.current.ocrText(idx),
      selection: () => apiRef.current.selection(),
      pendingSummary: () => apiRef.current.pendingSummary(),
      outline: () => apiRef.current.outline(),
      searchIndex: () => apiRef.current.searchIndex(),
      isDeleted: (i) => apiRef.current.isDeleted(i),
      gotoPage: (p) => apiRef.current.gotoPage(p),
      addMarkup: (type, idx, rects, color) => apiRef.current.addMarkup(type, idx, rects, color),
      annotationSummary: () => apiRef.current.annotationSummary(),
      createDocument: (request) => apiRef.current.createDocument(request),
      confirmFileOp: requestFileOpConfirm,
      insertBlankPage: (afterVis) => apiRef.current.insertBlankPage(afterVis),
      setPageSize: (w, h) => apiRef.current.setPageSize(w, h),
      cropPages: (vis, rect) => apiRef.current.cropPages(vis, rect),
      replacePages: (vis) => apiRef.current.replacePages(vis),
      extractPages: (vis) => apiRef.current.extractPages(vis),
      splitPdf: (n) => apiRef.current.splitPdf(n),
      splitPages: (n) => apiRef.current.splitPages(n),
      mergePages: (n, direction, separator) => apiRef.current.mergePages(n, direction, separator),
      stamps: () => apiRef.current.stamps(),
      setStamps: (cfg) => apiRef.current.setStamps(cfg),
      annotationsOn: (idx) => apiRef.current.annotationsOn(idx),
      addNote: (idx, at, contents, color) => apiRef.current.addNote(idx, at, contents, color),
      findNoteRoot: (idx, key) => apiRef.current.findNoteRoot(idx, key),
      replyToThread: (idx, root, contents) => apiRef.current.replyToThread(idx, root, contents),
      editNote: (idx, item, contents) => apiRef.current.editNote(idx, item, contents),
      deleteMarkups: (idx, keys) => apiRef.current.deleteMarkups(idx, keys),
      deleteNoteThread: (idx, root) => apiRef.current.deleteNoteThread(idx, root),
      editText: (input) => apiRef.current.editText(input),
      moveTextBlock: (idx, block, d) => apiRef.current.moveTextBlock(idx, block, d),
      insertText: (input) => apiRef.current.insertText(input),
      addFormMark: (idx, kind, rect) => apiRef.current.addFormMark(idx, kind, rect),
      textInserts: () => apiRef.current.textInserts(),
      updateTextInsert: (id, edit) => apiRef.current.updateTextInsert(id, edit),
      moveTextInsert: (id, origin) => apiRef.current.moveTextInsert(id, origin),
      deleteTextInsert: (id) => apiRef.current.deleteTextInsert(id),
      editFonts: () => apiRef.current.editFonts(),
      formEdits: () => apiRef.current.formEdits(),
      applyOps: (ops, opts) => apiRef.current.applyOps(ops, opts),
      metadata: () => apiRef.current.metadata(),
      pageOrder: () => apiRef.current.pageOrder(),
      pageGeom: (idx) => apiRef.current.pageGeom(idx),
      listImages: () => apiRef.current.listImages(),
      isImageClaimed: (ref) => apiRef.current.isImageClaimed(ref),
      insertImage: (idx, png, rect, layer) => apiRef.current.insertImage(idx, png, rect, layer),
      transformImage: (ref, rect, layer, quarterTurns) =>
        apiRef.current.transformImage(ref, rect, layer, quarterTurns),
      replaceImage: (ref, png) => apiRef.current.replaceImage(ref, png),
      bakeImage: (ref, op, signal) => apiRef.current.bakeImage(ref, op, signal),
      deleteImage: (ref) => apiRef.current.deleteImage(ref),
      searchImages: (query, max) => apiRef.current.searchImages(query, max),
      generateImage: (op) => apiRef.current.generateImage(op),
      // 生图门槛跟全局默认:ai-settings 里能解析出生图模型即启用(BYOK-first 主进程处理器)
      hasImageModel: () => !!pickImageModel(settingsRef.current ?? defaultSettingsV2()),
      fetchImage: (url) => apiRef.current.fetchImage(url),
    }
    loopRef.current = new AgentLoop({
      // the request carries only the selection; the owning main process resolves profile + secret
      transport: createElectronTransport(() => settingsRef.current!.currentModel!),
      skill: createPdfSkill(deps),
      systemSuffix: () => aiLangDirective(langRef.current),
      events: {
        onText: (text) => {
          setPhase('replying')
          segTextRef.current = text
          patchLast({ text })
        },
        onToolExecuted: ({ call, execution }) => {
          setPhase('working')
          if (execution.mutated) runMutatedRef.current = true
          runToolsRef.current.push({
            name: call.name,
            summary: execution.summary,
            isError: execution.isError,
            output: execution.output?.slice(0, 2000),
          })
          patchLast((last) => ({
            tools: [
              ...(last.tools ?? []),
              {
                name: call.name,
                summary: execution.summary,
                isError: execution.isError,
                output: execution.output?.slice(0, 2000),
              },
            ],
          }))
        },
        onTurnEnd: () => {
          setPhase('thinking')
          runTextsRef.current.push(segTextRef.current)
          segTextRef.current = ''
          patchLast({ streaming: false })
          setChat((prev) => [
            ...prev,
            {
              role: 'assistant',
              text: '',
              streaming: true,
              model: panelSettings.currentModel?.modelId,
            },
          ])
        },
        onDone: ({ text, cancelled, turnLimit, truncated }) => {
          const base = turnLimit
            ? [text, tGlobal('aiTurnLimit')].filter(Boolean).join('\n\n')
            : text || (cancelled ? tGlobal('aiStopped') : '')
          // finish_reason=length with no prose (a reasoning model that spent the whole
          // output budget thinking) must say so instead of showing the bare "(no reply)",
          // which reads like the assistant ignored the user — same handling as docs
          const final = truncated
            ? [base, tGlobal('aiTruncatedNote')].filter(Boolean).join('\n\n')
            : base
          if (cancelled) {
            // LOCAL(2026-09-21, d8201ad0): D10 —— 取消的轮次照常落盘(半截文本+工具活动)
            const texts = [...runTextsRef.current, segTextRef.current].filter(Boolean)
            const half = texts.join('\n\n')
            if ((half && half.trim()) || runToolsRef.current.length > 0) {
              persistRun(true)
            } else {
              segTextRef.current = ''
              runTextsRef.current = []
              runToolsRef.current = []
            }
          } else {
            segTextRef.current = final || segTextRef.current
            persistRun()
          }
          patchLast((last) => ({
            streaming: false,
            text: final || (last.tools?.length ? last.text : tGlobal('aiNoReply')),
          }))
          setBusy(false)
          if (conversation) conversation.onTurnEnd()
          if (runMutatedRef.current) {
            runMutatedRef.current = false
            onRunDoneRef.current?.()
          }
        },
        onError: (error) => {
          setChat((prev) => {
            const next = [...prev]
            // the loop rolled this run's user message out of the model context — surface that
            for (let i = next.length - 1; i >= 0; i--) {
              const entry = next[i]!
              if (entry.role === 'user') {
                next[i] = { ...entry, undelivered: true }
                break
              }
            }
            const last = next.at(-1)
            if (last?.role === 'assistant') {
              next[next.length - 1] = { ...last, streaming: false, text: error, isError: true }
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

  useEffect(() => {
    if (stickToBottomRef.current) {
      chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight })
    }
  }, [chat, busy, fileOpConfirm])

  const onChatScroll = (): void => {
    const el = chatRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }

  /** retryScope: null = a retry that had no scope; undefined = capture the live selection */
  const send = (text: string, retryScope?: AiScopeQuoteData | null): void => {
    const instruction = text.trim()
    const loop = ensureLoop()
    if (!instruction || !loop || loop.busy) return
    stickToBottomRef.current = true
    const scope = retryScope !== undefined ? (retryScope ?? undefined) : selectionScopeQuote()
    persistMessage('user', instruction, undefined, scope)
    if (conversation) conversation.onFirstMessage(instruction)
    segTextRef.current = ''
    runTextsRef.current = []
    runToolsRef.current = []
    setChat((prev) => [
      ...prev,
      { role: 'user', text: instruction },
      { role: 'assistant', text: '', streaming: true, model: panelSettings.currentModel?.modelId },
    ])
    setPrompt('')
    setBusy(true)
    setPhase('thinking')
    runMutatedRef.current = false
    void (async () => {
      try {
        settingsRef.current = await window.pdfApi.getAiSettings()
        const kbInstruction = await kb.augment(instruction)
        if (kb.lastCitations.current.length > 0)
          patchLast({ kbCitations: kb.lastCitations.current })
        await loop.run(kbInstruction)
      } catch (err) {
        patchLast({
          streaming: false,
          text: err instanceof Error ? err.message : String(err),
          isError: true,
        })
        setBusy(false)
      }
    })()
  }

  // LOCAL(2026-09-21, d8201ad0): D10 续作入口(半截轮次恢复后「继续」)
  const continueRun = (): void => send(AI_CONTINUE_INSTRUCTION)

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

  // LOCAL(2026-09-21, d8201ad0): stop-then-close(D5/D10)——确认后先 stop 再 close
  const stopConversation = async (): Promise<void> => {
    loopRef.current?.cancel()
    if (!busyRef.current) return
    await new Promise<void>((resolve) => idleWaitersRef.current.push(resolve))
  }
  const stopRef = useRef(stopConversation)
  stopRef.current = stopConversation

  const sendRef = useRef(send)
  sendRef.current = send
  const pdfHandleRef = useRef<PdfConversationHandle | null>(null)
  if (!pdfHandleRef.current) {
    pdfHandleRef.current = {
      stop: () => stopRef.current(),
      send: (text) => sendRef.current(text),
      assist: (text) => {
        if (loopRef.current?.busy) setPrompt(text)
        else sendRef.current(text)
      },
      setDraft: (text) => setPrompt(text),
    }
  }
  useEffect(() => {
    if (!conversation) return
    conversation.onRegister(pdfHandleRef.current!)
    return () => conversation.onUnregister()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // One-click AI actions from the ribbon / Ask popover; while a run is active the
  // preset lands in the composer instead of being dropped silently (markdown parity)
  useEffect(() => {
    if (!preset || convMode) return
    if (loopRef.current?.busy) setPrompt(preset.text)
    else send(preset.text)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per nonce
  }, [preset?.nonce])

  const typingLabel =
    phase === 'replying' ? t('aiReplying') : phase === 'working' ? t('aiWorking') : t('aiThinking')

  // scope chip data, read per render (App re-renders on every selection change)
  const scopeSel = api.selection()
  const hasScopeSelection = !!scopeSel && scopeSel.text.trim().length > 0

  const selectionScopeQuote = (): AiScopeQuoteData | undefined => {
    const sel = api.selection()
    const text = sel?.text.replace(/\s+/g, ' ').trim() ?? ''
    if (!sel || !text) return undefined
    return {
      label: t('aiScopeSelection', {
        page: sel.lastPage > sel.page ? `${sel.page}-${sel.lastPage}` : sel.page,
        words: countWords(text),
      }),
      text: text.length > SCOPE_TEXT_MAX ? `${text.slice(0, SCOPE_TEXT_MAX)}…` : text,
    }
  }

  // the selection can vanish without the × (click-away, another file): close the preview too
  useEffect(() => {
    if (!hasScopeSelection) setScopePreviewOpen(false)
  }, [hasScopeSelection])

  /** [p.N](pdfnav://page/N) links in replies scroll the reading view to that page */
  const pdfNav = {
    scheme: PDF_NAV_SCHEME,
    onNavigate: (href: string) => {
      const page = parsePdfNavHref(href)
      if (page !== null) apiRef.current.gotoPage(page)
    },
  }

  /** Assistant tab: the one-click actions from the old empty state, docs list style */
  const assistantItems = [
    {
      id: 'summary',
      label: t('aiQuickSummary'),
      desc: t('aiQuickSummaryDesc'),
      icon: <IconAiSummarize />,
      run: () => {
        send(t(hasScopeSelection ? 'aiQuickSummarySelPrompt' : 'aiQuickSummaryPrompt'))
        selectTab('chat')
      },
    },
    {
      id: 'key-points',
      label: t('aiQuickKeyPoints'),
      desc: t('aiQuickKeyPointsDesc'),
      icon: <IconAiKeyPoints />,
      run: () => {
        send(t(hasScopeSelection ? 'aiQuickKeyPointsSelPrompt' : 'aiQuickKeyPointsPrompt'))
        selectTab('chat')
      },
    },
  ]

  // LOCAL(2026-09-21, d8201ad0): 会话实例以 div 容器渲染(外壳 aside 是面板根)
  const RootTag = (convMode ? 'div' : 'aside') as 'div'
  return (
    <RootTag
      className={convMode ? 'ai-conversation' : 'copilot'}
      style={convMode ? { display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 } : { width: '100%' }}
      dir={lang === 'ar' || lang === 'he' ? 'rtl' : undefined}
    >
      {!convMode && (
        // LOCAL(2026-09-21, d8201ad0): 弃用销毁式「新对话」按钮——由外壳「+」取代
        <PanelTabs
          tabs={aiTabs}
          activeId={tab}
          onTabChange={selectTab}
          actions={undefined}
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
                        onClick={() => send(entry.text, entry.scope ?? null)}
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
          if (!entry.text && !hasTools) return null
          return (
            <div
              key={i}
              className={`ai-msg ai-msg-assistant${entry.isError ? ' ai-msg-error' : ''}`}
            >
              {hasTools && <ToolChipList tools={entry.tools!} />}
              {entry.text && (
                <div dir="auto">
                  <Markdown
                    text={entry.text}
                    nav={pdfNav}
                    citations={entry.kbCitations}
                    onCitationClick={setKbCiteView}
                  />
                </div>
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
        {fileOpConfirm && (
          <div className="ai-confirm-card" role="group" aria-label={t('aiFileOpConfirmTitle')}>
            <div className="ai-confirm-title">{t('aiFileOpConfirmTitle')}</div>
            <div className="ai-confirm-summary">{fileOpConfirm.summary}</div>
            {fileOpConfirm.detail && (
              <div className="ai-confirm-detail">{fileOpConfirm.detail}</div>
            )}
            <div className="ai-confirm-warning">{t('aiFileOpConfirmWarning')}</div>
            <div className="ai-confirm-actions">
              <button
                type="button"
                className="pdf-modal-btn"
                onClick={() => confirmRef.current?.settle(false)}
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                className="pdf-modal-btn primary"
                onClick={() => confirmRef.current?.settle(true)}
              >
                {t('aiFileOpConfirm')}
              </button>
            </div>
          </div>
        )}
        {/* In-progress state: a standalone three-dot row at the end of the stream, kept until done */}
        {busy && <AiTypingIndicator label={typingLabel} />}
      </div>

      {!convMode && <AssistantTab items={assistantItems} hidden={tab !== 'assistant'} />}

      <div className="ai-composer" style={tab === 'chat' ? undefined : { display: 'none' }}>
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
                    {t('aiScopeSelection', {
                      page:
                        scopeSel!.lastPage > scopeSel!.page
                          ? `${scopeSel!.page}-${scopeSel!.lastPage}`
                          : scopeSel!.page,
                      words: countWords(scopeSel!.text),
                    })}
                  </button>
                  <button
                    className="ai-scope-clear"
                    onClick={() => {
                      setScopePreviewOpen(false)
                      onClearSelection?.()
                    }}
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
                    {scopeSel!.text.length > 400
                      ? `${scopeSel!.text.slice(0, 400)}…`
                      : scopeSel!.text}
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
                  void pdfModelBridge.setCurrentModel(selection).then(refreshPanelSettings)
                }}
                onOpenSettings={() => setModelSettingsOpen(true)}
              />
            </>
          }
          onChange={setPrompt}
          onSend={() => send(prompt)}
          onStop={stop}
        />
      </div>
      {modelSettingsOpen && (
        <Suspense fallback={null}>
          <ModelSettingsPage
            bridge={pdfModelBridge}
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

/** Tool row list (unified with docs/slides/sheets): dot + summary, expandable details when there's output */
/** Step-row status icons (timeline glyphs: 14px in a 20px slot, 1.6 stroke) */
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

/** Tool activity group: a single quiet summary row
 *  that auto-opens while tools run, auto-collapses into "Worked · N steps" when they finish,
 *  and a manual toggle that always wins. Rows inside are step rows with 1px connectors. */
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

  const open = userOpen ?? false
  const label = tr('aiWorkedSteps', { n: tools.length })

  return (
    <div className="ai-work-group">
      <button
        type="button"
        className={`ai-work-group-summary`}
        aria-expanded={open}
        onClick={() => setUserOpen(!open)}
      >
        <span className="ai-work-group-label">{label}</span>
        <span className={`ai-tool-chip-caret${open ? ' open' : ''}`} aria-hidden>
          ›
        </span>
      </button>
      <div className={`ai-work-group-body${open ? ' open' : ''}`}>
        <div className="ai-work-group-body-inner">
          {tools.map((tool, j) => {
            const hasOutput = !!tool.output
            const isOpen = expanded.has(j)
            const stepStatus = tool.isError ? 'error' : 'done'
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

function Svg({ children }: { children: React.ReactNode }): ReactElement {
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

/** ChatOffice brand mark (rounded-square sparkle badge), inline so it renders
 * crisply at device resolution instead of going through <img> rasterization */
export function ChatOfficeMark({ size = 18 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 130 130.025"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M105.115 0H24.6428C11.0443 0 0 11.0686 0 24.6915V105.334C0 118.981 11.0199 130.025 24.6428 130.025H105.115C118.714 130.025 129.758 118.957 129.758 105.334V24.6915C129.758 11.0443 118.714 0 105.115 0ZM71.5201 35.2735C85.5078 33.1571 86.7729 31.9164 88.865 17.88C88.938 17.4421 89.3028 17.1259 89.7407 17.1259C90.1786 17.1259 90.5435 17.4421 90.6164 17.88C92.7328 31.8921 93.9735 33.1571 107.961 35.2735C108.399 35.3465 108.715 35.7114 108.715 36.1493C108.715 36.5871 108.399 36.952 107.961 37.025C93.9249 39.1414 92.7085 40.4064 90.5677 54.6131C90.5191 54.9537 90.2516 55.197 89.911 55.197C89.5704 55.197 89.3028 54.9537 89.2542 54.6131C87.1134 40.4064 85.5565 39.1658 71.4958 37.025C71.0579 36.952 70.7417 36.5871 70.7417 36.1493C70.7417 35.7114 71.0579 35.3465 71.4958 35.2735H71.5201ZM101.758 78.5261C101.758 78.8181 101.563 79.037 101.271 79.0856C92.3193 80.4236 91.5652 81.2264 90.2029 90.2759C90.1786 90.4948 89.9839 90.6408 89.7893 90.6408C89.5703 90.6408 89.4001 90.4948 89.3758 90.2759C88.0135 81.2507 87.0161 80.4479 78.0883 79.0856C77.7964 79.037 77.6017 78.7937 77.6017 78.5261C77.6017 78.2342 77.7964 78.0153 78.0883 77.9666C86.9918 76.6287 87.7703 75.8259 89.1326 66.898C89.1812 66.6061 89.4244 66.4115 89.692 66.4115C89.9839 66.4115 90.2028 66.6061 90.2515 66.898C91.5894 75.8259 92.3923 76.6043 101.296 77.9666C101.588 78.0153 101.782 78.2585 101.782 78.5261H101.758ZM16.5178 54.8077C16.5178 54.1023 17.0286 53.4941 17.7341 53.3968C40.1388 50.0154 42.1093 47.9963 45.4907 25.5672C45.588 24.8861 46.1961 24.3509 46.9016 24.3509C47.6071 24.3509 48.191 24.8617 48.3126 25.5672C51.694 47.9963 53.6887 50.0154 76.0691 53.3968C76.7503 53.4941 77.2855 54.1023 77.2855 54.8077C77.2855 55.5132 76.7746 56.1214 76.0691 56.2187C53.5914 59.6244 51.6696 61.6192 48.2639 84.3645C48.1909 84.8754 47.7287 85.2889 47.2179 85.2889C46.707 85.2889 46.2448 84.8997 46.1718 84.3645C42.7418 61.6435 40.2604 59.6244 17.7584 56.2187C17.0772 56.1214 16.542 55.5132 16.542 54.8077H16.5178ZM112.097 109.591C112.097 111.416 110.613 112.9 108.813 112.9H21.2614C19.4369 112.9 17.9774 111.416 17.9774 109.591V102.658C17.9774 100.834 19.4612 99.3497 21.2614 99.3497H108.813C110.637 99.3497 112.097 100.834 112.097 102.658V109.591Z"
        fill="currentColor"
      />
    </svg>
  )
}


// ── LOCAL(2026-09-21, d8201ad0): 多会话外壳(D1/D5/D9)─────────────────────────
// tab 行 = [会话…][助手];「+」常驻;每会话一个 AiConversationBody 实例。
// pdf 的 fileOpConfirm 卡为实例私有(§4.5)。上游无同类实现;收敛条件:上游若原生
// 实现多会话,评估取上游并删除本地会话池。
// LOCAL(2026-09-22, d8201ad0): D12/D13 增量——历史不再是 tab:「🕘」改 actions 槽
// 常驻图标([+][🕘])的下拉浮层 AiHistoryPopover;空会话(从未发言)关闭直接丢弃、
// 不进历史(hook close() 内分流)。上游动向与收敛条件同上。
const isChatTabP = (tab: AiActiveTab): tab is string =>
  typeof tab === 'string' && tab !== 'assistant' && tab !== 'empty'

export function AiPanel(props: Parameters<typeof AiConversationBody>[0]) {
  const { filePath, dockChrome } = props
  const { t } = useI18n()
  const tempChatIdRef = useRef(`unsaved-${Date.now()}`)
  const conv = useAiConversations(
    { filePath: filePath ?? null, tempChatId: tempChatIdRef.current },
    { persistKey: 'aipdf.aiTab' },
  )
  const bodyHandlesRef = useRef(new Map<string, PdfConversationHandle>())

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
    if (isChatTabP(conv.activeTab) && conv.open.some((c) => c.chatId === conv.activeTab)) {
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

  useEffect(() => {
    const preset = props.preset
    if (!preset) return
    const target = targetChatId()
    const handle = target ? bodyHandlesRef.current.get(target) : undefined
    // pdf preset 沿用原语义(busy 落 composer,否则直接发送)
    if (handle) handle.assist(preset.text)
    else {
      pendingRef.current = { text: preset.text, assist: true }
      conv.create()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.preset?.nonce])

  return (
    <aside className="copilot" style={{ width: '100%', position: 'relative' }}>
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
    </aside>
  )
}
