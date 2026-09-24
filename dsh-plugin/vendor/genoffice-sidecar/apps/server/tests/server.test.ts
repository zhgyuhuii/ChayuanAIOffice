import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openLocalArea } from '@genoffice/storage-adapter'
import { buildServer } from '../src/app.ts'

const dirs: string[] = []

function tempArea() {
  const dir = mkdtempSync(join(tmpdir(), 'genoffice-bff-'))
  dirs.push(dir)
  return openLocalArea({ rootDir: dir })
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('GET /healthz', () => {
  it('reports ok', async () => {
    const { app } = buildServer({ area: tempArea() })
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
  })
})

describe('POST /rpc/:service/:method', () => {
  it('forwards to the chatHistory service and returns its result', async () => {
    const { app } = buildServer({ area: tempArea() })
    const res = await app.inject({
      method: 'POST',
      url: '/rpc/chatHistory/resolveChat',
      payload: { args: [{ filePath: '/tmp/a.md' }] },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.result.projectId).toBe('default')
  })

  it('round-trips append + loadChat', async () => {
    const area = tempArea()
    const { app } = buildServer({ area })
    const resolved = await app.inject({
      method: 'POST',
      url: '/rpc/chatHistory/resolveChat',
      payload: { args: [{ filePath: '/tmp/b.md' }] },
    })
    const { projectId, chatId } = resolved.json().result
    await app.inject({
      method: 'POST',
      url: '/rpc/chatHistory/appendChat',
      payload: { args: [{ projectId, chatId, role: 'user', text: 'via bff' }] },
    })
    const loaded = await app.inject({
      method: 'POST',
      url: '/rpc/chatHistory/loadChat',
      payload: { args: [{ projectId, chatId }] },
    })
    expect(loaded.json().result).toHaveLength(1)
    expect(loaded.json().result[0].text).toBe('via bff')
  })

  it('404s unknown service or method', async () => {
    const { app } = buildServer({ area: tempArea() })
    expect((await app.inject({ method: 'POST', url: '/rpc/nope/list', payload: {} })).statusCode).toBe(404)
    expect(
      (await app.inject({ method: 'POST', url: '/rpc/chatHistory/nope', payload: {} })).statusCode,
    ).toBe(404)
  })

  it('400s with the error message when the service throws', async () => {
    const { app } = buildServer({ area: tempArea() })
    const res = await app.inject({
      method: 'POST',
      url: '/rpc/chatHistory/rebindChat',
      payload: { args: [{ projectId: 'default', tempChatId: 't1' }] },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().ok).toBe(false)
  })

  it('serves the settings service too', async () => {
    const area = tempArea()
    const { app } = buildServer({ area })
    await app.inject({
      method: 'POST',
      url: '/rpc/settings/set',
      payload: { args: ['theme', 'dark'] },
    })
    const got = await app.inject({ method: 'POST', url: '/rpc/settings/get', payload: { args: ['theme'] } })
    expect(got.json().result).toBe('dark')
  })
})

describe('auth (jwt mode)', () => {
  function tokenFor(sub: string, aud?: string): string {
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
    return `.${enc({ sub, ...(aud ? { aud } : {}) })}.`
  }

  it('rejects missing/invalid tokens on rpc routes and accepts a valid sub', async () => {
    const { app } = buildServer({ area: tempArea(), auth: { mode: 'jwt', audience: 'genoffice' } })
    const noToken = await app.inject({ method: 'POST', url: '/rpc/settings/get', payload: { args: ['x'] } })
    expect(noToken.statusCode).toBe(401)

    const badAud = await app.inject({
      method: 'POST',
      url: '/rpc/settings/get',
      payload: { args: ['x'] },
      headers: { authorization: `Bearer ${tokenFor('u1', 'other')}` },
    })
    expect(badAud.statusCode).toBe(401)

    const ok = await app.inject({
      method: 'POST',
      url: '/rpc/settings/get',
      payload: { args: ['x'] },
      headers: { authorization: `Bearer ${tokenFor('u1', 'genoffice')}` },
    })
    expect(ok.statusCode).toBe(200)

    const health = await app.inject({ method: 'GET', url: '/healthz' })
    expect(health.statusCode).toBe(200)
  })
})

describe('AI relay metering', () => {
  it('records every call and reports usage', async () => {
    const seen: Array<Record<string, unknown>> = []
    const { app } = buildServer({
      area: tempArea(),
      ai: { onCall: (r) => seen.push(r as unknown as Record<string, unknown>) },
    })
    await app.inject({
      method: 'POST',
      url: '/ai/relay',
      payload: { channel: 'byok:openai', model: 'gpt-x', requestId: 'r1' },
    })
    expect(seen).toHaveLength(1)
    expect(seen[0].model).toBe('gpt-x')
    const usage = await app.inject({ method: 'GET', url: '/ai/usage' })
    expect(usage.json().calls).toBe(1)
  })

  it('rejects incomplete relay requests', async () => {
    const { app } = buildServer({ area: tempArea() })
    const res = await app.inject({ method: 'POST', url: '/ai/relay', payload: { channel: 'x' } })
    expect(res.statusCode).toBe(400)
  })
})
