/**
 * LOCAL(2026-09-21, d8201ad0): sheets 多会话改造——按会话 chatId 挂载的隐藏宿主组件
 * (B 区新文件;上游无此文件,收敛条件:上游原生实现多会话则评估取上游)。
 *
 * 每个打开的会话一个实例:持有该会话的转录/流式/输入/附件状态与惰性 AgentLoop
 * (首次 send 才构造),自身不渲染(视图状态经 onState 上报 App,由 AiChatPanel
 * 渲染激活会话)。Plan §4.5 资源归属(sheets):
 *   实例私有(进本组件):chat/prompt/busy/attachments/attachNotice/sentAttachments/
 *     runTools/runLastText/runMutated/runStarting/每会话 loop/persistence;
 *   面板级共享(绝不进实例清理):preview/lazyPreviewRef、aiRunScope(冻结选区)、
 *     aiApplyPromises 池、message 状态条、workbook 运行时与 skill 依赖、kb 增强选中态;
 *   全局/UI:语言、设置。
 *
 * D10:取消的轮次照常落盘(半截文本 + 工具活动)打 interrupted 标记;loadChat
 * limit 10_000 全量装载(D11)→ 缓冲 → 首次 send 建 loop 时 restore 灌回。
 */
import { useEffect, useRef, useState } from 'react'
import {
  AgentLoop,
  composeSkills,
  COMPLETED_VIA_TOOLS_TEXT,
  type AgentImage,
} from '@chatoffice/agent-core'
import { enabledChatModels, pickImageModel, type AiSettingsV2 } from '@chatoffice/ai-provider/browser'
import {
  AiScopeQuote,
  type AiScopeQuoteData,
  type KbCitation,
  useKbAugment,
} from '@chatoffice/ui'
import { aiLangDirective, useI18n } from '../i18n/locale'
import {
  ATTACHMENT_IMAGE_EXTS,
  type AttachmentAddResult,
  type AttachmentMeta,
} from '../../shared/desktop-api'
import { createElectronTransport } from './transport'
import { createSheetsMediaSkill } from './media-skill'
import { createWorkbookSkill } from './workbook-skill'
import type { SheetsSkillDeps } from './tools'
import { createFilesSkill } from './files-skill'
import { createMergeSkill } from './merge-skill'
import { createSearchSkill } from './search-skill'
import { createImageSkill } from './image-skill'
import { scopeLabel } from './AiChatPanel'
import type { AiChatMessage } from './AiChatPanel'

/** Max characters of tool output echoed in the chat UI */
const TOOL_OUTPUT_MAX_CHARS_UI = 2000

/** the conversation view state reported up to App for AiChatPanel rendering */
export interface SheetsConversationView {
  chat: readonly AiChatMessage[]
  historic: readonly AiChatMessage[]
  prompt: string
  busy: boolean
  attachments: readonly AttachmentMeta[]
  attachNotice: string | null
}

export interface SheetsConversationHandle {
  send(instruction?: string, attachments?: readonly AttachmentMeta[], retryIndex?: number): void
  stop(): Promise<void>
  setPrompt(text: string): void
  pickAttachments(): Promise<void>
  addAttachmentPaths(paths: readonly string[]): Promise<void>
  addPastedImage(data: ArrayBuffer, ext: string): Promise<void>
  removeAttachment(path: string): void
}

