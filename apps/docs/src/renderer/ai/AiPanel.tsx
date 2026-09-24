import { useEffect, useRef, useState, lazy, Suspense } from 'react'
import type { Editor } from '@tiptap/core'
// LOCAL(2026-09-22, f5247d3..476e5023): 上游 #544(analyze_media)的 import hunk 基于其单体
// AiPanel,本地为「外壳+AiConversationBody」架构——保本地 import;mediaAnalysisAvailable
// 接线重放至 AiConversationBody(该提交的 docs-skill/tools/main 侧已并集落地)
import type { Block } from '@chatoffice/docx-engine'
import { streamText } from '@chatoffice/agent-core'
import type { AiSettingsV2 } from '../../shared/ipc'

import { buildAssistantInstruction, findCoreAssistant } from './assistants'
import {
  buildDocWriterRequest,
  countFragmentBlocks,
  DOC_MAX_CHARS,
  extractFragment,
  type DocWriteResult,
  type DocWriteSpec,
} from './doc-writer'
import type { AiCommentsAccess, AiDocExtras, AiHeaderFooterAccess } from './tools'
import type { AiPageSetupAccess } from './page-setup'
import type { AiNotesAccess } from './note-ops'
import { createElectronTransport } from './transport'
import { docsModelBridge } from './model-bridge'
import { aiLangDirective, t as tModule, useI18n } from '../i18n/locale'
import type { NumIds } from './protocol'
import type { DocsEditQueueItem } from './edit-queue'
import { AssistantBrowser, type AssistantRun } from './AssistantBrowser'
import { AiConversationBody, type AiConversationHandle } from './AiConversationBody'
import type { ChatEntry } from './ai-body-types'
import { IconAiPolish, IconAiSummarize, IconAiTidy } from './AssistantTab'
import {
  AiConversationsEmpty,
  AiHistoryPopover,
  AiTabConfirm,
  PanelTabs,
  useAiConversations,
  type AiActiveTab,
  useKbAugment,
} from '@chatoffice/ui'
import type { DockChrome } from '@chatoffice/ui'
import { IconNewChat } from '../components/icons'

// 惰性加载:模型设置页(含厂商 logo 组)只在打开时拉取,不进启动图
const ModelSettingsPage = lazy(() =>
  import('@chatoffice/ui/ModelSettingsPage').then((m) => ({ default: m.ModelSettingsPage })),
)

/** author name on AI-generated tracked revisions (accept/reject via Review) */
export const AI_REVISION_AUTHOR = 'AI Assistant'

/** progress chip refresh while a write streams */
const CHIP_UPDATE_MS = 400

/** persisted UI preference: highlight AI edits in yellow and ask for confirmation */
const TRACK_CHANGES_KEY = 'ai-docs-track-changes'

interface AiPanelProps {
  editor: Editor
  blocks: Block[]
  settings: AiSettingsV2
  /** the document has no text yet — the empty-state copy offers drafting instead of editing */
  docEmpty?: boolean
  /** fallback numbering ids for documents created from the blank template */
  numIdFallback?: NumIds | null
  /** preset instruction pushed from the ribbon or start screen; autoRun sends it immediately */
  preset?: { text: string; nonce: number; autoRun?: boolean } | null
  /** run a core-pack assistant (context menu / ribbon entry): resolved against the live selection */
  assistantRequest?: { id: string; nonce: number } | null
  /** kept in sync with DockShell's open state; effects use it to catch up after re-expand */
  open?: boolean
  /** chrome injected by the DockShell: header buttons + header drag behavior */
  dockChrome?: DockChrome
  /** Absolute path of the currently open file (used for chat-history persistence) */
  filePath?: string | null
  /** queued selection-scoped edits (owned by App, which also owns the anchors) */
  editQueue?: DocsEditQueueItem[]
  onQueueEditInstruction?: (qid: string, instruction: string) => void
  onQueueRemove?: (qid: string) => void
  onQueueClear?: () => void
  /** scroll to and select the anchored passage */
  onQueueFocus?: (qid: string) => void
  /** submission consumed these items: drop them and their anchors */
  onQueueConsume?: (qids: string[]) => void
  /** comments store for the AI comment tools (read/reply/resolve) */
  commentsAccess?: AiCommentsAccess
  /** header/footer state for the set_header_footer tool and per-turn context */
  hfAccess?: AiHeaderFooterAccess
  /** P2-5 回流薄钩(Q5'a): a completed panel turn is reported to the host so
   *  the Home project mainline stays the single complete transcript. Thin:
   *  the panel's own state/persistence is untouched. */
  onTurnCompleted?: (turn: { userText: string; assistantText: string; cancelled: boolean }) => void
  /** section store for set_page_setup / insert_section_break (upstream; unwired locally) */
  pageSetupAccess?: AiPageSetupAccess
  /** style catalog and watermark stores (upstream; unwired locally) */
  docExtras?: AiDocExtras
  /** footnote / endnote lists (upstream; unwired locally) */
  notesAccess?: AiNotesAccess
}

