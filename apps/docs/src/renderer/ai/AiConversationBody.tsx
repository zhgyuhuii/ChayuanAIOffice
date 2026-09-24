/**
 * LOCAL(2026-09-21, d8201ad0): docs 多会话改造——按会话 chatId 实例化的对话体(B 区新文件)。
 * 原 AiPanel 的单份对话体(消息流 + composer + 附件条 + 会话私有状态 + 每会话 loop)
 * 原样搬入;面板级共享资源(writer、trackChanges 状态、模型设置页、知识库共享选中态、
 * editQueue 数据、助手 tab 体)留在 AiPanel,经 props 注入。上游无此文件。
 *
 * 资源归属分类(多会话计划 §4.5,docs 端结论,实施前已核):
 *   实例私有(进本组件,卸载时清理):chat/historicChat 转录、busy、input、loop(惰性,首次
 *     runWith 才构造)、pendingSend、runTools/runSnapshot/runUserText/instruction/
 *     lastInstruction/lastAttachments/lastScope、attachments/sentAttachments/attachNotice/
 *     previews、logRef/inputRef/stickToBottom、copiedIdx、kbCiteView;
 *   面板级共享(绝不进实例清理,§4.5 writer 特别说明):runDocWriter/transport/writerEpoch/
 *     partial 卡、trackChanges 状态、panelSettings、kb(useKbAugment 共享选中态)、editQueue
 *     数据、ModelSettingsPage;
 *   全局/UI(原地不动):语言、主题。
 *
 * D10 断点续作:取消的轮次若已有半截文本或工具活动,照常落盘并打 interrupted 标记
 * (全空不落盘);恢复路径 loadChat limit 10_000 全量装载(D11)→ 缓冲 → 首次 runWith
 * 建 loop 时 restore 灌回(含半截文本);最后一轮 interrupted 显示「继续」入口。
 */
import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { Block } from '@chatoffice/docx-engine'
import { AgentLoop, composeSkills, streamText, type AgentImage, type AgentTransport } from '@chatoffice/agent-core'
import type { AiSettingsV2, AttachmentAddResult, AttachmentMeta } from '../../shared/ipc'
import { ATTACHMENT_IMAGE_EXTS } from '../../shared/ipc'
import type { PmNode } from '../editor/convert'
import { TABLE_TRAILING_SKIP } from '../editor/extensions'
import { countWords, findNumId, type NumIds } from './protocol'
import { DOC_NAV_SCHEME, navigateToBlock, parseDocNavHref } from './doc-nav'
import { setInactiveSelectionShown } from '../editor/inactive-selection'
import { applyRevisionsBy } from '../editor/revisions'
import { waitForFullContent } from '../phased-content'
import { currentDocGeneration } from '../file-actions'
import type { DocWriteResult, DocWriteSpec } from './doc-writer'
import { aiLangDirective, t as tModule, useI18n, type StringKey } from '../i18n/locale'
import {
  AiComposer,
  AiTypingIndicator,
  AiScopeQuote,
  KbCitePreview,
  KbPickerButton,
  Markdown,
  ModelPickerButton,
  useKbAugment,
  USER_LOGIN_READY,
  AI_CONTINUE_INSTRUCTION,
  type AiScopeQuoteData,
  type KbCitation,
} from '@chatoffice/ui'
import { enabledChatModels } from '@chatoffice/ai-provider/browser'
import { AI_REVISION_AUTHOR } from './AiPanel'
import { markDocSeen, type AiCommentsAccess, type AiDocExtras, type AiHeaderFooterAccess } from './tools'
import type { AiPageSetupAccess } from './page-setup'
import type { AiNotesAccess } from './note-ops'
import { EditQueueCard } from './EditQueueCard'
import {
  buildQueueInstruction,
  buildQueueSummary,
  liveItems,
  resolveQueue,
  type DocsEditQueueItem,
} from './edit-queue'
import { createFilesSkill } from './files-skill'
import { createDocsSkill } from './docs-skill'
import { createDocsMediaSkill } from './media-skill'
import { insertImageFromDataUrl } from '../components/ribbon-tabs'
import {
  AttachmentCardIcon,
  EditStarters,
  DraftStarters,
  PASTE_MIME_EXT,
  PERSIST_TOOL_FIELD_MAX,
  SCOPE_TEXT_MAX,
  TOOL_OUTPUT_MAX_CHARS,
  SentAttachments,
  ToolChipList,
  RollbackButton,
  formatAttachmentSize,
  safeJsonInput,
  truncateCardName,
  type ChatEntry,
  type ToolActivity,
} from './ai-body-types'
import attachIcon from '../assets/attach-icon.png'
import fileImageIcon from '../assets/file-image.png'

export interface AiConversationBodyProps {
  chatId: string
  /** project id from the conversation pool (appendChat/loadChat need it) */
  projectId: string | null
  editor: Editor
  blocks: Block[]
  numIdFallback?: NumIds | null
  /** the document has no text yet — the empty-state copy offers drafting instead of editing */
  docEmpty?: boolean
  /** panel-level shared settings (model picker + loop) */
  settings: AiSettingsV2
  /** shared electron transport (panel-level, cheap to share) */
  transport: AgentTransport
  trackChanges: boolean
  onToggleTrackChanges: (next: boolean) => void
  commentsAccess?: AiCommentsAccess
  hfAccess?: AiHeaderFooterAccess
  pageSetupAccess?: AiPageSetupAccess
  docExtras?: AiDocExtras
  notesAccess?: AiNotesAccess
  /**
   * panel-level shared writer (对话体 write 工具与助手体共用,实例卸载绝不清理)。
   * patch routes the writing chip into THIS conversation's transcript.
   */
  runDocWriter: (
    spec: DocWriteSpec,
    onProgress: (html: string) => void,
    signal?: AbortSignal,
    patch?: (patch: Partial<ChatEntry> | ((last: ChatEntry) => Partial<ChatEntry>)) => void,
  ) => Promise<DocWriteResult>
  /** panel-level shared partial card state */
  activePartial: { blocks: number } | null
  decidePartial: (keep: boolean) => void
  /** shared KB augment (selection state shared with the assistant tab) */
  kb: ReturnType<typeof useKbAugment>
  /** queued selection-scoped edits (owned by App, panel-level data) */
  editQueue: DocsEditQueueItem[]
  onQueueEditInstruction?: (qid: string, instruction: string) => void
  onQueueRemove?: (qid: string) => void
  onQueueClear?: () => void
  onQueueFocus?: (qid: string) => void
  onQueueConsume?: (qids: string[]) => void
  /** P2-5 回流薄钩: a completed panel turn is reported to the host */
  onTurnCompleted?: (turn: { userText: string; assistantText: string; cancelled: boolean }) => void
  /** conversation-pool reporting (tab dot / title / last-active) */
  onRunningChange: (running: boolean) => void
  onFirstMessage: (text: string) => void
  onTurnEnd: () => void
  onRegister: (handle: AiConversationHandle) => void
  onUnregister: () => void
  onOpenModelSettings: () => void
  onPickModel: React.ComponentProps<typeof ModelPickerButton>['onPick']
}

