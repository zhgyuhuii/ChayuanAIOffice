import React, { useEffect, useRef, useState, useCallback, lazy, Suspense } from 'react'
import { createSlidesMediaSkill } from './media-skill'
import {
  AgentLoop,
  composeSkills,
  IPC_STREAM_SILENCE_TIMEOUT_MS,
  type AgentAudio,
  type AgentImage,
  type AgentVideo,
  type ToolDisplay,
} from '@chatoffice/agent-core'
import type { RenderSlide } from '@chatoffice/pptx-render'
import type {
  AiModelSelection,
  AiSettingsV2,
  AttachmentAddResult,
  AttachmentMeta,
} from '../../shared/ipc'
import {
  ATTACHMENT_AUDIO_EXTS,
  ATTACHMENT_IMAGE_EXTS,
  ATTACHMENT_VIDEO_EXTS,
} from '../../shared/ipc'
import {
  createSlidesSkill,
  type DeckAccess,
  type ClarifyQuestion,
  type DeckImageAsset,
  type DeckProgressEvent,
} from './slides-skill'
import { extractJsonObject, parseOutlineJson } from './outline-json'
import { resolveSpecAssets } from './spec-asset-resolve'
import { EditQueueCard } from './EditQueueCard'
import { deriveDeckProgressView, type DeckProgressSnapshot } from './deck-progress-view'
import {
  buildPageInstruction,
  groupByPage,
  resolveQueue,
  type EditQueueItem,
  type ResolveFailure,
} from './edit-queue'
import { createFilesSkill } from './files-skill'
import { createElectronTransport } from './transport'
import { renderSlidesToPngBase64 } from '../export-render'
import {
  isQcEnabled,
  isUnsupportedImageInputError,
  mergeQcPages,
  qcSlidePage,
  QC_MAX_PAGES,
  settingsSupportVision,
} from './slide-qc'
import { useI18n, t as tGlobal, aiLangDirective, type StringKey, type TFunc } from '../i18n/locale'
import {
  IconSend,
  IconStop,
  Markdown,
  KbPickerButton,
  ModelPickerButton,
  useKbAugment,
  PanelTabs,
  USER_LOGIN_READY,
  usePanelTab,
  AI_CONTINUE_INSTRUCTION,
  useAiConversations,
  AiConversationsEmpty,
  AiHistoryPopover,
  AiTabConfirm,
  type AiActiveTab,
  AiScopeQuote,
  KbCitePreview,
  useAiPanelPrefs,
  type AiScopeQuoteData,
  type KbCitation,
} from '@chatoffice/ui'
import {
  defaultSettingsV2,
  enabledChatModels,
  functionCallingVerdict,
  pickImageModel,
  resolveDefaultModel,
  resolveModelCapabilities,
  type AiProtocol,
} from '@chatoffice/ai-provider/browser'
import { slidesModelBridge } from './model-bridge'
import { hydrateSpecSvg } from './spec-svg-hydrate'
import attachIcon from '../assets/attach-icon.png'
import filePdfIcon from '../assets/file-pdf.png'
import fileWordIcon from '../assets/file-word.png'
import fileExcelIcon from '../assets/file-excel.png'
import filePptIcon from '../assets/file-ppt.png'
import fileImageIcon from '../assets/file-image.png'
import fileVideoIcon from '../assets/file-video.png'
import fileVoiceIcon from '../assets/file-voice.png'
import fileDocumentIcon from '../assets/file-document.png'
import fileGeneralIcon from '../assets/file-general.png'
import { IconNewChat } from '../components/icons'
import {
  AssistantTab,
  IconAiAskSelection,
  IconAiBeautify,
  IconAiFactCheck,
  IconAiImage,
} from './AssistantTab'
import type { DockChrome } from '@chatoffice/ui'

// 惰性加载:模型设置页(含厂商 logo 组)只在打开时拉取,不进启动图
const ModelSettingsPage = lazy(() =>
  import('@chatoffice/ui/ModelSettingsPage').then((m) => ({ default: m.ModelSettingsPage })),
)

interface ToolActivity {
  name: string
  summary: string
  /** still executing: rendered as a spinner chip, replaced in place when the tool finishes */
  running?: boolean
  isError?: boolean
  /** Full tool output (truncated to 2000 chars) */
  output?: string
  /**
   * Side-channel display data: structured UI data filled by tools, not in LLM context.
   * Takes priority over name-based inference.
   */
  display?: ToolDisplay
}

/** Max stored chars of tool output (UI-side truncation, doesn't affect what the LLM receives) */
const TOOL_OUTPUT_MAX_CHARS = 2000

/** Clipboard bitmap MIME → attachment extension (matches ATTACHMENT_IMAGE_EXTS) */
const PASTE_MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

/** File-type icons for attachment cards (ChatOffice attachment icon set); exts the
 *  attachment allowlist doesn't accept yet are mapped ahead so they light up when added */