const isChatTab = (tab: AiActiveTab): tab is string =>
  typeof tab === 'string' && tab !== 'assistant' && tab !== 'empty'

// LOCAL(2026-09-21, d8201ad0): 多会话改造——本面板由「单会话 + 销毁式 newChat」改为会话池
// (useAiConversations)+ 按会话实例化的 AiConversationBody;对话体 JSX、每会话 loop 与
// 会话私有状态整体迁入 AiConversationBody(B 区)。上游暂无同类实现(基点 d8201ad0 无多
// 会话动向);下次同步若上游原生实现多会话/会话列表,评估取上游并删除本地会话池(收敛条件)。
// 「新对话」按钮语义变更:不再清空会话,只新建一个 tab(弃用裁定已登记 docs/upstream-sync.md)。
// LOCAL(2026-09-22, d8201ad0): D12/D13 增量——历史不再是 tab:tab 行 = [会话…][助手],
// 「🕘 历史对话」改为 actions 槽常驻图标([+][🕘])的下拉浮层 AiHistoryPopover;空会话
// (从未发言)关闭时直接丢弃、不进历史(hook close() 内分流)。上游动向与收敛条件同上。
export function AiPanel({
  editor,
  blocks,
  settings,
  docEmpty,
  numIdFallback,
  preset,
  assistantRequest,
  open = true,
  dockChrome,
  filePath,
  editQueue = [],
  onQueueEditInstruction,
  onQueueRemove,
  onQueueClear,
  onQueueFocus,
  onQueueConsume,
  commentsAccess,
  hfAccess,
  onTurnCompleted,

  pageSetupAccess,
  docExtras,
  notesAccess,
}: AiPanelProps) {
  const { lang, t } = useI18n()
  // 知识库选库与发送前检索增强(共享选中态,与首页对话一致)——面板级(§4.5)
  const kb = useKbAugment()
  // Panel chrome follows the UI language; message text follows its own content (dir=auto below)
  const isRtl = lang === 'ar' || lang === 'he'

  // ── 会话池(单一真源:打开集合 + 激活项 + 历史列表 + 运行态)──
  /** unsaved docs key their conversation index by this temp id until the first save */
  const tempChatIdRef = useRef(`unsaved-${Date.now()}`)
  const conv = useAiConversations(
    { filePath: filePath ?? null, tempChatId: tempChatIdRef.current },
    { persistKey: 'aidocs.aiTab' },
  )

  // 未保存 → 已保存 / 文件重命名:索引键换绑(chatId 不变;数据流单点在 hook)
  const prevFilePathRef = useRef(filePath ?? null)
  useEffect(() => {
    const prev = prevFilePathRef.current
    prevFilePathRef.current = filePath ?? null
    if (!filePath || prev === filePath) return
    conv.rebindIndex(prev ?? tempChatIdRef.current, filePath)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath])

  // ── 面板级共享资源(§4.5:绝不进实例清理)──
  const [trackChanges, setTrackChanges] = useState(
    () => localStorage.getItem(TRACK_CHANGES_KEY) === '1',
  )
  const toggleTrackChangesState = (next: boolean) => {
    setTrackChanges(next)
    localStorage.setItem(TRACK_CHANGES_KEY, next ? '1' : '0')
  }
  // panel-local copy: the picker and the settings page refresh it without touching App state
  const [panelSettings, setPanelSettings] = useState(settings)
  useEffect(() => {
    setPanelSettings(settings)
  }, [settings])
  const refreshSettings = async () => {
    try {
      setPanelSettings(await docsModelBridge.getSettings())
    } catch {
      /* keep the last known settings */
    }
  }
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false)

  const panelSettingsRef = useRef(panelSettings)
  panelSettingsRef.current = panelSettings
  const transportRef = useRef<ReturnType<typeof createElectronTransport> | null>(null)
  if (!transportRef.current)
    // the request carries only the selection; the main process resolves profile + secret
    transportRef.current = createElectronTransport(() => panelSettingsRef.current.currentModel!)

  /**
   * Long-form writing: one tool-less request whose reply is the fragment, streamed
   * into the document as a draft by the tool. A stream that stops early leaves the
   * user a keep-or-discard choice; a stream that produced nothing is retried once.
   * 面板级共享:对话体 write 工具与助手体共用;关闭会话绝不清理(§4.5)。
   * patch routes the writing chip into the requesting conversation's transcript.
   */
  const runDocWriter = async (
    spec: DocWriteSpec,
    onProgress: (html: string) => void,
    signal?: AbortSignal,
    patch?: (patch: Partial<ChatEntry> | ((last: ChatEntry) => Partial<ChatEntry>)) => void,
  ): Promise<DocWriteResult> => {
    const { system, user } = buildDocWriterRequest(spec, aiLangDirective())
    const epoch = writerEpochRef.current
    let closed = false
    let chipTimer: ReturnType<typeof setTimeout> | null = null
    let latest = ''
    const updateChip = () => {
      chipTimer = null
      if (closed) return
      const blocks = countFragmentBlocks(latest)
      patch?.((last) => ({
        tools: last.tools?.map((tl) =>
          tl.running ? { ...tl, summary: tModule('aiWritingDocument', { blocks }) } : tl,
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
        extract: (raw) => ({ text: extractFragment(raw) }),
        onProgress: (html) => {
          if (closed) return
          latest = html
          onProgress(html)
          if (chipTimer === null) chipTimer = setTimeout(updateChip, CHIP_UPDATE_MS)
        },
      })
    let outcome = await attempt()
    if (outcome.status === 'empty' && !signal?.aborted) outcome = await attempt()
    closed = true
    if (chipTimer !== null) clearTimeout(chipTimer)
    if (outcome.status === 'complete') return { ok: true, html: outcome.text }
    if (outcome.status === 'empty') return { ok: false, error: outcome.error }
    if (epoch !== writerEpochRef.current) return { ok: false, error: 'the chat was reset' }
    // the draft stays in the document while the user decides
    const keep = await new Promise<boolean>((resolve) => {
      partialResolverRef.current = resolve
      setActivePartial({ blocks: countFragmentBlocks(outcome.text) })
    })
    return keep
      ? { ok: true, html: outcome.text, truncated: true }
      : {
          ok: false,
          error: `${outcome.reason}${outcome.error ? `: ${outcome.error}` : ''}; the user discarded the partial content`,
        }
  }
  const runDocWriterRef = useRef(runDocWriter)
  runDocWriterRef.current = runDocWriter

  const [activePartial, setActivePartial] = useState<{ blocks: number } | null>(null)
  const partialResolverRef = useRef<((keep: boolean) => void) | null>(null)
  /** bumped by unmount: a writer resuming after its abort must not open the keep card */
  const writerEpochRef = useRef(0)
  const decidePartial = (keep: boolean): void => {
    partialResolverRef.current?.(keep)
    partialResolverRef.current = null
    setActivePartial(null)
  }
  // a pending keep/discard must not outlive the panel: settle it as discard
  useEffect(
    () => () => {
      writerEpochRef.current++
      partialResolverRef.current?.(false)
      partialResolverRef.current = null
    },
    [],
  )

  // ── 会话关闭流程(D5 + D10):运行中 → 确认 → stop → close;D12:空会话静默丢弃 ──
  const [closeConfirmId, setCloseConfirmId] = useState<string | null>(null)
  // D13: 历史下拉浮层开关(空态引导的「从历史还原」也走它)
  const [historyOpen, setHistoryOpen] = useState(false)

  const bodyHandlesRef = useRef(new Map<string, AiConversationHandle>())
  const registerBodyHandle = (chatId: string) => (handle: AiConversationHandle) => {
    bodyHandlesRef.current.set(chatId, handle)
  }
  const unregisterBodyHandle = (chatId: string) => () => {
    bodyHandlesRef.current.delete(chatId)
  }

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

  // ── 指令路由:面板级入口(preset / 助手 / 上下文菜单)→ 目标会话体 ──
  const pendingRunRef = useRef<{ instruction: string; display?: string } | null>(null)
  const targetChatId = (): string | null => {
    if (isChatTab(conv.activeTab) && conv.open.some((c) => c.chatId === conv.activeTab)) {
      return conv.activeTab
    }
    return conv.open[0]?.chatId ?? null
  }
  /** deliver a queued run when its conversation body is mounted */
  useEffect(() => {
    const p = pendingRunRef.current
    if (!p) return
    const target = targetChatId()
    if (!target) {
      // the pool settled with zero open conversations: open one to deliver into
      if (conv.ready && conv.open.length === 0) conv.create()
      return
    }
    const h = bodyHandlesRef.current.get(target)
    if (!h) return
    pendingRunRef.current = null
    h.runWith(p.instruction, p.display)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.open.length, conv.activeTab, conv.ready])
  const routeRun = (instruction: string, display?: string): void => {
    const target = targetChatId()
    const handle = target ? bodyHandlesRef.current.get(target) : undefined
    if (handle) {
      handle.runWith(instruction, display)
      return
    }
    // the pool is still loading (or empty): the delivery effect above runs the
    // queued instruction on the first ready conversation body — the seeded one,
    // not a freshly created tab
    pendingRunRef.current = { instruction, display }
  }

  useEffect(() => {
    if (!preset) return
    if (preset.autoRun) routeRun(preset.text)
    else {
      const target = targetChatId()
      const handle = target ? bodyHandlesRef.current.get(target) : undefined
      if (handle) handle.setDraft(preset.text)
      else {
        pendingRunRef.current = { instruction: preset.text }
        conv.create()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset?.nonce])

  // a core-pack assistant run pushed from the context menu / ribbon: build the
  // instruction against the live selection and send it like a typed message
  /** current selection as plain text, sampled at assistant-run time */
  const getSelectionText = () => {
    if (!editor || editor.state.selection.empty) return ''
    const { from, to } = editor.state.selection
    return editor.state.doc.textBetween(from, to, '\n\n')
  }

  useEffect(() => {
    if (!assistantRequest) return
    const doc = findCoreAssistant(assistantRequest.id)
    if (!doc) return
    const plan = buildAssistantInstruction(doc, getSelectionText())
    if (plan.ok) routeRun(plan.instruction, plan.display)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistantRequest?.nonce])

  /** 助手 tab: the one-click actions from the old ribbon group, list style */
  const assistItems = [
    {
      id: 'summarize',
      label: t('aiSummarizeBtn'),
      desc: t('aiSummarizeDesc'),
      icon: <IconAiSummarize />,
      disabled: docEmpty,
      run: () => {
        routeRun(t('aiSummarizePrompt'))
        conv.setActiveTab(targetChatId() ?? 'assistant')
      },
    },
    {
      id: 'polish',
      label: t('aiPolishBtn'),
      desc: t('aiPolishDesc'),
      icon: <IconAiPolish />,
      disabled: docEmpty,
      run: () => {
        routeRun(t(editor.state.selection.empty ? 'aiPolishPrompt' : 'aiPolishSelectionPrompt'))
        conv.setActiveTab(targetChatId() ?? 'assistant')
      },
    },
    {
      id: 'tidy',
      label: t('aiTidyBtn'),
      desc: t('aiTidyDesc'),
      icon: <IconAiTidy />,
      disabled: docEmpty,
      run: () => {
        routeRun(t('aiTidyPrompt'))
        conv.setActiveTab(targetChatId() ?? 'assistant')
      },
    },
  ]

  const runAssistant = ({ instruction, display }: AssistantRun) => {
    routeRun(instruction, display)
    conv.setActiveTab(targetChatId() ?? 'assistant')
  }

  // tab 行 = [会话1][会话2]…[助手](D1/D13:历史不是 tab,走 🕘 浮层)
  const aiTabs = [
    ...conv.open.map((c) => ({
      id: c.chatId,
      label: c.title || t('aiConvUntitled'),
      onClose: () => closeFlow(c.chatId),
      running: conv.runningIds.has(c.chatId),
    })),
    { id: 'assistant', label: t('aiTabAssistant') },
  ]

  const closeConfirmMeta =
    closeConfirmId !== null
      ? {
          title: t('aiConvCloseRunningTitle'),
          body: t('aiConvCloseRunningBody'),
          confirm: t('aiConvStopClose'),
          cancel: t('aiConvCancel'),
        }
      : null

  return (
    <aside
      dir={isRtl ? 'rtl' : undefined}
      className="ai-panel"
      style={{ position: 'relative' }}
    >
      <PanelTabs
        tabs={aiTabs}
        activeId={conv.activeTab}
        onTabChange={conv.setActiveTab}
        actions={
          // LOCAL(2026-09-22, d8201ad0): D13——常驻两图标 [+][🕘](面板布局按钮左侧):
          // 「+」新建并激活;「🕘」历史对话下拉浮层(不再受「有内容才显示」限制)
          <>
            <button
              className="ai-header-btn"
              onClick={() => conv.create()}
              data-tip={t('aiNewChatTitle')}
              aria-label={t('aiNewChatTitle')}
            >
              <IconNewChat size={16} />
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
      {closeConfirmId !== null && closeConfirmMeta && (
        <AiTabConfirm
          title={closeConfirmMeta.title}
          body={closeConfirmMeta.body}
          confirmLabel={closeConfirmMeta.confirm}
          cancelLabel={closeConfirmMeta.cancel}
          onConfirm={() => {
            const id = closeConfirmId
            setCloseConfirmId(null)
            if (id !== null) void closeConversation(id)
          }}
          onCancel={() => setCloseConfirmId(null)}
        />
      )}

      {/* 每会话一个挂载实例 + display:none 切换(D9,与上游「对话/助手」双体同模式) */}
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
            chatId={c.chatId}
            projectId={conv.projectId}
            editor={editor}
            blocks={blocks}
            numIdFallback={numIdFallback}
            docEmpty={docEmpty}
            settings={panelSettings}
            transport={transportRef.current!}
            trackChanges={trackChanges}
            onToggleTrackChanges={toggleTrackChangesState}
            commentsAccess={commentsAccess}
            hfAccess={hfAccess}
            pageSetupAccess={pageSetupAccess}
            docExtras={docExtras}
            notesAccess={notesAccess}
            runDocWriter={(spec, onProgress, signal, patch) =>
              runDocWriterRef.current(spec, onProgress, signal, patch)
            }
            activePartial={activePartial}
            decidePartial={decidePartial}
            kb={kb}
            editQueue={editQueue}
            onQueueEditInstruction={onQueueEditInstruction}
            onQueueRemove={onQueueRemove}
            onQueueClear={onQueueClear}
            onQueueFocus={onQueueFocus}
            onQueueConsume={onQueueConsume}
            onTurnCompleted={onTurnCompleted}
            onRunningChange={(running) => conv.setRunning(c.chatId, running)}
            onFirstMessage={(text) => conv.reportTitle(c.chatId, text)}
            onTurnEnd={() => conv.touch(c.chatId)}
            onRegister={registerBodyHandle(c.chatId)}
            onUnregister={unregisterBodyHandle(c.chatId)}
            onOpenModelSettings={() => setModelSettingsOpen(true)}
            onPickModel={(selection) => {
              void docsModelBridge.setCurrentModel(selection).then(refreshSettings)
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
            create: t('aiNewChatTitle'),
            openHistory: t('aiConvOpenHistory'),
          }}
          onCreate={() => conv.create()}
          onOpenHistory={() => setHistoryOpen(true)}
        />
      )}

      <AssistantBrowser
        quickItems={assistItems}
        getSelectionText={getSelectionText}
        docEmpty={docEmpty}
        onRun={runAssistant}
        hidden={conv.activeTab !== 'assistant'}
      />

      {modelSettingsOpen && (
        <Suspense fallback={null}>
          <ModelSettingsPage
            bridge={docsModelBridge}
            lang={lang}
            onClose={() => {
              setModelSettingsOpen(false)
              void refreshSettings()
            }}
          />
        </Suspense>
      )}
    </aside>
  )
}
