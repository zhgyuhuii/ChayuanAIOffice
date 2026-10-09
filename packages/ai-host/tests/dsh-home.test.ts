import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { discoverDshHome } from '../src/dsh-home'

/** build a fake filesystem: dirs map path→true (created), files path→content */
function build(root: string, files: Record<string, string>, dirs: string[] = []): void {
  for (const d of dirs) mkdirSync(join(root, d), { recursive: true })
  for (const [p, content] of Object.entries(files)) {
    const abs = join(root, p)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content)
  }
}

const temps: string[] = []
afterAll(() => {
  for (const t of temps) rmSync(t, { recursive: true, force: true })
})

function tempRoot(): string {
  const t = mkdtempSync(join(tmpdir(), 'dsh-home-test-'))
  temps.push(t)
  return t
}

const stateWith = (proxyPort: number) => JSON.stringify({ proxyPort, instances: [] })

describe('discoverDshHome', () => {
  it('env pin wins even when its proxy is not live', async () => {
    const root = tempRoot()
    const pinned = join(root, 'pinned-home')
    build(root, {
      'pinned-home/storages/chatop-models/state.json': stateWith(11111),
      'fallback-home/storages/chatop-models/state.json': stateWith(22222),
    })
    const found = await discoverDshHome({
      env: { CHATOP_DSH_HOME: pinned },
      homedir: () => join(root, 'nonexistent-home'),
      appDataDir: () => join(root, 'nonexistent-appdata'),
      probeProxyHealth: async (port) => port === 22222,
    })
    expect(found?.home).toBe(pinned)
    expect(found?.proxyLive).toBe(false)
  })

  it('a live chatop-data user home outranks an earlier stale sibling', async () => {
    const root = tempRoot()
    const home = join(root, 'appdata', 'chatop-dev-data', 'users', 'admin', 'profile', 'dsh-home')
    // Documents root comes first in candidate order but its proxy is dead
    build(root, {
      'Documents/chatop-data/users/admin/profile/dsh-home/storages/chatop-models/state.json':
        stateWith(11111),
      'appdata/chatop-dev-data/users/admin/profile/dsh-home/storages/chatop-models/state.json':
        stateWith(22222),
    })
    const found = await discoverDshHome({
      env: {},
      homedir: () => join(root, 'home'),
      appDataDir: () => join(root, 'appdata'),
      probeProxyHealth: async (port) => port === 22222,
    })
    expect(found?.home).toBe(home)
    expect(found?.proxyPort).toBe(22222)
    expect(found?.proxyLive).toBe(true)
  })

  it('~/.dsh with only settings.yaml is valid (vendor fusion without the model service)', async () => {
    const root = tempRoot()
    build(root, { 'home/.dsh/settings.yaml': 'llm-pi-ai:\n  providers: {}\n' })
    const found = await discoverDshHome({
      env: {},
      homedir: () => join(root, 'home'),
      appDataDir: () => join(root, 'appdata'),
      probeProxyHealth: async () => false,
    })
    expect(found?.home).toBe(join(root, 'home', '.dsh'))
    expect(found?.proxyPort).toBeNull()
  })

  it('homes with neither state.json nor settings.yaml are skipped; none valid → undefined', async () => {
    const root = tempRoot()
    build(root, { 'home/.chatop/irrelevant.txt': 'x' }, ['appdata/chatop-data/users/admin/profile/dsh-home'])
    const found = await discoverDshHome({
      env: {},
      homedir: () => join(root, 'home'),
      appDataDir: () => join(root, 'appdata'),
      probeProxyHealth: async () => true,
    })
    expect(found).toBeUndefined()
  })

  it('corrupt state.json without settings.yaml is skipped', async () => {
    const root = tempRoot()
    build(root, { 'home/.chatop/storages/chatop-models/state.json': '{not json' })
    const found = await discoverDshHome({
      env: {},
      homedir: () => join(root, 'home'),
      appDataDir: () => join(root, 'appdata'),
      probeProxyHealth: async () => true,
    })
    expect(found).toBeUndefined()
  })
})
