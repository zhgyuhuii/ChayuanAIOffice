import { afterEach, describe, expect, it } from 'vitest'
import {
  buildKbContext,
  createKbHttpClient,
  isKbStatus,
  KbError,
  mergeKbHits,
  type KbHit,
  type KbStatus,
} from '../src/kb-client'
import { discoverHarnessKb } from '../src/kb-discovery'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const status: KbStatus = {
  ok: true,
  kbs: [
    {
      kbId: 'default',
      docs: [{ id: 'd1', name: 'a.md', status: 'ready' }],
      vecBackend: 'sqlite-vec',
    },
  ],
  chain: { cloudEmbedding: true },
}

describe('kb-client', () => {
  it('fingerprint accepts only a chatop-kb /status payload', () => {
    expect(isKbStatus(status)).toBe(true)
    expect(isKbStatus({ ok: true })).toBe(false)
    expect(isKbStatus({ ok: false, kbs: [] })).toBe(false)
    expect(isKbStatus(null)).toBe(false)
  })

  it('search passes kbId/q/topK and returns hits', async () => {
    const hits: KbHit[] = [
      { chunkId: 'c1', docId: 'd1', docName: 'a.md', seq: 0, headingPath: ' Intro', text: 'hi' },
    ]
    let seenUrl = ''
    const client = createKbHttpClient({
      baseUrl: 'http://127.0.0.1:3080/',
      fetchImpl: (async (input: RequestInfo | URL) => {
        seenUrl = String(input)
        return jsonResponse({ ok: true, hits })
      }) as typeof fetch,
    })
    await expect(client.search('default', '这个问题', 6)).resolves.toEqual(hits)
    expect(seenUrl).toBe(
      'http://127.0.0.1:3080/api/chatop-kb/search?kbId=default&q=' +
        encodeURIComponent('这个问题') +
        '&topK=6',
    )
  })

  it('search with q containing reserved chars keeps the query intact', async () => {
    let seenUrl = ''
    const client = createKbHttpClient({
      baseUrl: 'http://x',
      fetchImpl: (async (input: RequestInfo | URL) => {
        seenUrl = String(input)
        return jsonResponse({ ok: true, hits: [] })
      }) as typeof fetch,
    })
    await client.search('k', 'a&b c', 3)
    expect(seenUrl).toContain('q=a%26b+c')
  })

  it('non-OK responses raise KbError with the status code', async () => {
    const client = createKbHttpClient({
      baseUrl: 'http://x',
      fetchImpl: (async () => jsonResponse({ ok: false }, 404)) as typeof fetch,
    })
    await expect(client.status()).rejects.toBeInstanceOf(KbError)
  })

  it('merge round-robins groups, dedupes chunkIds and honors the budget', () => {
    const a: KbHit[] = [
      { chunkId: 'a1', docId: 'd', docName: 'a', seq: 0, text: 'x'.repeat(10) },
      { chunkId: 'a2', docId: 'd', docName: 'a', seq: 1, text: 'x'.repeat(10) },
    ]
    const b: KbHit[] = [
      { chunkId: 'a1', docId: 'd', docName: 'a', seq: 0, text: 'x'.repeat(10) },
      { chunkId: 'b1', docId: 'e', docName: 'b', seq: 0, text: 'y'.repeat(10) },
    ]
    const merged = mergeKbHits([a, b], 35)
    expect(merged.map((h) => h.chunkId)).toEqual(['a1', 'a2', 'b1'])
    expect(merged.reduce((n, h) => n + h.text.length, 0)).toBeLessThanOrEqual(35)
  })

  it('context block numbers hits and mirrors the citations list', () => {
    const hits: KbHit[] = [
      {
        chunkId: 'c1',
        docId: 'd1',
        docName: '规格.md',
        seq: 2,
        headingPath: '总则/范围',
        text: '内容一',
      },
      { chunkId: 'c2', docId: 'd2', docName: 'faq.md', seq: 0, text: '内容二' },
    ]
    const { block, citations } = buildKbContext(hits, ['default'])
    expect(block).toContain('[1] 来源：规格.md › 总则/范围')
    expect(block).toContain('[2] 来源：faq.md')
    expect(block).toContain('内容二')
    expect(citations.map((c) => c.n)).toEqual([1, 2])
    expect(citations[0]).toMatchObject({ docId: 'd1', docName: '规格.md', text: '内容一' })
  })
})

describe('kb-discovery', () => {
  afterEach(() => {
    delete (globalThis as { __kbSeen?: unknown }).__kbSeen
  })

  it('prefers the manual origin over probing', async () => {
    const probed: string[] = []
    const result = await discoverHarnessKb({
      explicitOrigin: 'http://127.0.0.1:9999',
      probePorts: [3080],
      fetchImpl: (async (input: RequestInfo | URL) => {
        probed.push(String(input))
        return jsonResponse(status)
      }) as typeof fetch,
    })
    expect(result).toMatchObject({ origin: 'http://127.0.0.1:9999', source: 'manual' })
    expect(probed.some((u) => u.includes(':3080/'))).toBe(false)
  })

  it('falls back to the port probe and validates the fingerprint', async () => {
    const result = await discoverHarnessKb({
      probePorts: [3080, 41000],
      timeoutMs: 200,
      fetchImpl: (async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes(':41000')) return jsonResponse(status)
        throw new Error('refused')
      }) as typeof fetch,
    })
    expect(result).toMatchObject({ origin: 'http://127.0.0.1:41000', source: 'probe' })
  })

  it('returns null when nothing answers', async () => {
    const result = await discoverHarnessKb({
      probePorts: [41234, 41235],
      timeoutMs: 120,
      fetchImpl: (async () => {
        throw new Error('refused')
      }) as typeof fetch,
    })
    expect(result).toBeNull()
  })
})
