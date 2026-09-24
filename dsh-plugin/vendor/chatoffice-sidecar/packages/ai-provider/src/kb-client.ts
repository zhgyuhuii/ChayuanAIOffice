/**
 * Browser-safe HTTP client for the harness knowledge base (the chatop-kb
 * plugin served inside the dsh web process at /api/chatop-kb/*).
 *
 * This is the single data-plane contract of the KB integration (see
 * docs/kb-integration-plan.md): the sidecar proxies it at /kb/* for the
 * web/dsh forms, the desktop main reaches it directly for the electron form,
 * and the renderer never talks to dsh itself. Pure fetch — no node imports.
 */

export interface KbDocInfo {
  id: string
  name: string
  mime?: string
  size?: number
  status?: string
  error?: string | null
  progress?: number
  created_at?: number | string
  updated_at?: number | string
}

export interface KbInfo {
  kbId: string
  docs?: KbDocInfo[]
  vecBackend?: string
  ftsTokenizer?: string
  embedFingerprint?: string | null
}

export interface KbChain {
  cloudEmbedding?: boolean
  cloudChat?: boolean
  localChatLoaded?: boolean
  localEmbedReady?: boolean
}

export interface KbStatus {
  ok: true
  kbs: KbInfo[]
  chain?: KbChain
  docStatuses?: string[]
}

export interface KbHit {
  chunkId: string
  docId: string
  docName: string
  seq: number
  headingPath?: string | undefined
  text: string
}

export interface KbDocRecord {
  id: string
  name: string
  mime?: string
  size?: number
  status?: string
}

/** one numbered source behind a `[n]` marker in an answer */
export interface KbCitation {
  n: number
  kbId: string
  docId: string
  docName: string
  headingPath?: string | undefined
  text: string
}

export class KbError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'KbError'
    this.status = status
  }
}

/**
 * Identity fingerprint for the discovery probe: only a chatop-kb /status
 * response has this shape, so a random loopback service can never pass.
 */
export function isKbStatus(value: unknown): value is KbStatus {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { ok?: unknown }).ok === true &&
    Array.isArray((value as { kbs?: unknown }).kbs)
  )
}

export interface KbHttpClient {
  status(): Promise<KbStatus>
  search(kbId: string, q: string, topK?: number): Promise<KbHit[]>
  doc(kbId: string, docId: string): Promise<KbDocRecord>
  file(kbId: string, docId: string): Promise<KbFilePayload>
}

/** one source document fetched from the harness /file endpoint */
export interface KbFilePayload {
  name: string
  mime: string
  bytes: ArrayBuffer
}

/** pull the original filename out of a RFC 5987 content-disposition header */
export function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header)
  if (star) {
    try {
      return decodeURIComponent(star[1]!.trim().replace(/^["']|["']$/g, ''))
    } catch {
      /* fall through to the plain form */
    }
  }
  const plain = /filename=("?)([^";]+)\1/i.exec(header)
  return plain ? plain[2]!.trim() : null
}

export interface KbHttpOptions {
  /** origin of the dsh web process, e.g. http://127.0.0.1:3080; empty = same origin */
  baseUrl: string
  fetchImpl?: typeof fetch
  /** per-request abort budget (ms); 0 disables */
  timeoutMs?: number
}

export function createKbHttpClient(options: KbHttpOptions): KbHttpClient {
  const baseUrl = options.baseUrl.replace(/\/$/, '')
  const doFetch = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 8000

  const request = async <T>(path: string, query?: Record<string, string>): Promise<T> => {
    const url = new URL(`${baseUrl}/api/chatop-kb${path}`)
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v)
    const controller = timeoutMs > 0 ? new AbortController() : null
    const timer =
      controller && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null
    let response: Response
    try {
      // exactOptionalPropertyTypes: pass signal only when a budget is set
      response = await doFetch(url.toString(), controller ? { signal: controller.signal } : {})
    } catch (err) {
      throw new KbError(err instanceof Error ? err.message : String(err), 0)
    } finally {
      if (timer) clearTimeout(timer)
    }
    if (!response.ok) throw new KbError(`kb ${path} -> HTTP ${response.status}`, response.status)
    return (await response.json()) as T
  }

  return {
    async status() {
      const doc = await request<unknown>('/status')
      if (!isKbStatus(doc)) throw new KbError('kb status: unexpected payload', 0)
      return doc
    },
    async search(kbId, q, topK = 6) {
      const doc = await request<{ ok: boolean; hits: KbHit[] }>('/search', {
        kbId,
        q,
        topK: String(topK),
      })
      return Array.isArray(doc.hits) ? doc.hits : []
    },
    async doc(kbId, docId) {
      return request<{ ok: boolean; doc: KbDocRecord }>('/doc', { kbId, docId }).then((d) => d.doc)
    },
    async file(kbId, docId) {
      const url = new URL(`${baseUrl}/api/chatop-kb/file`)
      url.searchParams.set('kbId', kbId)
      url.searchParams.set('docId', docId)
      const controller = timeoutMs > 0 ? new AbortController() : null
      const timer =
        controller && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null
      let response: Response
      try {
        response = await doFetch(url.toString(), controller ? { signal: controller.signal } : {})
      } catch (err) {
        throw new KbError(err instanceof Error ? err.message : String(err), 0)
      } finally {
        if (timer) clearTimeout(timer)
      }
      if (!response.ok) throw new KbError(`kb /file -> HTTP ${response.status}`, response.status)
      return {
        name:
          filenameFromDisposition(response.headers.get('content-disposition')) ?? docId.slice(0, 8),
        mime:
          response.headers.get('content-type')?.split(';')[0]!.trim() || 'application/octet-stream',
        bytes: await response.arrayBuffer(),
      }
    },
  }
}

/**
 * Merge per-KB search results: round-robin across the KB order (so every
 * selected library is heard), dedupe by chunkId, then cap the total context
 * at `budgetChars` (measured on hit text only).
 */
export function mergeKbHits(groups: KbHit[][], budgetChars: number): KbHit[] {
  const seen = new Set<string>()
  const merged: KbHit[] = []
  let used = 0
  const depth = Math.max(...groups.map((g) => g.length), 0)
  for (let i = 0; i < depth; i++) {
    for (const group of groups) {
      const hit = group[i]
      if (!hit || seen.has(hit.chunkId)) continue
      if (used + hit.text.length > budgetChars) continue
      seen.add(hit.chunkId)
      merged.push(hit)
      used += hit.text.length
    }
  }
  return merged
}

/**
 * Build the deterministic retrieval-augmentation block appended to the user
 * instruction. The `[n]` numbering maps 1:1 onto the returned citations, and
 * the citation contract (cite as [n], admit gaps) mirrors the harness-side
 * answer prompt.
 */
export function buildKbContext(
  hits: KbHit[],
  kbIds: string[],
): { block: string; citations: KbCitation[] } {
  const citations: KbCitation[] = hits.map((hit, i) => ({
    n: i + 1,
    kbId: kbIds[0] ?? '',
    docId: hit.docId,
    docName: hit.docName,
    headingPath: hit.headingPath,
    text: hit.text,
  }))
  const sections = hits.map((hit, i) => {
    const head = hit.headingPath ? ` › ${hit.headingPath}` : ''
    return `[${i + 1}] 来源：${hit.docName}${head}\n${hit.text}`
  })
  const block = [
    '以下是知识库检索到的资料片段（编号 [1]-[' +
      hits.length +
      ']），回答时用 [n] 标注所依据的片段；',
    '资料不足以回答的部分请明确说明，不要编造：',
    '',
    sections.join('\n\n'),
  ].join('\n')
  return { block, citations }
}
