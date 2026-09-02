import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openLocalArea, openStorageArea, resolveWithin } from '../src/index.js'

const dirs: string[] = []

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'chatoffice-storage-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('resolveWithin', () => {
  it('joins a relative path onto the root', () => {
    expect(resolveWithin('/r', 'a/b.json')).toBe(join('/r', 'a', 'b.json'))
  })

  it('rejects absolute paths', () => {
    expect(() => resolveWithin('/r', '/etc/passwd')).toThrow()
  })

  it('rejects traversal', () => {
    expect(() => resolveWithin('/r', '../x')).toThrow()
    expect(() => resolveWithin('/r', 'a/../../x')).toThrow()
  })
})

describe('openLocalArea', () => {
  it('reads and writes inside the root with relative paths', () => {
    const root = tempRoot()
    const area = openLocalArea({ rootDir: root })
    area.fs.mkdirSync('sub')
    area.fs.writeFileSync('sub/a.txt', 'hello')
    expect(area.fs.readFileSync('sub/a.txt')).toBe('hello')
    expect(area.fs.existsSync('sub/a.txt')).toBe(true)
    expect(area.fs.readdirSync('sub')).toEqual(['a.txt'])
  })

  it('appends, renames, stats, and unlinks', () => {
    const root = tempRoot()
    const area = openLocalArea({ rootDir: root })
    area.fs.writeFileSync('log', 'a\n')
    area.fs.appendFileSync('log', 'b\n')
    expect(area.fs.readFileSync('log')).toBe('a\nb\n')
    area.fs.renameSync('log', 'log2')
    expect(area.fs.existsSync('log')).toBe(false)
    const st = area.fs.statSync('log2')
    expect(st.size).toBe(4)
    expect(typeof st.mtimeMs).toBe('number')
    area.fs.unlinkSync('log2')
    expect(area.fs.existsSync('log2')).toBe(false)
  })

  it('cannot touch files outside the root', () => {
    const root = tempRoot()
    const outside = tempRoot()
    writeFileSync(join(outside, 'secret.txt'), 'x')
    const area = openLocalArea({ rootDir: root })
    expect(() => area.fs.readFileSync(join(outside, 'secret.txt'))).toThrow()
  })

  it('requires an absolute rootDir', () => {
    expect(() => openLocalArea({ rootDir: 'relative' })).toThrow()
  })
})

describe('openStorageArea', () => {
  it('routes local to the local implementation', () => {
    const area = openStorageArea('local', { rootDir: tempRoot() })
    expect(area.track).toBe('local')
  })

  it('rejects unimplemented tracks explicitly', () => {
    expect(() => openStorageArea('cloud', { rootDir: '/x' })).toThrow(/not implemented/)
    expect(() => openStorageArea('embedded', { rootDir: '/x' })).toThrow(/not implemented/)
  })
})