export interface AiSheetsConversationProps {
  chatId: string
  projectId: string | null
  /** latest v2 settings (refs read at loop construction) */
  getSettings: () => AiSettingsV2
  /** App-level skill deps bundle (workbook runtime, lazy loader, status bar …) */
  getSkillDeps: () => SheetsSkillDeps
  /** App-level workbook merge (merge_workbooks tool) */
  mergePaths: (paths: string[]) => Promise<import('../merge-workbooks').MergeSourcesResult>
  /** deterministic fallback planner (no LLM configured) */
  runDeterministicPlan: (instruction: string) => { text: string; isError?: boolean }
  /** shared KB augment (selection state shared across conversations) */
  kb: ReturnType<typeof useKbAugment>
  /** status bar message (panel-level) */
  setMessage: (text: string) => void
  /** freeze the selection scope for a starting run (panel-level aiRunScope) */
  beginRun: () => AiScopeQuoteData | undefined
  /** the live selection scope quote for a fresh send (panel-level aiScope) */
  getLiveScope: () => AiScopeQuoteData | undefined
  /** release the frozen scope at run end (panel-level) */
  endRun: () => void
  /** run-scoped plan-apply patch routing + shared apply-promise pool (panel-level) */
  onRunStart: (patch: (fn: (entry: AiChatMessage) => AiChatMessage) => void) => void
  onRunEnd: () => void
  /** App-level auto-save of a completed run (patched entries routed via onRunStart) */
  autoSave: () => Promise<void>
  /** conversation-pool reporting */
  onRunningChange: (running: boolean) => void
  onFirstMessage: (text: string) => void
  onTurnEnd: () => void
  onRegister: (handle: SheetsConversationHandle) => void
  onUnregister: () => void
  onState: (view: SheetsConversationView) => void
}

