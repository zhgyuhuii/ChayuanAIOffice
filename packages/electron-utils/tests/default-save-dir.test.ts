import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  configuredDefaultSaveDir,
  readDefaultSaveDirSetting,
  resolveDefaultSaveDir,
} from '../src/index'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'chatoffice-save-dir-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('readDefaultSaveDirSetting', () => {
  const settingsPath = () => join(root, 'app-settings.json')

  it('returns the configured absolute path', () => {
    writeFileSync(settingsPath(), JSON.stringify({ defaultSaveDir: '/some/where' }))
    expect(readDefaultSaveDirSetting(settingsPath())).toBe('/some/where')
  })

  it('returns null when the file is missing, corrupt, or the key is absent', () => {
    expect(readDefaultSaveDirSetting(settingsPath())).toBeNull()
    writeFileSync(settingsPath(), 'not json')
    expect(readDefaultSaveDirSetting(settingsPath())).toBeNull()
    writeFileSync(settingsPath(), JSON.stringify({ language: 'en' }))
    expect(readDefaultSaveDirSetting(settingsPath())).toBeNull()
  })

  it('rejects non-string and relative values', () => {
    writeFileSync(settingsPath(), JSON.stringify({ defaultSaveDir: 42 }))
    expect(readDefaultSaveDirSetting(settingsPath())).toBeNull()
    writeFileSync(settingsPath(), JSON.stringify({ defaultSaveDir: 'relative/dir' }))
    expect(readDefaultSaveDirSetting(settingsPath())).toBeNull()
  })
})

describe('resolveDefaultSaveDir', () => {
  it('uses the configured folder when it is usable (creating it on demand)', () => {
    const configured = join(root, 'custom', 'nested')
    const resolved = resolveDefaultSaveDir(configured, join(root, 'fallback'))
    expect(resolved).toBe(configured)
    expect(existsSync(configured)).toBe(true)
  })

  it('creates and returns the fallback when nothing is configured', () => {
    const fallback = join(root, 'Documents', 'ChatOffice')
    expect(resolveDefaultSaveDir(null, fallback)).toBe(fallback)
    expect(existsSync(fallback)).toBe(true)
  })

  // POSIX-only premise: Windows ignores the read-only attribute on directories,
  // so accessSync(W_OK) still passes after chmod 0o500 and no degradation occurs
  it.skipIf(process.platform === 'win32')(
    'degrades to the fallback when the configured folder is not writable',
    () => {
      const readOnly = join(root, 'read-only')
      mkdirSync(readOnly)
      chmodSync(readOnly, 0o500)
      const fallback = join(root, 'fallback')
      try {
        expect(resolveDefaultSaveDir(readOnly, fallback)).toBe(fallback)
      } finally {
        chmodSync(readOnly, 0o700)
      }
    },
  )

  it('throws a descriptive error when the fallback itself is unusable', () => {
    const blocker = join(root, 'blocker')
    writeFileSync(blocker, 'x')
    expect(() => resolveDefaultSaveDir(null, blocker)).toThrow(/default save dir not usable/)
  })
})

describe('configuredDefaultSaveDir', () => {
  it('reads the setting from userData/app-settings.json and honors it', () => {
    const userData = join(root, 'userData')
    const documents = join(root, 'Documents')
    mkdirSync(userData, { recursive: true })
    const custom = join(root, 'my-files')
    writeFileSync(join(userData, 'app-settings.json'), JSON.stringify({ defaultSaveDir: custom }))
    const app = {
      getPath: (name: 'userData' | 'documents') => (name === 'userData' ? userData : documents),
    }
    expect(configuredDefaultSaveDir(app)).toBe(custom)
  })

  // 2026-09-23 用户明令：默认保存目录一律 <Documents>/ChayuanAIOffice，
  // 不再沿用 ChatOffice / ChaAI Office 等历史代目录
  it('always falls back to <Documents>/ChayuanAIOffice, ignoring legacy folders', () => {
    const userData = join(root, 'userData')
    const documents = join(root, 'Documents')
    mkdirSync(userData, { recursive: true })
    mkdirSync(join(documents, 'ChatOffice'), { recursive: true })
    mkdirSync(join(documents, 'ChaAI Office'), { recursive: true })
    const app = {
      getPath: (name: 'userData' | 'documents') => (name === 'userData' ? userData : documents),
    }
    expect(configuredDefaultSaveDir(app)).toBe(join(documents, 'ChayuanAIOffice'))
    expect(existsSync(join(documents, 'ChayuanAIOffice'))).toBe(true)
  })
})
