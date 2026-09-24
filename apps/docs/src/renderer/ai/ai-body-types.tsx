/**
 * LOCAL(2026-09-21, d8201ad0): docs 对话体共享类型与纯展示组件(B 区)。
 * 原 AiPanel.tsx 模块级工具(消息模型、附件卡、工具步骤列表、回滚按钮、starter 常量)
 * 迁入此文件,供 AiConversationBody(及面板级 writer)引用。
 */
import { useState } from 'react'
import type { AttachmentMeta } from '../../shared/ipc'
import { ATTACHMENT_IMAGE_EXTS } from '../../shared/ipc'
import type { PmNode } from '../editor/convert'
import { useI18n, type StringKey } from '../i18n/locale'
import filePdfIcon from '../assets/file-pdf.png'
import fileWordIcon from '../assets/file-word.png'
import fileExcelIcon from '../assets/file-excel.png'
import filePptIcon from '../assets/file-ppt.png'
import fileImageIcon from '../assets/file-image.png'
import fileVideoIcon from '../assets/file-video.png'
import fileVoiceIcon from '../assets/file-voice.png'
import fileDocumentIcon from '../assets/file-document.png'
import fileGeneralIcon from '../assets/file-general.png'

export interface ToolActivity {
  name: string
  summary: string
  /** still executing: rendered as a spinner chip, replaced in place when the tool finishes */
  running?: boolean
  isError?: boolean
  /** Tool output (truncated on the UI side); when set, the row can be expanded for details */
  output?: string
}

/** Max characters of tool output in the UI expansion panel */
export const TOOL_OUTPUT_MAX_CHARS = 2000

/** Cap on tool args/output persisted in the transcript (the store layer has another 16k truncation fallback) */
export const PERSIST_TOOL_FIELD_MAX = 16_000

/** Tool args → JSON string (truncated; returns undefined on serialization failure, doesn't block persistence) */
export function safeJsonInput(input: unknown): string | undefined {
  try {
    const s = JSON.stringify(input)
    return s && s !== '{}' ? s.slice(0, PERSIST_TOOL_FIELD_MAX) : undefined
  } catch {
    return undefined
  }
}

export interface ChatEntry {
  role: 'user' | 'assistant'
  text: string
  error?: string
  streaming?: boolean
  turnLimit?: boolean
  /** D10: restored interrupted turn (half text kept, rendered with the badge) */
  interrupted?: boolean
  /** the run failed because ChatOffice is signed out — render an inline sign-in button */
  loginRequired?: boolean
  /** tool executions performed during this assistant turn */
  tools?: ToolActivity[]
  /** document state before this turn's first edit — rendered as an inline roll-back action */
  snapshot?: PmNode
  /** attachments consumed from the composer by this user message (read-only echo chips) */
  attachments?: AttachmentMeta[]
  /** model id that produced this assistant turn (display only) */
  model?: string
  scope?: import('@chatoffice/ui').AiScopeQuoteData
  /** KB citations behind the [n] chips of this assistant turn */
  kbCitations?: import('@chatoffice/ui').KbCitation[]
}

/** longest selection excerpt echoed on a user bubble */
export const SCOPE_TEXT_MAX = 200

/** clickable starter prompts for the empty state (fill the input, do not send) */
export const DraftStarters: StringKey[] = [
  'aiStarterWeeklyReport',
  'aiStarterLaunchPost',
  'aiStarterEventOutline',
]
export const EditStarters: StringKey[] = [
  'aiStarterSummarize',
  'aiStarterPolishAll',
  'aiStarterContinue',
  'aiStarterFillTemplate',
]

/** Clipboard bitmap MIME → attachment extension (corresponds to ATTACHMENT_IMAGE_EXTS) */
export const PASTE_MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

/** File-type icons for attachment cards (ChatOffice attachment icon set) */
export const ATTACHMENT_CARD_ICON_GROUPS: [icon: string, exts: string[]][] = [
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

export function AttachmentCardIcon({ ext }: { ext: string }) {
  return <img src={ATTACHMENT_CARD_ICONS[ext] ?? fileGeneralIcon} alt="" aria-hidden />
}

/** Card name slot width: 190 card - 2 border - 8/14 padding - 40 icon - 10 gap */
const CARD_NAME_MAX_WIDTH = 116
let cardNameCtx: CanvasRenderingContext2D | null = null

/** Ellipsize like the design: cut at the limit, strip trailing -_./spaces */
export function truncateCardName(name: string): string {
  cardNameCtx ??= document.createElement('canvas').getContext('2d')
  if (!cardNameCtx) return name
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

export function formatAttachmentSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    : `${(bytes / 1024).toFixed(2)} KB`
}

/** Read-only echo of the attachments a user message consumed from the composer */
export function SentAttachments({
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

/** Quiet roll-back action in the message toolbar */
export function RollbackButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  const { t: tr } = useI18n()
  return (
    <button type="button" className="ai-rollback-btn" disabled={disabled} onClick={onClick}>
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

/** Tool activity group: a single quiet summary row with step rows inside */
export function ToolChipList({ tools }: { tools: ToolActivity[] }) {
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
