import { migrateSettingsV2 } from './settings-v2'
import type { AiModelEntry, AiProviderProfile, AiSettingsV2, AiWireProtocol } from './types'
import { harnessKeyRefFor, harnessRouteFor, VENDOR_BY_ID } from './vendor-catalog'

/**
 * Settings sources: the three backends behind one interface.
 * - file: desktop ai-settings.json and the Docker BFF's server-side config
 * - harness: dsh's llm-pi-ai namespace via loopback RPC (true fusion with
 *   chatop — both apps read/write the same providers), with office-side
 *   selection state (currentModel/imageModel/chatoffice toggle) kept in a local
 *   sidecar file so we never touch chatop's own model picker.
 *
 * Node I/O is injected so this package stays importable from renderers.
 */

export interface AiSettingsSource {
  read(): Promise<AiSettingsV2>
  write(next: AiSettingsV2): Promise<void>
  /** change notification when the backend supports it (file watcher) */
  subscribe?(cb: () => void): () => void
}

export interface FileSourceFs {
  readFile(path: string): Promise<string>
  writeFile(path: string, contents: string): Promise<void>
  watch?(path: string, cb: () => void): () => void
}

/** File-backed source with migration-on-read and serialized atomic writes. */
export function createFileSource(filePath: string, fs: FileSourceFs): AiSettingsSource {
  let writeChain: Promise<unknown> = Promise.resolve()
  const parse = async (): Promise<AiSettingsV2> => {
    try {
      const text = await fs.readFile(filePath)
      return migrateSettingsV2(JSON.parse(text))
    } catch {
      return migrateSettingsV2(null) // missing/corrupt file → defaults; first write recreates it
    }
  }
  return {
    async read() {
      return parse()
    },
    async write(next) {
      writeChain = writeChain.then(async () => {
        await fs.writeFile(filePath, JSON.stringify(next, null, 2))
      })
      await writeChain
    },
    ...(fs.watch
      ? {
          subscribe(cb: () => void) {
            return fs.watch!(filePath, cb)
          },
        }
      : {}),
  }
}

// ---- harness (dsh llm-pi-ai) backend ----

/** harness's settings.mutate / credentials.set / llm.discoverModels channel */
export type HarnessRpc = (method: string, payload?: unknown) => Promise<unknown>

/** direct read of a file in the dsh home (~/.dsh/settings.yaml, .credentials.yaml) */
export type DshFileReader = (relativePath: string) => Promise<string>

/** subset of the profile dsh stores per provider route */
interface HarnessProviderProfile {
  displayName?: string
  apiKeyEnv?: string
  api?: string
  baseURL?: string
  models?: Array<{ id?: string; name?: string }>
}

/** minimal YAML scrape: `ns:` → `providers:` → route blocks → fields + model list
 * entries. The dsh settings file is machine-written with a stable 2-space layout
 * (chatop's credential echo relies on the same); a full YAML parser is not worth
 * a dependency here. */
