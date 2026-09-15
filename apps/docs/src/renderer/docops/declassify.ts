// declassify — 文档脱密 / 脱密复原 service, ported from chayuan-wps
// documentDeclassifyService.js onto ProseMirror (docs/chayuan-wps-harvest-analysis.md §6):
//   AI keyword extraction (the harvested secret-keyword-extract prompt) merged
//   with local regex fallbacks → §token§ placeholders → tolerant whole-text
//   matching (ignorable chars dropped, per-match ignore budget) → descending
//   in-place replacement (layout preserved) → AES-256-GCM sealed backup in a
//   sidecar file next to the document. Restore re-substitutes per token,
//   tolerating edits made after declassification.
import type { Editor } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import { findCoreAssistant } from '../ai/assistants'
import { encryptPayloadWithPassword, decryptPayload, fingerprintText, type DeclassifyEnvelope } from './declassify-crypto'

// ---- local fallback patterns (harvested verbatim) ---------------------------

const LOCAL_SENSITIVE_PATTERNS = [
  { regex: /\b1[3-9]\d{9}\b/g, category: '联系方式', riskLevel: 'high', reason: '命中手机号模式' },
  { regex: /\b[1-9]\d{16}[0-9Xx]\b/g, category: '证件信息', riskLevel: 'high', reason: '命中身份证号模式' },
  { regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, category: '联系方式', riskLevel: 'high', reason: '命中邮箱模式' },
  { regex: /\b[A-Z]{2,6}-\d{2,}\b/g, category: '编号标识', riskLevel: 'medium', reason: '命中编号模式' },
  { regex: /\b\d{6,}\b/g, category: '编号标识', riskLevel: 'medium', reason: '命中长数字编号模式' },
  { regex: /\b(?:\d{16}|\d{19})\b/g, category: '金融账户', riskLevel: 'high', reason: '命中银行卡号模式' },
  { regex: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g, category: '网络信息', riskLevel: 'high', reason: '命中IP地址模式' },
  { regex: /[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-Z][A-HJ-NP-Z0-9]{4,5}[A-HJ-NP-Z0-9挂学警港澳]/g, category: '车辆信息', riskLevel: 'high', reason: '命中车牌号模式' },
  { regex: /\b[0-9A-HJ-NP-RTUWXY]{2}\d{6}[0-9A-HJ-NP-RTUWXY]{10}\b/g, category: '单位信息', riskLevel: 'high', reason: '命中统一社会信用代码模式' },
]

const RANDOM_TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
const RANDOM_TOKEN_LENGTH = 8

export function generateReplacementToken(): string {
  const randomBytes = crypto.getRandomValues(new Uint8Array(RANDOM_TOKEN_LENGTH))
  let body = ''
  for (let i = 0; i < RANDOM_TOKEN_LENGTH; i++) {
    body += RANDOM_TOKEN_ALPHABET[randomBytes[i]! % RANDOM_TOKEN_ALPHABET.length]
  }
  return `§${body}§`
}

function ensureUniqueReplacementToken(usedTokens: Set<string>, documentText: string): string {
  for (let attempt = 0; attempt < 32; attempt++) {
    const token = generateReplacementToken()
    if (!usedTokens.has(token) && !documentText.includes(token)) return token
  }
  // astronomically unlikely; fall back to a timestamp-salted token
  return `§${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}§`
}

/** assign a fresh unique token to every entry (the wps loader swaps the model's
 *  suggestion for a system-random one so tokens are unpredictable) */
export function ensureUniqueReplacementTokens(
  entries: KeywordEntry[],
  documentText: string,
): KeywordEntry[] {
  const used = new Set<string>()
  return entries.map((entry) => {
    const token = ensureUniqueReplacementToken(used, documentText)
    used.add(token)
    return { ...entry, token }
  })
}

// ---- keyword model ----------------------------------------------------------

export type RiskLevel = 'high' | 'medium' | 'low'

export interface KeywordEntry {
  term: string
  token: string
  category: string
  riskLevel: RiskLevel
  reason: string
  /** how many times the term actually matches the document */
  occurrences: number
}

/** extract via the harvested secret-keyword-extract prompt; null on model failure */
export async function extractSecretKeywordsWithModel(
  fullText: string,
  complete: (system: string, user: string) => Promise<string>,
): Promise<KeywordEntry[] | null> {
  const assistant = findCoreAssistant('core.secret-keyword-extract')
  if (!assistant) return null
  const user = assistant.userPromptTemplate.replaceAll('{{input}}', fullText)
  let raw: string
  try {
    raw = await complete(assistant.systemPrompt, user)
  } catch {
    return null
  }
  const jsonText = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  try {
    const parsed = JSON.parse(jsonText) as {
      keywords?: Array<{ term?: string; category?: string; riskLevel?: string; reason?: string }>
    }
    if (!Array.isArray(parsed.keywords)) return null
    return parsed.keywords
      .filter((k) => typeof k.term === 'string' && k.term.trim().length > 0)
      .map((k) => ({
        term: k.term!.trim(),
        token: '',
        category: String(k.category ?? '其他'),
        riskLevel: (['high', 'medium', 'low'].includes(String(k.riskLevel))
          ? k.riskLevel
          : 'medium') as RiskLevel,
        reason: String(k.reason ?? ''),
        occurrences: 0,
      }))
  } catch {
    return null
  }
}

