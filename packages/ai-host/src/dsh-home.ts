import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir as osHomedir } from 'node:os'

/**
 * Automatic discovery of the 察元 harness (dsh) home for the desktop form.
 *
 * The harness lives in different places per install shape, and a dev machine
 * can carry several of them at once (a migrated production root next to a live
 * dev-shell root — both recording the same proxyPort while only one service
 * actually listens). Discovery therefore:
 *  1. honors explicit env pins (CHATOP_DSH_HOME > CHAOFFICE_DSH_HOME > DSH_HOME),
 *  2. falls back through the standalone conventions (~/.chatop, ~/.dsh) and
 *     every known per-user chatop-data root,
 *  3. among candidates that carry a model-service state.json, prefers one
 *     whose proxyPort actually answers /health — a live service outranks a
 *     stale file from a sibling install.
 *
 * A candidate is valid when it has a readable chatop-models state.json (local
 * model service) or a settings.yaml (llm-pi-ai vendor routes); homes with
 * neither cannot power any fusion.
 */

export interface DshHomeDiscoveryDeps {
  env?: Record<string, string | undefined>
  homedir?: () => string
  /** per-OS application-data dir (mac: ~/Library/Application Support) */
  appDataDir?: () => string
  /** liveness probe for the model proxy; overridable in tests */
  probeProxyHealth?: (port: number) => Promise<boolean>
}

export interface DiscoveredDshHome {
  home: string
  /** proxyPort from the home's chatop-models state.json, when present */
  proxyPort: number | null
  /** the /health probe answered for proxyPort */
  proxyLive: boolean
}

function defaultAppDataDir(env: Record<string, string | undefined>, home: string): string {
  if (process.platform === 'win32') return env.APPDATA ?? join(home, 'AppData', 'Roaming')
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support')
  return env.XDG_CONFIG_HOME ?? join(home, '.config')
}

async function defaultProbeProxyHealth(port: number): Promise<boolean> {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(350),
    })
    return resp.ok
  } catch {
    return false
  }
}

/** parse proxyPort + state freshness out of a candidate's chatop-models
 *  state.json (null port when the file is missing/corrupt/carries no port) */
function readState(home: string): { proxyPort: number | null; updatedAt: number } {
  try {
    const state = JSON.parse(
      readFileSync(join(home, 'storages', 'chatop-models', 'state.json'), 'utf8'),
    ) as { proxyPort?: unknown; updatedAt?: unknown }
    const proxyPort =
      typeof state.proxyPort === 'number' && state.proxyPort > 0 ? state.proxyPort : null
    const updatedAt = typeof state.updatedAt === 'number' ? state.updatedAt : 0
    return { proxyPort, updatedAt }
  } catch {
    return { proxyPort: null, updatedAt: 0 }
  }
}

/** user dsh-homes under a chatop data root (users/<id>/profile/dsh-home) */
function perUserHomes(root: string): string[] {
  try {
    return readdirSync(join(root, 'users'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(root, 'users', e.name, 'profile', 'dsh-home'))
      .filter((home) => existsSync(home))
      .sort()
  } catch {
    return []
  }
}

export async function discoverDshHome(
  deps: DshHomeDiscoveryDeps = {},
): Promise<DiscoveredDshHome | undefined> {
  const env = deps.env ?? process.env
  const home = (deps.homedir ?? osHomedir)()
  const appData = (deps.appDataDir ?? (() => defaultAppDataDir(env, home)))()
  const probe = deps.probeProxyHealth ?? defaultProbeProxyHealth

  const pinned = [
    env.CHATOP_DSH_HOME,
    env.CHAOFFICE_DSH_HOME,
    env.DSH_HOME,
  ].filter((v): v is string => !!v && v.trim() !== '')
  const roots = [
    join(home, '.chatop'),
    join(home, '.dsh'),
    ...perUserHomes(join(home, 'Documents', 'chatop-data')),
    ...perUserHomes(join(appData, 'chatop-data')),
    ...perUserHomes(join(appData, 'chatop')),
    ...perUserHomes(join(appData, 'chatop-dev-data')),
  ]
  const seen = new Set<string>()
  const candidates: Array<{ home: string; pinned: boolean }> = []
  for (const c of [...pinned.map((p) => ({ home: p, pinned: true })), ...roots.map((p) => ({ home: p, pinned: false }))]) {
    if (seen.has(c.home)) continue
    seen.add(c.home)
    candidates.push(c)
  }

  interface Valid extends DiscoveredDshHome {
    pinned: boolean
    order: number
    /** state.json updatedAt — among homes sharing a live proxy port, the one
     *  the running service keeps writing is the owner (siblings carry stale
     *  files from an earlier run of a different install) */
    updatedAt: number
  }
  const valid: Valid[] = []
  candidates.forEach((c, order) => {
    if (!existsSync(c.home)) return
    const { proxyPort, updatedAt } = readState(c.home)
    const hasSettings = existsSync(join(c.home, 'settings.yaml'))
    if (proxyPort === null && !hasSettings) return
    valid.push({ home: c.home, proxyPort, proxyLive: false, pinned: c.pinned, order, updatedAt })
  })
  if (valid.length === 0) return undefined

  // liveness pass (parallel, bounded): a live model service outranks stale
  // siblings; pinned homes keep their priority, then freshness breaks ties
  // between homes claiming the same live port
  await Promise.all(
    valid.map(async (v) => {
      if (v.proxyPort === null) return
      v.proxyLive = await probe(v.proxyPort)
    }),
  )
  const rank = (a: Valid, b: Valid): number =>
    Number(b.pinned) - Number(a.pinned) ||
    Number(b.proxyLive) - Number(a.proxyLive) ||
    b.updatedAt - a.updatedAt ||
    a.order - b.order
  const pick = [...valid].sort(rank)[0]
  if (!pick) return undefined
  const { home: pickedHome, proxyPort, proxyLive } = pick
  return { home: pickedHome, proxyPort, proxyLive }
}