export function parseHarnessProviders(
  yaml: string,
  ns = 'llm-pi-ai',
): Record<string, HarnessProviderProfile> {
  const lines = yaml.split('\n')
  const out: Record<string, HarnessProviderProfile> = {}
  let inNs = false
  let inProviders = false
  let routeIndent = -1
  let current: { route: string; profile: HarnessProviderProfile } | null = null
  const flush = () => {
    if (current) out[current.route] = current.profile
    current = null
  }
  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue
    const indent = raw.length - raw.trimStart().length
    if (indent === 0) {
      flush()
      inNs = raw.trim() === `${ns}:`
      inProviders = false
      routeIndent = -1
      continue
    }
    if (!inNs) continue
    if (!inProviders) {
      if (indent === 2 && raw.trim() === 'providers:') inProviders = true
      continue
    }
    const entry = raw.trim()
    const isRouteHeader = /^[A-Za-z0-9_.-]+:\s*$/.test(entry) && !entry.startsWith('-')
    if (isRouteHeader && (routeIndent === -1 || indent === routeIndent)) {
      flush()
      routeIndent = indent
      current = { route: entry.replace(/:\s*$/, ''), profile: {} }
      continue
    }
    if (!current || indent <= routeIndent) continue
    const field = /^(displayName|apiKeyEnv|api|baseURL):\s*(.*)$/.exec(entry)
    if (field) {
      const value = field[2]!.trim().replace(/^['"]|['"]$/g, '')
      ;(current.profile as Record<string, unknown>)[field[1]!] = value
      continue
    }
    const modelEntry = /^-\s+id:\s*(\S+)\s*$/.exec(entry)
    if (modelEntry) {
      current.profile.models ??= []
      current.profile.models.push({ id: modelEntry[1]!.replace(/^['"]|['"]$/g, '') })
    }
  }
  flush()
  return out
}

/** scrape `REF: value` pairs out of the credentials yaml (same machine, loopback-only read) */
export function parseHarnessCredentials(yaml: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of yaml.split('\n')) {
    const m = /^\s{2}([A-Za-z0-9_]+):\s*(\S.*)$/.exec(raw)
    if (m) out[m[1]!] = m[2]!.trim().replace(/^['"]|['"]$/g, '')
  }
  return out
}

function profileFromHarness(route: string, hp: HarnessProviderProfile): AiProviderProfile | null {
  const rawVendorId = route.startsWith('chatop-') ? route.slice('chatop-'.length) : undefined
  // legacy yaml written before the rebrand carried the vendor's old id
  const vendorId = rawVendorId === 'genspark' ? 'chatoffice' : rawVendorId
  const vendor = vendorId ? VENDOR_BY_ID.get(vendorId) : undefined
  const protocol = (hp.api ?? vendor?.api ?? 'openai-completions') as AiWireProtocol
  const baseUrl = hp.baseURL ?? ''
  if (!baseUrl) return null // half-written route; ignore until it has an endpoint
  const models: AiModelEntry[] = (hp.models ?? [])
    .filter((m) => m?.id)
    .map((m) => ({ id: m.id!, ...(m.name && m.name !== m.id ? { name: m.name } : {}) }))
  return {
    id: vendorId ?? route,
    ...(vendorId ? { vendorId } : {}),
    displayName: hp.displayName ?? vendor?.name ?? route,
    protocol,
    baseUrl,
    ...(hp.apiKeyEnv ? { apiKeyRef: hp.apiKeyEnv } : {}),
    auth: 'api-key',
    enabled: true,
    models,
  }
}

export function profileToHarnessMutation(profile: AiProviderProfile): {
  op: unknown
  keyRef: string
} {
  const vendorId = profile.vendorId ?? profile.id
  const keyRef = profile.apiKeyRef ?? harnessKeyRefFor(vendorId)
  const value: HarnessProviderProfile & { apiKeyEnv: string } = {
    displayName: profile.displayName,
    apiKeyEnv: keyRef,
    api: profile.protocol,
    baseURL: profile.baseUrl,
    models: profile.models.map((m) => ({
      id: m.id,
      ...(m.name && m.name !== m.id ? { name: m.name } : {}),
    })),
  }
  return {
    op: { op: 'set', path: ['providers', harnessRouteFor(vendorId)], value },
    keyRef,
  }
}

export interface HarnessSourceDeps {
  rpc: HarnessRpc
  /** read a file relative to the dsh home (settings.yaml, .credentials.yaml) */
  readDshFile: DshFileReader
  /** local sidecar file holding office-side state (currentModel/imageModel/chatoffice/chatoffice) */
  officeStateSource: AiSettingsSource
}

/**
 * Composite harness source: provider profiles live in dsh's llm-pi-ai (shared
 * with chatop), office selections live in the local sidecar. write() diffs the
 * profile set into settings.mutate ops + credentials.set calls.
 */
export function createHarnessSource(deps: HarnessSourceDeps): AiSettingsSource {
  const { rpc, readDshFile, officeStateSource } = deps

  const readProfiles = async (): Promise<AiProviderProfile[]> => {
    const yaml = await readDshFile('settings.yaml')
    const parsed = parseHarnessProviders(yaml)
    const profiles: AiProviderProfile[] = []
    for (const [route, hp] of Object.entries(parsed)) {
      const profile = profileFromHarness(route, hp)
      if (profile) profiles.push(profile)
    }
    return profiles
  }

  return {
    async read() {
      const [office, profiles] = await Promise.all([
        officeStateSource.read(),
        readProfiles().catch(() => [] as AiProviderProfile[]),
      ])
      return { ...office, profiles }
    },
    async write(next) {
      const office: AiSettingsV2 = {
        version: 2,
        profiles: next.profiles.filter((p) => p.auth === 'chatoffice-login'),
        ...(next.currentModel ? { currentModel: next.currentModel } : {}),
        ...(next.imageModel ? { imageModel: next.imageModel } : {}),
        ...(next.chatofficeToolsEnabled !== undefined
          ? { chatofficeToolsEnabled: next.chatofficeToolsEnabled }
          : {}),
      }
      const current = await readProfiles().catch(() => [] as AiProviderProfile[])
      const currentByVendor = new Map(current.map((p) => [p.vendorId ?? p.id, p]))
      const wantedByVendor = new Map(
        next.profiles.filter((p) => p.auth === 'api-key').map((p) => [p.vendorId ?? p.id, p]),
      )
      const ops: unknown[] = []
      // removed profiles → unset their harness routes
      for (const [vendorKey, profile] of currentByVendor) {
        if (!wantedByVendor.has(vendorKey)) {
          ops.push({
            op: 'unset',
            path: ['providers', harnessRouteFor(profile.vendorId ?? profile.id)],
          })
        }
      }
      // added/updated profiles → set + credentials.set when the key changed
      for (const [vendorKey, profile] of wantedByVendor) {
        const prev = currentByVendor.get(vendorKey)
        const { op, keyRef } = profileToHarnessMutation(profile)
        const keyChanged = !prev || (profile.apiKey ?? '') !== '' // fresh profile, or an inline key the user (re)entered
        ops.push(op)
        if (keyChanged && profile.apiKey) {
          await rpc('credentials.set', { ref: keyRef, value: profile.apiKey })
        }
      }
      if (ops.length) await rpc('settings.mutate', { ns: 'llm-pi-ai', ops })
      await officeStateSource.write(office)
    },
  }
}

/** resolve the secret for a harness-backed profile: inline key or the credentials file */
export async function resolveHarnessSecret(
  profile: AiProviderProfile,
  readDshFile: DshFileReader,
): Promise<string> {
  if (profile.apiKey) return profile.apiKey
  if (!profile.apiKeyRef) return ''
  const yaml = await readDshFile('.credentials.yaml')
  return parseHarnessCredentials(yaml)[profile.apiKeyRef] ?? ''
}
