import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openLocalArea } from '@chatoffice/storage-adapter'
import { buildServer } from '../src/app.ts'

const dirs: string[] = []

function tempArea() {
  const dir = mkdtempSync(join(tmpdir(), 'chatoffice-static-'))
  dirs.push(dir)
  return openLocalArea({ rootDir: dir })
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function webRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'chatoffice-www-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'editors', 'docs'), { recursive: true })
  writeFileSync(join(dir, 'index.html'), '<html>host</html>')
  writeFileSync(join(dir, 'config.js'), 'window.CHATOFFICE_EDITORS = {}')
  writeFileSync(join(dir, 'editors', 'docs', 'index.html'), '<html>docs</html>')
  return dir
}

describe('static hosting', () => {
  it('serves the host SPA and editor bundles with correct mime types', async () => {
    const { app } = buildServer({ area: tempArea(), staticDir: webRoot() })
    const host = await app.inject({ method: 'GET', url: '/' })
    expect(host.statusCode).toBe(200)
    expect(host.body).toContain('host')
    expect(host.headers['content-type']).toContain('text/html')

    const editor = await app.inject({ method: 'GET', url: '/editors/docs/' })
    expect(editor.statusCode).toBe(200)
    expect(editor.body).toContain('docs')

    const js = await app.inject({ method: 'GET', url: '/config.js' })
    expect(js.headers['content-type']).toContain('text/javascript')
  })

  it('falls back to index.html for unknown SPA routes but keeps API 404s as JSON', async () => {
    const { app } = buildServer({ area: tempArea(), staticDir: webRoot() })
    const spa = await app.inject({ method: 'GET', url: '/some/client/route' })
    expect(spa.statusCode).toBe(200)
    expect(spa.body).toContain('host')

    const api = await app.inject({ method: 'POST', url: '/rpc/nope/x', payload: {} })
    expect(api.statusCode).toBe(404)
    expect(api.json().error).toBeTruthy()
  })

  it('rejects traversal outside the static root', async () => {
    const { app } = buildServer({ area: tempArea(), staticDir: webRoot() })
    const res = await app.inject({ method: 'GET', url: '/..%2f..%2fetc%2fpasswd' })
    expect([403, 404]).toContain(res.statusCode)
    expect(res.body).not.toContain('root:')
  })
})
