/**
 * Knowledge-base proxy for the web/dsh forms (docs/kb-integration-plan.md §4).
 *
 * The renderer must never talk to the dsh web origin directly: the sidecar
 * owns the harness origin (direct env value or the origin file the dsh plugin
 * host writes on first request) and re-exposes the chatop-kb read surface at
 * /kb/* same-origin. Strictly read-only — management (upload / reindex /
 * keys) stays in the harness-side knowledge-base app.
 */

import { readFile } from 'node:fs/promises'
import type { FastifyInstance, FastifyReply } from 'fastify'
import {
  createKbHttpClient,
  discoverHarnessKb,
  isKbStatus,
  KbError,
  type KbHttpClient,
} from '@chatoffice/ai-provider'

export interface KbProxyOptions {
  /** same harness block attachAiProxy receives; absent = KB routes degrade */
  harness?: {
    dshHome: string
    rpcOrigin: string
    rpcOriginFile?: string
  }
}

/** degraded payload shape the renderer facade understands */
const UNAVAILABLE = { ok: false, reason: 'kb-unavailable' as const }

let cachedOrigin = ''
let cachedOriginAt = 0

async function resolveHarnessOrigin(options: KbProxyOptions): Promise<string | null> {
  const harness = options.harness
  if (!harness) return null
  if (harness.rpcOrigin) return harness.rpcOrigin
  if (harness.rpcOriginFile) {
    if (cachedOrigin && Date.now() - cachedOriginAt < 5000) return cachedOrigin
    try {
      cachedOrigin = (await readFile(harness.rpcOriginFile, 'utf8')).trim()
      cachedOriginAt = Date.now()
    } catch {
      cachedOrigin = ''
    }
    if (cachedOrigin) return cachedOrigin
  }
  // origin not discovered yet: fall back to the loopback ladder once, so the
  // very first UI probe works even before dsh has served a proxied request
  const found = await discoverHarnessKb({ timeoutMs: 800 })
  return found?.origin ?? null
}

type Reply = FastifyReply

export function attachKbProxy(app: FastifyInstance, options: KbProxyOptions): void {
  let client: KbHttpClient | null = null
  let clientOrigin = ''

  const getClient = async (): Promise<{ kb: KbHttpClient; origin: string } | null> => {
    const origin = await resolveHarnessOrigin(options)
    if (!origin) return null
    if (!client || clientOrigin !== origin) {
      client = createKbHttpClient({ baseUrl: origin })
      clientOrigin = origin
    }
    return { kb: client, origin }
  }

  /** shared body: null client degrades to 200 UNAVAILABLE, upstream errors map to 502 */
  const respond = async <T>(
    reply: Reply,
    fn: (kb: KbHttpClient, origin: string) => Promise<T>,
  ): Promise<unknown> => {
    const resolved = await getClient()
    if (!resolved) return reply.code(200).send(UNAVAILABLE)
    try {
      return await fn(resolved.kb, resolved.origin)
    } catch (err) {
      const status = err instanceof KbError && err.status >= 400 ? err.status : 502
      return reply.code(status).send({
        ok: false,
        reason: 'kb-upstream',
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // availability probe + KB listing: decides whether the composer picker lights up
  app.get('/kb/discover', async (_request, reply) =>
    respond(reply, async (kb, origin) => {
      const status = await kb.status()
      if (!isKbStatus(status)) return UNAVAILABLE
      return { ok: true, origin, status }
    }),
  )

  app.get('/kb/search', async (request, reply) => {
    const query = (request.query ?? {}) as { kbIds?: string; q?: string; topK?: string }
    const kbIds = (query.kbIds ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (kbIds.length === 0 || !query.q)
      return reply.code(400).send({ ok: false, reason: 'bad-request' })
    return respond(reply, async (kb) => {
      const topK = Math.min(Number(query.topK ?? 6) || 6, 20)
      // per-KB groups: the renderer round-robins them through mergeKbHits
      const groups = await Promise.all(
        kbIds.map((kbId) => kb.search(kbId, query.q!, topK).catch(() => [])),
      )
      return { ok: true, groups }
    })
  })

  app.get('/kb/doc', async (request, reply) => {
    const query = (request.query ?? {}) as { kbId?: string; docId?: string }
    if (!query.kbId || !query.docId)
      return reply.code(400).send({ ok: false, reason: 'bad-request' })
    return respond(reply, async (kb) => {
      const doc = await kb.doc(query.kbId!, query.docId!)
      return { ok: true, doc }
    })
  })

  // source-file download behind a citation: buffered passthrough (harness caps
  // uploads at 48MB) so the browser gets native content-disposition handling
  app.get('/kb/file', async (request, reply) => {
    const query = (request.query ?? {}) as { kbId?: string; docId?: string }
    if (!query.kbId || !query.docId)
      return reply.code(400).send({ ok: false, reason: 'bad-request' })
    const resolved = await getClient()
    if (!resolved) return reply.code(200).send(UNAVAILABLE)
    try {
      const file = await resolved.kb.file(query.kbId, query.docId)
      reply.header('content-type', file.mime || 'application/octet-stream')
      reply.header(
        'content-disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      )
      return reply.send(Buffer.from(file.bytes))
    } catch (err) {
      const status = err instanceof KbError && err.status >= 400 ? err.status : 502
      return reply.code(status).send({ ok: false, reason: 'kb-upstream' })
    }
  })
}