/** command handle the panel holds per conversation (stop-then-close flow, plan §4.3) */
export interface AiConversationHandle {
  stop(): Promise<void>
  runWith(instruction: string, display?: string): void
  setDraft(text: string): void
  addAttachmentPaths(paths: string[]): void
}

export function AiConversationBody({
  chatId,
  projectId,
  editor,
  blocks,
  numIdFallback,
  docEmpty,
  settings,
  transport,
  trackChanges,
  onToggleTrackChanges,
  commentsAccess,
  hfAccess,
  pageSetupAccess,
  docExtras,
  notesAccess,
  runDocWriter,
  activePartial,
  decidePartial,
  kb,
  editQueue,
  onQueueEditInstruction,
  onQueueRemove,
  onQueueClear,
  onQueueFocus,
  onQueueConsume,
  onTurnCompleted,
  onRunningChange,
  onFirstMessage,
  onTurnEnd,
  onRegister,
  onUnregister,
  onOpenModelSettings,
  onPickModel,
}: AiConversationBodyProps) {
  const { lang, t } = useI18n()
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  /** waiters resolved when a run fully settles (stop() awaits them: D10 时序保证) */
  const idleWaitersRef = useRef<Array<() => void>>([])
  const setBusyTracked = (v: boolean): void => {
    busyRef.current = v
    setBusy(v)
    if (!v) {
      const waiters = idleWaitersRef.current
      idleWaitersRef.current = []
      for (const w of waiters) w()
    }
  }
  /** a send waiting on a phased open's tail; Stop / close abort it before it runs */
  const pendingSendRef = useRef<{ aborted: boolean } | null>(null)
  const [chat, setChat] = useState<ChatEntry[]>([])
  /** this conversation's transcript loaded from the jsonl (read-only above the live turn) */
  const [historicChat, setHistoricChat] = useState<(ChatEntry & { interrupted?: boolean })[]>([])
  /** messages buffered for the loop: history loads at mount, the loop is built on
      the first runWith — the buffer is restored into the loop at construction (D10/D11) */
  const bufferedRestoreRef = useRef<Array<{ role: 'user' | 'assistant'; text: string }> | null>(null)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([])
  const [attachNotice, setAttachNotice] = useState<string | null>(null)
  /** data-URL previews for image attachments, keyed by path */
  const [attachmentPreviews, setAttachmentPreviews] = useState<Record<string, string>>({})
  const previewRequestedRef = useRef(new Set<string>())
  /** Attachments consumed by earlier sends this session */
  const sentAttachmentsRef = useRef<AttachmentMeta[]>([])
  /** Wall-clock start of the current run (kept from the pre-refactor shape) */
  const runStartedAtRef = useRef(0)
  /** bumped on selection/doc changes so the scope hint & quick actions stay fresh */
  const [, setScopeTick] = useState(0)
  /** the scope chip's expandable preview of the selected text */
  const [scopePreviewOpen, setScopePreviewOpen] = useState(false)
  const [kbCiteView, setKbCiteView] = useState<KbCitation | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  /** false once the user scrolls up to read; re-arms near the bottom */
  const stickToBottomRef = useRef(true)
  const [dragOver, setDragOver] = useState(false)
  /** paints the strip's scrollbar thumb while the user scrolls it */
  const attachScrollFadeRef = useRef(0)
  const onAttachmentsScroll = (e: React.UIEvent<HTMLDivElement>): void => {
    const el = e.currentTarget
    el.classList.add('is-scrolling')
    window.clearTimeout(attachScrollFadeRef.current)
    attachScrollFadeRef.current = window.setTimeout(() => el.classList.remove('is-scrolling'), 800)
  }

  // latest props for the loop's closures (the loop instance outlives renders)
  const editorRef = useRef(editor)
  editorRef.current = editor
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const blocksRef = useRef(blocks)
  blocksRef.current = blocks
  const numIdFallbackRef = useRef(numIdFallback)
  numIdFallbackRef.current = numIdFallback
  const attachmentsRef = useRef(attachments)
  attachmentsRef.current = attachments
  const lastAttachmentsRef = useRef<AttachmentMeta[]>([])
  // LOCAL(2026-09-22, f5247d3..476e5023): 上游 #544 analyze_media 门控重放为本地能力旗标
  // (统一媒体通道的 imageUnderstanding/videoUnderstanding;mount+focus 刷新,照上游
  // gskLoggedInRef 模式)——未配置分析模型时 docs-skill 隐藏 analyze_media 工具
  const mediaCapsRef = useRef({ imageUnderstanding: false, videoUnderstanding: false })
  useEffect(() => {
    let alive = true
    const refresh = () => {
      // tests render the body without a preload bridge
      void (window as unknown as {
        desktop?: { mediaCapabilities?: () => Promise<{ flags?: Record<string, boolean> }> }
      })
        .desktop?.mediaCapabilities?.()
        .then((caps) => {
          if (!alive || !caps?.flags) return
          mediaCapsRef.current = {
            imageUnderstanding: !!caps.flags.imageUnderstanding,
            videoUnderstanding: !!caps.flags.videoUnderstanding,
          }
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
  /** the scope quote of the last send, so a retry reuses it instead of re-reading the live selection */
  const lastScopeRef = useRef<AiScopeQuoteData | undefined>(undefined)
  const trackChangesRef = useRef(trackChanges)
  trackChangesRef.current = trackChanges
  const commentsAccessRef = useRef(commentsAccess)
  commentsAccessRef.current = commentsAccess
  const hfAccessRef = useRef(hfAccess)
  hfAccessRef.current = hfAccess
  const pageSetupAccessRef = useRef(pageSetupAccess)
  pageSetupAccessRef.current = pageSetupAccess
  const docExtrasRef = useRef(docExtras)
  docExtrasRef.current = docExtras
  const notesAccessRef = useRef(notesAccess)
  notesAccessRef.current = notesAccess

  /** composer attachments plus everything already sent this session (deduped by path) */
  const availableAttachments = (): AttachmentMeta[] => {
    const seen = new Set<string>()
    return [...sentAttachmentsRef.current, ...attachmentsRef.current].filter((a) =>
      seen.has(a.path) ? false : (seen.add(a.path), true),
    )
  }

  /** drop every aiChanged flag; silent = skip undo history (auto-accept path) */
  const clearAiHighlights = (silent = false) => {
    const view = editorRef.current.view
    let tr = view.state.tr
    let touched = false
    view.state.doc.forEach((node, offset) => {
      if (node.attrs.aiChanged) {
        tr = tr.setNodeMarkup(offset, undefined, { ...node.attrs, aiChanged: false })
        touched = true
      }
    })
    if (silent) tr = tr.setMeta('addToHistory', false)
    if (touched) {
      view.dispatch(tr)
      // AI-pipeline housekeeping, not a user edit: keep the freshness baseline current
      markDocSeen(editorRef.current)
    }
  }
  /** instruction of the in-flight run */
  const instructionRef = useRef('')
  /** model id driving the in-flight run — shown on this turn's assistant bubbles */
  const runModelRef = useRef<string | undefined>(undefined)
  /** document state before the run's first edit */
  const runSnapshotRef = useRef<PmNode | null>(null)
  /** raw user instruction of the in-flight turn (P2-5 回流薄钩 payload) */
  const runUserTextRef = useRef('')
  /** last sent instruction, for one-click retry */
  const lastInstructionRef = useRef('')
  /** Tool activity of the whole run (accumulated across turns) */
  const runToolsRef = useRef<
    Array<{ name: string; summary: string; isError?: boolean; input?: string; output?: string }>
  >([])
  /** the loop's streamed text so far — the interrupted persist keeps this half turn (D10) */
  const halfTextRef = useRef('')

  // ── per-conversation persistence ──────────────────────────────────────
  const persistMessage = (
    role: 'user' | 'assistant',
    text: string,
    tools?: ToolActivity[],
    attachments?: AttachmentMeta[],
    scope?: AiScopeQuoteData,
    interrupted?: boolean,
  ) => {
    const api = (window as Window & { projectApi?: typeof window.projectApi }).projectApi
    if (!projectId || !api) return
    void api
      .appendChat({
        projectId,
        chatId,
        role,
        text,
        ...(interrupted ? { interrupted: true } : {}),
        ...(tools && tools.length > 0 ? { tools } : {}),
        ...(attachments && attachments.length > 0
          ? {
              attachments: attachments.map((a) => ({
                name: a.name,
                path: a.path,
                ext: a.ext,
                sizeBytes: a.sizeBytes,
              })),
            }
          : {}),
        ...(scope ? { scope } : {}),
      })
      .catch(() => {
        /* silent */
      })
  }

  // lazy-load this conversation's jsonl (limit 10_000 = the store cap = full load, D11)
  useEffect(() => {
    const api = (window as Window & { projectApi?: typeof window.projectApi }).projectApi
    if (!api || !projectId) return
    let disposed = false
    void api
      .loadChat({ projectId, chatId, limit: 10_000 })
      .then((msgs) => {
        if (disposed || msgs.length === 0) return
        setHistoricChat(
          msgs.map((m) => ({
            role: m.role,
            text: m.text,
            interrupted: m.interrupted === true,
            tools: m.tools?.map((tl) => ({
              name: tl.name,
              summary: tl.summary,
              isError: tl.isError,
              output: tl.output ? tl.output.slice(0, TOOL_OUTPUT_MAX_CHARS) : undefined,
            })),
            // stored metadata only: no thumbnail read for history, the chips render name/size
            attachments: m.attachments
              ?.filter((a) => a.path)
              .map((a) => ({
                name: a.name,
                path: a.path ?? '',
                ext: a.ext ?? '',
                sizeBytes: a.sizeBytes ?? 0,
              })),
            ...(m.scope ? { scope: m.scope } : {}),
          })),
        )
        // D10/D11 hard chain: buffer → restore into the loop at its construction
        // (before the first send). Never drop the restore when the loop is lazy.
        bufferedRestoreRef.current = msgs.map((m) => ({ role: m.role, text: m.text }))
        // legacy seeded conversations get their title backfilled from the first user message
        const firstUser = msgs.find((m) => m.role === 'user')
        if (firstUser) onFirstMessage(firstUser.text)
      })
      .catch(() => {
        /* history load failures are silent */
      })
    return () => {
      disposed = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, chatId])

  const patchLastAssistant = (
    patch: Partial<ChatEntry> | ((last: ChatEntry) => Partial<ChatEntry>),
  ) => {
    setChat((prev) => {
      const next = [...prev]
      const last = next[next.length - 1]
      if (!last || last.role !== 'assistant') return prev
      next[next.length - 1] = { ...last, ...(typeof patch === 'function' ? patch(last) : patch) }
      return next
    })
  }
  const patchLastAssistantRef = useRef(patchLastAssistant)
  patchLastAssistantRef.current = patchLastAssistant

  /** the per-conversation loop: lazily constructed on the first runWith (计划 §8 风险) */
  const loopRef = useRef<AgentLoop<PmNode> | null>(null)
  const ensureLoop = (): AgentLoop<PmNode> => {
    if (loopRef.current) return loopRef.current
    const numIds = (): NumIds => ({
      bullet: findNumId(blocksRef.current, 'bullet') ?? numIdFallbackRef.current?.bullet ?? null,
      ordered: findNumId(blocksRef.current, 'ordered') ?? numIdFallbackRef.current?.ordered ?? null,
    })
    const loop = new AgentLoop<PmNode>({
      transport,
      systemSuffix: aiLangDirective,
      skill: composeSkills('docs+files', '', [
        createDocsMediaSkill(),
        createDocsSkill(
          () => editorRef.current,
          numIds,
          () => (trackChangesRef.current ? { author: AI_REVISION_AUTHOR } : undefined),
          () => commentsAccessRef.current,
          () => hfAccessRef.current,
          () => settingsRef.current.imageSource ?? 'auto',
          () => ({
            write: (spec, onProgress, signal) =>
              runDocWriter(spec, onProgress, signal, (p) => patchLastAssistantRef.current(p)),
          }),
          () => pageSetupAccessRef.current,
          () => docExtrasRef.current,
          () => notesAccessRef.current,
          // LOCAL(2026-09-22, f5247d3..476e5023): 上游 #544——analyze_media 按媒体分析能力
          // 隐藏(本地门=统一媒体通道能力旗标,替代上游 gskLoggedIn+BYOK 判定)
          () => mediaCapsRef.current.imageUnderstanding || mediaCapsRef.current.videoUnderstanding,
        ),
        createFilesSkill(availableAttachments),
      ]),
      captureSnapshot: () => editorRef.current.getJSON() as PmNode,
      events: {
        onText: (text) => {
          if (text) halfTextRef.current = text
          patchLastAssistant({ text })
        },
        onToolStart: (call) => {
          // Live "running" chip: replaced in place by onToolExecuted
          patchLastAssistant((last) => ({
            tools: [
              ...(last.tools ?? []),
              { name: call.name, summary: call.name.replace(/[_-]+/g, ' '), running: true },
            ],
          }))
        },
        onToolExecuted: ({ call, execution, snapshotBefore }) => {
          // The run's first pre-edit state wins so one roll-back undoes the whole run
          if (snapshotBefore && !runSnapshotRef.current) runSnapshotRef.current = snapshotBefore
          if (execution.mutated) {
            // tracking off: accept immediately; tracking on: handled in the Review tab
            if (!trackChangesRef.current) clearAiHighlights(true)
          }
          runToolsRef.current.push({
            name: call.name,
            summary: execution.summary,
            isError: execution.isError,
            input: safeJsonInput(call.input),
            output: execution.output
              ? execution.output.slice(0, PERSIST_TOOL_FIELD_MAX)
              : undefined,
          })
          patchLastAssistant((last) => {
            // Swap out the running placeholder pushed by onToolStart (parse-fail calls have none)
            const tools = [...(last.tools ?? [])]
            if (tools.at(-1)?.running) tools.pop()
            return {
              tools: [
                ...tools,
                {
                  name: call.name,
                  summary: execution.summary,
                  isError: execution.isError,
                  output: execution.output
                    ? execution.output.slice(0, TOOL_OUTPUT_MAX_CHARS)
                    : undefined,
                },
              ],
            }
          })
        },
        onTurnEnd: () => {
          patchLastAssistant({ streaming: false })
          setChat((prev) => [
            ...prev,
            { role: 'assistant', text: '', streaming: true, model: runModelRef.current },
          ])
        },
        onDone: ({ text, cancelled, turnLimit, truncated }) => {
          // module-level t: the loop is created once; the component's t goes stale
          const baseText = turnLimit
            ? [text, tModule('aiTurnLimit')].filter(Boolean).join('\n\n')
            : text || (cancelled ? tModule('aiStopped') : '')
          const finalText = truncated
            ? [baseText, tModule('aiTruncatedNote')].filter(Boolean).join('\n\n')
            : baseText
          patchLastAssistant((last) => ({
            streaming: false,
            turnLimit,
            text: finalText || (last.tools?.length ? last.text : tModule('aiNoReply')),
            // A stop mid-tool can leave a running placeholder behind — drop it
            tools: last.tools?.filter((tl) => !tl.running),
            snapshot: runSnapshotRef.current ?? undefined,
          }))
          setBusyTracked(false)
          // a run that generated content into a never-saved document triggers a
          // silent first save with a content-derived file name
          window.dispatchEvent(new Event('ai-docs-run-done'))
          // D10: a cancelled turn persists its half text + tool activity with the
          // interrupted flag; a fully empty cancel persists nothing (断点 = 任务起点)
          if (cancelled) {
            const half = text
            if ((half && half.trim()) || runToolsRef.current.length > 0) {
              persistMessage('assistant', half, runToolsRef.current, undefined, undefined, true)
            }
          } else if (finalText || runToolsRef.current.length > 0) {
            // Edits-only runs (tools ran, no text) persist too, or the whole turn vanishes
            persistMessage('assistant', finalText, runToolsRef.current)
          }
          onTurnCompleted?.({
            userText: runUserTextRef.current,
            assistantText: finalText,
            cancelled,
          })
          onTurnEnd()
        },
        onError: (error) => {
          setChat((prev) => {
            const next = [...prev]
            const last = next.at(-1)
            if (last?.role === 'assistant') {
              next[next.length - 1] = {
                ...last,
                streaming: false,
                error,
                tools: last.tools?.filter((tl) => !tl.running),
                snapshot: runSnapshotRef.current ?? undefined,
              }
            }
            return next
          })
          // Signed-out failures get an inline sign-in button
          void window.desktop
            .aiChatOfficeStatus()
            .then((status) => {
              if (status.loggedIn) return
              setChat((prev) => {
                const next = [...prev]
                const last = next.at(-1)
                if (last?.role === 'assistant' && last.error) {
                  next[next.length - 1] = { ...last, loginRequired: true }
                }
                return next
              })
            })
            .catch(() => {})
          setBusyTracked(false)
        },
      },
    })
    loopRef.current = loop
    // D10 hard chain: restored history (incl. interrupted half text) feeds the
    // loop before the first send — a lazy loop must never start empty when history exists
    if (bufferedRestoreRef.current && bufferedRestoreRef.current.length > 0) {
      loop.restore(bufferedRestoreRef.current)
      bufferedRestoreRef.current = null
    }
    return loop
  }

  useEffect(() => {
    onRunningChange(busy)
  }, [busy, onRunningChange])

  // keep the scope hint & quick actions in sync with the editor selection
  useEffect(() => {
    const bump = () => {
      if (editor.state.selection.empty) setScopePreviewOpen(false)
      setScopeTick((t) => t + 1)
    }
    editor.on('selectionUpdate', bump)
    editor.on('update', bump)
    return () => {
      editor.off('selectionUpdate', bump)
      editor.off('update', bump)
    }
  }, [editor])

  // scope chip data, recomputed per render (the scope tick above keeps it fresh)
  const liveSelection = editor.state.selection
  const selectionText = liveSelection.empty
    ? ''
    : editor.state.doc.textBetween(liveSelection.from, liveSelection.to, '\n', ' ').trim()
  const hasScopeSelection = selectionText.length > 0

  /** the × on the scope chip: collapse the selection so the run targets the whole document */
  const clearScopeSelection = () => {
    editor.commands.setTextSelection(editor.state.selection.to)
  }

  const selectionScopeQuote = (): AiScopeQuoteData | undefined => {
    const { from, to, empty } = editor.state.selection
    if (empty) return undefined
    const text = editor.state.doc.textBetween(from, to, ' ', ' ').replace(/\s+/g, ' ').trim()
    if (!text) return undefined
    return {
      label: t('aiScopeSelection', { words: countWords(text) }),
      text: text.length > SCOPE_TEXT_MAX ? `${text.slice(0, SCOPE_TEXT_MAX)}…` : text,
    }
  }

  // the frozen-range highlight ends with the run, or as soon as the editor is focused again
  useEffect(() => {
    if (!busy) setInactiveSelectionShown(editor, false)
  }, [busy, editor])
  useEffect(() => {
    const off = () => setInactiveSelectionShown(editor, false)
    editor.on('focus', off)
    return () => {
      editor.off('focus', off)
    }
  }, [editor])

  /** [label](docnav://block/N) links in replies select and scroll to that block */
  const docNav = {
    scheme: DOC_NAV_SCHEME,
    onNavigate: (href: string) => {
      const index = parseDocNavHref(href)
      if (index !== null) navigateToBlock(editorRef.current, index)
    },
  }

  // follow the stream, but stop yanking once the user scrolls up to read
  useEffect(() => {
    if (stickToBottomRef.current) {
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
    }
  }, [chat])

  const onLogScroll = () => {
    const el = logRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }

  const run = () => runWith(input.trim())

  /** Image attachments are read as base64 and go multimodal with this user message (≤5MB per image, max 20) */
  const MAX_IMAGES_PER_MESSAGE = 20
  const collectImageAttachments = async (atts: AttachmentMeta[]): Promise<AgentImage[]> => {
    const imageAtts = atts.filter((a) => ATTACHMENT_IMAGE_EXTS.has(a.ext))
    const images: AgentImage[] = []
    const failures: string[] = []
    for (const att of imageAtts.slice(0, MAX_IMAGES_PER_MESSAGE)) {
      const result = await window.desktop.readAttachmentImage(att.path)
      if (result.ok && result.base64 && result.mime) {
        images.push({ base64: result.base64, mime: result.mime })
      } else {
        failures.push(result.error ?? t('aiImageReadFail', { name: att.name }))
      }
    }
    if (imageAtts.length > MAX_IMAGES_PER_MESSAGE) {
      failures.push(t('aiTooManyImages', { max: MAX_IMAGES_PER_MESSAGE }))
    }
    if (failures.length > 0) {
      setAttachNotice(failures.join(';'))
      window.setTimeout(() => setAttachNotice(null), 5000)
    }
    return images
  }

  const runWith = (
    instruction: string,
    displayInstruction = instruction,
    attachmentsOverride?: AttachmentMeta[],
    /** null = a retry that had no scope; undefined = capture the live selection */
    retryScope?: AiScopeQuoteData | null,
  ) => {
    if (!instruction) return
    const loop = ensureLoop()
    if (loop.busy || pendingSendRef.current) return
    setInput('')
    // The message consumes the composer attachments: they ride along and the composer clears.
    const sentAtts = attachmentsOverride ?? attachmentsRef.current
    if (!attachmentsOverride && sentAtts.length > 0) {
      const seen = new Set(sentAttachmentsRef.current.map((a) => a.path))
      sentAttachmentsRef.current = [
        ...sentAttachmentsRef.current,
        ...sentAtts.filter((a) => !seen.has(a.path)),
      ]
      setAttachments([])
    }
    lastAttachmentsRef.current = sentAtts
    // the queue batch and the continue action carry their own display text: no selection quote
    const scope =
      retryScope !== undefined
        ? (retryScope ?? undefined)
        : displayInstruction === instruction
          ? selectionScopeQuote()
          : undefined
    lastScopeRef.current = scope
    // the popover input / composer own the DOM selection now: keep the targeted range visible
    if (scope) setInactiveSelectionShown(editor, true)
    instructionRef.current = instruction
    lastInstructionRef.current = instruction
    runToolsRef.current = []
    runSnapshotRef.current = null
    halfTextRef.current = ''
    stickToBottomRef.current = true
    runModelRef.current = settingsRef.current.currentModel?.modelId
    setChat((prev) => [
      ...prev,
      {
        role: 'user',
        text: displayInstruction,
        ...(sentAtts.length > 0 ? { attachments: sentAtts } : {}),
        ...(scope ? { scope } : {}),
      },
      { role: 'assistant', text: '', streaming: true, model: runModelRef.current },
    ])
    runStartedAtRef.current = Date.now()
    setBusyTracked(true)
    // claimed before the async image read so Stop / close can flag this send at any point
    const generation = currentDocGeneration()
    const pending = { aborted: false }
    pendingSendRef.current = pending
    onFirstMessage(displayInstruction)
    persistMessage('user', instruction, undefined, sentAtts, scope)
    // a rejected image read must not strand the run (busy would stay true forever)
    void collectImageAttachments(sentAtts)
      .catch((): AgentImage[] => {
        setAttachNotice(t('aiImagesSendFailed'))
        window.setTimeout(() => setAttachNotice(null), 5000)
        return []
      })
      // a phased open still streaming its tail: the context must describe the whole document
      .then(async (images) => {
        await waitForFullContent()
        // a newer send (after close/reset) owns the conversation now: leave its state alone
        if (pendingSendRef.current !== pending) return
        pendingSendRef.current = null
        // the wait ended because another document replaced this one, or the
        // user stopped the chat meanwhile: nothing to run
        if (pending.aborted || currentDocGeneration() !== generation) {
          setChat((prev) =>
            prev.filter(
              (m, i) => !(i === prev.length - 1 && m.role === 'assistant' && m.streaming),
            ),
          )
          setBusyTracked(false)
          return
        }
        runUserTextRef.current = instruction
        const kbInstruction = await kb.augment(instruction)
        const kbCitations = kb.lastCitations.current
        if (kbCitations.length > 0) {
          setChat((prev) =>
            prev.map((m, i) =>
              i === prev.length - 1 && m.role === 'assistant' && m.streaming
                ? { ...m, kbCitations }
                : m,
            ),
          )
        }
        return loop.run(kbInstruction, images)
      })
  }
  const runWithRef = useRef(runWith)
  runWithRef.current = runWith

  const cancel = () => {
    if (pendingSendRef.current) pendingSendRef.current.aborted = true
    loopRef.current?.cancel()
  }

  /** stop-and-close flow (D5/D10): abort the in-flight run; resolves after the
      interrupted turn's persist has been issued (idle waiters) */
  const stop = async (): Promise<void> => {
    if (pendingSendRef.current) {
      pendingSendRef.current.aborted = true
      pendingSendRef.current = null
    }
    loopRef.current?.cancel()
    if (!busyRef.current) return
    await new Promise<void>((resolve) => idleWaitersRef.current.push(resolve))
  }
  const stopRef = useRef(stop)
  stopRef.current = stop

  /** submit every still-anchored queued edit as one batch run */
  const sendQueue = () => {
    const loop = loopRef.current
    if (!loop || loop.busy || editQueue.length === 0) return
    const entries = liveItems(resolveQueue(editorRef.current, editQueue))
    if (entries.length === 0) {
      onQueueClear?.()
      return
    }
    const instruction = buildQueueInstruction(entries)
    const display = buildQueueSummary(t('aiQueueSubmitted', { count: entries.length }), entries)
    // consumed at send: the run rewrites the anchored passages, which would
    // orphan the anchors anyway; a failed run is retried via the retry action
    onQueueConsume?.(editQueue.map((item) => item.qid))
    runWith(instruction, display)
  }

  const retry = () =>
    runWith(
      lastInstructionRef.current,
      lastInstructionRef.current,
      lastAttachmentsRef.current,
      lastScopeRef.current ?? null,
    )

  const continueRun = () => runWith(AI_CONTINUE_INSTRUCTION, t('aiContinue'))

  const copyMessage = (text: string, idx: number) => {
    void navigator.clipboard.writeText(text)
    setCopiedIdx(idx)
    window.setTimeout(() => setCopiedIdx((cur) => (cur === idx ? null : cur)), 1200)
  }

  const mergeAttachments = (result: AttachmentAddResult | null) => {
    if (!result) return
    if (result.accepted.length > 0) {
      setAttachments((prev) => {
        const seen = new Set(prev.map((a) => a.path))
        return [...prev, ...result.accepted.filter((a) => !seen.has(a.path))]
      })
    }
    if (result.rejected.length > 0) {
      setAttachNotice(result.rejected.join(';'))
      window.setTimeout(() => setAttachNotice(null), 5000)
    }
  }
  const mergeAttachmentsRef = useRef(mergeAttachments)
  mergeAttachmentsRef.current = mergeAttachments

  const pickAttachments = async () => mergeAttachments(await window.desktop.pickAttachments())

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => window.desktop.getPathForFile(f))
      .filter(Boolean)
    if (paths.length > 0) mergeAttachments(await window.desktop.addAttachmentPaths(paths))
  }

  /** Files pasted into the input: ones with a local path go through regular attachments; pure bitmaps hit a temp file first */
  const onPasteFiles = async (files: File[]) => {
    const paths: string[] = []
    for (const f of files) {
      const p = window.desktop.getPathForFile(f)
      if (p) {
        paths.push(p)
        continue
      }
      const ext = PASTE_MIME_EXT[f.type] ?? f.name.split('.').pop()?.toLowerCase() ?? 'bin'
      mergeAttachments(await window.desktop.addPastedImage(await f.arrayBuffer(), ext))
    }
    if (paths.length > 0) mergeAttachments(await window.desktop.addAttachmentPaths(paths))
  }

  const removeAttachment = (path: string) =>
    setAttachments((prev) => prev.filter((a) => a.path !== path))

  const acceptChanges = () => {
    applyRevisionsBy(editorRef.current, AI_REVISION_AUTHOR, 'accept')
    clearAiHighlights()
  }

  const toggleTrackChanges = () => {
    const next = !trackChanges
    onToggleTrackChanges(next)
    // switching off keeps nothing pending: accept whatever is still highlighted
    if (!next) acceptChanges()
  }

  const rollback = (entryIdx: number, snapshot: PmNode) => {
    editor
      .chain()
      .setMeta(TABLE_TRAILING_SKIP, true)
      .setContent(snapshot as never)
      .run()
    // The document rewound to before this turn, so this and every later
    // rollback point now describe discarded futures
    setChat((prev) =>
      prev.map((e, i) => (i >= entryIdx && e.snapshot ? { ...e, snapshot: undefined } : e)),
    )
  }

  // previews cover the composer plus every image echoed on a sent/history message
  useEffect(() => {
    const wanted = [
      ...attachments,
      ...chat.flatMap((e) => e.attachments ?? []),
      ...historicChat.flatMap((e) => e.attachments ?? []),
    ]
    const alive = new Set(wanted.map((a) => a.path))
    // drop previews (and request markers) of removed attachments
    setAttachmentPreviews((prev) => {
      const stale = Object.keys(prev).filter((p) => !alive.has(p))
      if (stale.length === 0) return prev
      const next = { ...prev }
      for (const p of stale) delete next[p]
      return next
    })
    for (const p of previewRequestedRef.current) {
      if (!alive.has(p)) previewRequestedRef.current.delete(p)
    }
    for (const a of wanted) {
      if (!ATTACHMENT_IMAGE_EXTS.has(a.ext) || previewRequestedRef.current.has(a.path)) continue
      previewRequestedRef.current.add(a.path)
      void window.desktop
        .readAttachmentImage(a.path)
        .then((r) => {
          if (!previewRequestedRef.current.has(a.path)) return
          if (r.ok && r.base64 && r.mime) {
            setAttachmentPreviews((prev) => ({
              ...prev,
              [a.path]: `data:${r.mime};base64,${r.base64}`,
            }))
          }
        })
        .catch(() => {
          // A rejected read must not leave the path marked requested forever
          previewRequestedRef.current.delete(a.path)
        })
    }
  }, [attachments, chat, historicChat])

  // instance-private cleanup on unmount: abort this conversation's in-flight
  // work; the loop's onDone still persists the interrupted half turn (D10).
  // 面板级共享资源(writer/trackChanges/kb)绝不在此清理(§4.5)。
  useEffect(
    () => () => {
      if (pendingSendRef.current) pendingSendRef.current.aborted = true
      loopRef.current?.cancel()
    },
    [],
  )

  // register the command handle once; methods route through refs (always fresh)
  const handleRef = useRef<AiConversationHandle | null>(null)
  if (!handleRef.current) {
    handleRef.current = {
      stop: () => stopRef.current(),
      runWith: (instruction, display) => runWithRef.current(instruction, display),
      setDraft: (text) => {
        setInput(text)
        window.setTimeout(() => inputRef.current?.focus(), 0)
      },
      addAttachmentPaths: (paths) => {
        void window.desktop.addAttachmentPaths(paths).then((r) => mergeAttachmentsRef.current(r))
      },
    }
  }
  useEffect(() => {
    onRegister(handleRef.current!)
    return () => onUnregister()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hasChatModel = enabledChatModels(settings).length > 0
  const lastHistoric = historicChat[historicChat.length - 1]
  const lastHistoricInterrupted = lastHistoric?.interrupted === true

  return (
    <div
      className={`ai-conversation${dragOver ? ' ai-panel-dragover' : ''}`}
      style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          e.stopPropagation()
          setDragOver(true)
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false)
      }}
      onDrop={onDrop}
    >
      <div ref={logRef} className="ai-chat" onScroll={onLogScroll}>
        {/* this conversation's restored transcript (read-only, fed to the model at loop build) */}
        {historicChat.length > 0 && (
          <>
            {historicChat.map((entry, i) => (
              <div key={`h${i}`} className={`ai-msg ai-msg-${entry.role} ai-msg-historic`}>
                {entry.role === 'user' && entry.scope && <AiScopeQuote scope={entry.scope} />}
                {entry.role === 'user' && entry.attachments && entry.attachments.length > 0 && (
                  <SentAttachments atts={entry.attachments} previews={attachmentPreviews} />
                )}
                {entry.tools && entry.tools.length > 0 && <ToolChipList tools={entry.tools} />}
                {entry.role === 'assistant' && entry.model && !entry.streaming && (
                  <div className="ai-msg-model" title={entry.model}>
                    {entry.model}
                  </div>
                )}
                {entry.text && (
                  <div dir="auto">
                    <Markdown
                      text={entry.text}
                      nav={docNav}
                      onInsertImage={(src) =>
                        void insertImageFromDataUrl(
                          editorRef.current,
                          src,
                          lang.startsWith('zh') ? 'AI 生成图片' : 'AI image',
                        )
                      }
                      insertImageLabel={lang.startsWith('zh') ? '插入文档' : 'Insert'}
                    />
                  </div>
                )}
                {entry.interrupted && (
                  <span className="ai-msg-interrupted-badge">{t('aiTurnInterrupted')}</span>
                )}
              </div>
            ))}
            <div className="ai-history-sep">{t('aiHistorySep')}</div>
          </>
        )}
        {chat.length === 0 && historicChat.length === 0 && (
          <div className="ai-chat-empty">
            <div className="ai-chat-empty-title">
              {t(docEmpty ? 'aiEmptyDraftTitle' : 'aiEmptyTitle')}
            </div>
            <div className="ai-chat-empty-body">
              {t(docEmpty ? 'aiEmptyDraftBody1' : 'aiEmptyBody1')}
              <br />
              {t(docEmpty ? 'aiEmptyDraftBody2' : 'aiEmptyBody2')}
            </div>
            {!hasChatModel ? (
              <div className="ai-model-empty">
                <div className="ai-model-empty-title">{t('aiNoModelErrorTitle')}</div>
                <div className="ai-model-empty-body">{t('aiNoModelErrorBody')}</div>
                <button className="ai-login-btn" onClick={onOpenModelSettings}>
                  {t('aiOpenModelSettings')}
                </button>
              </div>
            ) : (
              <div className="ai-starter-list">
                {(docEmpty ? DraftStarters : EditStarters).map((p: StringKey) => (
                  <button
                    key={p}
                    className="ai-starter"
                    onClick={() => {
                      setInput(t(p))
                      inputRef.current?.focus()
                    }}
                  >
                    {t(p)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {chat.map((entry, i) => {
          if (
            entry.role === 'assistant' &&
            !entry.text &&
            !entry.streaming &&
            !entry.error &&
            !entry.tools?.length
          ) {
            return null
          }
          const isLast = i === chat.length - 1
          // Action row appears once per completed reply: on the turn's final segment only
          const nextEntry = chat[i + 1]
          const turnEnded = nextEntry ? nextEntry.role === 'user' : !busy
          const showToolbar =
            entry.role === 'assistant' &&
            !entry.streaming &&
            turnEnded &&
            // edits-only turns have no text but still carry the rollback point
            !!(entry.text || entry.error || entry.snapshot)
          return (
            <div
              key={i}
              className={`ai-msg ai-msg-${entry.role}${entry.role === 'assistant' && entry.streaming ? ' ai-msg-streaming' : ''}`}
            >
              {entry.role === 'user' && entry.scope && <AiScopeQuote scope={entry.scope} />}
              {entry.role === 'user' && entry.attachments && entry.attachments.length > 0 && (
                <SentAttachments atts={entry.attachments} previews={attachmentPreviews} />
              )}
              {entry.role === 'assistant' && !entry.text && entry.streaming ? (
                <span className="ai-typing-row">
                  <AiTypingIndicator
                    label={entry.tools?.length ? t('aiWorking') : t('aiThinking')}
                  />
                </span>
              ) : entry.role === 'assistant' ? (
                <div dir="auto">
                  <Markdown
                    text={entry.text}
                    nav={docNav}
                    citations={entry.kbCitations}
                    onCitationClick={setKbCiteView}
                    onInsertImage={(src) =>
                      void insertImageFromDataUrl(
                        editorRef.current,
                        src,
                        lang.startsWith('zh') ? 'AI 生成图片' : 'AI image',
                      )
                    }
                    insertImageLabel={lang.startsWith('zh') ? '插入文档' : 'Insert'}
                  />
                </div>
              ) : (
                <span dir="auto">{entry.text}</span>
              )}
              {entry.tools && entry.tools.length > 0 && <ToolChipList tools={entry.tools} />}
              {entry.role === 'assistant' && entry.model && !entry.streaming && (
                <div className="ai-msg-model" title={entry.model}>
                  {entry.model}
                </div>
              )}
              {entry.error && (
                <div className="ai-msg-error">{t('aiErrorPrefix', { error: entry.error })}</div>
              )}
              {/* 用户登录未开放（USER_LOGIN_READY=false）：失败重试的登录按钮隐藏 */}
              {USER_LOGIN_READY && entry.loginRequired && (
                <button
                  className="ai-login-btn"
                  onClick={() => void window.desktop.aiChatOfficeLogin()}
                >
                  {t('aiChatOfficeLoginBtn')}
                </button>
              )}
              {showToolbar && (
                <div className="ai-msg-toolbar">
                  {entry.text && (
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
                  )}
                  {isLast && !busy && lastInstructionRef.current && (
                    <button
                      className="ai-msg-tool-btn"
                      onClick={retry}
                      aria-label={t('aiRegenerateTitle')}
                      data-tip={t('aiRegenerateTitle')}
                    >
                      {/* 24-canvas glyph at 18px (near-full-bleed paths, sized for optical
                          parity with the copy icon): stroke 1.5 paints 1.125px (1:16) */}
                      <svg
                        style={{ width: 18, height: 18 }}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <path d="M3.68881 9.85339C4.1791 8.0054 5.28205 6.30704 6.9459 5.09101C10.8046 2.27085 16.2188 3.11279 19.0389 6.97147C19.7242 7.90904 20.1932 8.93842 20.4553 10.0001" />
                        <path d="M2.00452 8.46411L2.87229 10.7059C2.96814 10.9535 3.24658 11.0765 3.4942 10.9807L5.73594 10.1129" />
                        <path d="M20.3308 14.4908C19.8405 16.3388 18.7376 18.0372 17.0738 19.2532C13.215 22.0734 7.80083 21.2314 4.98071 17.3728C4.22167 16.3342 3.72792 15.183 3.48686 13.9999" />
                        <path d="M22.0151 15.8801L21.1474 13.6384C21.0515 13.3908 20.7731 13.2677 20.5255 13.3636L18.2837 14.2314" />
                      </svg>
                    </button>
                  )}
                  {entry.snapshot && (
                    <>
                      {/* hairline between reply actions (icons) and the document action (icon+label) */}
                      <span className="ai-rollback-sep" aria-hidden />
                      <RollbackButton disabled={busy} onClick={() => rollback(i, entry.snapshot!)} />
                    </>
                  )}
                </div>
              )}
              {entry.turnLimit && isLast && !busy && (
                <button className="ai-continue-btn" onClick={continueRun}>
                  {t('aiContinue')}
                </button>
              )}
            </div>
          )
        })}
        {/* D10: a restored conversation whose last turn was interrupted offers 继续 */}
        {lastHistoricInterrupted && !busy && (
          <div className="ai-continue-row">
            <button className="ai-continue-btn" onClick={continueRun}>
              {t('aiContinue')}
            </button>
          </div>
        )}
      </div>

      <div className="ai-composer">
        {attachNotice && <div className="ai-attach-notice">{attachNotice}</div>}
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
        <EditQueueCard
          items={editQueue}
          editor={editor}
          busy={busy}
          onEditInstruction={(qid, text) => onQueueEditInstruction?.(qid, text)}
          onRemove={(qid) => onQueueRemove?.(qid)}
          onDiscardAll={() => onQueueClear?.()}
          onSend={sendQueue}
          onFocus={(qid) => onQueueFocus?.(qid)}
        />
        <AiComposer
          header={
            (hasScopeSelection || attachments.length > 0) && (
              <>
                {hasScopeSelection && (
                  <div className="ai-scope-row">
                    <span className="ai-scope-hint">
                      <button
                        type="button"
                        className="ai-scope-label"
                        onClick={() => setScopePreviewOpen((v) => !v)}
                        aria-expanded={scopePreviewOpen}
                        data-tip={t('aiScopeSelectionTip')}
                      >
                        {t('aiScopeSelection', { words: countWords(selectionText) })}
                      </button>
                      <button
                        type="button"
                        className="ai-scope-clear"
                        onClick={clearScopeSelection}
                        data-tip={t('aiScopeClearTitle')}
                        aria-label={t('aiScopeClearTitle')}
                      >
                        <svg width="12" height="12" viewBox="0 0 32 32" aria-hidden>
                          <path
                            d="M24 9.4L22.6 8L16 14.6L9.4 8L8 9.4l6.6 6.6L8 22.6L9.4 24l6.6-6.6l6.6 6.6l1.4-1.4l-6.6-6.6L24 9.4z"
                            fill="currentColor"
                          />
                        </svg>
                      </button>
                    </span>
                    {scopePreviewOpen && (
                      <div className="ai-scope-preview">
                        {selectionText.length > 400
                          ? `${selectionText.slice(0, 400)}…`
                          : selectionText}
                      </div>
                    )}
                  </div>
                )}
                {attachments.length > 0 && (
                  <div className="ai-attachments" onScroll={onAttachmentsScroll}>
                    {attachments.map((a) =>
                      ATTACHMENT_IMAGE_EXTS.has(a.ext) ? (
                        <span key={a.path} className="ai-attachment-thumb" data-tip={a.path}>
                          {attachmentPreviews[a.path] ? (
                            <img src={attachmentPreviews[a.path]} alt={a.name} />
                          ) : (
                            <span className="ai-attachment-thumb-pending" aria-hidden>
                              <img src={fileImageIcon} alt="" />
                            </span>
                          )}
                          <button
                            className="ai-attachment-thumb-remove"
                            onClick={() => removeAttachment(a.path)}
                            data-tip={t('aiRemoveAttachmentTitle')}
                            aria-label={t('aiRemoveAttachmentTitle')}
                          >
                            <svg width="16" height="16" viewBox="0 0 32 32" aria-hidden>
                              <path
                                d="M24 9.4L22.6 8L16 14.6L9.4 8L8 9.4l6.6 6.6L8 22.6L9.4 24l6.6-6.6l6.6 6.6l1.4-1.4l-6.6-6.6L24 9.4z"
                                fill="currentColor"
                              />
                            </svg>
                          </button>
                        </span>
                      ) : (
                        <span key={a.path} className="ai-attachment-card" data-tip={a.path}>
                          <span className="ai-attachment-card-icon">
                            <AttachmentCardIcon ext={a.ext} />
                          </span>
                          <span className="ai-attachment-card-meta">
                            <span className="ai-attachment-card-name">
                              {truncateCardName(a.name)}
                            </span>
                            <span className="ai-attachment-card-size">
                              {formatAttachmentSize(a.sizeBytes)}
                            </span>
                          </span>
                          <button
                            className="ai-attachment-thumb-remove"
                            onClick={() => removeAttachment(a.path)}
                            data-tip={t('aiRemoveAttachmentTitle')}
                            aria-label={t('aiRemoveAttachmentTitle')}
                          >
                            <svg width="16" height="16" viewBox="0 0 32 32" aria-hidden>
                              <path
                                d="M24 9.4L22.6 8L16 14.6L9.4 8L8 9.4l6.6 6.6L8 22.6L9.4 24l6.6-6.6l6.6 6.6l1.4-1.4l-6.6-6.6L24 9.4z"
                                fill="currentColor"
                              />
                            </svg>
                          </button>
                        </span>
                      ),
                    )}
                  </div>
                )}
              </>
            )
          }
          value={input}
          busy={busy}
          placeholder={t('aiInputPlaceholder')}
          hintIdle={t('aiHintIdle')}
          hintBusy={t('aiHintBusy')}
          hintIdleTitle={t('aiHintIdleTitle')}
          sendLabel={t('aiSend')}
          stopLabel={t('aiStop')}
          iconOnly
          textareaRef={inputRef}
          onChange={setInput}
          onSend={run}
          onStop={cancel}
          onPasteFiles={(files) => void onPasteFiles(files)}
          footerStart={
            <>
              <KbPickerButton lang={lang} selected={kb.selected} onToggle={kb.toggle} />
              <ModelPickerButton settings={settings} onPick={onPickModel} onOpenSettings={onOpenModelSettings} />
              <button
                className="ai-attach-btn"
                onClick={pickAttachments}
                data-tip={t('aiAttachTitle')}
                aria-label={t('aiAttachTitle')}
              >
                <img src={attachIcon} alt="" aria-hidden />
              </button>
              <button
                className={`ai-track-btn${trackChanges ? ' on' : ''}`}
                onClick={toggleTrackChanges}
                data-tip={trackChanges ? t('aiTrackOnTitle') : t('aiTrackOffTitle')}
              >
                <span className="ai-track-dot" aria-hidden />
                {t('aiTrackChanges')}
              </button>
            </>
          }
        />
      </div>
      {kbCiteView && (
        <KbCitePreview citation={kbCiteView} lang={lang} onClose={() => setKbCiteView(null)} />
      )}
    </div>
  )
}
