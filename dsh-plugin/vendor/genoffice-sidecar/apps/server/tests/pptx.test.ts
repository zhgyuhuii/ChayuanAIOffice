import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openLocalArea } from '@genoffice/storage-adapter'
import { buildServer } from '../src/app.ts'

const dirs: string[] = []

function tempArea() {
  const dir = mkdtempSync(join(tmpdir(), 'genoffice-pptx-'))
  dirs.push(dir)
  return openLocalArea({ rootDir: dir })
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})


describe('pptx service', () => {
  it('status reports zero sessions on a fresh server', async () => {
    const { app } = buildServer({ area: tempArea() })
    const res = await app.inject({ method: 'GET', url: '/rpc/pptx/status' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ openSessions: 0 })
  })

  it('rejects empty bytes with a structured error', async () => {
    const { app } = buildServer({ area: tempArea() })
    const res = await app.inject({
      method: 'POST',
      url: '/rpc/pptx/openBytes',
      payload: { args: [{ base64: '', name: 'x.pptx' }] },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().ok).toBe(false)
  })

  it('rejects unknown sessions on save', async () => {
    const { app } = buildServer({ area: tempArea() })
    const res = await app.inject({
      method: 'POST',
      url: '/rpc/pptx/saveBytes',
      payload: { args: ['nope'] },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('unknown pptx session')
  })

  it('opens and re-serializes a real pptx round-trip', async () => {
    // Use a real deck from the engine fixtures if present
    const fixture = findFixture()
    if (!fixture) return // no fixture in this checkout — covered by engine tests
    const base64 = readFileSync(fixture).toString('base64')
    const { app } = buildServer({ area: tempArea() })
    const open = await app.inject({
      method: 'POST',
      url: '/rpc/pptx/openBytes',
      payload: { args: [{ base64, name: 'deck.pptx', fitWidthPx: 960 }] },
    })
    expect(open.statusCode).toBe(200)
    const body = open.json()
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.result.slides)).toBe(true)
    const saved = await app.inject({
      method: 'POST',
      url: '/rpc/pptx/saveBytes',
      payload: { args: [body.result.sessionId] },
    })
    expect(saved.statusCode).toBe(200)
    expect(saved.json().result.base64.length).toBeGreaterThan(100)
  })
})

function findFixture(): string | null {
  const dir = join(import.meta.dirname ?? '.', '..', '..', 'fixtures')
  try {
    if (!existsSync(dir)) return null
    const first = readdirSync(dir).find((f) => f.endsWith('.pptx'))
    return first ? join(dir, first) : null
  } catch {
    return null
  }
}
