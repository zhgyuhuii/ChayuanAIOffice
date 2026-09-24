/**
 * Node-side discovery of the local harness knowledge base endpoint (see
 * docs/kb-integration-plan.md §5). The chatop-kb HTTP API lives inside the
 * dsh web process (loopback). 2026-09-21 起察元系统一端口注册表
 * （chayuan-harness docs/port-registry.md）：主实例 52584，多用户会话段
 * 52601+；旧段 3080..3090 保留为兼容尾巴（老装机渐进升级）。so "discovery"
 * means: find a loopback origin whose /status carries the KB fingerprint.
 * Four levels, first hit wins:
 *
 *   manual override → cached last-good → hint file → parallel port probe
 *
 * Requires no harness-side changes and no secrets (the KB API is loopback
 * trust, keys live harness-side).
 */

import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createKbHttpClient, type KbStatus } from './kb-client'

export interface KbDiscoveryOptions {
  /** manual override from settings; wins over everything */
  explicitOrigin?: string
  /** last known-good origin (persisted by the caller); verified before use */
  cachedOrigin?: string
  /** hint file written by the chatoffice dsh plugin host (default under ~/.dsh) */
  hintFile?: string
  /** probe ports; default = 注册表 52584 + 会话段 52601.. +10，旧段 3080..3090 兜底 */
  probePorts?: number[]
  /** per-candidate request budget (ms) */
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export type KbDiscoverySource = 'manual' | 'cached' | 'hint' | 'probe'

export interface KbDiscoveryResult {
  origin: string
  source: KbDiscoverySource
  status: KbStatus
}

const REGISTRY_PORT = 52584 // chayuan-harness DSH_WEB_PORT（docs/port-registry.md）
const SESSION_BASE = 52601 // dsh 多用户会话段
const LEGACY_BASE = 3080 // 旧段（老装机兼容尾巴）
const DEFAULT_PORTS = [
  REGISTRY_PORT,
  ...Array.from({ length: 10 }, (_, i) => SESSION_BASE + i),
  ...Array.from({ length: 11 }, (_, i) => LEGACY_BASE + i),
]

function defaultHintFile(): string {
  return join(homedir(), '.dsh', 'storages', 'chatoffice', 'dsh-rpc-origin')
}

async function verify(
  origin: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<KbStatus | null> {
  try {
    const client = createKbHttpClient({ baseUrl: origin, fetchImpl, timeoutMs })
    return await client.status()
  } catch {
    return null
  }
}

/** probe one origin; resolves null on miss (never rejects) */
function probeOne(
  port: number,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<{ origin: string; status: KbStatus } | null> {
  return verify(`http://127.0.0.1:${port}`, timeoutMs, fetchImpl).then((status) =>
    status ? { origin: `http://127.0.0.1:${port}`, status } : null,
  )
}

export async function discoverHarnessKb(
  options: KbDiscoveryOptions = {},
): Promise<KbDiscoveryResult | null> {
  const timeoutMs = options.timeoutMs ?? 1200
  const fetchImpl = options.fetchImpl ?? fetch

  const levels: Array<{ source: KbDiscoverySource; origins: Promise<string[]> }> = [
    {
      source: 'manual',
      origins: Promise.resolve(options.explicitOrigin ? [options.explicitOrigin] : []),
    },
    {
      source: 'cached',
      origins: Promise.resolve(options.cachedOrigin ? [options.cachedOrigin] : []),
    },
    {
      source: 'hint',
      origins: (async () => {
        const file = options.hintFile ?? defaultHintFile()
        try {
          if (!(await stat(file)).isFile()) return []
          const text = (await readFile(file, 'utf8')).trim()
          return text.startsWith('http://') || text.startsWith('https://') ? [text] : []
        } catch {
          return []
        }
      })(),
    },
  ]

  for (const level of levels) {
    for (const origin of await level.origins) {
      const status = await verify(origin, timeoutMs, fetchImpl)
      if (status) return { origin, source: level.source, status }
    }
  }

  // parallel port ladder: first fingerprinted responder wins
  const ports = options.probePorts ?? DEFAULT_PORTS
  const attempts = ports.map((port) => probeOne(port, timeoutMs, fetchImpl))
  const settled = await raceResolved(attempts)
  for (const winner of settled) {
    if (winner) return { origin: winner.origin, source: 'probe', status: winner.status }
  }
  return null
}

/**
 * Drain promises in completion order; `onResolved` may stop the race by
 * returning true. Losers are left to settle in the background (their errors
 * are swallowed — probeOne never rejects).
 */
async function raceResolved<T>(
  promises: Promise<T>[],
  onResolved?: (value: T) => boolean,
): Promise<T[]> {
  const resolved: T[] = []
  await Promise.all(
    promises.map(async (p) => {
      try {
        const value = await p
        resolved.push(value)
        onResolved?.(value)
      } catch {
        /* probe noise */
      }
    }),
  )
  return resolved
}
