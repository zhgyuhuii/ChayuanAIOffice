import { describe, expect, it, vi } from 'vitest'
import { createLocalTools, type LocalToolDeps } from '../src/local-tools'

/** deterministic fake deps: no network, no processes — probe/which/run are scripted */
function fakeDeps(over: Partial<LocalToolDeps> = {}): LocalToolDeps {
  return {
    platform: 'darwin',
    probe: async () => {
      throw new Error('unreachable')
    },
    which: async () => null,
    exists: () => false,
    run: async () => {},
    spawnDetached: () => {},
    writeTemp: async (_n, d) => `tmp/${_n}:${d.length}`,
    fetch: (async () => {
      throw new Error('no network in test')
    }) as unknown as typeof globalThis.fetch,
    sleep: async () => {},
    ...over,
  }
}

describe('local tools (本地与自建 一键安装)', () => {
  it('unknown vendor reports supported=false (UI hides the card)', async () => {
    const tools = createLocalTools(fakeDeps())
    const s = await tools.status('openai-compatible')
    expect(s.supported).toBe(false)
    expect(s.installable).toBe(false)
  })

  it('ollama: installed + running via endpoint, with version', async () => {
    const tools = createLocalTools(
      fakeDeps({ probe: async () => JSON.stringify({ version: '0.12.1' }) }),
    )
    const s = await tools.status('ollama')
    expect(s.supported).toBe(true)
    expect(s.running).toBe(true)
    expect(s.installed).toBe(true)
    expect(s.version).toBe('0.12.1')
    expect(s.installable).toBe(true)
    expect(s.startable).toBe(true)
  })

  it('ollama: binary on PATH without a running server → installed but not running', async () => {
    const tools = createLocalTools(
      fakeDeps({ which: async (b) => (b === 'ollama' ? '/usr/local/bin/ollama' : null) }),
    )
    const s = await tools.status('ollama')
    expect(s.installed).toBe(true)
    expect(s.running).toBe(false)
    expect(s.startable).toBe(true)
  })

  it('ollama start: spawns serve, polls the endpoint, surfaces timeout as ok=false', async () => {
    const spawnDetached = vi.fn()
    const tools = createLocalTools(
      fakeDeps({
        which: async (b) => (b === 'ollama' ? '/usr/local/bin/ollama' : null),
        spawnDetached,
      }),
    )
    const r = await tools.start('ollama')
    expect(spawnDetached).toHaveBeenCalledWith('/usr/local/bin/ollama', ['serve'])
    expect(r.ok).toBe(false) // probe never answers in the fake
    expect(r.message).toContain('超时')
  })

  it('install reports failure reasons from the platform runner', async () => {
    const tools = createLocalTools(
      fakeDeps({
        which: async (b) => (b === 'brew' ? '/opt/homebrew/bin/brew' : null),
        run: async () => {
          throw new Error('brew 退出码 1')
        },
      }),
    )
    const r = await tools.install('ollama', undefined)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('退出码')
  })

  it('lm-studio is install-only (no one-click start); probe-only vendors are neither', async () => {
    const tools = createLocalTools(fakeDeps())
    const lms = await tools.status('lm-studio')
    expect(lms.installable).toBe(true)
    expect(lms.startable).toBe(false)
    const xin = await tools.status('xinference')
    expect(xin.supported).toBe(true)
    expect(xin.installable).toBe(false)
    expect(xin.startable).toBe(false)
  })

  it('install streams runner output lines through onLine', async () => {
    const lines: string[] = []
    const tools = createLocalTools(
      fakeDeps({
        which: async (b) => (b === 'brew' ? '/opt/homebrew/bin/brew' : null),
        run: async (_c, _a, onLine) => {
          onLine?.('==> Downloading ollama')
          onLine?.('==> Pouring ollama')
        },
      }),
    )
    const r = await tools.install('ollama', (l) => lines.push(l))
    expect(r.ok).toBe(true)
    expect(lines).toEqual(['==> Downloading ollama', '==> Pouring ollama'])
  })
})
