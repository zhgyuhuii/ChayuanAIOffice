import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openLocalArea } from '@chatoffice/storage-adapter'
import { buildServer } from '../src/app.ts'

const dirs: string[] = []
const servers: Server[] = []

function tempArea() {
  const dir = mkdtempSync(join(tmpdir(), 'chatoffice-kb-bff-'))
  dirs.push(dir)
  return openLocalArea({ rootDir: dir })
}

afterEach(() => {
  while (servers.length) servers.pop()!.close()
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

/** stand-in for the dsh web process: serves the chatop-kb shape on an ephemeral port */
async function upstream(statusBody: unknown): Promise<string> {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    if (String(req.url).includes('/status')) res.end(JSON.stringify(statusBody))
    else
      res.end(
        JSON.stringify({
          ok: true,
          hits: [{ chunkId: 'c1', docId: 'd1', docName: 'a.md', seq: 0, text: '内容' }],
        }),
      )
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`
}

describe('kb proxy', () => {
  it('degrades gracefully when no harness is configured', async () => {
    const { app } = buildServer({ area: tempArea() })
    const res = await app.inject({ method: 'GET', url: '/kb/discover' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: false, reason: 'kb-unavailable' })
  })

  it('proxies status/search against the configured harness origin', async () => {
    const origin = await upstream({ ok: true, kbs: [{ kbId: 'default', docs: [] }] })
    const { app } = buildServer({
      area: tempArea(),
      kbHarness: { dshHome: join(tmpdir(), 'unused'), rpcOrigin: origin },
    })
    const probe = await app.inject({ method: 'GET', url: '/kb/discover' })
    expect(probe.json()).toMatchObject({ ok: true, origin })
    expect(probe.json().status.kbs).toHaveLength(1)

    const search = await app.inject({
      method: 'GET',
      url: '/kb/search?kbIds=default,other&q=' + encodeURIComponent('问题'),
    })
    expect(search.json().ok).toBe(true)
    expect(search.json().groups).toHaveLength(2)

    const missing = await app.inject({ method: 'GET', url: '/kb/search?q=x' })
    expect(missing.statusCode).toBe(400)
  })

  it('maps upstream failures to 5xx without crashing', async () => {
    const origin = await upstream({ ok: true, kbs: [] })
    // kill the upstream so requests fail
    servers.pop()!.close()
    const { app } = buildServer({
      area: tempArea(),
      kbHarness: { dshHome: join(tmpdir(), 'unused'), rpcOrigin: origin },
    })
    const res = await app.inject({ method: 'GET', url: '/kb/discover' })
    expect(res.statusCode).toBe(502)
    expect(res.json().ok).toBe(false)
  })
})
