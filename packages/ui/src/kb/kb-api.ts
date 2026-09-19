/**
 * Renderer facade for the knowledge-base read surface (docs/kb-integration-plan.md
 * §4). One contract everywhere: the `window.chatOfficeKb` global installed by
 * the desktop preloads (IPC) and by the web-bridge shims (same-origin fetch
 * against the sidecar /kb/* proxy). Missing global = KB integration absent →
 * the UI degrades by hiding the picker, never by crashing.
 */
import {
  buildKbContext,
  mergeKbHits,
  type KbCitation,
  type KbHit,
  type KbStatus,
} from '@chatoffice/ai-provider/browser'

export type { KbCitation, KbHit, KbStatus }

export interface KbBridgeApi {
  discover(): Promise<KbDiscoverPayload>
  search(args: { kbIds: string[]; q: string; topK?: number }): Promise<KbSearchPayload>
  doc(args: { kbId: string; docId: string }): Promise<KbDocPayload>
  /** optional: preloads/fetch bridges without it keep the cite preview link hidden */
  file?(args: { kbId: string; docId: string }): Promise<KbFilePayload>
  getSource(): Promise<KbSourceState>
  setOrigin(origin: string | null): Promise<KbSourceState>
}

export interface KbDiscoverPayload {
  ok: boolean
  reason?: 'kb-unavailable'
  origin?: string
  source?: 'manual' | 'cached' | 'hint' | 'probe'
  status?: KbStatus
}

export interface KbSearchPayload {
  ok: boolean
  reason?: string
  groups?: KbHit[][]
}

export interface KbDocPayload {
  ok: boolean
  reason?: string
  doc?: { id: string; name: string; mime?: string; size?: number; status?: string }
}

/**
 * Result of a source-file download behind a citation. Exactly one of `url`
 * (web/dsh form: same-origin download link the renderer navigates to) or
 * `savedPath` (desktop form: main already wrote the file and revealed it).
 */
export interface KbFilePayload {
  ok: boolean
  reason?: string
  url?: string
  savedPath?: string
}

export interface KbSourceState {
  manualOrigin?: string
  cachedOrigin?: string
}

declare global {
  interface Window {
    chatOfficeKb?: KbBridgeApi
  }
}

/** structural guard: never trust the global's shape (f1dcbd86 lesson) */
export function kbBridge(): KbBridgeApi | null {
  if (typeof window === 'undefined') return null
  const kb = window.chatOfficeKb
  return kb && typeof kb.search === 'function' && typeof kb.discover === 'function' ? kb : null
}

/** context budget for retrieval augmentation, in characters of hit text */
const BUDGET_KEY = 'chatoffice-kb-budget'
export function kbBudget(): number {
  try {
    const raw = Number(localStorage.getItem(BUDGET_KEY))
    return Number.isFinite(raw) && raw >= 2000 ? raw : 12_000
  } catch {
    return 12_000
  }
}
export function setKbBudget(chars: number): void {
  try {
    localStorage.setItem(BUDGET_KEY, String(chars))
  } catch {
    /* private mode */
  }
}

const SELECTED_KEY = 'chatoffice-kb-selected'
export function kbSelectedIds(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SELECTED_KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}
export function setKbSelectedIds(ids: string[]): void {
  try {
    localStorage.setItem(SELECTED_KEY, JSON.stringify(ids))
  } catch {
    /* private mode */
  }
}

let discoverCache: { at: number; payload: KbDiscoverPayload } | null = null
const DISCOVER_TTL = 5000

export async function kbDiscover(force = false): Promise<KbDiscoverPayload> {
  const kb = kbBridge()
  if (!kb) return { ok: false, reason: 'kb-unavailable' }
  if (!force && discoverCache && Date.now() - discoverCache.at < DISCOVER_TTL) {
    return discoverCache.payload
  }
  try {
    const payload = await kb.discover()
    discoverCache = { at: Date.now(), payload }
    return payload
  } catch {
    return { ok: false, reason: 'kb-unavailable' }
  }
}

/** per-KB hit groups in selection order (empty group when a library fails) */
export async function kbSearchGroups(kbIds: string[], q: string, topK = 6): Promise<KbHit[][]> {
  const kb = kbBridge()
  if (!kb || kbIds.length === 0 || !q.trim()) return []
  try {
    // harness-side chunker prefers short queries; cap runaway instructions
    const payload = await kb.search({ kbIds, q: q.slice(0, 512), topK })
    return Array.isArray(payload.groups) ? payload.groups : []
  } catch {
    return []
  }
}

/**
 * The send-pipeline primitive: search the selected libraries, merge with the
 * round-robin + budget policy, and build the numbered context block. Returns
 * null when nothing usable came back (caller degrades to a plain send).
 */
export async function kbRetrieve(
  kbIds: string[],
  q: string,
  options: { topK?: number; budgetChars?: number } = {},
): Promise<{ hits: KbHit[]; citations: KbCitation[]; block: string } | null> {
  const groups = await kbSearchGroups(kbIds, q, options.topK ?? 6)
  const hits = mergeKbHits(groups, options.budgetChars ?? kbBudget())
  if (hits.length === 0) return null
  const { block, citations } = buildKbContext(hits, kbIds)
  return { hits, citations, block }
}

export async function kbDoc(kbId: string, docId: string): Promise<KbDocPayload> {
  const kb = kbBridge()
  if (!kb) return { ok: false, reason: 'kb-unavailable' }
  try {
    return await kb.doc({ kbId, docId })
  } catch {
    return { ok: false, reason: 'kb-upstream' }
  }
}

/**
 * Download the source file behind a citation. Returns kb-unsupported when the
 * installed bridge predates the file channel (affordance stays hidden), so
 * the renderer never navigates blindly.
 */
export async function kbFile(kbId: string, docId: string): Promise<KbFilePayload> {
  const kb = kbBridge()
  if (!kb || typeof kb.file !== 'function') return { ok: false, reason: 'kb-unsupported' }
  try {
    return await kb.file({ kbId, docId })
  } catch {
    return { ok: false, reason: 'kb-upstream' }
  }
}

export async function kbGetSource(): Promise<KbSourceState> {
  const kb = kbBridge()
  if (!kb) return {}
  try {
    return await kb.getSource()
  } catch {
    return {}
  }
}

export async function kbSetOrigin(origin: string | null): Promise<KbSourceState> {
  const kb = kbBridge()
  if (!kb) return {}
  discoverCache = null
  try {
    return await kb.setOrigin(origin)
  } catch {
    return {}
  }
}
