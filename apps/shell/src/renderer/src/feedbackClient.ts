/**
 * Renderer side of the feedback channel (aidooo.com): device id, diagnostics
 * collection, attachment upload via the main-process proxy, and offline
 * drafts. Network + signing live in main (src/main/feedback.ts) because the
 * renderer CSP blocks cross-origin fetch.
 */
import type { FeedbackAttachmentMeta, FeedbackSubmitResult } from '../../shared/home-api'

const MID_KEY = 'co_feedback_mid'
const DRAFTS_KEY = 'co_feedback_drafts'

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** 16-hex device id, anchored in localStorage (server groups history by it). */
export function getFeedbackMid(): string {
  try {
    const existing = localStorage.getItem(MID_KEY)
    if (existing && /^[0-9a-f]{16}$/.test(existing)) return existing
    const bytes = new Uint8Array(8)
    crypto.getRandomValues(bytes)
    const mid = toHex(bytes)
    localStorage.setItem(MID_KEY, mid)
    return mid
  } catch {
    const bytes = new Uint8Array(8)
    crypto.getRandomValues(bytes)
    return toHex(bytes)
  }
}

export interface FeedbackDiagnostics {
  appVersion: string
  os: string
  osVer: string
  arch: string
  logJson: string
}

/** Version (IPC) + UA-derived os/arch + MCP log tail, packed as logJson. */
export async function collectFeedbackDiagnostics(): Promise<FeedbackDiagnostics> {
  let appVersion = ''
  try {
    appVersion = await window.chatOffice.getAppVersion()
  } catch {
    appVersion = ''
  }

  let os = 'unknown'
  let osVer = ''
  let arch = ''
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  if (/Windows NT ([0-9.]+)/.test(ua)) {
    os = 'windows'
    osVer = RegExp.$1
  } else if (/Mac OS X ([0-9_]+)/.test(ua)) {
    os = 'macos'
    osVer = RegExp.$1.replace(/_/g, '.')
  } else if (/Android[ /]([0-9.]+)/.test(ua)) {
    os = 'android'
    osVer = RegExp.$1
  } else if (/Linux/.test(ua)) {
    os = 'linux'
  }
  if (/arm64|aarch64/i.test(ua)) arch = 'arm64'
  else if (/x64|Win64|WOW64|x86_64|amd64/i.test(ua)) arch = 'x64'

  let recentLog: string[] = []
  try {
    const lines = await window.chatOffice.getMcpLogs()
    if (Array.isArray(lines)) recentLog = lines.slice(-50)
  } catch {
    recentLog = []
  }

  const logObj = { version: appVersion, ua, ts: Date.now(), recentLog }
  let logJson = ''
  try {
    logJson = JSON.stringify(logObj)
    if (logJson.length > 8000) {
      logJson = JSON.stringify({ ...logObj, recentLog: recentLog.slice(-10) })
      if (logJson.length > 8000) logJson = JSON.stringify({ ...logObj, recentLog: [] })
    }
  } catch {
    logJson = JSON.stringify({ version: appVersion, ua, ts: Date.now(), recentLog: [] })
  }

  return { appVersion, os, osVer, arch, logJson }
}

export interface FeedbackDraft {
  localId: string
  content: string
  attachments: FeedbackAttachmentMeta[]
  type: string
  createdAt: string
}

/** Upload one picked file through the main-process proxy. */
export async function uploadFeedbackFile(file: File): Promise<FeedbackAttachmentMeta> {
  const data = new Uint8Array(await file.arrayBuffer())
  const res = await window.chatOffice.feedbackUpload(file.name, file.type || 'application/octet-stream', data)
  if (!res.ok || !res.url) throw new Error(res.error || 'upload failed')
  return {
    name: res.name || file.name,
    url: res.url,
    kind: res.kind === 'image' ? 'image' : 'file',
    size: res.size ?? file.size,
  }
}

/**
 * Submit the form. On a network failure (offline) the form is saved as a
 * local draft for auto-resend, and the offline flag is surfaced to the caller.
 */
export async function submitFeedbackForm(args: {
  content: string
  type: string
  attachments: FeedbackAttachmentMeta[]
}): Promise<FeedbackSubmitResult> {
  const { appVersion, os, osVer, arch, logJson } = await collectFeedbackDiagnostics()
  const res = await window.chatOffice.feedbackSubmit({
    mid: getFeedbackMid(),
    type: args.type,
    content: args.content,
    attachments: args.attachments,
    logJson,
    appVersion,
    os,
    osVer,
    arch,
  })
  if (!res.ok && res.offline) saveFeedbackDraft({ content: args.content, attachments: args.attachments, type: args.type })
  return res
}

export function saveFeedbackDraft(draft: { content: string; attachments: FeedbackAttachmentMeta[]; type: string }): void {
  try {
    const drafts = loadFeedbackDrafts()
    drafts.push({
      localId: `d_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      content: draft.content || '',
      attachments: Array.isArray(draft.attachments) ? draft.attachments : [],
      type: draft.type || 'suggestion',
      createdAt: new Date().toISOString(),
    })
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts))
  } catch {
    /* storage unavailable — draft is simply not persisted */
  }
}

export function loadFeedbackDrafts(): FeedbackDraft[] {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Re-send every stored draft; each success removes it, failures stay. */
export async function retryFeedbackDrafts(): Promise<number> {
  const drafts = loadFeedbackDrafts()
  let submitted = 0
  for (const draft of drafts) {
    const res = await submitFeedbackForm({ content: draft.content, type: draft.type, attachments: draft.attachments })
    if (res.ok) {
      try {
        localStorage.setItem(DRAFTS_KEY, JSON.stringify(loadFeedbackDrafts().filter((d) => d.localId !== draft.localId)))
      } catch {
        /* ignore */
      }
      submitted++
    }
  }
  return submitted
}
