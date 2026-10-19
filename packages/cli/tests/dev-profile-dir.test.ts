import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { controlEndpoint } from '../src/control'
import { chaofficeUserDataDir, chaofficeUserDataDirs, guiOpenDocuments } from '../src/gui'

/** Where the packaged profile sits for this platform, under a fake home. */
function appData(home: string): string {
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support')
  if (process.platform === 'win32') return join(home, 'AppData', 'Roaming')
  return join(home, '.config')
}

function fakeHome(): { home: string; env: NodeJS.ProcessEnv } {
  const home = mkdtempSync(join(tmpdir(), 'chaoffice-devdir-'))
  return { home, env: { HOME: home } }
}

function publish(dir: string, name: string, body: unknown): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), JSON.stringify(body))
}

describe('userData directory list', () => {
  it('scans the dev profile under both spellings it has had', () => {
    const { env, home } = fakeHome()
    const packaged = join(appData(home), 'ChaOffice')
    // The shell writes "-Dev" since chaoffice#1879; " Dev" is what it wrote
    // before, and a profile nobody migrated is still there.
    expect(chaofficeUserDataDirs(env)).toEqual([packaged, `${packaged}-Dev`, `${packaged} Dev`])
  })

  it('prefers the current spelling and keeps the packaged profile first', () => {
    const { env } = fakeHome()
    const dirs = chaofficeUserDataDirs(env)
    expect(dirs[0]).toBe(chaofficeUserDataDir(env))
    expect(dirs.indexOf(`${dirs[0]}-Dev`)).toBeLessThan(dirs.indexOf(`${dirs[0]} Dev`))
  })

  it('scans nothing else when GENOFFICE_USER_DATA is set', () => {
    expect(chaofficeUserDataDirs({ GENOFFICE_USER_DATA: '/u' })).toEqual(['/u'])
  })
})

describe('a dev shell is reachable', () => {
  it('finds the control endpoint published under "-Dev"', () => {
    // The regression chaoffice#1879 left behind: the shell moved to "-Dev"
    // and this reader still looked for " Dev", so `open` stopped finding a
    // running dev instance and could only ever find the packaged one.
    const { env, home } = fakeHome()
    const dev = join(appData(home), 'ChaOffice-Dev')
    publish(dev, 'control.json', {
      pid: process.pid,
      endpoint: 'http://127.0.0.1:1/dev',
      token: 'dev-token',
    })
    expect(controlEndpoint(env)?.token).toBe('dev-token')
  })

  it('still finds a profile left under the old " Dev" spelling', () => {
    const { env, home } = fakeHome()
    const old = join(appData(home), 'ChaOffice Dev')
    publish(old, 'control.json', {
      pid: process.pid,
      endpoint: 'http://127.0.0.1:1/old',
      token: 'old-token',
    })
    expect(controlEndpoint(env)?.token).toBe('old-token')
  })

  it('reads a dev registry of open documents under "-Dev"', () => {
    // Upstream #980 made this check cover every live instance; the local CLI
    // keeps first-live-instance semantics (single registry or null), so the
    // assertion is the plain registry object (upstream #2054 absorbed via
    // chaofficeUserDataDirs).
    const { env, home } = fakeHome()
    const dev = join(appData(home), 'ChaOffice-Dev')
    publish(dev, 'open-documents.json', { pid: process.pid, paths: ['/dev.docx'] })
    expect(guiOpenDocuments(env)).toEqual({ pid: process.pid, paths: ['/dev.docx'] })
  })

  it('prefers the packaged registry when both profiles publish one', () => {
    // Upstream's guard covers every live instance at once; the local write
    // guard still reads the first live registry only, which is the packaged
    // profile (scan order: packaged, "-Dev", " Dev").
    const { env, home } = fakeHome()
    const packaged = join(appData(home), 'ChaOffice')
    const dev = join(appData(home), 'ChaOffice-Dev')
    publish(packaged, 'open-documents.json', { pid: process.pid, paths: ['/a.docx'] })
    publish(dev, 'open-documents.json', { pid: process.pid, paths: ['/b.docx'] })
    expect(guiOpenDocuments(env)).toEqual({ pid: process.pid, paths: ['/a.docx'] })
  })
})
