import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openLocalArea } from '@genoffice/storage-adapter'
import { createCore, createSettingsApi, settingsService } from '../src/index.js'

const dirs: string[] = []

function tempArea() {
  const dir = mkdtempSync(join(tmpdir(), 'genoffice-settings-'))
  dirs.push(dir)
  return openLocalArea({ rootDir: dir })
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('settings service', () => {
  it('gets, sets, and patches settings persisted in the area', () => {
    const api = createSettingsApi({ area: tempArea() })
    expect(api.get('lang')).toBeUndefined()
    api.set('lang', 'zh')
    api.set('theme', 'dark')
    expect(api.get('lang')).toBe('zh')
    api.patch({ theme: 'light', accent: 'blue' })
    expect(api.getAll()).toEqual({ lang: 'zh', theme: 'light', accent: 'blue' })
  })

  it('survives recreation from the same area (persistence)', () => {
    const area = tempArea()
    createSettingsApi({ area }).set('lang', 'en')
    expect(createSettingsApi({ area }).get('lang')).toBe('en')
  })

  it('works through createCore alongside other services', () => {
    const area = tempArea()
    const core = createCore(
      { settings: settingsService() },
      { storage: { defaultArea: () => area } },
    )
    core.api.settings.set('theme', 'system')
    expect(core.api.settings.get('theme')).toBe('system')
  })
})