export function AiSheetsConversation({
  chatId,
  projectId,
  getSettings,
  getSkillDeps,
  mergePaths,
  runDeterministicPlan,
  kb,
  setMessage,
  beginRun,
  getLiveScope,
  endRun,
  onRunStart,
  onRunEnd,
  autoSave,
  onRunningChange,
  onFirstMessage,
  onTurnEnd,
  onRegister,
  onUnregister,
  onState,
}: AiSheetsConversationProps) {
  const { t } = useI18n()
  const [chat, setChat] = useState<readonly AiChatMessage[]>([])
  /** History loaded from project-store (read-only transcript, not fed to the live turn) */
  const [historic, setHistoric] = useState<readonly AiChatMessage[]>([])
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  /** waiters resolved when a run fully settles (stop-then-close D10 时序) */
  const idleWaitersRef = useRef<Array<() => void>>([])
  const [attachments, setAttachments] = useState<readonly AttachmentMeta[]>([])
  const [attachNotice, setAttachNotice] = useState<string | null>(null)
  const attachmentsRef = useRef(attachments)
  attachmentsRef.current = attachments
  /** Attachments consumed by earlier sends this session */
  const sentAttachmentsRef = useRef<readonly AttachmentMeta[]>([])
  /** Synchronous re-entrancy guard between runAgent trigger and loop.run */
  const runStartingRef = useRef(false)
  /** Tool activity for the whole run */
  const runToolsRef = useRef<
    Array<{ name: string; summary: string; isError?: boolean; input?: string; output?: string }>
  >([])
  /** Last non-empty streamed text of the run */
  const runLastTextRef = useRef('')
  /** true once any tool of the run mutated the workbook */
  const runMutatedRef = useRef(false)
  /** the loop's streamed text so far — the interrupted persist keeps this half turn (D10) */
  const halfTextRef = useRef('')
  /** messages buffered for the lazy loop (D10/D11 hard chain) */
  const bufferedRestoreRef = useRef<Array<{ role: 'user' | 'assistant'; text: string }> | null>(null)

  /** composer attachments plus everything already sent this session (deduped by path) */
  const availableAttachments = (): AttachmentMeta[] => {
    const seen = new Set<string>()
    return [...sentAttachmentsRef.current, ...attachmentsRef.current].filter((a) =>
      seen.has(a.path) ? false : (seen.add(a.path), true),
    )
  }

  const appendChatEntry = (entry: AiChatMessage): void => {
    setChat((previous) => [...previous, entry])
  }

  function patchLastAssistant(patch: (entry: AiChatMessage) => AiChatMessage): void {
    setChat((previous) => {
      const index = previous.length - 1
      const last = previous[index]
      if (!last || last.role !== 'assistant') return previous
      const next = previous.slice()
      next[index] = patch(last)
      return next
    })
  }

  const persistChatMessage = (
    role: 'user' | 'assistant',
    text: string,
    tools?: Array<{
      name?: string
      summary: string
      isError?: boolean
      input?: string
      output?: string
    }>,
    attachments?: readonly AttachmentMeta[],
    scope?: AiScopeQuoteData,
    interrupted?: boolean,
  ): boolean => {
    const api = (window as Window & { projectApi?: typeof window.projectApi }).projectApi
    if (!projectId || !api) return false
    void api
      .appendChat({
        projectId,
        chatId,
        role,
        text,
        ...(interrupted ? { interrupted: true } : {}),
        ...(tools && tools.length > 0
          ? { tools: tools.map((tl) => ({ ...tl, name: tl.name ?? '' })) }
          : {}),
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
    return true
  }

  // lazy-load this conversation's jsonl (limit 10_000 = full load, D11)
  useEffect(() => {
    const api = (window as Window & { projectApi?: typeof window.projectApi }).projectApi
    if (!api || !projectId) return
    let disposed = false
    void api
      .loadChat({ projectId, chatId, limit: 10_000 })
      .then((msgs) => {
        if (disposed || msgs.length === 0) return
        setHistoric(
          msgs.map((m) => ({
            role: m.role,
            text: m.text,
            interrupted: m.interrupted === true,
            tools:
              m.tools?.map((tl) => ({
                summary: tl.summary,
                isError: !!tl.isError,
                ...(tl.name ? { name: tl.name } : {}),
                ...(tl.output ? { output: tl.output.slice(0, TOOL_OUTPUT_MAX_CHARS_UI) } : {}),
              })) ?? [],
            ...(m.attachments && m.attachments.length > 0
              ? {
                  attachments: m.attachments
                    .filter((a) => a.path)
                    .map((a) => ({
                      name: a.name,
                      path: a.path ?? '',
                      ext: a.ext ?? '',
                      sizeBytes: a.sizeBytes ?? 0,
                    })),
                }
              : {}),
            ...(m.scope ? { scope: m.scope } : {}),
          })),
        )
        // D10/D11 hard chain: buffer → restore into the loop at its construction
        bufferedRestoreRef.current = msgs.map((m) => ({ role: m.role, text: m.text }))
        const firstUser = msgs.find((m) => m.role === 'user')
        if (firstUser) onFirstMessage(firstUser.text)
      })
      .catch(() => {
        /* silent */
      })
    return () => {
      disposed = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, chatId])

  const ensureLoop = (): AgentLoop => {
    if (loopRef.current) return loopRef.current
    const loop = new AgentLoop({
      transport: createElectronTransport(() => getSettings().currentModel!),
      systemSuffix: aiLangDirective,
      skill: composeSkills('sheets+files', '', [
        createSheetsMediaSkill(),
        createWorkbookSkill(getSkillDeps()),
        createFilesSkill(availableAttachments),
        createMergeSkill({
          getAttachments: availableAttachments,
          mergePaths,
        }),
        createSearchSkill(),
        createImageSkill(
          () => !!pickImageModel(getSettings() ?? ({} as AiSettingsV2)),
          () => getSettings()?.imageSource ?? 'auto',
        ),
      ]),
      events: {
        onText: (text) => {
          if (text) {
            runLastTextRef.current = text
            halfTextRef.current = text
          }
          setMessage(t('appAiThinking'))
          patchLastAssistant((entry) => ({ ...entry, text, isError: false }))
        },
        onToolStart: (call) => {
          patchLastAssistant((entry) => ({
            ...entry,
            tools: [
              ...entry.tools,
              {
                summary: call.name.replace(/[_-]+/g, ' '),
                isError: false,
                name: call.name,
                running: true,
              },
            ],
          }))
        },
        onToolExecuted: ({ call, execution }) => {
          if (execution.mutated) runMutatedRef.current = true
          const input = safeJsonInputOf(call.input)
          const output = execution.output
            ? execution.output.slice(0, PERSIST_TOOL_FIELD_MAX_LOCAL)
            : undefined
          runToolsRef.current.push({
            name: call.name,
            summary: execution.summary,
            isError: !!execution.isError,
            ...(input !== undefined ? { input } : {}),
            ...(output !== undefined ? { output } : {}),
          })
          patchLastAssistant((entry) => {
            const tools = [...entry.tools]
            if (tools.at(-1)?.running) tools.pop()
            return {
              ...entry,
              tools: [
                ...tools,
                {
                  summary: execution.summary,
                  isError: !!execution.isError,
                  name: call.name,
                  ...(execution.output
                    ? { output: execution.output.slice(0, TOOL_OUTPUT_MAX_CHARS_UI) }
                    : {}),
                },
              ],
            }
          })
        },
        onDone: ({ text, cancelled, turnLimit, truncated }) => {
          const toolSummaries = (() => {
            const lines: string[] = []
            const seen = new Set<string>()
            for (const tool of runToolsRef.current) {
              if (!tool.summary || tool.isError || seen.has(tool.summary)) continue
              seen.add(tool.summary)
              lines.push(tool.summary)
              if (lines.length >= 8) break
            }
            return lines.join('\n')
          })()
          const prose =
            text && text !== COMPLETED_VIA_TOOLS_TEXT
              ? text
              : cancelled
                ? ''
                : runLastTextRef.current || toolSummaries || text
          const fallback = cancelled
            ? t('appAiStopped')
            : runLastTextRef.current ||
              toolSummaries ||
              (runMutatedRef.current ? t('appAiNoSummary') : t('appAiNoAction'))
          const baseText = turnLimit
            ? [prose, t('appAiTurnLimit')].filter(Boolean).join('\n\n')
            : prose || fallback
          const finalText = truncated
            ? [baseText, t('appAiTruncatedNote')].filter(Boolean).join('\n\n')
            : baseText
          setMessage(cancelled ? t('appAiStopped') : t('appAiDone'))
          patchLastAssistant((entry) => ({
            ...entry,
            text: finalText,
            streaming: false,
            isError: false,
            tools: entry.tools.filter((tl) => !tl.running),
          }))
          // D10: a cancelled turn persists its half text + tool activity with the
          // interrupted flag; a fully empty cancel persists nothing
          if (cancelled) {
            const half = halfTextRef.current
            if ((half && half.trim()) || runToolsRef.current.length > 0) {
              persistChatMessage('assistant', half, runToolsRef.current, undefined, undefined, true)
            }
          } else if (finalText) {
            persistChatMessage('assistant', finalText, runToolsRef.current)
          }
          endRun()
          void autoSave().finally(() => {
            onRunEnd()
            setBusyTracked(false)
          })
          onTurnEnd()
        },
        onError: (error) => {
          setMessage(error)
          setChat((previous) => {
            const next = [...previous]
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
                text: error,
                isError: true,
                streaming: false,
                tools: last.tools.filter((tl) => !tl.running),
              }
            }
            return next
          })
          void window.desktopApi
            .aiChatOfficeStatus()
            .then((status) => {
              if (status.loggedIn) return
              setChat((previous) => {
                const next = [...previous]
                const last = next.at(-1)
                if (last?.role === 'assistant' && last.isError) {
                  next[next.length - 1] = { ...last, loginRequired: true }
                }
                return next
              })
            })
            .catch(() => {})
          endRun()
          void autoSave().finally(() => {
            onRunEnd()
            setBusyTracked(false)
          })
        },
      },
    })
    loopRef.current = loop
    // D10 hard chain: restored history (incl. interrupted half text) feeds the
    // loop before the first send
    if (bufferedRestoreRef.current && bufferedRestoreRef.current.length > 0) {
      loop.restore(bufferedRestoreRef.current)
      bufferedRestoreRef.current = null
    }
    return loop
  }
  const loopRef = useRef<AgentLoop | null>(null)

  const setBusyTracked = (v: boolean): void => {
    busyRef.current = v
    setBusy(v)
    if (!v) {
      const waiters = idleWaitersRef.current
      idleWaitersRef.current = []
      for (const w of waiters) w()
    }
  }

  useEffect(() => {
    onRunningChange(busy)
  }, [busy, onRunningChange])

  /** Image attachments read as base64 and sent multimodal with this user message */
  const MAX_IMAGES_PER_MESSAGE = 20
  async function collectImageAttachments(atts: readonly AttachmentMeta[]): Promise<AgentImage[]> {
    const imageAtts = atts.filter((a) => ATTACHMENT_IMAGE_EXTS.has(a.ext))
    const images: AgentImage[] = []
    const failures: string[] = []
    for (const att of imageAtts.slice(0, MAX_IMAGES_PER_MESSAGE)) {
      const result = await window.desktopApi.readAttachmentImage(att.path)
      if (result.ok && result.base64 && result.mime) {
        images.push({ base64: result.base64, mime: result.mime })
      } else {
        failures.push(result.error ?? t('appAttachmentReadFailed', { name: att.name }))
      }
    }
    if (imageAtts.length > MAX_IMAGES_PER_MESSAGE) {
      failures.push(t('appTooManyImages', { max: MAX_IMAGES_PER_MESSAGE }))
    }
    if (failures.length > 0) {
      setAttachNotice(failures.join('；'))
      window.setTimeout(() => setAttachNotice(null), 5000)
    }
    return images
  }

  function runAgent(instruction: string, sentAttachments: readonly AttachmentMeta[]): void {
    const loop = ensureLoop()
    if (loop.busy || runStartingRef.current) return
    runStartingRef.current = true
    // freeze the selection scope for the whole run (panel-level aiRunScope)
    beginRun()
    // route App-side plan-apply patches (auto-applied badge, save notes) into this conversation
    onRunStart(patchLastAssistant)
    runLastTextRef.current = ''
    runMutatedRef.current = false
    halfTextRef.current = ''
    setBusyTracked(true)
    setMessage(t('appAiThinking'))
    appendChatEntry({ role: 'assistant', text: '', tools: [], streaming: true })
    const attachKbCitations = (): void => {
      const citations = kb.lastCitations.current
      if (citations.length > 0) {
        patchLastAssistant((entry) => ({ ...entry, kbCitations: [...citations] }))
      }
    }
    void collectImageAttachments(sentAttachments)
      .then(async (images) => {
        runStartingRef.current = false
        const kbInstruction = kb.augment(instruction)
        void kbInstruction.then(attachKbCitations)
        loop.run(await kbInstruction, images)
      })
      .catch(async () => {
        runStartingRef.current = false
        const kbInstruction = kb.augment(instruction)
        void kbInstruction.then(attachKbCitations)
        loop.run(await kbInstruction)
      })
  }

  function send(
    overrideInstruction?: string,
    overrideAttachments?: readonly AttachmentMeta[],
    retryIndex?: number,
  ): void {
    const instruction = (overrideInstruction ?? prompt).trim()
    if (!instruction || busy || runStartingRef.current) return
    runToolsRef.current = []
    const sentAtts = overrideAttachments ?? attachmentsRef.current
    const agentConfigured = enabledChatModels(getSettings()).length > 0
    const alreadyPersisted = retryIndex !== undefined && chat[retryIndex]?.persisted === true
    if (retryIndex !== undefined) {
      setChat((previous) => pruneFailedExchangeOf(previous, retryIndex))
    }
    // a retry quotes what the failed message quoted; a fresh send the live scope
    const scope =
      retryIndex !== undefined ? chat[retryIndex]?.scope : (getLiveScope() ?? undefined)
    const persisted =
      alreadyPersisted || persistChatMessage('user', instruction, undefined, sentAtts, scope)
    appendChatEntry({
      role: 'user',
      text: instruction,
      tools: [],
      persisted,
      ...(sentAtts.length > 0 ? { attachments: sentAtts } : {}),
      ...(scope ? { scope } : {}),
    })
    if (!overrideInstruction) setPrompt('')
    if (!overrideAttachments && sentAtts.length > 0) {
      const seen = new Set(sentAttachmentsRef.current.map((a) => a.path))
      sentAttachmentsRef.current = [
        ...sentAttachmentsRef.current,
        ...sentAtts.filter((a) => !seen.has(a.path)),
      ]
      setAttachments([])
    }
    onFirstMessage(instruction)
    if (agentConfigured) {
      runAgent(instruction, sentAtts)
      return
    }
    const outcome = runDeterministicPlan(instruction)
    setMessage(outcome.text)
    appendChatEntry({ role: 'assistant', text: outcome.text, tools: [], isError: outcome.isError })
    persistChatMessage('assistant', outcome.text)
  }

  const stop = async (): Promise<void> => {
    if (runStartingRef.current) runStartingRef.current = false
    loopRef.current?.cancel()
    if (!busyRef.current) return
    await new Promise<void>((resolve) => idleWaitersRef.current.push(resolve))
  }

  const mergeAttachments = (result: AttachmentAddResult | null): void => {
    if (!result) return
    if (result.accepted.length > 0) {
      setAttachments((prev) => {
        const seen = new Set(prev.map((a) => a.path))
        return [...prev, ...result.accepted.filter((a) => !seen.has(a.path))]
      })
    }
    if (result.rejected.length > 0) {
      setAttachNotice(result.rejected.join('；'))
      window.setTimeout(() => setAttachNotice(null), 5000)
    }
  }

  // register the handle once; methods route through refs (always fresh)
  const sendRef = useRef(send)
  sendRef.current = send
  const mergeRef = useRef(mergeAttachments)
  mergeRef.current = mergeAttachments
  const handleRef = useRef<SheetsConversationHandle | null>(null)
  if (!handleRef.current) {
    handleRef.current = {
      send: (instruction, atts, retryIndex) => sendRef.current(instruction, atts, retryIndex),
      stop: () => stopRef.current(),
      setPrompt: (text) => setPrompt(text),
      pickAttachments: async () => mergeRef.current(await window.desktopApi.pickAttachments()),
      addAttachmentPaths: async (paths) => {
        if (paths.length === 0) return
        mergeRef.current(await window.desktopApi.addAttachmentPaths([...paths]))
      },
      addPastedImage: async (data, ext) =>
        mergeRef.current(await window.desktopApi.addPastedImage(data, ext)),
      removeAttachment: (path) => setAttachments((prev) => prev.filter((a) => a.path !== path)),
    }
  }
  const stopRef = useRef(stop)
  stopRef.current = stop
  useEffect(() => {
    onRegister(handleRef.current!)
    return () => onUnregister()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // report the view state up (App renders the active conversation through AiChatPanel)
  useEffect(() => {
    onState({ chat, historic, prompt, busy, attachments, attachNotice })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat, historic, prompt, busy, attachments, attachNotice])

  // instance-private cleanup on unmount (§4.5): abort in-flight work; the loop's
  // onDone still persists the interrupted half turn. Shared workbook/preview
  // resources are App-level and are NOT touched here.
  useEffect(
    () => () => {
      if (runStartingRef.current) runStartingRef.current = false
      loopRef.current?.cancel()
    },
    [],
  )

  return null
}

// ── local helpers kept parity with the previous App.tsx implementations ──

/** Max stored characters of tool args/output persisted in the transcript */
const PERSIST_TOOL_FIELD_MAX_LOCAL = 16_000

/** Tool args → JSON string (truncated; undefined on serialization failure) */
function safeJsonInputOf(input: unknown): string | undefined {
  try {
    const s = JSON.stringify(input)
    return s && s !== '{}' ? s.slice(0, PERSIST_TOOL_FIELD_MAX_LOCAL) : undefined
  } catch {
    return undefined
  }
}



/** Retry re-sends in place: drop the failed bubble and its error reply */
function pruneFailedExchangeOf(
  previous: readonly AiChatMessage[],
  retryIndex: number,
): AiChatMessage[] {
  const start = retryIndex
  let end = previous.length
  for (let i = retryIndex + 1; i < previous.length; i++) {
    if (previous[i]!.role === 'user') {
      end = i
      break
    }
  }
  return [...previous.slice(0, start), ...previous.slice(end)]
}