/** merge model output with the local regex fallbacks (dedup by normalized term) */
export function mergeLocalKeywordHits(
  fullText: string,
  modelEntries: KeywordEntry[] | null,
): KeywordEntry[] {
  const out = new Map<string, KeywordEntry>()
  for (const entry of modelEntries ?? []) {
    if (!out.has(entry.term)) out.set(entry.term, { ...entry, token: '' })
  }
  for (const pattern of LOCAL_SENSITIVE_PATTERNS) {
    const matches = fullText.match(pattern.regex)
    if (!matches) continue
    for (const term of matches) {
      if (out.has(term)) continue
      out.set(term, {
        term,
        token: '',
        category: pattern.category,
        riskLevel: pattern.riskLevel as RiskLevel,
        reason: pattern.reason,
        occurrences: 0,
      })
    }
  }
  // longer terms first so the longest match wins when terms nest
  return [...out.values()].sort((a, b) => b.term.length - a.term.length)
}

// ---- tolerant matching over the PM document ---------------------------------

/** ignorable between/around characters: spaces (half/full), tabs, zero-widths, BOM, soft hyphen */
// eslint-disable-next-line no-misleading-character-class -- soft hyphen \u00AD sits after astraneous chars but is a lone codepoint here
const IGNORABLE = /[\s\u00A0\u3000\u200B\u200C\u200D\uFEFF\u00AD]/g

interface TextSegment {
  /** index range within the normalized stream */
  normStart: number
  normEnd: number
  /** absolute PM positions of this text node */
  pmFrom: number
  pmTo: number
  text: string
  /** normalized index → index in `text` */
  normToRaw: number[]
}

/** build the normalized whole-document stream with PM position mapping */
export function buildNormalizedStream(doc: PmNode): {
  normalized: string
  segments: TextSegment[]
} {
  let normalized = ''
  const segments: TextSegment[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'text' || !node.text) return true
    const text = node.text
    const normToRaw: number[] = []
    let piece = ''
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!
      IGNORABLE.lastIndex = 0
      if (IGNORABLE.test(ch)) continue
      piece += ch
      normToRaw.push(i)
    }
    if (piece.length === 0) return true
    segments.push({
      normStart: normalized.length,
      normEnd: normalized.length + piece.length,
      pmFrom: pos,
      pmTo: pos + node.nodeSize,
      text,
      normToRaw,
    })
    normalized += piece
    return true
  })
  return { normalized, segments }
}

export interface ReplacementHit {
  term: string
  token: string
  /** absolute PM range inside a single text node */
  from: number
  to: number
  contextBefore: string
  contextAfter: string
}

/**
 * buildReplacementPlan — tolerant single-pass scan (the wps findMatchedEntry
 * semantics: ignorable characters may sit inside a term). One hit never spans
 * two text nodes; nested terms are absorbed by the longest-first ordering.
 */
export function buildReplacementPlan(
  doc: PmNode,
  entries: KeywordEntry[],
): { hits: ReplacementHit[]; unmatchedTerms: string[] } {
  const { normalized, segments } = buildNormalizedStream(doc)
  const normTerms = entries.map((e) => ({
    entry: e,
    norm: e.term.replace(IGNORABLE, ''),
  }))
  const hits: ReplacementHit[] = []
  const claimed: Array<[number, number]> = [] // normalized ranges already replaced
  const matchedTerms = new Set<string>()
  const overlaps = (a: [number, number], from: number, to: number) =>
    !(a[1] <= from || to <= a[0])

  for (const { entry, norm } of normTerms) {
    if (!norm) continue
    let searchFrom = 0
    for (;;) {
      const idx = normalized.indexOf(norm, searchFrom)
      if (idx < 0) break
      searchFrom = idx + norm.length
      if (claimed.some((c) => overlaps(c, idx, idx + norm.length))) continue
      // map normalized range back to PM positions within one segment
      const seg = segments.find((s) => s.normStart <= idx && idx + norm.length <= s.normEnd)
      if (!seg) continue
      const rawFrom = seg.normToRaw[idx - seg.normStart]!
      const rawLast = seg.normToRaw[idx - seg.normStart + norm.length - 1]!
      const from = seg.pmFrom + rawFrom
      const to = seg.pmFrom + rawLast + 1
      claimed.push([idx, idx + norm.length])
      matchedTerms.add(entry.term)
      hits.push({
        term: entry.term,
        token: entry.token,
        from,
        to,
        contextBefore: normalized.slice(Math.max(0, idx - 12), idx),
        contextAfter: normalized.slice(idx + norm.length, idx + norm.length + 12),
      })
    }
  }
  const unmatchedTerms = entries.filter((e) => !matchedTerms.has(e.term)).map((e) => e.term)
  return { hits, unmatchedTerms }
}

