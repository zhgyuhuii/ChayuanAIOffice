import { migrateSettingsV2 } from './settings-v2'
import type { AiModelEntry, AiProviderProfile, AiSettingsV2, AiWireProtocol } from './types'
import { harnessKeyRefFor, harnessRouteFor, VENDOR_BY_ID } from './vendor-catalog'
import {
  CHATOP_LOCAL_PROFILE_ID,
  readChatopLocalSource,
  type ChatopLocalSource,
} from './chatop-local'

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
 * a dependency here. */ export function parseHarnessProviders(
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

/** scrape dsh's own default-model pick (`agent-default-model:` provider/model
 * block) so a fresh office side can adopt the harness's selection */
export function parseHarnessDefaultModel(yaml: string): { provider: string; model: string } | null {
  let inBlock = false
  let provider = ''
  let model = ''
  for (const raw of yaml.split('\n')) {
    const indent = raw.length - raw.trimStart().length
    if (indent === 0) {
      if (inBlock) break
      inBlock = raw.trim() === 'agent-default-model:'
      continue
    }
    if (!inBlock || indent !== 2) continue
    const m = /^(provider|model):\s*(\S+)\s*$/.exec(raw.trim())
    if (m) {
      if (m[1] === 'provider') provider = m[2]!
      else model = m[2]!
    }
  }
  return inBlock && provider && model ? { provider, model } : null
}

function profileFromHarness(route: string, hp: HarnessProviderProfile): AiProviderProfile | null {
  // office manages only the chatop-<vendorId> routes (what chatop's own model
  // settings UI writes). dsh's hand-written routes (bare vendor ids) are the
  // dsh agent's internal config — surfacing them would collide with their
  // chatop-* twins and the write diff could clobber them, so they stay
  // dsh-internal.
  if (!route.startsWith('chatop-')) return null
  // legacy yaml written before the rebrand carried the vendor's old id
  const vendorId =
    route.slice('chatop-'.length) === 'genspark' ? 'chatoffice' : route.slice('chatop-'.length)
  const vendor = VENDOR_BY_ID.get(vendorId)
  const protocol = (hp.api ?? vendor?.api ?? 'openai-completions') as AiWireProtocol
  const baseUrl = hp.baseURL ?? ''
  if (!baseUrl) return null // half-written route; ignore until it has an endpoint
  const models: AiModelEntry[] = (hp.models ?? [])
    .filter((m) => m?.id)
    .map((m) => ({ id: m.id!, ...(m.name && m.name !== m.id ? { name: m.name } : {}) }))
  return {
    id: vendorId,
    vendorId,
    displayName: hp.displayName ?? vendor?.name ?? route,
    protocol,
    baseUrl,
    ...(hp.apiKeyEnv ? { apiKeyRef: hp.apiKeyEnv } : {}),
    ...(vendor?.ollamaLike ? { ollamaLike: true } : {}),
    auth: 'api-key',
    enabled: true,
    models,
  }
}

export function profileToHarnessMutation(
  profile: AiProviderProfile,
  prevRef?: string,
): {
  op: unknown
  keyRef: string
} {
  const vendorId = profile.vendorId ?? profile.id
  // the renderer round-trips profiles without apiKeyRef (secrets are
  // server-side); keep the route's existing reference so a mere settings save
  // never orphans the credential the route points at
  const keyRef = profile.apiKeyRef ?? prevRef ?? harnessKeyRefFor(vendorId)
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

  /** the harness's local model service as a synthetic profile (chatop-local):
   *  installed local chat models through the model proxy with lazy-load; null
   *  when the service is absent — the group then simply does not appear */
  const readLocal = (): Promise<ChatopLocalSource | null> =>
    readChatopLocalSource(readDshFile).catch(() => null)

  /** map dsh's agent-default-model pick onto a managed profile + model */
  const adoptHarnessDefault = (
    profiles: AiProviderProfile[],
    pick: { provider: string; model: string },
  ): AiSettingsV2['currentModel'] | undefined => {
    const vendorId = pick.provider.startsWith('chatop-')
      ? pick.provider.slice('chatop-'.length)
      : pick.provider
    const profile = profiles.find((p) => (p.vendorId ?? p.id) === vendorId)
    if (!profile?.models.some((m) => m.id === pick.model)) return undefined
    return { profileId: profile.id, modelId: pick.model }
  }

  /** default-model chain when office has no recorded selection:
   *  1. a harness default that points at the local service (chatop-local) wins
   *  2. any running local chat model (the harness prewarmed/loaded it — the
   *     most likely intent for a desktop that just started one)
   *  3. a vendor-backed harness default (the original adoption rule)
   *  4. the first model of the merged list */
  const defaultSelection = (
    office: AiSettingsV2,
    local: ChatopLocalSource | null,
    vendorProfiles: AiProviderProfile[],
    defaultPick: { provider: string; model: string } | null,
    profiles: AiProviderProfile[],
  ): AiSettingsV2['currentModel'] | undefined => {
    if (office.currentModel) return office.currentModel
    if (
      local &&
      defaultPick &&
      (defaultPick.provider === CHATOP_LOCAL_PROFILE_ID || defaultPick.provider === 'local')
    ) {
      const want = defaultPick.model.startsWith('local/')
        ? defaultPick.model
        : `local/${defaultPick.model}`
      if (local.profile.models.some((m) => m.id === want)) {
        return { profileId: CHATOP_LOCAL_PROFILE_ID, modelId: want }
      }
    }
    if (local?.runningChatId) {
      return { profileId: CHATOP_LOCAL_PROFILE_ID, modelId: `local/${local.runningChatId}` }
    }
    if (defaultPick) {
      const adopted = adoptHarnessDefault(vendorProfiles, defaultPick)
      if (adopted) return adopted
    }
    const first = profiles.find((p) => p.models.length > 0)
    return first ? { profileId: first.id, modelId: first.models[0]!.id } : undefined
  }

  return {
    async read() {
      const [office, vendorProfiles, local, defaultPick] = await Promise.all([
        officeStateSource.read(),
        readProfiles().catch(() => [] as AiProviderProfile[]),
        readLocal(),
        readDshFile('settings.yaml')
          .then((yaml) => parseHarnessDefaultModel(yaml))
          .catch(() => null),
      ])
      // local group first so the picker lists it above the vendor groups
      const profiles = local ? [local.profile, ...vendorProfiles] : vendorProfiles
      const currentModel = defaultSelection(office, local, vendorProfiles, defaultPick, profiles)
      return { ...office, profiles, ...(currentModel ? { currentModel } : {}) }
    },
    async write(next) {
      // Selection anchors: the office file's normalize pass validates
      // currentModel/imageModel against the file's own profile set, and the
      // harness profiles live in dsh, not in that file — without an anchor the
      // migration silently drops every selection and the harness default
      // adoption re-fires forever. Anchors are verbatim copies of the backing
      // harness profile (key stripped); on read the profile set is replaced
      // from dsh wholesale, so they only ever serve that validation.
      const anchors = new Map<string, AiProviderProfile>()
      for (const sel of [
        next.currentModel,
        next.imageModel,
        ...Object.values(next.modelDefaults ?? {}),
      ]) {
        if (!sel) continue
        const backing = next.profiles.find(
          // the synthetic chatop-local profile is synthesized on read just like
          // the harness routes — it needs the same anchor treatment or the
          // office file's own validation drops every local selection
          (p) =>
            p.id === sel.profileId &&
            p.auth === 'api-key' &&
            (!!p.vendorId || p.id === CHATOP_LOCAL_PROFILE_ID),
        )
        if (backing && !anchors.has(backing.id)) anchors.set(backing.id, { ...backing, apiKey: '' })
      }
      const office: AiSettingsV2 = {
        version: 2,
        profiles: [
          ...next.profiles.filter((p) => p.auth === 'chatoffice-login'),
          ...anchors.values(),
        ],
        ...(next.currentModel ? { currentModel: next.currentModel } : {}),
        ...(next.imageModel ? { imageModel: next.imageModel } : {}),
      }
      const current = await readProfiles().catch(() => [] as AiProviderProfile[])
      const currentByVendor = new Map(current.map((p) => [p.vendorId ?? p.id, p]))
      // only vendor-backed profiles map to chatop-* routes; anything else in the
      // view is not office-manageable in harness mode and must be ignored here
      // (dropping it from the diff, never unsetting its route)
      const wantedByVendor = new Map(
        next.profiles
          .filter((p) => p.auth === 'api-key' && p.vendorId)
          .map((p) => [p.vendorId ?? p.id, p]),
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
        const { op, keyRef } = profileToHarnessMutation(profile, prev?.apiKeyRef)
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