const ATTACHMENT_CARD_ICON_GROUPS: [icon: string, exts: string[]][] = [
  [fileWordIcon, ['doc', 'docx']],
  [fileExcelIcon, ['xls', 'xlsx', 'xlsm', 'csv', 'tsv']],
  [filePptIcon, ['ppt', 'pptx']],
  [filePdfIcon, ['pdf']],
  [fileImageIcon, ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tiff', 'heic']],
  [fileVideoIcon, ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v']],
  [fileVoiceIcon, ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus']],
  [
    fileDocumentIcon,
    [
      'txt',
      'md',
      'markdown',
      'rtf',
      'log',
      'json',
      'yaml',
      'yml',
      'xml',
      'html',
      'htm',
      'js',
      'ts',
      'tsx',
      'jsx',
      'py',
      'java',
      'c',
      'h',
      'cpp',
      'go',
      'rs',
      'rb',
      'sh',
      'sql',
      'css',
    ],
  ],
]

const ATTACHMENT_CARD_ICONS: Record<string, string> = Object.fromEntries(
  ATTACHMENT_CARD_ICON_GROUPS.flatMap(([icon, exts]) => exts.map((ext) => [ext, icon])),
)

function AttachmentCardIcon({ ext }: { ext: string }) {
  return <img src={ATTACHMENT_CARD_ICONS[ext] ?? fileGeneralIcon} alt="" aria-hidden />
}

/** Card name slot width: 190 card - 2 border - 8/14 padding - 40 icon - 10 gap */
const CARD_NAME_MAX_WIDTH = 116
let cardNameCtx: CanvasRenderingContext2D | null = null

/** Ellipsize like the design: cut at the limit, strip trailing -_./spaces so
 *  punctuation never sits against the …; CSS text-overflow stays as fallback */
function truncateCardName(name: string): string {
  cardNameCtx ??= document.createElement('canvas').getContext('2d')
  if (!cardNameCtx) return name
  // must match the stack the card name actually renders with (body font in styles.css)
  cardNameCtx.font =
    "500 13px 'Segoe UI', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif"
  if (cardNameCtx.measureText(name).width <= CARD_NAME_MAX_WIDTH) return name
  let lo = 1
  let hi = name.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (cardNameCtx.measureText(`${name.slice(0, mid)}…`).width <= CARD_NAME_MAX_WIDTH) lo = mid
    else hi = mid - 1
  }
  return `${name.slice(0, lo).replace(/[-_.\s]+$/, '')}…`
}

/** Read-only echo of the attachments a user message consumed from the composer
 *  (image previews when the file is still readable; otherwise the placeholder icon) */
function SentAttachments({
  atts,
  previews,
}: {
  atts: AttachmentMeta[]
  previews: Record<string, string>
}) {
  return (
    <div className="ai-msg-attachments">
      {atts.map((a) =>
        ATTACHMENT_IMAGE_EXTS.has(a.ext) ? (
          <span key={a.path} className="ai-attachment-thumb" title={a.name}>
            {previews[a.path] ? (
              <img src={previews[a.path]} alt={a.name} />
            ) : (
              <span className="ai-attachment-thumb-pending" aria-hidden>
                <img src={fileImageIcon} alt="" />
              </span>
            )}
          </span>
        ) : (
          <span key={a.path} className="ai-attachment-card" title={a.name}>
            <span className="ai-attachment-card-icon">
              <AttachmentCardIcon ext={a.ext} />
            </span>
            <span className="ai-attachment-card-meta">
              <span className="ai-attachment-card-name">{truncateCardName(a.name)}</span>
              <span className="ai-attachment-card-size">{formatAttachmentSize(a.sizeBytes)}</span>
            </span>
          </span>
        ),
      )}
    </div>
  )
}

function formatAttachmentSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    : `${(bytes / 1024).toFixed(2)} KB`
}

/** Cap on tool args/output persisted to the transcript (the store layer has another 16k truncation fallback) */
const PERSIST_TOOL_FIELD_MAX = 16_000

/** Tool args → JSON string (truncated; returns undefined on serialization failure, doesn't block persistence) */
function safeJsonInput(input: unknown): string | undefined {
  try {
    const s = JSON.stringify(input)
    return s && s !== '{}' ? s.slice(0, PERSIST_TOOL_FIELD_MAX) : undefined
  } catch {
    return undefined
  }
}

interface ChatEntry {
  role: 'user' | 'assistant'
  text: string
  error?: string
  /** LOCAL(2026-09-21, d8201ad0): D10 —— 恢复的被中断轮次(半截文本保留,渲染角标) */
  interrupted?: boolean
  /** model id that produced this assistant turn (display only) */
  model?: string
  streaming?: boolean
  /** the run failed because ChatOffice is signed out — render an inline sign-in button */
  loginRequired?: boolean
  tools?: ToolActivity[]
  /** Generation progress card (only one per turn, replaced in real time) */
  deckProgress?: DeckProgressSnapshot
  /** Main-process rollback point for this turn's deck edits — rendered as an inline roll-back action */
  snapshotId?: number
  /** attachments consumed from the composer by this user message (read-only echo chips) */
  attachments?: AttachmentMeta[]
  /** the selection this user message targeted, frozen at send */
  scope?: AiScopeQuoteData
  /** KB citations behind the [n] chips of this assistant turn */
  kbCitations?: KbCitation[]
}

/** Empty deck → generation starters; deck with content → polish starters */
const starterPrompts = (t: TFunc, deckEmpty: boolean): string[] =>
  deckEmpty
    ? [t('aiStarterGenReport'), t('aiStarterGenLaunch'), t('aiStarterGenTraining')]
    : [t('aiStarterPolishTitle'), t('aiStarterTighten'), t('aiStarterProofread')]

interface AiPanelProps {
  /** page speaker-notes write-through (setNotes op path) */
  onSetSpeakerNotes?: (slideIndex: number, text: string) => void

  slides: RenderSlide[]
  current: number
  selectedIds: string[]
  /** no slide carries real content yet — the empty-state copy offers generation instead of polish */
  deckEmpty?: boolean
  /** Decoded image cache from App (SlideThumb needs it) — powers AI-vision slide screenshots */
  images: Map<string, HTMLImageElement>
  applySlide: (slideIndex: number, updated: RenderSlide) => void
  applyDeck: (slides: RenderSlide[], goTo?: number) => void
  fitWidthPx: number
  settings: AiSettingsV2
  /** Preset instruction pushed from the ribbon/start screen; sent immediately when autoRun. When displayText exists the chat bubble shows only it while the full text still goes to the model.
      attachments are local files added in the start-screen input, taking effect with the first message.
      slideShot attaches a rendering of the current slide so the model sees what it's editing (AI Beautify) */
  preset?: {
    text: string
    nonce: number
    autoRun?: boolean
    displayText?: string
    attachments?: AttachmentMeta[]
    slideShot?: boolean
    scope?: AiScopeQuoteData
  } | null
  /** false while collapsed; the component stays mounted so panel state survives */
  open?: boolean
  /** shared DockShell header chrome (drag-to-dock + layout buttons) */
  dockChrome?: DockChrome
  /** Visible rollback action; uses the same main-process history as Cmd/Ctrl+Z. */
  onUndo?: () => void
  /** Callback to update the path after AI generation lands on disk (title bar sync) */
  onPathChange?: (path: string) => void
  /** Flush pending editor state (e.g. the speaker-notes draft) right before an AI run edits the deck, so a stale draft cannot overwrite what the run writes */
  onBeforeRun?: () => Promise<void> | void
  /** Generation progress callback (for the canvas top progress bar) */
  onDeckProgress?: (event: DeckProgressEvent | null) => void
  /** Absolute path of the currently open file (for chat history persistence) */
  currentFilePath?: string | null
  /** Pending element-scoped edits; owned by App, which also holds selection/navigation */
  editQueue?: EditQueueItem[]
  onQueueEditInstruction?: (key: string, instruction: string) => void
  onQueueRemove?: (key: string) => void
  onQueueClear?: () => void
  /** Jump to the item's page and select its elements */
  onQueueFocus?: (key: string) => void
  /** Drop the items a submission finished with (successful and unrunnable alike) */
  onQueueConsume?: (keys: string[]) => void
  /** Open the stage-side popover that queues an AI edit for the selected elements */
  onAskSelection?: () => void
  /** LOCAL(2026-09-21, d8201ad0): 多会话——由外壳 AiPanel 按会话实例化时传入(D9)。
   *  传入后:tab 行/助手 tab/「+」由外壳持有,持久化走 conversation.chatId(D10/D11)。 */
  conversation?: {
    chatId: string
    projectId: string | null
    onRunningChange: (running: boolean) => void
    onFirstMessage: (text: string) => void
    onTurnEnd: () => void
    onRegister: (handle: SlidesConversationHandle) => void
    onUnregister: () => void
  }
}

/** command handle the outer panel holds per conversation (stop-then-close, plan §4.3) */
export interface SlidesConversationHandle {
  stop(): Promise<void>
  runWith(instruction: string, display?: string, opts?: { slideShot?: boolean }): void
  setDraft(text: string): void
  addAttachmentPaths(paths: string[]): void
  /** merge ready-made attachment metas into this conversation's composer (sync ref update) */
  addAttachments(atts: readonly AttachmentMeta[]): void
}

/** Some locales already end the label with an ellipsis — normalize to exactly one. */
function withEllipsis(label: string): string {
  return `${label.replace(/(?:…|\.{3})+$/u, '')}…`
}

/**
 * Running-chip labels for the long-running tools. While a tool executes, the
 * chip would otherwise show the raw name with spaces ("generate deck"), which
 * reads broken for steps that take minutes; these get a localized "doing X…"
 * line. Quick ops keep the prettified name.
 */
const RUNNING_TOOL_LABELS: Record<string, StringKey> = {
  generate_deck: 'aiToolRunDeck',
  regenerate_slide: 'aiToolRunRegenSlide',
  plan_deck: 'aiToolRunPlanDeck',
  generate_image: 'aiToolRunImage',
  generate_svg: 'aiToolRunSvg',
  generate_video: 'aiToolRunVideo',
  insert_web_image: 'aiToolRunInsertImage',
  web_search: 'aiToolRunWebSearch',
  image_search: 'aiToolRunImageSearch',
  read_url: 'aiToolRunReadUrl',
}

/** Two-phase waiting→thinking indicator (mirrors AiTypingIndicator in packages/ui):
 *  grow/shrink blue dots first, then after ~1.2s only the shimmering "Thinking…" text — never both at once. */
function AiTypingIndicator({ label }: { readonly label: string }) {
  const [elapsed, setElapsed] = useState(0)
  const [showLabel, setShowLabel] = useState(false)

  useEffect(() => {
    const phase = setTimeout(() => setShowLabel(true), 1200)
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => {
      clearTimeout(phase)
      clearInterval(timer)
    }
  }, [])

  return (
    <span className="ai-typing" role="status" aria-label={label}>
      {showLabel ? (
        <span className="ai-typing-label">
          {withEllipsis(label)}
          {elapsed >= 3 && (
            <span className="ai-typing-elapsed" aria-hidden>{` · ${elapsed}s`}</span>
          )}
        </span>
      ) : (
        <span className="ai-typing-dots" aria-hidden>
          <span className="ai-typing-dot-slot">
            <span className="ai-typing-dot-grow" />
          </span>
          <span className="ai-typing-dot-slot">
            <span className="ai-typing-dot-shrink" />
          </span>
        </span>
      )}
    </span>
  )
}

function AiConversationBody({
  conversation,
  slides,
  current,
  selectedIds,
  deckEmpty,
  images,
  applySlide,
  applyDeck,
  fitWidthPx,
  settings,
  preset,
  open = true,
  dockChrome,
  onPathChange,
  onBeforeRun,
  onDeckProgress,
  currentFilePath,
  editQueue,
  onQueueEditInstruction,
  onQueueRemove,
  onQueueClear,
  onQueueFocus,
  onQueueConsume,
  onAskSelection,
}: AiPanelProps) {
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
  const [legacyTab, selectTab] = usePanelTab('aislides.aiTab', aiTabs)
  const tab = convMode ? 'chat' : legacyTab
  const [input, setInput] = useState('')
  // Shared AI panel pref (Settings → General): the bespoke slides composer
  // must honor it like the shared AiComposer does.
  const { spellcheck } = useAiPanelPrefs()
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  /** waiters resolved when a run fully settles (stop-then-close, D10 时序) */
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
  const [chat, setChat] = useState<ChatEntry[]>([])
  /** Past conversation restored from JSONL (read-only transcript, not fed to the model) */
  const [historicChat, setHistoricChat] = useState<ChatEntry[]>([])
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([])
  const [attachNotice, setAttachNotice] = useState<string | null>(null)
  /** data-URL previews for image attachments, keyed by path (ChatOffice composer thumbnails) */
  const [attachmentPreviews, setAttachmentPreviews] = useState<Record<string, string>>({})
  /** image paths with a read already issued — one readAttachmentImage per attach, even while pending */
  const previewRequestedRef = useRef(new Set<string>())
  /** Attachments consumed by earlier sends this session: sending clears the composer, but the
      files skill must keep reading them mid-run and in follow-up turns. Deduped by path
      against the live composer list. */
  const sentAttachmentsRef = useRef<AttachmentMeta[]>([])
  useEffect(() => {
    // previews cover the composer plus every image echoed on a sent/history message
    // (history chips re-read the file by its stored path; a deleted file keeps the placeholder)
    const wanted = [
      ...attachments,
      ...chat.flatMap((e) => e.attachments ?? []),
      ...historicChat.flatMap((e) => e.attachments ?? []),
    ]
    const alive = new Set(wanted.map((a) => a.path))
    // drop previews (and request markers) of removed attachments, so memory is reclaimed and a re-attach re-reads
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
          if (!previewRequestedRef.current.has(a.path)) return // removed while the read was in flight
          if (r.ok && r.base64 && r.mime) {
            setAttachmentPreviews((prev) => ({
              ...prev,
              [a.path]: `data:${r.mime};base64,${r.base64}`,
            }))
          }
        })
        .catch(() => {
          // A rejected read (bridge error, teardown race) must not leave the
          // path marked requested forever — that would permanently skip the
          // thumbnail with no retry. Clear it so the next effect run retries.
          previewRequestedRef.current.delete(a.path)
        })
    }
  }, [attachments, chat, historicChat])
  /** paints the strip's scrollbar thumb while the user scrolls it (cleared 800ms after the last event) */
  const attachScrollFadeRef = useRef(0)
  const onAttachmentsScroll = (e: React.UIEvent<HTMLDivElement>): void => {
    const el = e.currentTarget
    el.classList.add('is-scrolling')
    window.clearTimeout(attachScrollFadeRef.current)
    attachScrollFadeRef.current = window.setTimeout(() => el.classList.remove('is-scrolling'), 800)
  }
  const [dragOver, setDragOver] = useState(false)
  /* Answered clarify receipts (answered-state card): view-only record, not chat data */
  const [clarifyAnswers, setClarifyAnswers] = useState<
    Array<{ afterIdx: number; qa: Array<{ q: string; a: string }> }>
  >([])
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  /** Stop following once the user scrolls up; re-attach when near the bottom */
  const stickToBottomRef = useRef(true)
  /** Current chat's projectId/chatId, set after resolve succeeds */
  const chatRefIds = useRef<{ projectId: string; chatId: string } | null>(null)

  // The loop instance survives across renders; closures read refs for the latest state
  const slidesRef = useRef(slides)
  slidesRef.current = slides
  const currentRef = useRef(current)
  currentRef.current = current
  const selectedRef = useRef(selectedIds)
  selectedRef.current = selectedIds
  const applySlideRef = useRef(applySlide)
  applySlideRef.current = applySlide
  const applyDeckRef = useRef(applyDeck)
  applyDeckRef.current = applyDeck
  const onBeforeRunRef = useRef(onBeforeRun)
  onBeforeRunRef.current = onBeforeRun
  const onPathChangeRef = useRef(onPathChange)
  onPathChangeRef.current = onPathChange

  /** push a chat-generated picture onto the current slide: centered at 70%
   * canvas width (natural aspect preserved), via the same IPC the skill's
   * insert_web_image tool uses (base64 payload, no network fetch) */
  const insertGeneratedImage = async (src: string): Promise<void> => {
    const m = /^data:image\/(png|jpeg|jpg|gif);base64,(.+)$/s.exec(src)
    if (!m) return
    const ext = m[1] === 'jpg' ? 'jpg' : m[1]
    const base64 = m[2]
    const natural = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image()
      img.onload = () => resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 })
      img.onerror = () => resolve({ w: 1, h: 1 })
      img.src = src
    })
    const wPx = Math.round(fitWidthPx * 0.7)
    const hPx = Math.max(1, Math.round((wPx * natural.h) / natural.w))
    const r = await window.slidesApi.insertImageUrl({
      slideIndex: currentRef.current,
      base64,
      ext,
      xPx: Math.max(0, Math.round((fitWidthPx - wPx) / 2)),
      yPx: Math.round(fitWidthPx * (9 / 16) * 0.15),
      wPx,
      hPx,
      fitWidthPx,
    })
    if (r?.slide) applySlideRef.current(currentRef.current, r.slide)
  }

  const onDeckProgressRef = useRef(onDeckProgress)
  onDeckProgressRef.current = onDeckProgress
  // panel-local copy: the picker and the settings page refresh it without App state
  const [panelSettings, setPanelSettings] = useState<AiSettingsV2>(
    () => settings ?? defaultSettingsV2(),
  )
  useEffect(() => {
    if (settings) setPanelSettings(settings)
  }, [settings])
  const settingsRef = useRef(panelSettings)
  settingsRef.current = panelSettings
  /** confirmed local image pool (data URIs) for the deck 'local' imagery source */
  const [localPool, setLocalPool] = useState<string[]>([])
  const localPoolRef = useRef<string[]>([])
  /** Attached images (company logo etc.) registered as deck brand assets — the
   * writer references them by `deck:<n>` handle; entries persist across runs
   * (merged by attachment path) so follow-ups keep the branding. */
  const deckAssetsRef = useRef<DeckImageAsset[]>([])
  localPoolRef.current = localPool
  /** model id driving the in-flight run — shown on this turn's assistant bubbles */
  const runModelRef = useRef<string | undefined>(undefined)
  const refreshSettings = async () => {
    try {
      setPanelSettings(await slidesModelBridge.getSettings())
    } catch {
      /* keep the last known settings */
    }
  }
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false)

  /** chatoffice login state for the cloud-tools gate (refreshed on mount and window focus) */
  const chatofficeLoggedInRef = useRef(false)
  useEffect(() => {
    let alive = true
    const refresh = () => {
      void window.slidesApi
        ?.aiChatOfficeStatus()
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
  const imagesRef = useRef(images)
  imagesRef.current = images
  const attachmentsRef = useRef(attachments)
  attachmentsRef.current = attachments
  /** attachments consumed by the most recent send — retry resends the same set */
  const lastAttachmentsRef = useRef<AttachmentMeta[]>([])
  /** the scope quote of the last send, so a retry reuses it instead of re-reading the live selection */
  const _lastScopeRef = useRef<AiScopeQuoteData | undefined>(undefined)
  /** composer attachments plus everything already sent this session (deduped by path) */
  const availableAttachments = (): AttachmentMeta[] => {
    const seen = new Set<string>()
    return [...sentAttachmentsRef.current, ...attachmentsRef.current].filter((a) =>
      seen.has(a.path) ? false : (seen.add(a.path), true),
    )
  }
  // Paths of text attachments already read via read_attachment — generate_deck refuses to run
  // while any current text attachment is still unread
  const readAttachmentPathsRef = useRef<Set<string>>(new Set())

  const instructionRef = useRef('')
  const lastInstructionRef = useRef('')
  /** Paired with lastInstructionRef: keeps the bubble showing only the user's request on retries */
  const lastDisplayTextRef = useRef<string | undefined>(undefined)
  /** Mirror of the last turn's (the final reply's turn) tool activity — used when persisting the assistant message,
      avoiding side effects inside the setState updater (StrictMode double-invokes updaters, duplicating history writes) */
  const lastTurnToolsRef = useRef<ToolActivity[]>([])
  /** Tool activity of the whole run (with args/output, accumulated across turns) — for full transcript persistence */
  const runToolsRef = useRef<
    Array<{ name: string; summary: string; isError?: boolean; input?: string; output?: string }>
  >([])
  /** Last streamed text of the current turn: the only copy left when a run dies before onDone */
  const streamedTextRef = useRef('')

  // ── Chat history persistence ──────────────────────────────────────────────
  // LOCAL(2026-09-21, d8201ad0): 会话实例走 conversation.chatId(immutable,loadChat
  // limit 10_000 全量装载 D11)→ 缓冲 → 首次 send 建 loop 时 restore 灌回(D10);
  // 单会话旧路径(外壳未接管的独立使用)保留 resolveChat。
  const historyLoadedRef = useRef(false)
  useEffect(() => {
    const api = (window as Window & { projectApi?: typeof window.projectApi }).projectApi
    if (!api) return
    const applyHistory = (msgs: Array<{
      role: 'user' | 'assistant'
      text: string
      interrupted?: boolean
      tools?: Array<{ name?: string; summary: string; isError?: boolean; output?: string }>
      attachments?: Array<{ name: string; path?: string; ext?: string; sizeBytes?: number }>
      scope?: AiScopeQuoteData
    }>) => {
      if (historyLoadedRef.current || msgs.length === 0) return
      historyLoadedRef.current = true
      setHistoricChat(
        msgs.map((m) => ({
          role: m.role,
          text: m.text,
          interrupted: m.interrupted === true,
          tools: m.tools?.map((t) => ({
            name: t.name ?? '',
            summary: t.summary,
            isError: t.isError,
            output: t.output ? t.output.slice(0, TOOL_OUTPUT_MAX_CHARS) : undefined,
          })),
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
      // D10 hard chain: buffer → restore into the loop at its construction
      bufferedRestoreRef.current = msgs.map((m) => ({ role: m.role, text: m.text }))
      const firstUser = msgs.find((m) => m.role === 'user')
      if (firstUser) onFirstMessageSafe(firstUser.text)
    }
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
          if (!disposed) applyHistory(msgs)
        })
        .catch(() => {
          /* History load failures are silent */
        })
      return () => {
        disposed = true
      }
    }
    const tempChatId = `unsaved-${Date.now()}`
    void api
      .resolveChat({ filePath: currentFilePath ?? null, tempChatId })
      .then((ids) => {
        chatRefIds.current = ids
        return api.loadChat({ projectId: ids.projectId, chatId: ids.chatId, limit: 200 })
      })
      .then((msgs) => {
        applyHistory(msgs)
        // Restore model context: follow-ups after reopening a file continue the earlier conversation (only when the loop is idle with no history)
        loopRef.current?.restore(msgs.map((m) => ({ role: m.role, text: m.text })))
      })
      .catch(() => {
        /* History load failures are silent */
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation?.projectId, conversation?.chatId])

  const onFirstMessageSafe = (text: string): void => {
    if (conversation) conversation.onFirstMessage(text)
  }

  /** After an unsaved draft lands and gets a real path, bind the unsaved-* history to that file (recoverable by path on reopen) */
  useEffect(() => {
    if (conversation) return
    const ids = chatRefIds.current
    const api = (window as Window & { projectApi?: typeof window.projectApi }).projectApi
    if (!api || !ids || !currentFilePath || !ids.chatId.startsWith('unsaved-')) return
    void api
      .rebindChat({
        projectId: ids.projectId,
        tempChatId: ids.chatId,
        newFilePath: currentFilePath,
      })
      .then((r) => {
        if (r?.chatId) chatRefIds.current = r
      })
      .catch(() => {
        /* Silent */
      })
  }, [currentFilePath])

  /** Persist one message (fails silently). tools include args/output (truncated by the store layer); attachments store metadata only. */
  const persistMessage = (
    role: 'user' | 'assistant',
    text: string,
    tools?: Array<{
      name: string
      summary: string
      isError?: boolean
      input?: string
      output?: string
    }>,
    attachments?: AttachmentMeta[],
    scope?: AiScopeQuoteData,
    interrupted?: boolean,
  ) => {
    const ids = conversation
      ? { projectId: conversation.projectId, chatId: conversation.chatId }
      : chatRefIds.current
    const api = (window as Window & { projectApi?: typeof window.projectApi }).projectApi
    if (!ids || !api || !ids.projectId) return
    void api
      .appendChat({
        projectId: ids.projectId,
        chatId: ids.chatId,
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
        /* Silent */
      })
  }

  /**
   * Record a run that ended without a usable reply. Deliberately not the chat
   * history: agent-core rolls a failed turn out of the model context, so storing
   * it there would feed it straight back on the next reopen.
   */
  const logRunFailure = (kind: 'error' | 'stopped', error?: string) => {
    void window.slidesApi
      .aiLogRunFailure({
        kind,
        instruction: instructionRef.current,
        streamed: streamedTextRef.current,
        ...(error ? { error } : {}),
        ...(runToolsRef.current.length > 0
          ? { tools: runToolsRef.current.map((tl) => tl.name) }
          : {}),
        ...(runStartedAtRef.current > 0
          ? { durationMs: Date.now() - runStartedAtRef.current }
          : {}),
      })
      .catch(() => {
        /* Diagnostics are best-effort */
      })
  }

  // Resolved when the user submits/cancels; the AI takes the answer and continues.
  const [activeClarify, setActiveClarify] = useState<ClarifyQuestion[] | null>(null)
  const clarifyResolverRef = useRef<((r: { answers: string; cancelled?: boolean }) => void) | null>(
    null,
  )

  /** Synchronous re-entry guard between runWith trigger and loop.run (see the comment inside runWith) */
  const runStartingRef = useRef(false)
  /**
   * Resolves the in-flight queue page run: AgentLoop reports completion through
   * events rather than a promise, so onDone/onError hand the outcome back here.
   */
  const queueRunResolverRef = useRef<((ok: boolean) => void) | null>(null)
  /** Pages landed by this run's generation calls, pending the post-generation layout QC pass */
  const qcPagesRef = useRef<number[]>([])
  const qcAbortRef = useRef<AbortController | null>(null)
  const qcRunningRef = useRef(false)
  /** Latest runQcPass closure; the loop's onDone (built once) calls through this ref */
  const runQcPassRef = useRef<() => Promise<void>>(() => Promise.resolve())
  /** DeckAccess reused by the QC pass (same executors as the main loop's slides skill) */
  const accessRef = useRef<DeckAccess | null>(null)
  /** Wall-clock start of the current run, drives the elapsed badge */
  const runStartedAtRef = useRef(0)
  const historyBatchActiveRef = useRef(false)
  const inputEditedSinceRunRef = useRef(false)
  /** This run's rollback batch — carried onto the QC entry when a QC pass
      follows (mid-turn segments never show the action toolbar) */
  const runSnapshotIdRef = useRef<number | null>(null)

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

  /** Update the last assistant message's progress card in real time (no spam; the same card updates in place). */
  const patchProgressInLastAssistant = (
    updater: (prev: DeckProgressSnapshot) => DeckProgressSnapshot,
  ) => {
    setChat((prev) => {
      const next = [...prev]
      const last = next[next.length - 1]
      if (!last || last.role !== 'assistant') return prev
      next[next.length - 1] = { ...last, deckProgress: updater(last.deckProgress ?? {}) }
      return next
    })
  }

  const finishHistoryBatch = async () => {
    if (!historyBatchActiveRef.current) return
    historyBatchActiveRef.current = false
    const id = await window.slidesApi.endHistoryBatch()
    if (typeof id !== 'number') return
    runSnapshotIdRef.current = id
    patchLastAssistant({ snapshotId: id })
  }

  const rollback = async (snapshotId: number) => {
    const restored = await window.slidesApi.aiSnapshotRestore(snapshotId)
    if (!restored) {
      // Evicted from the main-process snapshot ring — retire the dead action
      setChat((prev) =>
        prev.map((e) => (e.snapshotId === snapshotId ? { ...e, snapshotId: undefined } : e)),
      )
      return
    }
    applyDeckRef.current(restored, Math.min(currentRef.current, restored.length - 1))
    // The deck rewound to before this batch, so this and every later rollback
    // point now describe discarded futures (ids are monotonic across batches)
    setChat((prev) =>
      prev.map((e) =>
        e.snapshotId != null && e.snapshotId >= snapshotId ? { ...e, snapshotId: undefined } : e,
      ),
    )
  }

  const loopRef = useRef<AgentLoop | null>(null)
  /** messages buffered for the lazy loop (D10/D11 hard chain) */
  const bufferedRestoreRef = useRef<Array<{ role: 'user' | 'assistant'; text: string }> | null>(null)
  /** LOCAL(2026-09-21, d8201ad0): loop 惰性构造(首次 runWith 才建,防止 N 个会话 tab 建 N 个循环) */
  const ensureLoop = (): AgentLoop | null => {
    if (loopRef.current) return loopRef.current
    if (convMode && !conversation) return null
    {
    // The three slides generation steps (style/planning/per-page HTML) force the high-quality model (only on
    // anthropic-messages profiles; other protocols keep the user selection, avoiding nonexistent model ids).
    // Chat/fine-tuning still uses the user's configured model.
    const SLIDES_GEN_MODEL = 'claude-opus-4-7'
    // On-demand selection with the generation model overridden (the profile must have it enabled).
    const selectionForGen = (): AiModelSelection => {
      const cur = settingsRef.current
      const sel = cur.currentModel!
      // 1) explicit cross-protocol "generation" role: page-spec writing is the
      // quality bottleneck, so any protocol may pin a dedicated strong model
      const genSel = resolveDefaultModel(cur, 'generation')
      if (genSel) return genSel
      // 2) legacy pin: claude-opus inside the current (anthropic) profile
      const profile = cur.profiles.find((p) => p.id === sel.profileId)
      if (!profile || profile.protocol !== 'anthropic-messages') return sel
      if (!profile.models.some((m) => m.id === SLIDES_GEN_MODEL)) return sel
      return { profileId: profile.id, modelId: SLIDES_GEN_MODEL }
    }
    // Send one LLM request, aggregating streaming deltas into complete text. Shared by in-tool per-page/planning.
    // - On timeout/user stop (signal abort) call aiStreamCancel to cancel the main-process stream, leaving no orphan requests.
    // - useGenModel=true uses SLIDES_GEN_MODEL first; on request errors (non-timeout) automatically falls back to the
    //   user-configured model and retries once, so generation isn't wiped out when the key lacks access to that model.
    // errKind marks failure categories that shouldn't retry with another model (timeout/empty output/user stop)
    type LlmResult = {
      ok: boolean
      text?: string
      error?: string
      errKind?: 'timeout' | 'empty' | 'stopped'
    }
    const runLlmAttempt = (
      selection: AiModelSelection,
      system: string,
      user: string,
      timeoutMs: number,
      signal?: AbortSignal,
      maxTokens?: number,
    ): Promise<LlmResult> =>
      new Promise((resolve) => {
        if (signal?.aborted) {
          resolve({ ok: false, error: tGlobal('aiErrStopped'), errKind: 'stopped' })
          return
        }
        const requestId = crypto.randomUUID()
        let buf = ''
        let settled = false
        const finish = (r: LlmResult, cancelUpstream = false) => {
          if (settled) return
          settled = true
          clearTimeout(to)
          signal?.removeEventListener('abort', onAbort)
          unsub()
          // On timeout/abort the main-process stream keeps running; it must be cancelled explicitly or orphan streams eat proxy concurrency
          if (cancelUpstream) void window.slidesApi.aiStreamCancel(requestId)
          resolve(r)
        }
        const onAbort = () =>
          finish({ ok: false, error: tGlobal('aiErrStopped'), errKind: 'stopped' }, true)
        // Silence watchdog, not a total-duration cap: long generations legitimately run
        // for many minutes, and the main process re-arms us with keepalive pings on wire
        // activity. Firing means the turn is dead (main stall / lost chunks).
        let to: ReturnType<typeof setTimeout> | undefined
        const armTimeout = () => {
          clearTimeout(to)
          to = setTimeout(
            () =>
              finish(
                {
                  ok: false,
                  error: tGlobal('aiErrTimeout', { ms: timeoutMs }),
                  errKind: 'timeout',
                },
                true,
              ),
            timeoutMs,
          )
        }
        armTimeout()
        const unsub = window.slidesApi.onAiStream((chunk) => {
          if (chunk.requestId !== requestId) return
          armTimeout() // any chunk (including pings) proves the turn is alive
          if (chunk.type === 'delta') buf += chunk.text ?? ''
          else if (chunk.type === 'done')
            finish(
              buf.trim()
                ? { ok: true, text: buf }
                : { ok: false, text: buf, error: tGlobal('aiErrEmptyOutput'), errKind: 'empty' },
            )
          else if (chunk.type === 'error')
            finish({
              ok: false,
              error: chunk.error ?? tGlobal('aiErrUnknown'),
              // Empty gateway streams surface as errors now (ai-provider stream.ts
              // tags them with this suffix); keep classifying them as empty output
              // so retry ladders fail fast instead of burning billed attempts
              ...(chunk.error?.includes('(empty stream)') ? { errKind: 'empty' as const } : {}),
            })
        })
        signal?.addEventListener('abort', onAbort, { once: true })
        // If invoke itself rejects (IPC-layer failure), fail immediately instead of waiting out the timeout
        window.slidesApi
          .aiStream({
            requestId,
            settings: selection,
            system,
            messages: [{ role: 'user', text: user }],
            ...(maxTokens ? { maxTokens } : {}),
          })
          .catch((e) =>
            finish({
              ok: false,
              error: tGlobal('aiErrRequestFailed', {
                msg: e instanceof Error ? e.message : String(e),
              }),
            }),
          )
      })
    const runLlmOnce = async (
      system: string,
      user: string,
      timeoutMs = IPC_STREAM_SILENCE_TIMEOUT_MS,
      useGenModel = true,
      signal?: AbortSignal,
      maxTokens?: number,
    ): Promise<LlmResult> => {
      const first = await runLlmAttempt(
        useGenModel ? selectionForGen() : settingsRef.current.currentModel!,
        system,
        user,
        timeoutMs,
        signal,
        maxTokens,
      )
      if (first.ok || !useGenModel || signal?.aborted) return first
      // Only "request errors" fall back to the user's model for a retry; timeouts/empty output don't switch models (mostly network/output problems, switching won't help)
      if (first.errKind) return first
      const cur = settingsRef.current
      const sel = cur.currentModel
      // The gen-model override only applies on anthropic-messages profiles
      const profile = sel ? cur.profiles.find((p) => p.id === sel.profileId) : undefined
      if (profile?.protocol !== 'anthropic-messages') return first
      if (sel?.modelId === SLIDES_GEN_MODEL) return first
      return runLlmAttempt(sel!, system, user, timeoutMs, signal, maxTokens)
    }

    const access: DeckAccess = {
      getSlides: () => slidesRef.current,
      getCurrent: () => currentRef.current,
      // A queue run names its targets explicitly; whatever is selected on the
      // canvas right now is unrelated and would only compete with them
      getSelectedIds: () => (queueRunResolverRef.current ? [] : selectedRef.current),
      applySlide: (i, updated) => applySlideRef.current(i, updated),
      applyDeck: (all, goTo) => applyDeckRef.current(all, goTo),
      landGeneratedPages: async (
        pageMarkers: string[],
        mode?: 'replace' | 'append' | 'insert_at',
        deckName?: string,
        insertAt?: number,
      ) => {
        try {
          const res = await window.slidesApi.landGeneratedPages(
            pageMarkers,
            fitWidthPx,
            mode,
            insertAt,
            deckName,
          )
          if (res && 'slides' in res && Array.isArray(res.slides)) {
            const appendedFrom =
              'appendedFrom' in res && typeof res.appendedFrom === 'number' ? res.appendedFrom : 0
            const insertedIndex =
              'insertedIndex' in res && typeof res.insertedIndex === 'number'
                ? res.insertedIndex
                : undefined
            const fallbackReason =
              'fallbackReason' in res && typeof res.fallbackReason === 'string'
                ? res.fallbackReason
                : undefined
            const imageFailures =
              'imageFailures' in res && Array.isArray(res.imageFailures)
                ? res.imageFailures
                : undefined
            applyDeckRef.current(res.slides, insertedIndex ?? appendedFrom)
            // When the draft lands successfully, path is the real path; notify App to update the title bar
            if (res.path) onPathChangeRef.current?.(res.path)
            qcPagesRef.current = mergeQcPages(qcPagesRef.current, mode ?? 'replace', {
              pages: res.slides.length,
              appendedFrom,
              ...(insertedIndex !== undefined ? { insertedIndex } : {}),
            })
            return {
              ok: true,
              pages: res.slides.length,
              appendedFrom,
              insertedIndex,
              fallbackReason,
              imageFailures,
            }
          }
          return {
            ok: false,
            error:
              'error' in (res || {})
                ? (res as { error: string }).error
                : tGlobal('aiErrGenerateFailed'),
          }
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) }
        }
      },
      regenerateSlide: async (slideIndex: number, marker: string) => {
        try {
          const res = await window.slidesApi.landGeneratedPages(
            [marker],
            fitWidthPx,
            'replace_at',
            slideIndex,
          )
          if (res && 'slides' in res && Array.isArray(res.slides)) {
            applyDeckRef.current(res.slides, slideIndex)
            if (res.path) onPathChangeRef.current?.(res.path)
            qcPagesRef.current = mergeQcPages(qcPagesRef.current, 'replace_at', {
              pages: res.slides.length,
              insertedIndex: slideIndex,
            })
            return {
              ok: true,
              imageFailures:
                'imageFailures' in res && Array.isArray(res.imageFailures)
                  ? res.imageFailures
                  : undefined,
            }
          }
          return {
            ok: false,
            error:
              'error' in (res || {})
                ? (res as { error: string }).error
                : tGlobal('aiErrRegenFailed'),
          }
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) }
        }
      },
      askClarification: (questions: ClarifyQuestion[]) => {
        return new Promise<{ answers: string; cancelled?: boolean }>((resolve) => {
          clarifyResolverRef.current = resolve
          setActiveClarify(questions)
        })
      },
      isCloudPageGenEnabled: async () => {
        try {
          return !!(await window.slidesApi.cloudGenStatus())?.enabled
        } catch {
          return false
        }
      },
      // Local single-page generation (no chatoffice needed, e.g. BYOK): one LLM request through the
      // app's own AI transport writes a structured JSON slide spec, and the main process builds
      // it directly into a one-slide pptx with pptx-engine primitives — no HTML intermediate.
      generatePageLocal: async (args) => {
        const W = args.canvasW
        const H = args.canvasH
        const assets = (args.assets ?? []).filter((a) => a.dataUri)
        const sys =
          'You are a professional slide visual designer. Output exactly ONE JSON object describing one slide; no explanations/markdown/code fences.\n' +
          '\n' +
          '## Canvas\n' +
          `${W}x${H} px, origin top-left. All x/y/w/h are integers in px. Nothing may cross the canvas edges; negative coordinates forbidden. Elements paint in array order: background/decor shapes first, then images, text last (text must never end up underneath a shape).\n` +
          '\n' +
          '## Speaker notes (auto-narration): Your JSON object SHOULD also carry "notes": a 60-120 word spoken-style script for this page, in the user\'s language, with key numbers spelled out; it lands in the slide\'s speaker-notes pane.' +
          '## Layout skeletons (optional but recommended)\n' +
          'Instead of inventing geometry, you may pass "layout" + "layoutContent" alongside (or instead of) elements; the system draws a deterministic skeleton first and layers your elements on top. Layouts:\n' +
          '- titleSlide: {title, subtitle}\n' +
          '- titleContent: {title, body}\n' +
          '- twoCol: {title, left, right}\n' +
          '- fullImage: {title, image_url}\n' +
          '- statement: {text}\n' +
          '- sectionHeader: {index, title}\n' +
          'Use them for structural pages; use free elements only for data visuals and supplementary decoration.\n' +
          '\n' +
          '## Format\n' +
          '{"background":"#RRGGBB","elements":[...]}\n' +
          'Element types:\n' +
          '- Shape: {"type":"shape","shape":"roundRect","x":80,"y":120,"w":360,"h":200,"fill":"#RRGGBB or #RRGGBBAA (AA=alpha, 00 transparent)","stroke":{"color":"#RRGGBB","widthPt":1},"paragraphs":[...optional label text, vertically centered...]}\n' +
          '  Allowed shape values: rect, roundRect, ellipse, triangle, rightArrow, leftArrow, upArrow, downArrow, chevron, diamond, parallelogram, trapezoid, hexagon, pentagon, pie, donut, star5, heart, cloud, line, lineArrow. line/lineArrow draw the diagonal of their box from top-left to bottom-right and need a stroke (a horizontal rule = a box with h:1).\n' +
          '- Text: {"type":"text","x":80,"y":60,"w":800,"h":90,"valign":"top","paragraphs":[{"align":"left","lineSpacingPct":110,"spaceAfterPt":6,"bullet":false,"runs":[{"text":"...","sizePt":18,"bold":true,"italic":false,"color":"#RRGGBB","font":"Font Name"}]}]}\n' +
          '  A paragraph may mix runs of different weight/color/size (e.g. a big number run + a small unit run in one line).\n' +
          '- Image: {"type":"image","url":"https://...","x":660,"y":80,"w":540,"h":560} — center-cropped to fill its box (object-fit: cover).\n' +
          '- Image (vector, drawn by you): {"type":"image","svg":"<svg viewBox=\\"0 0 200 200\\">…</svg>","x":660,"y":80,"w":200,"h":200} — an inline standalone SVG you write for the slot; the system rasterizes it as the fallback and keeps the vector source. Use ONLY for the imagery briefs.\n' +
          '- Image (brand asset): {"type":"image","asset":"deck:1","x":660,"y":80,"w":200,"h":200} — reference a pre-registered deck asset by its handle from the brand-assets list; match w/h to its listed natural aspect.\n' +
          '\n' +
          '## Hard layout rules\n' +
          '- Text boxes have ZERO inner padding: the box top-left is exactly where the first glyph starts. Size every box from its content: one line is about sizePt*1.8 px tall at lineSpacingPct 110; a CJK character is about sizePt*1.35 px wide, a Latin character about sizePt*0.7 px. Text wraps at the box width — count the wrapped lines and make the box tall enough, plus one spare line.\n' +
          '- Text must never overflow its box or overlap other text. Keep >=8px between text and card edges, >=20px between a big title and its subtitle, >=5px between stacked text blocks in the same column — self-check every pair before output.\n' +
          '- Font sizes in pt: big titles 32-48, subtitles 18-24, body 12-15, hero KPI numbers up to 80.\n' +
          '- Spread content across the whole page; do not cram it into the top half leaving large blank areas; make text and images as large as the layout allows.\n' +
          '\n' +
          '## Visuals and assets\n' +
          '- Photos may only use URLs from the "available images" list, at most as many image elements as URLs. With no available images, fill with typography/color blocks/shapes — never fake photos.\n' +
          '- Icon-like decoration uses the allowed shapes only (at most 4-5 per page, strongly content-related). **Never use emoji**.\n' +
          '- Data visuals: compose bars/rings/timelines from rect/donut/line shapes with sizes proportional to the real values from the brief.\n' +
          '- Minimal editable units (hard rule): every visual element lands as its own independent element — words ALWAYS as text elements (never inside a picture/SVG), decorative geometry from shape primitives, and an inline SVG carries exactly ONE motif (one icon / one diagram component / one illustration). Never draw a whole page, a title, or several unrelated motifs into a single SVG.\n' +
          '- Solid colors only (alpha allowed) — no gradients. **No placeholders of any kind**: all copy comes from the brief’s real content.\n' +
          '\n' +
          '## Anti-AI design rules (violation = unacceptable)\n' +
          '- No thin vertical accent bar on the left of cards, no colored bar on top of cards, no small bar left of titles — express hierarchy with background color/font weight/size contrast.\n' +
          '- One primary + one secondary accent color for the whole page; even when comparing multiple entities, do not give each a different color (no rainbow cards).\n' +
          '- No decorative corner blocks/short lines; decorative elements must be consistent in position and style across the deck.\n' +
          '- Do not turn every page into a "shape + bold subtitle + description" list; the cover must not be a flat one-line title + subtitle layout — it needs a visual anchor (large color block/geometric composition/huge number/hero image).'
        const imgBlock = args.images.length
          ? `\nAvailable image URLs (put them into image elements; do not invent placeholder blocks):\n${args.images.map((u, i) => `${i + 1}. ${u}`).join('\n')}`
          : ''
        const briefsBlock = args.imageBriefs?.length
          ? `\nImagery briefs (no photo could be sourced for these slots — for EACH brief below you MUST emit one image element with an "svg" field, NOT a url):\n${args.imageBriefs.map((b, i) => `${i + 1}. ${b}`).join('\n')}` +
            '\nSVG rules: complete standalone markup starting <svg viewBox="0 0 200 200"> and ending </svg>; at most 1500 characters each; at most 6 per page; one motif per SVG; all coordinates inside the viewBox; flat solid fills using this page\'s palette (background/accent colors from the style); simple bold geometry (icons, diagram components, decorations) with no tiny details; NO text anywhere in the SVG (<text> is forbidden — words belong in text elements); NO external images/fonts/CSS/scripts; no emoji.'
          : ''
        const ctxBlock = args.context
          ? `\n\nReference material (all real names/figures/facts come from here; do not invent):\n${args.context.slice(0, 4000)}`
          : ''
        const assetsBlock = assets.length
          ? `\nBrand assets (pre-registered by the user; reference by handle — the system injects the real image; never invent handles, never echo bytes):\n${assets
              .map(
                (a, i) =>
                  `${i + 1}. handle "${a.id}" — ${a.name}${a.width && a.height ? `, natural size ${a.width}x${a.height}` : ''} — place it on the cover${i === 0 ? ' prominently' : ''} and as a small footer mark on content pages; match w/h to the natural aspect`,
              )
              .join('\n')}`
          : ''
        const userMsg =
          `This is the deck's unified style (this page must follow it strictly to stay consistent across pages):\n${args.style}\n\n` +
          (args.topic ? `Deck topic: ${args.topic}\n` : '') +
          `Deck-wide narrative Core Hook: ${args.coreHook}\n\n` +
          `Now design page ${args.pageIndex}/${args.totalPages}.\n` +
          `Title: ${args.title}\nLayout: ${args.layout}\nContent brief (use real data/facts): ${args.brief}${imgBlock}${briefsBlock}${assetsBlock}${ctxBlock}\n\n` +
          "Return only this page's spec JSON."
        // One repair round: feed the exact validation error back so the model can fix its JSON
        let lastErr = ''
        for (let attempt = 0; attempt < 2; attempt++) {
          if (args.signal?.aborted) break
          const msg =
            attempt === 0
              ? userMsg
              : `${userMsg}\n\nYour previous output was rejected: ${lastErr}. Output the corrected JSON object only.`
          // Text-heavy spec JSON can exceed the default 8192 tokens; single-page requests get a higher cap
          const r = await runLlmOnce(sys, msg, 120000, true, args.signal, 16384)
          if (!r.ok || !r.text) {
            lastErr = r.error ?? tGlobal('aiErrEmptyOutput')
            continue
          }
          try {
            // inline SVG elements get sanitized + rasterized here (renderer image
            // pipeline); failed ones are dropped and the page continues without them.
            // Brand-asset handles ("deck:n") then rewrite to inline data URIs with an
            // aspect-true box, so the model never echoes multi-KB bytes.
            const hydrated = await hydrateSpecSvg(r.text)
            const resolved = resolveSpecAssets(hydrated.json, assets)
            const res = await window.slidesApi.localGeneratePage({ specJson: resolved.json })
            if (res?.ok && res.marker) return res
            lastErr = res?.error ?? tGlobal('aiErrUnknown')
          } catch (e) {
            lastErr = e instanceof Error ? e.message : String(e)
          }
        }
        return { ok: false, error: lastErr || tGlobal('aiErrUnknown') }
      },
      // Cloud single-page generation (chatoffice slide_generate): the cloud service owns HTML writing +
      // pptx conversion; the deck-level style/outline stay local.
      generatePageCloud: async (args) => {
        try {
          const briefParts = [args.brief]
          if (args.layout) briefParts.push(`Layout intent: ${args.layout}`)
          if (args.context)
            briefParts.push(
              `Reference material (all real names/figures/facts come from here; do not invent):\n${args.context.slice(0, 4000)}`,
            )
          const res = await window.slidesApi.cloudGeneratePage({
            brief: briefParts.join('\n\n'),
            title: args.title,
            styleSkill: args.style,
            deckContext: {
              ...(args.topic ? { topic: args.topic } : {}),
              core_hook: args.coreHook,
              page_index: args.pageIndex,
              total_pages: args.totalPages,
            },
            images: args.images.map((u) => ({ url: u })),
            width: args.canvasW,
            height: args.canvasH,
          })
          return res ?? { ok: false, error: tGlobal('aiErrUnknown') }
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) }
        }
      },
      // ── In-tool planning: given topic+page count, the LLM produces a structured outline (batched recursion scheduled by the skill).
      // Fixes "missing pages at the input side" at the root: the main agent doesn't hand-write dozens of pages of pages JSON.
      // In-tool independent Style Skill generation: one focused LLM call thinking only about the design system.
      generateStyleSkill: async (a) => {
        const sys =
          'You are a professional deck visual designer. Given the presentation topic and style preferences, produce a complete Style Skill (visual style guide). Output strictly in the structure below, only the Style Skill content, no explanations/markdown/code fences.\n\n' +
          'Color rules (must use concrete hex values)\n' +
          '  Main background: #hex\n' +
          '  Per-page-type backgrounds:\n    cover: #hex\n    content: #hex\n    data: #hex\n    closing: #hex\n' +
          '  (Background selection principles, highest priority first):\n' +
          '   1) Style preference first: when a tone is explicit (dark theme, a brand color family, a certain texture), the background must honor it — do not fall back to a safe light color.\n' +
          "   2) Then topic mood: serve the content's emotion and tone (serious/playful/artistic/tech/traditional); different topics should have clearly different backgrounds. Dark colors, brand colors, and saturated light colors are all legitimate choices.\n" +
          '   3) Light neutral backgrounds are only a fallback: use only when the topic is neutral and the style expresses no clear preference.\n' +
          '   Constraints: content pages share one background within a deck; the main background and main text color must have sufficient contrast (light text on dark, dark text on light).\n' +
          '  Main text color: #hex\n  Primary accent: #hex\n  Secondary accent: #hex\n' +
          '  (Iron rule: one accent color system across the whole deck — even when comparing multiple companies/products/options, do not assign each entity a different color; distinguish entities by name and typography. Never exceed the primary + secondary accents)\n' +
          '  Card background: #hex\n  Border color: #hex\n\n' +
          'Fonts\n  CJK title font: [font name]\n  Latin title font: [font name]\n  Body font: [font name]\n  Title size: [range]px\n  Body size: [range]px\n\n' +
          'Layout variants per page type (list at least 2 variants each, format: variant name: description)\n' +
          '  cover variants:\n    cover_full_image_overlay: full-bleed photo background + dark overlay, centered white title, bottom metadata bar\n    cover_split_color: two color blocks side by side (60/40)\n    cover_typography_hero: pure typography, no photo, huge title (100px+)\n    cover_dark_minimal: dark background, centered large title + a little accent color\n    cover_magazine: magazine-style title taking 60% + partial imagery\n    cover_split_image: title on the left half + hero image on the right half\n' +
          '  content variants:\n    left_text_right_image | three_column_cards | hero_big_number | two_column_comparison | timeline_horizontal | full_image_text_overlay (give each a one-line description)\n' +
          '  data variants:\n    kpi_cards_row: horizontal KPI cards\n    chart_with_insight: chart left + insight right\n    two_by_two_grid: 2x2 quadrants\n' +
          '  closing variants:\n    closing_cta: centered title + contact info\n    closing_thank_you: full-bleed thank-you page\n\n' +
          'Overall style: [one sentence describing the overall design language]'
        const q = a.questionnaire ? `\nUser questionnaire answers: ${a.questionnaire}` : ''
        const hint = a.styleHint ? `\nStyle preference: ${a.styleHint}` : ''
        const userMsg = `Topic and style preferences: ${a.topic}${hint}${q}\nOutput the Style Skill.`
        const r = await runLlmOnce(sys, userMsg, undefined, true, a.signal)
        return r.ok && r.text
          ? { ok: true, styleSkill: r.text.trim() }
          : { ok: false, error: r.error ?? tGlobal('aiErrEmptyOutput') }
      },
      planDeckOutline: async (a) => {
        // style is already produced independently by generateStyleSkill; this function only outputs core_hook + per-page outlines (layout chosen per the Style Skill).
        const sys =
          'You are a professional deck planner. Given the confirmed design style, plan the content page by page. Output only one JSON object, no explanations/markdown/code fences.\n' +
          'Format: {"core_hook":"...","pages":[{"title":"","type":"cover|content|data|closing","brief":"","layout":"","image_queries":[]}]}\n' +
          '\n' +
          '## core_hook\n' +
          "The deck's narrative anchor: one sentence, with tension, containing a number or counter-intuitive contrast, at most 20 characters.\n" +
          '\n' +
          "## layout (choose from the Style Skill's per-page-type variant library; content pages within one deck must not repeat the same variant)\n" +
          'cover: cover_typography_hero (huge pure typography) | cover_dark_minimal (dark background, centered large title) | cover_split_color (side-by-side color blocks) | cover_full_image_overlay (full-bleed photo + dark overlay) | cover_magazine (magazine-style large title + partial imagery) | cover_split_image (text left, image right)\n' +
          'content: left_text_right_image | three_column_cards | hero_big_number | two_column_comparison | timeline_horizontal | full_image_text_overlay\n' +
          'data: kpi_cards_row | chart_with_insight | two_by_two_grid\n' +
          'closing: closing_cta | closing_thank_you\n' +
          'Selection criteria: 3 parallel points → three_column_cards; a key number → hero_big_number; comparison/categories → two_column_comparison/two_by_two_grid; sequence → timeline_horizontal; image+text → left_text_right_image/full_image_text_overlay; metrics → kpi_cards_row.\n' +
          '\n' +
          '## brief\n' +
          'Describe in detail what goes in each region of the layout; prefer real data/facts from the reference material, no "XX%" placeholders; cover gives main/sub titles and mood; data gives metric names + concrete values + changes.\n' +
          '\n' +
          '## image_queries\n' +
          'Array: one entry per photo slot on the page. If the reference material contains ready image URLs (starting with http), use them directly; otherwise put English image-search keywords (describing a concrete scene, e.g. "summer palace kunming lake", not generic words like "park") — the system auto-searches and fills real URLs back. Travel/product/people/brand pages get images by default; give [] only when the page truly needs no photos (fill with typography/icons; never count on CSS-drawn fake images).'
        const styleBlock = a.styleSkill
          ? `\n[Confirmed design style Style Skill; choose layout accordingly while planning]:\n${a.styleSkill}`
          : ''
        const contHint = a.continueFrom
          ? `\nThis continues the earlier plan starting at page ${a.startPage}, ${a.count} pages in total; stay narratively coherent with what came before. Core Hook: ${a.continueFrom.coreHook}. Return only these ${a.count} pages' pages (core_hook identical to before).`
          : `\nPlan ${a.count} pages in total.`
        const userMsg = `Topic: ${a.topic}${a.context ? `\nReference material/requirements: ${a.context}` : ''}${styleBlock}${contHint}\nOutput the JSON.`
        // On parse failure, silently re-request once with the same args (prompt unchanged); local quote/trailing-comma fixes run first.
        const parseOutline = (text: string) => {
          const obj = parseOutlineJson(text)
          if (obj) return { ok: true as const, outline: obj }
          // Keep the native parse error for log correlation (e.g. position 671)
          let detail = 'output is not valid JSON'
          try {
            JSON.parse(extractJsonObject(text))
          } catch (e) {
            detail = e instanceof Error ? e.message : String(e)
          }
          return { ok: false as const, error: 'outline JSON parse failed: ' + detail }
        }
        const maxAttempts = 2
        let lastErr = tGlobal('aiErrEmptyOutput')
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          if (a.signal?.aborted) return { ok: false, error: tGlobal('aiErrStopped') }
          const r = await runLlmOnce(sys, userMsg, undefined, true, a.signal)
          if (!r.ok || !r.text) {
            lastErr = r.error ?? tGlobal('aiErrEmptyOutput')
            // Empty output/timeout doesn't burn another attempt; request-level errors may retry
            if (r.errKind === 'timeout' || r.errKind === 'empty' || r.errKind === 'stopped') break
            continue
          }
          const parsed = parseOutline(r.text)
          if (parsed.ok) return parsed
          lastErr = parsed.error
        }
        return { ok: false, error: lastErr }
      },
      fitWidthPx,
      onProgress: (event: DeckProgressEvent) => {
        // Notify the App layer to update the canvas top progress bar
        onDeckProgressRef.current?.(event)
        // Update the progress card in the chat stream (replaced in place, no new message)
        patchProgressInLastAssistant((prev) => {
          if (event.stage === 'style') {
            return {
              ...prev,
              style: { label: event.label, status: event.status, summary: event.summary },
            }
          }
          if (event.stage === 'plan') {
            return {
              ...prev,
              plan: {
                label: event.label,
                done: event.done,
                total: event.total,
                status: event.status,
                summary: event.summary,
              },
            }
          }
          if (event.stage === 'images') {
            return {
              ...prev,
              images: {
                label: event.label,
                done: event.done,
                total: event.total,
                status: event.status,
                summary: event.summary,
              },
            }
          }
          if (event.stage === 'pages') {
            return {
              ...prev,
              pages: {
                label: event.label,
                done: event.done,
                total: event.total,
                status: event.status,
                summary: event.summary,
                items: event.pages,
              },
            }
          }
          if (event.stage === 'done') {
            return {
              ...prev,
              finalTotal: event.total,
              isDone: true,
              doneSummary: event.summary,
              ...(event.outcome ? { doneOutcome: event.outcome } : {}),
            }
          }
          return prev
        })
      },
      searchImages: async (query: string, maxResults: number) => {
        try {
          const r = await window.slidesApi.imageSearch(query, maxResults)
          return r.images.map((im) => im.imageUrl).filter(Boolean)
        } catch {
          return []
        }
      },
      imageSourcePref: () => settingsRef.current?.imageSource ?? 'auto',
      setImageSourcePref: (source) => {
        const cur = settingsRef.current
        if (!cur || cur.imageSource === source) return
        // 覆盖即更新默认: a per-run choice (panel picker or verbal tool arg)
        // becomes the new default
        void slidesModelBridge
          .saveSettings({ ...cur, imageSource: source })
          .then(refreshSettings)
          .catch(() => {})
      },
      hasImageModel: () => !!pickImageModel(settingsRef.current!),
      generateModelImage: async (prompt) => {
        try {
          const r = await window.slidesApi.generateImage({ prompt })
          return r.url ?? null
        } catch {
          return null
        }
      },
      localImagePool: () => localPoolRef.current,
      // Attached images (logo etc.) persist as brand assets for follow-up runs too —
      // merged by path so re-sending never duplicates a handle; payloadless entries
      // (read still pending/failed) never route generation
      deckImageAssets: () => deckAssetsRef.current.filter((a) => a.dataUri),
      saveSidecar: async (data) => {
        try {
          await window.slidesApi.saveStyleSidecar(data)
        } catch {
          /* fail-open */
        }
      },
      saveStyleTemplate: async (name, data) => {
        try {
          return await window.slidesApi.saveStyleTemplate(name, data)
        } catch {
          return { ok: false, error: String('') }
        }
      },
      listStyleTemplates: async () => {
        try {
          return await window.slidesApi.listStyleTemplates()
        } catch {
          return []
        }
      },
      loadStyleTemplate: async (name) => {
        try {
          return await window.slidesApi.loadStyleTemplate(name)
        } catch {
          return { ok: false, error: String('') }
        }
      },
      // generate_image rides the locally configured image model — advertise it
      // exactly while one resolves (same predicate the deck image sourcing uses)
      imageModelAvailable: () => !!pickImageModel(settingsRef.current!),
      unreadTextAttachments: () =>
        availableAttachments()
          .filter(
            (a) => !ATTACHMENT_IMAGE_EXTS.has(a.ext) && !readAttachmentPathsRef.current.has(a.path),
          )
          .map((a) => a.name),
      getComments: async (slideIndex: number) => {
        try {
          return await window.slidesApi.getComments(slideIndex)
        } catch {
          return []
        }
      },
      addComment: async (slideIndex: number, text: string) => {
        try {
          return await window.slidesApi.addComment({ slideIndex, text })
        } catch {
          return null
        }
      },
    }
    accessRef.current = access
    loopRef.current = new AgentLoop({
      transport: createElectronTransport(() => settingsRef.current.currentModel!),
      systemSuffix: aiLangDirective,
      skill: composeSkills('slides+files', '', [
        createSlidesMediaSkill(),
        createSlidesSkill(access),
        createFilesSkill(availableAttachments, (path) => readAttachmentPathsRef.current.add(path)),
      ]),
      events: {
        onText: (text) => {
          streamedTextRef.current = text
          patchLastAssistant({ text })
        },
        onToolStart: (call) => {
          // Live "running" chip: replaced in place by onToolExecuted; known
          // long-running tools show a localized "doing X…" label (tGlobal reads
          // the current lang at call time), the rest keep the prettified name
          const runKey = RUNNING_TOOL_LABELS[call.name]
          const activity: ToolActivity = {
            name: call.name,
            summary: runKey ? tGlobal(runKey) : call.name.replace(/[_-]+/g, ' '),
            running: true,
          }
          patchLastAssistant((last) => ({ tools: [...(last.tools ?? []), activity] }))
        },
        onToolExecuted: ({ call, execution }) => {
          const activity: ToolActivity = {
            name: call.name,
            summary: execution.summary,
            isError: execution.isError,
            output: execution.output ? execution.output.slice(0, TOOL_OUTPUT_MAX_CHARS) : undefined,
            // Side channel: display comes from tools, not into LLM context, UI only
            display: execution.display,
          }
          lastTurnToolsRef.current.push(activity)
          if (!execution.display) {
            runToolsRef.current.push({
              name: call.name,
              summary: execution.summary,
              isError: execution.isError,
              input: safeJsonInput(call.input),
              output: execution.output
                ? execution.output.slice(0, PERSIST_TOOL_FIELD_MAX)
                : undefined,
            })
          }
          patchLastAssistant((last) => {
            // Swap out the running placeholder pushed by onToolStart (parse-fail calls have none)
            const tools = [...(last.tools ?? [])]
            if (tools.at(-1)?.running) tools.pop()
            return { tools: [...tools, activity] }
          })
        },
        onTurnEnd: () => {
          lastTurnToolsRef.current = []
          patchLastAssistant({ streaming: false })
          setChat((prev) => [
            ...prev,
            { role: 'assistant', text: '', streaming: true, model: runModelRef.current },
          ])
        },
        onDone: ({ text, cancelled, turnLimit, degraded, truncated }) => {
          // Degraded runs badge their reply: the operator model lacks native
          // function calling and tools ran over the JSON-text protocol.
          const degradedNote = degraded ? tGlobal('aiDegradedMode') : ''
          const baseText = turnLimit
            ? [text, tGlobal('aiTurnLimit')].filter(Boolean).join('\n\n')
            : text || (cancelled ? tGlobal('aiStoppedNote') : '')
          const finalText = [
            truncated
              ? [baseText, tGlobal('aiTruncatedNote')].filter(Boolean).join('\n\n')
              : baseText,
            degradedNote,
          ]
            .filter(Boolean)
            .join('\n\n')
          const ranTools = runToolsRef.current.length > 0
          setChat((prev) => {
            const next = [...prev]
            const last = next.at(-1)
            if (!last || last.role !== 'assistant') return prev
            // Tool-heavy runs often end with an empty closing turn. Earlier
            // bubbles already show the executed work — drop the empty trailing
            // bubble instead of mislabeling the whole run as "no content".
            if (!finalText && !last.text && !last.tools?.length && ranTools) {
              next.pop()
              return next
            }
            next[next.length - 1] = {
              ...last,
              streaming: false,
              text: finalText || (last.tools?.length ? last.text : tGlobal('aiNoResponse')),
              // A stop mid-tool can leave a running placeholder behind — drop it
              tools: last.tools?.filter((tl) => !tl.running),
            }
            return next
          })
          void finishHistoryBatch().finally(() => {
            setBusyTracked(false)
            // Post-generation layout QC: only after a completed run that landed generated pages
            if (cancelled) qcPagesRef.current = []
            else if (qcPagesRef.current.length > 0) void runQcPassRef.current()
            // After the batch closes, so the next queued page opens a fresh one
            const resolveQueueRun = queueRunResolverRef.current
            queueRunResolverRef.current = null
            resolveQueueRun?.(!cancelled)
          })
          // Persist the assistant message (deckProgress not stored; tools store the whole run's full activity) —
          // side effects outside the updater (StrictMode double-invokes updaters, duplicating history writes)
          if (!cancelled && (finalText || runToolsRef.current.length > 0)) {
            persistMessage('assistant', finalText, runToolsRef.current)
          }
          // LOCAL(2026-09-21, d8201ad0): D10 — 取消的轮次照常落盘(半截文本 + 工具活动)
          // 打 interrupted 标记;全空不落盘(断点 = 任务起点)
          if (cancelled) {
            const half = streamedTextRef.current
            if ((half && half.trim()) || runToolsRef.current.length > 0) {
              persistMessage('assistant', half, runToolsRef.current, undefined, undefined, true)
            }
          }
          // A stop with nothing streamed is just the user changing their mind; a stop
          // over half-written output is the case worth keeping (runaway repetition)
          if (cancelled && streamedTextRef.current) logRunFailure('stopped')
          if (conversation) conversation.onTurnEnd()
        },
        onError: (error) => {
          logRunFailure('error', error)
          qcPagesRef.current = []
          setChat((prev) => {
            const next = [...prev]
            const last = next.at(-1)
            if (last?.role === 'assistant') {
              next[next.length - 1] = {
                ...last,
                streaming: false,
                error,
                tools: last.tools?.filter((tl) => !tl.running),
              }
            }
            return next
          })
          // Signed-out failures get an inline sign-in button — but only when the
          // error is itself a chatoffice auth error (both locales name ChatOffice
          // next to a sign-in word). Gating on status alone stamped the CTA onto
          // generic failures (tool-error stops, BYOK key problems) where signing
          // in fixes nothing and the button reads as required.
          void window.slidesApi
            .aiChatOfficeStatus()
            .then((status) => {
              if (status.loggedIn || !isChatofficeAuthError(error)) return
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
          void finishHistoryBatch().finally(() => {
            setBusyTracked(false)
            const resolveQueueRun = queueRunResolverRef.current
            queueRunResolverRef.current = null
            resolveQueueRun?.(false)
          })
        },
      },
    })
    // Static FC gate: a model whose API never returns tool_calls starts in
    // degraded (JSON-text) mode immediately; FC-capable models rely on the
    // loop's own silent-turn probe as the dynamic fallback.
    {
      const sel = settingsRef.current?.currentModel
      const profile = sel
        ? settingsRef.current?.profiles.find((p) => p.id === sel.profileId)
        : undefined
      if (sel && profile) {
        const protocolMap: Record<string, AiProtocol> = {
          'anthropic-messages': 'anthropic',
          'openai-completions': 'openai-compatible',
          'openai-responses': 'openai-responses',
          'gemini-native': 'gemini',
        }
        const verdict = functionCallingVerdict({
          vendorId: profile.vendorId ?? profile.id,
          protocol: protocolMap[profile.protocol] ?? 'openai-compatible',
          modelId: sel.modelId,
        })
        if (!verdict.supported) loopRef.current?.degrade()
      }
    }
    }
    const built = loopRef.current
    if (built) {
      // D10 hard chain: restored history (incl. interrupted half text) feeds the
      // loop before the first send — a lazy loop must never start empty when history exists
      if (bufferedRestoreRef.current && bufferedRestoreRef.current.length > 0) {
        built.restore(bufferedRestoreRef.current)
        bufferedRestoreRef.current = null
      }
      return built
    }
    return null
  }

  useEffect(() => {
    if (!preset || convMode) return
    // Attachments from the start screen: merge into attachments first (ref updated synchronously so this runWith can read them),
    // then trigger the run. Deduplicated by path, safe under StrictMode double runs.
    if (preset.attachments && preset.attachments.length > 0) {
      const seen = new Set(attachmentsRef.current.map((a) => a.path))
      const merged = [
        ...attachmentsRef.current,
        ...preset.attachments.filter((a) => !seen.has(a.path)),
      ]
      attachmentsRef.current = merged
      setAttachments(merged)
    }
    if (preset.autoRun)
      runWith(preset.text, preset.displayText, {
        slideShot: preset.slideShot ?? false,
        ...(preset.scope ? { scope: preset.scope } : {}),
      })
    else {
      setInput(preset.text)
      inputRef.current?.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset?.nonce])

  // `open` dep: re-expanding lands on messages streamed while collapsed
  useEffect(() => {
    if (stickToBottomRef.current) {
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
    }
  }, [chat, open])

  const onLogScroll = () => {
    const el = logRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }

  // Input box auto-sizes, up to seven lines (keep in sync with the CSS max-height);
  // empty clears the inline height outright so the CSS min-height governs
  // (a hidden-at-measure pass can leave a stale value), same as the shared AiComposer.
  useEffect(() => {
    const ta = inputRef.current
    if (!ta) return
    if (input === '') {
      ta.style.height = ''
      return
    }
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 168)}px`
    // `open` dep: re-measure after expand restores a draft
  }, [input, open])

  const run = () => runWith(input.trim())

  /** Image attachments read as base64, sent multimodally with this user message (≤5MB per image, max 20; isomorphic to docs) */
  const MAX_IMAGES_PER_MESSAGE = 20
  /** Brand-asset cap: logos/mascots are few; keeps writer prompts and pptx media small */
  const MAX_DECK_ASSETS = 6
  const collectImageAttachments = async (atts: AttachmentMeta[]): Promise<AgentImage[]> => {
    const imageAtts = atts.filter((a) => ATTACHMENT_IMAGE_EXTS.has(a.ext))
    const images: AgentImage[] = []
    const failures: string[] = []
    for (const att of imageAtts.slice(0, MAX_IMAGES_PER_MESSAGE)) {
      try {
        const result = await window.desktop.readAttachmentImage(att.path)
        if (result.ok && result.base64 && result.mime) {
          images.push({ base64: result.base64, mime: result.mime })
        } else {
          failures.push(result.error ?? t('aiReadFailed', { name: att.name }))
        }
      } catch {
        failures.push(t('aiReadFailed', { name: att.name }))
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

  /** Read audio/video attachments into wire parts; drops (with a notice) the
   * kinds the current model cannot accept per the capability matrix. */
  const collectMediaAttachments = async (
    atts: AttachmentMeta[],
  ): Promise<{ audio: AgentAudio[]; video: AgentVideo[] }> => {
    const audio: AgentAudio[] = []
    const video: AgentVideo[] = []
    const failures: string[] = []
    const sel = settingsRef.current?.currentModel
    const profile = sel
      ? settingsRef.current?.profiles.find((p) => p.id === sel.profileId)
      : undefined
    const protocolMap: Record<string, AiProtocol> = {
      'anthropic-messages': 'anthropic',
      'openai-completions': 'openai-compatible',
      'openai-responses': 'openai-responses',
      'gemini-native': 'gemini',
    }
    const caps =
      sel && profile
        ? resolveModelCapabilities({
            vendorId: profile.vendorId ?? profile.id,
            protocol: protocolMap[profile.protocol] ?? 'openai-compatible',
            modelId: sel.modelId,
          })
        : null
    const mediaExts = new Set([...ATTACHMENT_AUDIO_EXTS, ...ATTACHMENT_VIDEO_EXTS])
    for (const att of atts) {
      if (!mediaExts.has(att.ext)) continue
      if (!caps) {
        failures.push(`${att.name}: ${t('aiMediaUnsupported')}`)
        continue
      }
      const isAudio = ATTACHMENT_AUDIO_EXTS.has(att.ext)
      if (isAudio ? !caps.audioInput : !caps.videoInput) {
        failures.push(`${att.name}: ${t('aiMediaUnsupported')}`)
        continue
      }
      const result = await window.desktop.readAttachmentMedia(att.path)
      if (result.ok && result.base64 && result.mime) {
        if (isAudio) audio.push({ base64: result.base64, mime: result.mime })
        else video.push({ base64: result.base64, mime: result.mime })
      } else {
        failures.push(result.error ?? t('aiReadFailed', { name: att.name }))
      }
    }
    if (failures.length > 0) {
      setAttachNotice(failures.join(';'))
      window.setTimeout(() => setAttachNotice(null), 5000)
    }
    return { audio, video }
  }

  /** Current slide rendered at pixelRatio 1 (vision-friendly size); null when rendering fails */
  const captureSlideShot = async (pageIndex: number): Promise<AgentImage | null> => {
    const slide = slidesRef.current[pageIndex]
    if (!slide) return null
    try {
      const [png] = await renderSlidesToPngBase64([slide], imagesRef.current, 1)
      return png ? { base64: png, mime: 'image/png' } : null
    } catch {
      return null
    }
  }

  /** Register image attachments as deck brand assets (deck:1..n, capped): the page
   * writer references them by handle — the bytes never round-trip through the
   * model's output. Reads are fire-and-forget; natural size lands async and only
   * sharpens the resolver's aspect fit. Entries with no payload are filtered at
   * read time, so a failed read never poisons generation. */
  const registerDeckAssets = (atts: AttachmentMeta[]) => {
    const known = new Set(deckAssetsRef.current.map((a) => a.name))
    for (const att of atts) {
      if (deckAssetsRef.current.length >= MAX_DECK_ASSETS) break
      if (!ATTACHMENT_IMAGE_EXTS.has(att.ext) || known.has(att.path)) continue
      known.add(att.path)
      const entry: DeckImageAsset = {
        id: `deck:${deckAssetsRef.current.length + 1}`,
        name: att.name,
        dataUri: '',
      }
      deckAssetsRef.current = [...deckAssetsRef.current, entry]
      void window.desktop
        .readAttachmentImage(att.path)
        .then((r) => {
          if (!r.ok || !r.base64 || !r.mime) return
          entry.dataUri = `data:${r.mime};base64,${r.base64}`
          const probe = new Image()
          probe.onload = () => {
            entry.width = probe.naturalWidth
            entry.height = probe.naturalHeight
          }
          probe.src = entry.dataUri
        })
        .catch(() => {})
    }
  }

  const runWith = (
    instruction: string,
    displayText?: string,
    opts?: {
      slideShot?: boolean
      attachments?: AttachmentMeta[]
      scope?: AiScopeQuoteData
      /** resend of the last message: quote what it quoted */
      retry?: boolean
    },
  ) => {
    const loop = ensureLoop()
    // runStartingRef: loop.run is called only after attachments are read asynchronously, during which loop.busy is still false,
    // so duplicate triggers must be blocked synchronously (e.g. StrictMode double-running the preset autoRun effect),
    // otherwise two sets of bubbles get pushed and the earlier assistant placeholder stays at "thinking" forever.
    // qcRunningRef: the post-generation QC pass edits the deck outside the main loop — no concurrent runs
    if (!instruction || !loop || loop.busy || runStartingRef.current || qcRunningRef.current) return
    runStartingRef.current = true
    setInput('')
    // The message consumes the composer attachments: they ride along (echoed on the
    // bubble, images multimodal, files via the files skill) and the composer clears.
    const sentAtts = opts?.attachments ?? attachmentsRef.current
    if (!opts?.attachments && sentAtts.length > 0) {
      const seen = new Set(sentAttachmentsRef.current.map((a) => a.path))
      sentAttachmentsRef.current = [
        ...sentAttachmentsRef.current,
        ...sentAtts.filter((a) => !seen.has(a.path)),
      ]
      setAttachments([])
      attachmentsRef.current = []
    }
    lastAttachmentsRef.current = sentAtts
    // Auto-register image attachments as deck brand assets (idempotent by path):
    // generate_deck/regenerate_slide place them as independent editable pictures
    registerDeckAssets(sentAtts)
    inputEditedSinceRunRef.current = false
    instructionRef.current = instruction
    lastInstructionRef.current = instruction
    lastDisplayTextRef.current = displayText
    lastTurnToolsRef.current = []
    runToolsRef.current = []
    streamedTextRef.current = ''
    runSnapshotIdRef.current = null
    stickToBottomRef.current = true
    // Internal orchestration prompts (like generate_deck step notes) skip the chat bubble and go only to the model
    const shown = displayText ?? instruction
    runModelRef.current = settingsRef.current.currentModel?.modelId
    setChat((prev) => [
      // Fallback: clear leftover streaming flags on history entries, avoiding orphan "thinking" placeholders
      ...prev.map((e) => (e.role === 'assistant' && e.streaming ? { ...e, streaming: false } : e)),
      { role: 'user', text: shown, ...(sentAtts.length > 0 ? { attachments: sentAtts } : {}) },
      { role: 'assistant', text: '', streaming: true, model: runModelRef.current },
    ])
    runStartedAtRef.current = Date.now()
    setBusyTracked(true)
    // Persist the user message (store display text + attachment metadata; loop.restore rebuilds model context on file reopen)
    persistMessage('user', shown, undefined, sentAtts)
    onFirstMessageSafe(shown)
    void Promise.all([collectImageAttachments(sentAtts), collectMediaAttachments(sentAtts)])
      .then(async ([images, media]) => {
        // AI Beautify sends the current slide's rendering along, so the model sees what it edits;
        // the note rides on the model instruction only — the chat bubble stays the localized preset text
        let modelInstruction = instruction
        if (opts?.slideShot && settingsSupportVision(settingsRef.current)) {
          const shot = await captureSlideShot(currentRef.current)
          if (shot) {
            images.push(shot)
            modelInstruction += `\n\n(Attached image: the current rendering of this slide, slideIndex ${currentRef.current}. Use it to spot visual issues the element inventory can't show.)`
          }
        }
        // Clear the flag before run: loop.run sets running synchronously, leaving no re-entry window
        runStartingRef.current = false
        await onBeforeRunRef.current?.()
        if (await window.slidesApi.beginHistoryBatch()) historyBatchActiveRef.current = true
        const kbInstruction = await kb.augment(modelInstruction)
        if (kb.lastCitations.current.length > 0) {
          patchLastAssistant({ kbCitations: kb.lastCitations.current })
        }
        loop.run(kbInstruction, images, media)
      })
      .catch(() => {
        runStartingRef.current = false
        void finishHistoryBatch().finally(() => setBusyTracked(false))
      })
  }

  /** One page of a queue submission — runWith's bookkeeping minus the composer and the user bubble */
  const runQueuePage = (instruction: string) =>
    new Promise<boolean>((resolve) => {
      const loop = ensureLoop()
      if (!loop || loop.busy || runStartingRef.current || qcRunningRef.current) {
        resolve(false)
        return
      }
      runStartingRef.current = true
      instructionRef.current = instruction
      lastInstructionRef.current = instruction
      lastDisplayTextRef.current = undefined
      lastTurnToolsRef.current = []
      runToolsRef.current = []
      streamedTextRef.current = ''
      runSnapshotIdRef.current = null
      stickToBottomRef.current = true
      setChat((prev) => [
        ...prev.map((e) =>
          e.role === 'assistant' && e.streaming ? { ...e, streaming: false } : e,
        ),
        { role: 'assistant', text: '', streaming: true, model: runModelRef.current },
      ])
      runStartedAtRef.current = Date.now()
      setBusyTracked(true)
      queueRunResolverRef.current = resolve
      void Promise.resolve(onBeforeRunRef.current?.())
        .then(() => window.slidesApi.beginHistoryBatch())
        .then(async (ok) => {
          if (ok) historyBatchActiveRef.current = true
          runStartingRef.current = false
          const kbInstruction = await kb.augment(instruction)
          if (kb.lastCitations.current.length > 0) {
            patchLastAssistant({ kbCitations: kb.lastCitations.current })
          }
          loop.run(kbInstruction)
        })
        .catch(() => {
          runStartingRef.current = false
          queueRunResolverRef.current = null
          void finishHistoryBatch().finally(() => setBusyTracked(false))
          resolve(false)
        })
    })

  const SKIP_REASON_KEY: Record<
    ResolveFailure,
    'aiQueueSkipDeleted' | 'aiQueueSkipAmbiguous' | 'aiQueueSkipNested'
  > = {
    deleted: 'aiQueueSkipDeleted',
    ambiguous: 'aiQueueSkipAmbiguous',
    nested: 'aiQueueSkipNested',
  }

  /**
   * Submit the whole queue. Anchors are resolved now, not when they were
   * queued, so deletions and page moves in between are absorbed here. Each page
   * is its own run (and its own undo batch): the agent keeps a workable turn
   * budget per page, and a failure leaves the untouched pages queued.
   */
  const sendEditQueue = async () => {
    const items = editQueue ?? []
    const loop = ensureLoop()
    if (items.length === 0 || !loop || loop.busy || runStartingRef.current || qcRunningRef.current)
      return
    const resolved = resolveQueue(slidesRef.current, items)
    const groups = groupByPage(resolved)
    const skipped = resolved.filter((r) => !r.ok)
    const runnableCount = resolved.length - skipped.length

    const lines = [
      t('aiQueueSubmitted', { count: runnableCount }),
      ...groups.flatMap((g) =>
        g.entries.map(
          (e) => `${t('aiScopeSlide', { n: g.slideIndex + 1 })} · ${e.item.instruction}`,
        ),
      ),
      ...skipped.map(
        (r) =>
          `${t('aiScopeSlide', { n: r.item.slideIndex + 1 })} · ${r.item.instruction} — ${t(
            SKIP_REASON_KEY[r.reason],
          )}`,
      ),
    ]
    const shown = lines.join('\n')
    stickToBottomRef.current = true
    setChat((prev) => [
      ...prev.map((e) => (e.role === 'assistant' && e.streaming ? { ...e, streaming: false } : e)),
      { role: 'user', text: shown },
    ])
    persistMessage('user', shown)

    // Unrunnable entries leave the queue right away: re-resolving them would fail
    // the same way, and the transcript already explains why
    if (skipped.length > 0) onQueueConsume?.(skipped.map((r) => r.item.key))
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i]!
      const ok = await runQueuePage(buildPageInstruction(group, groups.length, i + 1))
      if (!ok) break // stopped or failed: the remaining pages stay queued for a retry
      onQueueConsume?.(group.entries.map((e) => e.item.key))
    }
  }

  /**
   * Post-generation layout QC: each page landed by this run gets one focused pass in a fresh
   * AgentLoop. Vision models receive screenshot + inventory; text-only models receive only
   * deterministic geometry evidence. Each page's edits sit in their own history batch; if the
   * deterministic audit says the page got worse, that batch is rolled back. Progress streams
   * into one assistant chat entry.
   */
  const runQcPass = async () => {
    const pages = qcPagesRef.current
    qcPagesRef.current = []
    const access = accessRef.current
    if (pages.length === 0 || !access || qcRunningRef.current || !isQcEnabled()) return
    qcRunningRef.current = true
    const controller = new AbortController()
    qcAbortRef.current = controller
    const capped = pages.slice(0, QC_MAX_PAGES)
    // QC reviewer: the explicit "qc" role when configured (must accept images);
    // the loop downgrades to geometry-only evidence for text-only models anyway
    const transport = createElectronTransport(
      () => resolveDefaultModel(settingsRef.current, 'qc') ?? settingsRef.current.currentModel!,
    )
    const header = tGlobal('aiQcStart', { count: capped.length })
    const lines: string[] = []
    const renderEntry = () => [header, ...lines].join('\n')
    setBusyTracked(true)
    stickToBottomRef.current = true
    // The QC entry demotes the run's reply to a mid-turn segment, whose action
    // toolbar never shows — carry its rollback point onto this entry instead
    // (settled in the finally below; runSnapshotIdRef keeps the id meanwhile)
    setChat((prev) => [
      ...prev.map((e, i) =>
        i === prev.length - 1 && e.snapshotId != null ? { ...e, snapshotId: undefined } : e,
      ),
      { role: 'assistant', text: header, streaming: true },
    ])
    // First kept QC batch — the run's own batch takes precedence (it is earlier,
    // so restoring it rewinds past the QC edits too)
    let qcSnapshotId: number | null = null
    // A custom endpoint may claim generic OpenAI-compatible vision support but reject the
    // first image. Fall back for that page and keep the rest of this pass geometry-only.
    let forceGeometryOnly = false
    try {
      for (const page of capped) {
        if (controller.signal.aborted) break
        const useScreenshot = !forceGeometryOnly && settingsSupportVision(settingsRef.current)
        const shot = useScreenshot ? await captureSlideShot(page) : null
        if (useScreenshot && !shot) {
          if (slidesRef.current[page]) lines.push(tGlobal('aiQcPageSkipped', { n: page + 1 }))
          continue
        }
        const batchOpened = await window.slidesApi.beginHistoryBatch()
        let result = await qcSlidePage({
          access,
          transport,
          pageIndex: page,
          screenshot: shot,
          systemSuffix: aiLangDirective,
          signal: controller.signal,
        })
        if (shot && result.error && isUnsupportedImageInputError(result.error)) {
          forceGeometryOnly = true
          result = await qcSlidePage({
            access,
            transport,
            pageIndex: page,
            screenshot: null,
            systemSuffix: aiLangDirective,
            signal: controller.signal,
          })
        }
        const batchId = batchOpened ? await window.slidesApi.endHistoryBatch() : null
        if (controller.signal.aborted) break
        if (result.error) {
          // QC is optional polish. Keep provider/network details in diagnostics instead of
          // exposing a noisy raw API error in the completed generation transcript.
          console.warn(`[slides-qc] page ${page + 1} skipped:`, result.error)
          lines.push(tGlobal('aiQcPageSkipped', { n: page + 1 }))
        } else if (result.edited && result.postIssues > result.preIssues) {
          // The fix made the deterministic audit worse — undo this page's batch
          if (typeof batchId === 'number') {
            const restored = await window.slidesApi.aiSnapshotRestore(batchId)
            if (restored)
              applyDeckRef.current(restored, Math.min(currentRef.current, restored.length - 1))
          }
          lines.push(tGlobal('aiQcPageReverted', { n: page + 1 }))
        } else if (result.edited) {
          const summary =
            result.reply && result.reply.toUpperCase() !== 'OK'
              ? result.reply
              : tGlobal('aiQcPageFixedDefault')
          lines.push(tGlobal('aiQcPageFixed', { n: page + 1, summary }))
          if (typeof batchId === 'number' && qcSnapshotId == null) qcSnapshotId = batchId
        } else {
          lines.push(tGlobal('aiQcPageOk', { n: page + 1 }))
        }
        patchLastAssistant({ text: renderEntry() })
      }
      if (pages.length > capped.length) {
        lines.push(tGlobal('aiQcCapped', { count: pages.length - capped.length }))
      }
      if (controller.signal.aborted) lines.push(tGlobal('aiQcStopped'))
    } finally {
      qcRunningRef.current = false
      qcAbortRef.current = null
      const finalText = renderEntry()
      patchLastAssistant({
        streaming: false,
        text: finalText,
        snapshotId: runSnapshotIdRef.current ?? qcSnapshotId ?? undefined,
      })
      persistMessage('assistant', finalText)
      setBusyTracked(false)
    }
  }
  runQcPassRef.current = runQcPass

  /** Finish pending survey cards as "skipped" (called on stop/new conversation, avoiding leftover cards and orphan promises) */
  const dismissClarify = () => {
    clarifyResolverRef.current?.({ answers: '', cancelled: true })
    clarifyResolverRef.current = null
    setActiveClarify(null)
  }

  const cancel = () => {
    dismissClarify()
    qcAbortRef.current?.abort()
    loopRef.current?.cancel()
  }

  // LOCAL(2026-09-21, d8201ad0): stop-then-close(D5/D10)——中止在途请求,
  // resolve 于该轮 interrupted 落盘发起之后(idle waiters)
  const stopConversation = async (): Promise<void> => {
    dismissClarify()
    qcAbortRef.current?.abort()
    loopRef.current?.cancel()
    if (!busyRef.current) return
    await new Promise<void>((resolve) => idleWaitersRef.current.push(resolve))
  }
  const stopRef = useRef(stopConversation)
  stopRef.current = stopConversation

  useEffect(() => {
    if (!conversation) return
    conversation.onRunningChange(busy)
  }, [busy, conversation])

  // register the command handle once; methods route through refs (always fresh)
  const slidesHandleRef = useRef<SlidesConversationHandle | null>(null)
  if (!slidesHandleRef.current) {
    slidesHandleRef.current = {
      stop: () => stopRef.current(),
      runWith: (instruction, display, opts) => runWithRef.current(instruction, display, opts),
      setDraft: (text) => {
        setInput(text)
        window.setTimeout(() => inputRef.current?.focus(), 0)
      },
      addAttachmentPaths: (paths) => {
        void window.desktop
          .addAttachmentPaths(paths)
          .then((r) => mergeAttachmentsRef.current(r))
      },
      addAttachments: (atts) => {
        const prev = attachmentsRef.current
        const seen = new Set(prev.map((a) => a.path))
        const merged = [...prev, ...atts.filter((a) => !seen.has(a.path))]
        attachmentsRef.current = merged
        setAttachments(merged)
      },
    }
  }
  useEffect(() => {
    if (!conversation) return
    conversation.onRegister(slidesHandleRef.current!)
    return () => conversation.onUnregister()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Abort a QC pass still running when the panel unmounts (new file / panel remount by key)
  // LOCAL(2026-09-21, d8201ad0): 实例卸载同时中止本会话在途 loop(§4.5 实例私有清理)
  useEffect(
    () => () => {
      qcAbortRef.current?.abort()
      loopRef.current?.cancel()
    },
    [],
  )

  const retry = () =>
    runWith(lastInstructionRef.current, lastDisplayTextRef.current, {
      attachments: lastAttachmentsRef.current,
      retry: true,
    })

  // LOCAL(2026-09-21, d8201ad0): D10 续作入口(半截轮次恢复后「继续」)
  const continueRun = () => runWith(AI_CONTINUE_INSTRUCTION)

  const newChat = () => {
    dismissClarify()
    qcAbortRef.current?.abort()
    loopRef.current?.reset()
    setBusyTracked(false)
    setChat([])
    // Same as docs (#195): the restored transcript is painted above the live
    // turn, so it must clear too — otherwise the old conversation survives.
    setHistoricChat([])
    // Answered clarifications are transcript too: they render under their
    // original message index, so stale entries would re-attach to unrelated
    // new messages after an index collision.
    setClarifyAnswers([])
    // Unsent composer attachments would otherwise ride into the next chat's
    // file context (availableAttachments merges sent + live), mirroring docs.
    setAttachments([])
    setAttachNotice(null)
    sentAttachmentsRef.current = []
    readAttachmentPathsRef.current.clear()
    inputRef.current?.focus()
  }

  const copyMessage = (text: string, idx: number) => {
    void navigator.clipboard.writeText(text)
    setCopiedIdx(idx)
    window.setTimeout(() => setCopiedIdx((cur) => (cur === idx ? null : cur)), 1200)
  }
  const runWithRef = useRef(runWith)
  runWithRef.current = runWith

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

  /** Files pasted into the input box: those with local paths go the regular attachment route; pure bitmaps like screenshots land in a temp file first */
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

  const hasDoc = !!slides[current]
  const assistItems = [
    {
      id: 'ask',
      label: t('aiAskBtn'),
      desc: t('aiAskDesc'),
      icon: <IconAiAskSelection />,
      disabled: !hasDoc || selectedIds.length === 0,
      run: () => {
        selectTab('chat')
        onAskSelection?.()
      },
    },
    {
      id: 'beautify',
      label: t('aiBeautifyBtn'),
      desc: t('aiBeautifyDesc'),
      icon: <IconAiBeautify />,
      disabled: !hasDoc || deckEmpty,
      run: () => {
        runWith(t('aiBeautifyPrompt'), undefined, { slideShot: true })
        selectTab('chat')
      },
    },
    {
      id: 'factcheck',
      label: t('aiFactCheckBtn'),
      desc: t('aiFactCheckDesc'),
      icon: <IconAiFactCheck />,
      disabled: !hasDoc || deckEmpty,
      run: () => {
        runWith(t('aiFactCheckPrompt'))
        selectTab('chat')
      },
    },
    {
      id: 'image',
      label: t('aiImageBtn'),
      desc: t('aiImageDesc'),
      icon: <IconAiImage />,
      disabled: !hasDoc || deckEmpty,
      run: () => {
        runWith(t('aiImagePrompt'))
        selectTab('chat')
      },
    },
  ]

  // LOCAL(2026-09-21, d8201ad0): 会话实例以 div 容器渲染(外壳 aside 已是面板根)
  const RootTag = (convMode ? 'div' : 'aside') as 'div'
  return (
    <RootTag
      className={convMode ? `ai-conversation${dragOver ? ' ai-panel-dragover' : ''}` : `ai-panel${dragOver ? ' ai-panel-dragover' : ''}`}
      dir={lang === 'ar' || lang === 'he' ? 'rtl' : undefined}
      style={convMode ? { display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 } : undefined}
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
      {!convMode && (
      <PanelTabs
        tabs={aiTabs}
        activeId={tab}
        onTabChange={selectTab}
        actions={
          // d9769d1: New chat is offered for a restored history transcript too
          tab === 'chat' && (chat.length > 0 || historicChat.length > 0) ? (
            <button
              className="ai-header-btn"
              onClick={newChat}
              data-tip={t('aiNewChat')}
              aria-label={t('aiNewChat')}
            >
              <IconNewChat size={15} />
            </button>
          ) : undefined
        }
        chromeActions={dockChrome?.buttons}
        dragProps={dockChrome?.dragProps}
      />
      )}

      <div
        ref={logRef}
        className="ai-chat"
        style={tab === 'chat' ? undefined : { display: 'none' }}
        onScroll={onLogScroll}
      >
        {/* Past conversation (read-only transcript, not fed to the model), displayed continuously with the current turn */}
        {historicChat.length > 0 && (
          <>
            {historicChat.map((entry, i) => (
              <div key={`h${i}`} className={`ai-msg ai-msg-${entry.role} ai-msg-historic`}>
                {entry.role === 'user' && entry.scope && <AiScopeQuote scope={entry.scope} />}
                {entry.role === 'user' && entry.attachments && entry.attachments.length > 0 && (
                  <SentAttachments atts={entry.attachments} previews={attachmentPreviews} />
                )}
                {entry.tools && entry.tools.length > 0 && <ToolChipList tools={entry.tools} />}
                {entry.text && (
                  <div dir="auto">
                    <Markdown text={entry.text} />
                  </div>
                )}
                {entry.interrupted && (
                  <span className="ai-msg-interrupted-badge">{t('aiTurnInterrupted')}</span>
                )}
              </div>
            ))}
            <div className="ai-history-sep">{t('aiHistorySep')}</div>
            {historicChat[historicChat.length - 1]?.interrupted && !busy && (
              <div className="ai-continue-row">
                <button className="ai-continue-btn" onClick={continueRun}>
                  {t('aiContinue')}
                </button>
              </div>
            )}
          </>
        )}
        {chat.length === 0 && historicChat.length === 0 && (
          <div className="ai-chat-empty">
            <div className="ai-chat-empty-title">
              {enabledChatModels(panelSettings).length === 0 && (
                <div className="ai-model-empty">
                  <div className="ai-model-empty-title">{t('aiNoModelErrorTitle')}</div>
                  <div className="ai-model-empty-body">{t('aiNoModelErrorBody')}</div>
                  <button className="ai-login-btn" onClick={() => setModelSettingsOpen(true)}>
                    {t('aiOpenModelSettings')}
                  </button>
                </div>
              )}
              {t(deckEmpty ? 'aiEmptyGenTitle' : 'aiEmptyTitle')}
            </div>
            <div className="ai-chat-empty-body">
              {t(deckEmpty ? 'aiEmptyGenBody1' : 'aiEmptyBody1')}
              <br />
              {t(deckEmpty ? 'aiEmptyGenBody2' : 'aiEmptyBody2')}
            </div>
            <div className="ai-starter-list">
              {starterPrompts(t, deckEmpty ?? false).map((p) => (
                <button
                  key={p}
                  className="ai-starter"
                  onClick={() => {
                    setInput(p)
                    inputRef.current?.focus()
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
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
          // (mid-turn segments have a following assistant entry; the live turn ends when !busy)
          const nextEntry = chat[i + 1]
          const turnEnded = nextEntry ? nextEntry.role === 'user' : !busy
          const showToolbar =
            entry.role === 'assistant' &&
            !entry.streaming &&
            turnEnded &&
            // edits-only turns have no text but still carry the rollback point
            (!!(entry.text || entry.error) || entry.snapshotId != null)
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
                    label={entry.tools?.length ? t('aiContinuing') : t('aiThinking')}
                  />
                </span>
              ) : entry.role === 'assistant' ? (
                <div dir="auto">
                  <Markdown
                    text={entry.text}
                    citations={entry.kbCitations}
                    onCitationClick={setKbCiteView}
                    onInsertImage={(src) => void insertGeneratedImage(src)}
                    insertImageLabel={lang.startsWith('zh') ? '插入幻灯片' : 'Insert'}
                  />
                </div>
              ) : (
                <span dir="auto">{entry.text}</span>
              )}
              {entry.tools && entry.tools.length > 0 && <ToolChipList tools={entry.tools} />}
              {entry.error && (
                <div className="ai-msg-error">{t('aiMsgError', { error: entry.error })}</div>
              )}
              {entry.role === 'assistant' && entry.model && !entry.streaming && (
                <div className="ai-msg-model" title={entry.model}>
                  {entry.model}
                </div>
              )}
              {/* 用户登录未开放（USER_LOGIN_READY=false）：失败重试的登录按钮隐藏 */}
              {USER_LOGIN_READY && entry.loginRequired && (
                <button
                  className="ai-login-btn"
                  onClick={() => void window.slidesApi.aiChatOfficeLogin()}
                >
                  {t('aiChatOfficeLoginBtn')}
                </button>
              )}
              {entry.deckProgress && <DeckProgressCard progress={entry.deckProgress} />}
              {showToolbar && (
                <div className="ai-msg-toolbar">
                  {entry.text && (
                    <button
                      className="ai-msg-tool-btn"
                      onClick={() => copyMessage(entry.text, i)}
                      aria-label={t('aiCopyReply')}
                      data-tip={t('aiCopyReply')}
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
                      aria-label={t('aiRegenerate')}
                      data-tip={t('aiRegenerate')}
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
                  {entry.snapshotId != null && (
                    <>
                      {/* hairline between reply actions (icons) and the document action (icon+label);
                          CSS shows it only when an icon button actually precedes it */}
                      <span className="ai-rollback-sep" aria-hidden />
                      <RollbackButton
                        disabled={busy}
                        onClick={() => void rollback(entry.snapshotId!)}
                      />
                    </>
                  )}
                </div>
              )}
              {clarifyAnswers
                .filter((c) => c.afterIdx === i)
                .map((c, k) => (
                  <div key={`ca${k}`} className="ai-clarify-answered">
                    {c.qa.map((pair, m) => (
                      <div key={m} className="ai-clarify-answered-row">
                        <div className="ai-clarify-answered-q">{pair.q}</div>
                        <div className="ai-clarify-answered-a">{pair.a}</div>
                      </div>
                    ))}
                  </div>
                ))}
            </div>
          )
        })}
        {activeClarify && (
          <div className="ai-clarify-chip" role="status">
            <span className="ai-clarify-chip-eyebrow">{t('aiClarifyTitle')}</span>
            <span className="ai-clarify-chip-arrow" aria-hidden>
              ↓
            </span>
          </div>
        )}
      </div>

      {!convMode && <AssistantTab items={assistItems} hidden={tab !== 'assistant'} />}

      {tab === 'chat' && activeClarify ? (
        /* Docked in the composer slot with the composer's own outer spacing */
        <div className="ai-composer">
          <ClarifyCard
            questions={activeClarify}
            onSubmit={(answers, qa) => {
              clarifyResolverRef.current?.({ answers })
              clarifyResolverRef.current = null
              setActiveClarify(null)
              setClarifyAnswers((prev) => [...prev, { afterIdx: chat.length - 1, qa }])
            }}
            onSkip={() => {
              clarifyResolverRef.current?.({ answers: '', cancelled: true })
              clarifyResolverRef.current = null
              setActiveClarify(null)
            }}
          />
        </div>
      ) : (
        <div className="ai-composer" style={tab === 'chat' ? undefined : { display: 'none' }}>
          {editQueue && editQueue.length > 0 && (
            <EditQueueCard
              items={editQueue}
              slides={slides}
              busy={busy}
              onEditInstruction={(key, instruction) => onQueueEditInstruction?.(key, instruction)}
              onRemove={(key) => onQueueRemove?.(key)}
              onDiscardAll={() => onQueueClear?.()}
              onFocus={(key) => onQueueFocus?.(key)}
              onSend={() => void sendEditQueue()}
            />
          )}
          {attachNotice && <div className="ai-attach-notice">{attachNotice}</div>}
          <div className="ai-input-box">
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
                        data-tip={t('aiRemoveAttachment')}
                        aria-label={t('aiRemoveAttachment')}
                      >
                        <svg width="16" height="16" viewBox="0 0 32 32" aria-hidden>
                          <path
                            d="M24 9.4L22.6 8L16 14.6L9.4 8L8 9.4l6.6 6.6L8 22.6L9.4 24l6.6-6.6l6.6 6.6l1.4-1.4l-6.6-6.6L24 9.4z"
                            fill="currentColor"
                            stroke="currentColor"
                            strokeWidth="0.25"
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
                        <span className="ai-attachment-card-name">{truncateCardName(a.name)}</span>
                        <span className="ai-attachment-card-size">
                          {formatAttachmentSize(a.sizeBytes)}
                        </span>
                      </span>
                      <button
                        className="ai-attachment-thumb-remove"
                        onClick={() => removeAttachment(a.path)}
                        data-tip={t('aiRemoveAttachment')}
                        aria-label={t('aiRemoveAttachment')}
                      >
                        <svg width="16" height="16" viewBox="0 0 32 32" aria-hidden>
                          <path
                            d="M24 9.4L22.6 8L16 14.6L9.4 8L8 9.4l6.6 6.6L8 22.6L9.4 24l6.6-6.6l6.6 6.6l1.4-1.4l-6.6-6.6L24 9.4z"
                            fill="currentColor"
                            stroke="currentColor"
                            strokeWidth="0.25"
                          />
                        </svg>
                      </button>
                    </span>
                  ),
                )}
              </div>
            )}
            <textarea
              ref={inputRef}
              value={input}
              dir="auto"
              spellCheck={spellcheck}
              data-slides-ai-input="true"
              data-deck-undo-ready={!busy && !inputEditedSinceRunRef.current ? 'true' : 'false'}
              placeholder={t(deckEmpty ? 'aiInputPlaceholderGen' : 'aiInputPlaceholder')}
              onChange={(e) => {
                inputEditedSinceRunRef.current = true
                setInput(e.target.value)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  run()
                } else if (e.key === 'Escape' && busy) {
                  e.preventDefault()
                  cancel()
                }
              }}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.files)
                if (files.length === 0) return
                e.preventDefault()
                void onPasteFiles(files)
              }}
              rows={1}
            />
            <div className="ai-input-footer">
              <KbPickerButton lang={lang} selected={kb.selected} onToggle={kb.toggle} />
              <ModelPickerButton
                settings={panelSettings}
                onPick={(selection) => {
                  void slidesModelBridge.setCurrentModel(selection).then(refreshSettings)
                }}
                onOpenSettings={() => setModelSettingsOpen(true)}
              />
              <button
                className="ai-attach-btn"
                onClick={pickAttachments}
                data-tip={t('aiAttachTitle')}
                aria-label={t('aiAttachTitle')}
              >
                <img src={attachIcon} alt="" aria-hidden />
              </button>
              {busy ? (
                <button
                  className="ai-send-btn ai-stop-btn"
                  onClick={cancel}
                  data-tip={t('aiStopGeneration')}
                  aria-label={t('aiStop')}
                >
                  <IconStop size={16} />
                </button>
              ) : (
                <button
                  className="ai-send-btn"
                  onClick={run}
                  disabled={!input.trim()}
                  data-tip={t('aiSend')}
                  aria-label={t('aiSend')}
                >
                  <IconSend size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {modelSettingsOpen && (
        <Suspense fallback={null}>
          <ModelSettingsPage
            bridge={slidesModelBridge}
            lang={lang}
            onClose={() => {
              setModelSettingsOpen(false)
              void refreshSettings()
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

/** Image URL regex: starts with http(s), extension is a common image format */
const IMAGE_URL_RE = /https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp|gif|bmp|svg)(?:\?[^\s"'<>]*)?/gi

/** The error is a chatoffice sign-in failure (the sign-in CTA's only trigger):
 * every locale's auth message names ChatOffice next to a sign-in word
 * (zh「未登录 ChatOffice…登录」, en "Not signed in to ChatOffice… Sign in"). */
function isChatofficeAuthError(msg: string): boolean {
  return /chatoffice/i.test(msg) && /sign\s?in|log\s?in|登录/i.test(msg)
}

/** URL regex (inline link detection) */
const URL_RE = /https?:\/\/[^\s"'<>]+/g

/** Extract the list of image URLs from tool output */
function extractImageUrls(text: string): string[] {
  return Array.from(new Set(Array.from(text.matchAll(IMAGE_URL_RE), (m) => m[0])))
}

/** Open external links (Electron renderer: window.open target=_blank, Electron routes external links to the system browser) */
function openExternal(url: string) {
  window.open(url, '_blank', 'noreferrer')
}

/** Split text into plain-text and link fragments by URL */
function renderLineWithLinks(line: string, keyPrefix: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  let last = 0
  const re = new RegExp(URL_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) parts.push(line.slice(last, m.index))
    const url = m[0]
    parts.push(
      <a
        key={`${keyPrefix}-${m.index}`}
        href={url}
        className="ai-tool-output-link"
        onClick={(e) => {
          e.preventDefault()
          openExternal(url)
        }}
      >
        {url}
      </a>,
    )
    last = m.index + url.length
  }
  if (last < line.length) parts.push(line.slice(last))
  return parts
}

/** Tool output panel: prefer display side-channel data, falling back to name-based inference + output text */
function ToolOutputPanel({
  name,
  output,
  display,
}: {
  name: string
  output: string
  display?: ToolDisplay
}) {
  // ── Preferred: structured display data filled by the tool ──
  if (display?.kind === 'images' && display.items && display.items.length > 0) {
    return (
      <div className="ai-tool-output ai-tool-output-images">
        {display.items.map((item, i) => (
          <ImageThumb key={i} url={item.url} title={item.title} />
        ))}
      </div>
    )
  }

  if (display?.kind === 'links' && display.items && display.items.length > 0) {
    return (
      <div className="ai-tool-output ai-tool-output-links">
        {display.items.map((item, i) => (
          <div key={i} className="ai-tool-output-link-row">
            <a
              className="ai-tool-output-link"
              href={item.url}
              onClick={(e) => {
                e.preventDefault()
                openExternal(item.url)
              }}
              data-tip={item.url}
            >
              {item.title || item.url}
            </a>
          </div>
        ))}
      </div>
    )
  }

  if (display?.kind === 'text' && display.text) {
    return <div className="ai-tool-output ai-tool-output-pre">{display.text}</div>
  }

  // ── Fallback: name-based inference (backward compatible, used when display is missing) ──
  const isImageSearch = /image_search|搜图|image.*search/i.test(name)
  const isWebSearch = /web_search|search_web|网页.*搜索|搜索|browse/i.test(name)

  if (isImageSearch) {
    const urls = extractImageUrls(output)
    if (urls.length > 0) {
      return (
        <div className="ai-tool-output ai-tool-output-images">
          {urls.map((url, i) => (
            <ImageThumb key={i} url={url} />
          ))}
        </div>
      )
    }
  }

  if (isWebSearch) {
    const lines = output.split('\n')
    return (
      <div className="ai-tool-output ai-tool-output-text">
        {lines.map((line, i) => (
          <div key={i} className="ai-tool-output-line">
            {renderLineWithLinks(line, String(i))}
          </div>
        ))}
      </div>
    )
  }

  // Default: pre-wrap plain text
  return <div className="ai-tool-output ai-tool-output-pre">{output}</div>
}

/** Single thumbnail: broken images auto-hide */
function ImageThumb({ url, title }: { url: string; title?: string }) {
  const [hidden, setHidden] = useState(false)
  if (hidden) return null
  return (
    <button
      className="ai-tool-output-img-btn"
      onClick={() => openExternal(url)}
      data-tip={title ?? url}
    >
      <img src={url} alt={title ?? ''} loading="lazy" onError={() => setHidden(true)} />
    </button>
  )
}

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

/** Quiet roll-back action in the message toolbar: restores the deck to before the run's edits */
function RollbackButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  const { t: tr } = useI18n()
  return (
    <button type="button" className="ai-rollback-btn" disabled={disabled} onClick={onClick}>
      {/* 24-canvas glyph at 18px (optical parity with the toolbar icons): stroke 1.5 paints 1.125px (1:16) */}
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M5.91026 4L2.5 7.14791L5.91026 10.8205" />
        <path d="M3.96154 7.41028H15.1636C18.5169 7.41028 21.3646 10.1484 21.4953 13.5C21.6334 17.0416 18.707 20.0769 15.1636 20.0769H6.88384" />
      </svg>
      {tr('aiRollback')}
    </button>
  )
}

/** Tool activity group: a single quiet summary row
 *  that auto-opens while tools run, auto-collapses into "Worked · N steps" when they finish,
 *  and a manual toggle that always wins. Rows inside are step rows with 1px connectors. */
function ToolChipList({ tools }: { tools: ToolActivity[] }) {
  const { t: tr } = useI18n()
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [userOpen, setUserOpen] = useState<boolean | null>(null)

  const toggle = useCallback((j: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(j)) next.delete(j)
      else next.add(j)
      return next
    })
  }, [])

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
            const hasDisplayData = !!(
              tool.display?.items?.length ||
              (tool.display?.kind === 'text' && tool.display.text)
            )
            const hasOutput = !tool.running && (!!tool.output || hasDisplayData)
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
                      <ToolOutputPanel
                        name={tool.name}
                        output={tool.output ?? ''}
                        display={tool.display}
                      />
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

/** Generation progress card: structured step archive (style → plan → images → pages → done) */
function DeckProgressCard({ progress }: { progress: DeckProgressSnapshot }) {
  const { t } = useI18n()
  // Collapsed by default: while generating only the one-line head shows (fewer concurrent loaders);
  // expanding is a view-only toggle
  const [open, setOpen] = useState(false)
  const { head, steps } = deriveDeckProgressView(progress, t)
  const pages = progress.pages

  if (steps.length === 0) return null

  return (
    <div className="deck-progress-card">
      <button
        type="button"
        className="deck-progress-head"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {head.tone === 'running' && <span className="deck-progress-spinner" aria-hidden />}
        {head.tone === 'done' ? (
          <span className="deck-progress-done">{head.text}</span>
        ) : (
          <span className={`deck-progress-title${head.tone === 'error' ? ' is-error' : ''}`}>
            {head.text}
          </span>
        )}
        <span className={`ai-tool-chip-caret${open ? ' open' : ''}`} aria-hidden>
          ›
        </span>
      </button>
      <div className={`deck-progress-body${open ? ' open' : ''}`}>
        <div className="deck-progress-body-inner">
          <div className="deck-progress-steps">
            {steps.map((step) => (
              <div key={step.key} className="deck-progress-step">
                <span className={`deck-progress-icon ${step.stepStatus}`}>
                  {step.stepStatus === 'running' ? (
                    <span className="deck-progress-spinner" />
                  ) : step.stepStatus === 'done' ? (
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                      <path
                        d="M2 6l3 3 5-5"
                        stroke="currentColor"
                        strokeWidth="0.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : (
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                      <path
                        d="M2 2l8 8M10 2l-8 8"
                        stroke="currentColor"
                        strokeWidth="0.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>
                <span className="deck-progress-step-label">{step.label}</span>
              </div>
            ))}
          </div>
          {pages && pages.items.length > 0 && (
            <div className="deck-progress-pages">
              {pages.items.map((p, i) => (
                <div key={i} className={`deck-progress-page-item deck-progress-page-${p.status}`}>
                  <span className="deck-progress-page-icon">
                    {p.status === 'done'
                      ? '✓'
                      : p.status === 'error'
                        ? '✗'
                        : p.status === 'running'
                          ? '⋯'
                          : '·'}
                  </span>
                  <span className="deck-progress-page-title">{`${t('aiPageN', { n: i + 1 })}${p.title ? '·' + p.title : ''}`}</span>
                  {p.status === 'error' && p.error && (
                    <span className="deck-progress-page-error-text" data-tip={p.error}>
                      {p.error}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Survey card: options clickable per question (single/multi), with "decide for me" and "Other (fill in)". */
function ClarifyCard({
  questions,
  onSubmit,
  onSkip,
}: {
  questions: ClarifyQuestion[]
  onSubmit: (answers: string, qa: Array<{ q: string; a: string }>) => void
  onSkip: () => void
}) {
  const { t } = useI18n()
  const decideAnswer = t('aiClarifyDecideAnswer')
  // Per question: set of selected options + the "Other" free text
  const [picked, setPicked] = useState<Record<string, Set<string>>>({})
  const [other, setOther] = useState<Record<string, string>>({})
  // Latest selections for the delayed auto-submit (the timer closure would otherwise
  // read the pre-click state and drop the final pick)
  const pickedRef = useRef(picked)
  pickedRef.current = picked
  const otherRef = useRef(other)
  otherRef.current = other
  // Pager view-state (one question at a time): back-nav limited to visited range,
  // single-select auto-advances after a beat, typing cancels the pending advance
  const [qIdx, setQIdx] = useState(0)
  const [furthest, setFurthest] = useState(0)
  const [slideDir, setSlideDir] = useState<'next' | 'prev'>('next')
  const advanceTimerRef = useRef<number | null>(null)

  const cancelAdvance = () => {
    if (advanceTimerRef.current) {
      window.clearTimeout(advanceTimerRef.current)
      advanceTimerRef.current = null
    }
  }

  const goTo = (i: number) => {
    cancelAdvance()
    const clamped = Math.max(0, Math.min(i, questions.length - 1))
    setSlideDir(clamped >= qIdx ? 'next' : 'prev')
    setQIdx(clamped)
    setFurthest((f) => Math.max(f, clamped))
  }

  // Single-select: picking advances; picking on the LAST question submits after the
  // same beat (typing in "Other" or navigating cancels the pending action)
  const scheduleAdvance = (from: number) => {
    cancelAdvance()
    const last = from >= questions.length - 1
    advanceTimerRef.current = window.setTimeout(() => {
      advanceTimerRef.current = null
      if (last) submit()
      else goTo(from + 1)
    }, 250)
  }

  useEffect(() => cancelAdvance, [])

  const toggle = (qid: string, opt: string, multi?: boolean, exclusive?: boolean) => {
    setPicked((prev) => {
      const cur = new Set(prev[qid] ?? [])
      if (multi) {
        if (exclusive) {
          cur.clear()
          cur.add(opt)
        } else {
          cur.delete(decideAnswer)
          if (cur.has(opt)) cur.delete(opt)
          else cur.add(opt)
        }
      } else {
        cur.clear()
        cur.add(opt)
      }
      return { ...prev, [qid]: cur }
    })
  }

  const submit = () => {
    const qa = questions.map((q) => {
      const chosen = [...(pickedRef.current[q.id] ?? [])]
      const ot = (otherRef.current[q.id] ?? '').trim()
      if (ot) chosen.push(ot)
      const ans = chosen.length ? chosen.join('、') : t('aiClarifyDecideAnswer')
      return { q: q.label, a: ans }
    })
    onSubmit(qa.map(({ q, a }) => `${q}: ${a}`).join('\n'), qa)
  }

  const q = questions[qIdx]
  const isLast = qIdx === questions.length - 1
  const selCount = picked[q.id]?.size ?? 0
  const hasAnswer = selCount > 0 || !!other[q.id]?.trim()

  const renderOpt = (opt: string, label: string) => (
    <button
      key={opt}
      className={`ai-clarify-opt${q.multi ? ' multi' : ''}${picked[q.id]?.has(opt) ? ' ai-clarify-opt-on' : ''}`}
      role={q.multi ? 'checkbox' : 'radio'}
      aria-checked={picked[q.id]?.has(opt) ?? false}
      onClick={() => {
        const isDecide = opt === decideAnswer
        toggle(q.id, opt, q.multi, isDecide)
        if (isDecide) {
          setOther((prev) => ({ ...prev, [q.id]: '' }))
          scheduleAdvance(qIdx)
        } else if (q.multi) {
          cancelAdvance()
        } else {
          scheduleAdvance(qIdx)
        }
      }}
    >
      <span className="ai-clarify-opt-box" aria-hidden />
      <span className="ai-clarify-opt-label">{label}</span>
      {!q.multi && (
        <span className="ai-clarify-opt-arrow" aria-hidden>
          ›
        </span>
      )}
    </button>
  )

  return (
    <div className="ai-clarify-card">
      <div className="ai-clarify-head">
        <span className="ai-clarify-head-label">{t('aiClarifyTitle')}</span>
        <span className="ai-clarify-head-progress" aria-live="polite">
          {`${qIdx + 1} / ${questions.length}`}
        </span>
        <span className="ai-clarify-head-arrows">
          <button
            type="button"
            className="ai-clarify-head-arrow"
            disabled={qIdx === 0}
            onClick={() => goTo(qIdx - 1)}
            aria-label={t('aiClarifyPrev')}
          >
            ‹
          </button>
          <button
            type="button"
            className="ai-clarify-head-arrow"
            disabled={qIdx >= furthest || !hasAnswer}
            onClick={() => goTo(qIdx + 1)}
            aria-label={t('aiClarifyNext')}
          >
            ›
          </button>
        </span>
      </div>
      <div key={q.id} className={`ai-clarify-q slide-${slideDir}`}>
        <div className="ai-clarify-question-head">
          <div className="ai-clarify-label">{q.label}</div>
          {q.multi && <span className="ai-clarify-multi-badge">{t('aiClarifyMulti')}</span>}
        </div>
        {q.description && <div className="ai-clarify-desc">{q.description}</div>}
        <div className="ai-clarify-opts">
          {q.options.map((opt) => renderOpt(opt, opt))}
          {renderOpt(decideAnswer, t('aiClarifyDecide'))}
        </div>
        <input
          className="ai-clarify-other"
          placeholder={t('aiClarifyOther')}
          value={other[q.id] ?? ''}
          onChange={(e) => {
            cancelAdvance()
            const value = e.target.value
            setOther((p) => ({ ...p, [q.id]: value }))
            if (value.trim()) {
              setPicked((prev) => {
                const cur = new Set(prev[q.id] ?? [])
                cur.delete(decideAnswer)
                return { ...prev, [q.id]: cur }
              })
            }
          }}
        />
      </div>
      <div className={`ai-clarify-actions${q.multi ? ' multi' : ''}`}>
        {q.multi && selCount > 0 && (
          <span className="ai-clarify-count">{t('aiClarifySelected', { n: selCount })}</span>
        )}
        <span className="ai-clarify-actions-btns">
          <button className="ai-clarify-skip" onClick={onSkip}>
            {t('aiClarifySkip')}
          </button>
          {isLast ? (
            <button className="ai-clarify-submit" onClick={submit} disabled={!hasAnswer}>
              {t('aiClarifySubmit')}
            </button>
          ) : (
            /* Multi-select waits for an explicit Next; single-select advances by picking. */
            q.multi && (
              <button
                type="button"
                className="ai-clarify-next"
                onClick={() => goTo(qIdx + 1)}
                disabled={!hasAnswer}
                aria-label={t('aiClarifyNext')}
              >
                <span>{t('aiClarifyNext')}</span>
                <span className="ai-clarify-next-arrow" aria-hidden>
                  →
                </span>
              </button>
            )
          )}
        </span>
      </div>
    </div>
  )
}


// ── LOCAL(2026-09-21, d8201ad0): 多会话外壳(D1/D5/D9)─────────────────────────
// tab 行 = [会话1][会话2]…[助手];「+ 新建对话」常驻右上;每个会话渲染一个
// 隐藏/显示切换的 AiConversationBody 实例(上面的原 AiPanel 主体,资源归属分类见该组件
// 顶部注释);「助手」tab 保持面板级,不实例化。上游无同类实现;收敛条件:上游若原生
// 实现多会话,评估取上游并删除本地会话池。
// LOCAL(2026-09-22, d8201ad0): D12/D13 增量——历史不再是 tab:「🕘」改 actions 槽
// 常驻图标([+][🕘])的下拉浮层 AiHistoryPopover;空会话(从未发言)关闭直接丢弃、
// 不进历史(hook close() 内分流)。上游动向与收敛条件同上。
const isChatTabS = (tab: AiActiveTab): tab is string =>
  typeof tab === 'string' && tab !== 'assistant' && tab !== 'empty'

export function AiPanel(props: AiPanelProps) {
  const {
    slides,
    current,
    selectedIds,
    deckEmpty,
    settings,
    preset,
    open = true,
    dockChrome,
    onUndo,
    onAskSelection,
    currentFilePath,
  } = props
  const { lang, t } = useI18n()
  const tempChatIdRef = useRef(`unsaved-${Date.now()}`)
  const conv = useAiConversations(
    { filePath: currentFilePath ?? null, tempChatId: tempChatIdRef.current },
    { persistKey: 'aislides.aiTab' },
  )
  const bodyHandlesRef = useRef(new Map<string, SlidesConversationHandle>())

  // 索引键换绑:未保存 → 已保存 / 重命名(chatId 不变)
  const prevFilePathRef = useRef(currentFilePath ?? null)
  useEffect(() => {
    const prev = prevFilePathRef.current
    prevFilePathRef.current = currentFilePath ?? null
    if (!currentFilePath || prev === currentFilePath) return
    conv.rebindIndex(prev ?? tempChatIdRef.current, currentFilePath)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFilePath])

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
    if (isChatTabS(conv.activeTab) && conv.open.some((c) => c.chatId === conv.activeTab)) {
      return conv.activeTab
    }
    return conv.open[0]?.chatId ?? null
  }
  const pendingRunRef = useRef<{
    text: string
    displayText?: string
    slideShot?: boolean
    attachments?: readonly AttachmentMeta[]
  } | null>(null)
  useEffect(() => {
    const p = pendingRunRef.current
    if (!p) return
    const target = targetChatId()
    if (!target) {
      // the pool settled with zero open conversations: open one to deliver into
      if (conv.ready && conv.open.length === 0) conv.create()
      return
    }
    const handle = bodyHandlesRef.current.get(target)
    if (!handle) return
    pendingRunRef.current = null
    if (p.attachments && p.attachments.length > 0) handle.addAttachments(p.attachments)
    handle.runWith(p.text, p.displayText, { slideShot: p.slideShot ?? false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.open.length, conv.activeTab, conv.ready])
  const routeRun = (
    text: string,
    displayText?: string,
    slideShot?: boolean,
    attachments?: readonly AttachmentMeta[],
  ): void => {
    const target = targetChatId()
    const handle = target ? bodyHandlesRef.current.get(target) : undefined
    if (handle) {
      if (attachments && attachments.length > 0) handle.addAttachments(attachments)
      handle.runWith(text, displayText, { slideShot: slideShot ?? false })
      return
    }
    // the pool is still loading (or empty): the delivery effect above runs the
    // queued instruction on the first ready conversation body — the seeded one,
    // not a freshly created tab
    pendingRunRef.current = { text, displayText, slideShot, attachments }
  }

  useEffect(() => {
    if (!preset) return
    if (preset.autoRun) {
      // start-screen attachments ride with the first message into the target conversation
      routeRun(preset.text, preset.displayText, preset.slideShot, preset.attachments)
    } else {
      const target = targetChatId()
      const handle = target ? bodyHandlesRef.current.get(target) : undefined
      if (handle) handle.setDraft(preset.text)
      else pendingRunRef.current = { text: preset.text }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset?.nonce])

  const hasDoc = !!slides[current]
  const assistItems = [
    {
      id: 'ask',
      label: t('aiAskBtn'),
      desc: t('aiAskDesc'),
      icon: <IconAiAskSelection />,
      disabled: !hasDoc || selectedIds.length === 0,
      run: () => onAskSelection?.(),
    },
    {
      id: 'beautify',
      label: t('aiBeautifyBtn'),
      desc: t('aiBeautifyDesc'),
      icon: <IconAiBeautify />,
      disabled: !hasDoc || deckEmpty,
      run: () => {
        routeRun(t('aiBeautifyPrompt'), undefined, true)
        const target = targetChatId()
        if (target) conv.setActiveTab(target)
      },
    },
    {
      id: 'factcheck',
      label: t('aiFactCheckBtn'),
      desc: t('aiFactCheckDesc'),
      icon: <IconAiFactCheck />,
      disabled: !hasDoc || deckEmpty,
      run: () => {
        routeRun(t('aiFactCheckPrompt'))
        const target = targetChatId()
        if (target) conv.setActiveTab(target)
      },
    },
    {
      id: 'image',
      label: t('aiImageBtn'),
      desc: t('aiImageDesc'),
      icon: <IconAiImage />,
      disabled: !hasDoc || deckEmpty,
      run: () => {
        routeRun(t('aiImagePrompt'))
        const target = targetChatId()
        if (target) conv.setActiveTab(target)
      },
    },
  ]

  const aiTabs = [
    ...conv.open.map((c) => ({
      id: c.chatId,
      label: c.title || t('aiConvUntitled'),
      onClose: () => closeFlow(c.chatId),
      running: conv.runningIds.has(c.chatId),
    })),
    { id: 'assistant', label: t('aiTabAssistant') },
  ]

  // 面板级设置:模型设置页(内部惰性加载)沿用原逻辑
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false)
  const [panelSettings, setPanelSettings] = useState(settings)
  useEffect(() => {
    setPanelSettings(settings)
  }, [settings])
  const refreshSettings = async () => {
    try {
      setPanelSettings(await slidesModelBridge.getSettings())
    } catch {
      /* keep the last known settings */
    }
  }

  return (
    <aside className="ai-panel" style={{ position: 'relative' }}>
      <PanelTabs
        tabs={aiTabs}
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
              <IconNewChat size={15} />
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

      {/* 每会话一个挂载实例 + display:none 切换(D9) */}
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

      {/* 助手 tab:保持面板级(§4.5),不实例化 */}
      {conv.activeTab === 'assistant' && (
        <AssistantTab items={assistItems} hidden={conv.activeTab !== 'assistant'} />
      )}

      {modelSettingsOpen && (
        <Suspense fallback={null}>
          <ModelSettingsPage
            bridge={slidesModelBridge}
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