/** 文档脱密 — assign unique tokens then replace every hit (descending) */
export function applyDocumentDeclassify(editor: Editor, hits: ReplacementHit[]): number {
  if (hits.length === 0) return 0
  const tr = editor.state.tr
  const ordered = [...hits].sort((a, b) => b.from - a.from)
  for (const hit of ordered) {
    tr.replaceWith(hit.from, hit.to, editor.state.schema.text(hit.token))
  }
  if (tr.docChanged) editor.view.dispatch(tr)
  return hits.length
}

/** 脱密复原 — put each token's original term back (descending, edit-tolerant) */
export function restoreDeclassifyByTokens(
  editor: Editor,
  pairs: Array<{ token: string; term: string }>,
): { restored: number; missingTokens: string[] } {
  const { normalized, segments } = buildNormalizedStream(editor.state.doc)
  const tr = editor.state.tr
  const pending: Array<{ from: number; to: number; term: string }> = []
  const missingTokens: string[] = []
  for (const { token, term } of pairs) {
    const normToken = token.replace(IGNORABLE, '')
    let searchFrom = 0
    let found = false
    for (;;) {
      const idx = normalized.indexOf(normToken, searchFrom)
      if (idx < 0) break
      searchFrom = idx + normToken.length
      const seg = segments.find(
        (s) => s.normStart <= idx && idx + normToken.length <= s.normEnd,
      )
      if (!seg) continue
      const rawFrom = seg.normToRaw[idx - seg.normStart]!
      const rawLast = seg.normToRaw[idx - seg.normStart + normToken.length - 1]!
      pending.push({ from: seg.pmFrom + rawFrom, to: seg.pmFrom + rawLast + 1, term })
      found = true
    }
    if (!found) missingTokens.push(token)
  }
  if (pending.length === 0) return { restored: 0, missingTokens }
  for (const p of pending.sort((a, b) => b.from - a.from)) {
    tr.replaceWith(p.from, p.to, editor.state.schema.text(p.term))
  }
  if (tr.docChanged) editor.view.dispatch(tr)
  return { restored: pending.length, missingTokens }
}

// ---- sealed backup (sidecar) -------------------------------------------------

export interface DeclassifyPayload {
  version: 1
  createdAt: string
  originalText: string
  declassifiedText: string
  keywordEntries: KeywordEntry[]
  replacements: Array<{ token: string; term: string; count: number }>
  textHashes: { original: string; declassified: string }
}

export interface DeclassifyState {
  status: 'declassified'
  keywordCount: number
  replacementCount: number
  algorithm: string
  createdAt: string
  updatedAt: string
}

/** sidecar record: plaintext state + the sealed payload envelope */
export interface DeclassifySidecar {
  state: DeclassifyState
  envelope: DeclassifyEnvelope
}

export const DECIPHER_STATE_ERRORS = {
  notDeclassified: 'not-declassified',
  noSidecar: 'no-sidecar',
  wrongPassword: 'wrong-password',
  tampered: 'tampered',
} as const

/** build the sealed sidecar after a successful declassification */
export async function buildSidecar(
  originalText: string,
  declassifiedText: string,
  entries: KeywordEntry[],
  hits: ReplacementHit[],
  password: string,
): Promise<DeclassifySidecar> {
  const counts = new Map<string, number>()
  for (const hit of hits) counts.set(hit.token, (counts.get(hit.token) ?? 0) + 1)
  const payload: DeclassifyPayload = {
    version: 1,
    createdAt: new Date().toISOString(),
    originalText,
    declassifiedText,
    keywordEntries: entries,
    replacements: [...counts.entries()].map(([token, count]) => ({
      token,
      term: hits.find((h) => h.token === token)?.term ?? '',
      count,
    })),
    textHashes: {
      original: await fingerprintText(originalText),
      declassified: await fingerprintText(declassifiedText),
    },
  }
  const envelope = await encryptPayloadWithPassword(payload, password)
  const now = new Date().toISOString()
  return {
    state: {
      status: 'declassified',
      keywordCount: entries.length,
      replacementCount: hits.length,
      algorithm: 'PBKDF2-SHA-256 + AES-256-GCM',
      createdAt: now,
      updatedAt: now,
    },
    envelope,
  }
}

export async function openSidecar(
  sidecar: DeclassifySidecar,
  password: string,
): Promise<DeclassifyPayload> {
  return decryptPayload<DeclassifyPayload>(sidecar.envelope, password)
}

/** the declassify password policy (wps parity): ≥8, upper+lower+digit+special */
export function validateDeclassifyPassword(password: string): string | null {
  if (password.length < 8) return 'too-short'
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password)) return 'need-case'
  if (!/\d/.test(password)) return 'need-digit'
  if (!/[^A-Za-z0-9]/.test(password)) return 'need-special'
  return null
}
