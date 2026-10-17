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
 *   chatop — both apps read/write the same providers), with office-side state
 *   (currentModel/imageModel/chaoffice toggle) kept in a local sidecar file.
 *   With rpc present (the dsh plugin form) the current-model pick is linked:
 *   writes propagate it into dsh's agent-default-model (chatop's own picker
 *   reads/writes the same ns), and reads honor it as the shared truth —
 *   whichever side switched last wins on both. Without rpc (the desktop form)
 *   the fusion is read-only and office selections stay authoritative.
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
    route.slice('chatop-'.length) === 'genspark' ? 'chaoffice' : route.slice('chatop-'.length)
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

/** an office selection the harness can express — a pick whose backing profile
 *  is a live chatop-* route in dsh (or the local model service). Anything else
 *  (custom BYOK profiles also carry a vendorId, but no dsh route backs them)
 *  is an explicit office-side choice the harness default never stomps. */
function officePickRepresentable(
  pick: AiSettingsV2['currentModel'] | undefined,
  profiles: AiProviderProfile[],
  harnessRouteIds: Set<string>,
): boolean {
  if (!pick) return false
  const backing = profiles.find((p) => p.id === pick.profileId)
  if (!backing) return false
  if (backing.id === CHATOP_LOCAL_PROFILE_ID) return true
  return backing.auth === 'api-key' && harnessRouteIds.has(backing.vendorId ?? backing.id)
}

/** dsh's agent-default-model patch for an office selection. Only picks backed
 *  by a live harness route (or the local service) produce one; the
 *  chatop-local form stores the bare model id (the read side re-adds the
 *  local/ prefix), and a vendor pick must be a model the backing route
 *  actually serves — dsh's agent would otherwise adopt a default its provider
 *  cannot answer. */
export function harnessDefaultPatch(
  pick: AiSettingsV2['currentModel'] | undefined,
  profiles: AiProviderProfile[],
  harnessRouteIds: Set<string>,
): { provider: string; model: string } | null {
  if (!pick) return null
  const backing = profiles.find((p) => p.id === pick.profileId)
  if (!backing) return null
  if (backing.id === CHATOP_LOCAL_PROFILE_ID)
    return { provider: 'chatop-local', model: pick.modelId.replace(/^local\//, '') }
  const vendorId = backing.vendorId ?? backing.id
  if (backing.auth !== 'api-key' || !harnessRouteIds.has(vendorId)) return null
  if (!backing.models.some((m) => m.id === pick.modelId)) return null
  return { provider: harnessRouteFor(vendorId), model: pick.modelId }
}

export function profileToHarnessMutation(
  profile: AiProviderProfile,
  prevRef?: string,
): {
  op: unknown
  keyRef: string
} {  const vendorId = profile.vendorId ?? profile.id
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
  /**
   * harness's settings.mutate / credentials.set loopback RPC. Absent =
   * read-only fusion (the desktop form): harness routes surface with their
   * credentials resolved at call time, but writes never leave the office
   * sidecar — the harness's own settings UI stays the only editor of routes.
   */
  rpc?: HarnessRpc
  /** read a file relative to the dsh home (settings.yaml, .credentials.yaml) */
  readDshFile: DshFileReader
  /** local sidecar file holding office-side state (currentModel/imageModel/chaoffice/chaoffice) */
  officeStateSource: AiSettingsSource
}

/** profile ids the harness source synthesizes on read (never office-persisted
 *  as user content — anchors cover their selection validation) */
const isSyntheticLocalProfile = (p: AiProviderProfile): boolean =>
  p.id === CHATOP_LOCAL_PROFILE_ID

/**
 * Composite harness source: provider profiles live in dsh's llm-pi-ai (shared
 * with chatop), office selections live in the local sidecar. write() diffs the
 * profile set into settings.mutate ops + credentials.set calls (rpc present),
 * and always persists the office sidecar: chaoffice-login profiles,
 * office-local profiles (custom BYOK entries the harness does not back), and
 * selection anchors.
 */
export function createHarnessSource(deps: HarnessSourceDeps): AiSettingsSource {
  const { rpc, readDshFile, officeStateSource } = deps

  const readProfiles = async (): Promise<AiProviderProfile[]> => {
    const profiles: AiProviderProfile[] = []
    // current dsh persists config in the profile's Cordis patch — the legacy
    // settings.yaml is imported once at boot and removed. File first (older
    // dsh keeps it live), then settings.describe over rpc (new dsh).
    const yaml = await readDshFile('settings.yaml').catch(() => '')
    if (yaml.trim()) {
      const parsed = parseHarnessProviders(yaml)
      for (const [route, hp] of Object.entries(parsed)) {
        const profile = profileFromHarness(route, hp)
        if (profile) profiles.push(profile)
      }
      return profiles
    }
    if (!rpc) return []
    const described = (await rpc('settings.describe', {})) as {
      namespaces?: Array<{ ns?: string; value?: { providers?: Record<string, HarnessProviderProfile> } }>
    } | null
    const providers =
      described?.namespaces?.find((n) => n.ns === 'llm-pi-ai')?.value?.providers ?? {}
    for (const [route, hp] of Object.entries(providers)) {
      const profile = profileFromHarness(route, hp)
      if (profile) profiles.push(profile)
    }
    return profiles
  }

  /** dsh's current default-model pick — same file-first, describe-fallback order */
  const readDefaultPick = async (): Promise<{ provider: string; model: string } | null> => {
    const yaml = await readDshFile('settings.yaml').catch(() => '')
    if (yaml.trim()) return parseHarnessDefaultModel(yaml)
    if (!rpc) return null
    const described = (await rpc('settings.describe', {})) as {
      namespaces?: Array<{ ns?: string; value?: { provider?: string; model?: string } }>
    } | null
    const value = described?.namespaces?.find((n) => n.ns === 'agent-default-model')?.value
    return value?.provider && value?.model ? { provider: value.provider, model: value.model } : null
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

  /** selection chain, split by mode:
   *  - unlinked (desktop, no rpc): office selections stay authoritative — the
   *    office side cannot write the harness's own default back, so honoring a
   *    diverging dsh default would silently revert every office-side switch.
   *    Order: office pick → local default pick → running local → vendor
   *    harness default → first model (the historical chain).
   *  - linked (dsh plugin form, rpc present): dsh's agent-default-model is the
   *    shared source of truth — write() propagates office picks into it, so
   *    whichever UI switched last wins on every read. Order: office pick that
   *    the harness cannot represent (explicit custom choice) → harness default
   *    pick (local form, then vendor form) → office representable pick →
   *    running local → first model. */
  const defaultSelection = (
    office: AiSettingsV2,
    local: ChatopLocalSource | null,
    vendorProfiles: AiProviderProfile[],
    defaultPick: { provider: string; model: string } | null,
    profiles: AiProviderProfile[],
    linked: boolean,
  ): AiSettingsV2['currentModel'] | undefined => {
    const harnessRouteIds = new Set(vendorProfiles.map((p) => p.vendorId ?? p.id))
    if (
      office.currentModel &&
      !officePickRepresentable(office.currentModel, profiles, harnessRouteIds)
    )
      return office.currentModel
    const localDefaultPick = (): AiSettingsV2['currentModel'] | undefined => {
      if (
        !local ||
        !defaultPick ||
        (defaultPick.provider !== CHATOP_LOCAL_PROFILE_ID && defaultPick.provider !== 'local')
      )
        return undefined
      const want = defaultPick.model.startsWith('local/')
        ? defaultPick.model
        : `local/${defaultPick.model}`
      if (local.profile.models.some((m) => m.id === want))
        return { profileId: CHATOP_LOCAL_PROFILE_ID, modelId: want }
      return undefined
    }
    if (!linked && office.currentModel) return office.currentModel
    const fromLocalDefault = localDefaultPick()
    if (fromLocalDefault) return fromLocalDefault
    if (!linked && local?.runningChatId)
      return { profileId: CHATOP_LOCAL_PROFILE_ID, modelId: `local/${local.runningChatId}` }
    if (defaultPick) {
      const adopted = adoptHarnessDefault(vendorProfiles, defaultPick)
      if (adopted) return adopted
    }
    if (office.currentModel) return office.currentModel
    if (local?.runningChatId)
      return { profileId: CHATOP_LOCAL_PROFILE_ID, modelId: `local/${local.runningChatId}` }
    const first = profiles.find((p) => p.models.length > 0)
    return first ? { profileId: first.id, modelId: first.models[0]!.id } : undefined
  }

  /** office-file profiles the harness does not back (custom BYOK entries the
   *  user added in the office UI): they survive the harness merge and ride
   *  along every read/write so the picker never loses them */
  const isOfficeLocal = (
    p: AiProviderProfile,
    harnessVendorIds: Set<string>,
  ): boolean =>
    !harnessVendorIds.has(p.vendorId ?? p.id) &&
    !harnessVendorIds.has(p.id) &&
    !isSyntheticLocalProfile(p)

  const officeLocalProfiles = (
    office: AiSettingsV2,
    vendorProfiles: AiProviderProfile[],
  ): AiProviderProfile[] => {
    const harnessVendorIds = new Set([
      ...vendorProfiles.map((p) => p.vendorId ?? p.id),
      CHATOP_LOCAL_PROFILE_ID,
    ])
    return office.profiles.filter((p) => isOfficeLocal(p, harnessVendorIds))
  }

  return {
    async read() {
      const [office, vendorProfiles, local, defaultPick] = await Promise.all([
        officeStateSource.read(),
        readProfiles().catch(() => [] as AiProviderProfile[]),
        readLocal(),
        readDefaultPick().catch(() => null),
      ])
      // local group first so the picker lists it above the vendor groups, then
      // the harness vendor routes, then office-local custom profiles
      const locals = officeLocalProfiles(office, vendorProfiles)
      const profiles = [
        ...(local ? [local.profile] : []),
        ...vendorProfiles,
        ...locals,
      ]
      const currentModel = defaultSelection(
        office,
        local,
        vendorProfiles,
        defaultPick,
        profiles,
        !!rpc,
      )
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
      // office-local custom profiles persist verbatim (the harness does not
      // back them); harness-backed entries surface again on the next read
      const current = await readProfiles().catch(() => [] as AiProviderProfile[])
      const harnessVendorIds = new Set(current.map((p) => p.vendorId ?? p.id))
      const localKeep = next.profiles.filter(
        (p) => p.auth === 'api-key' && isOfficeLocal(p, harnessVendorIds),
      )
      // root fields (stock/search keys, search providers, maxOutputTokens,
      // modelDefaults…) ride along verbatim — the desktop sidecar owns them
      const office: AiSettingsV2 = {
        ...next,
        version: 2,
        profiles: [
          ...next.profiles.filter((p) => p.auth === 'chaoffice-login'),
          ...localKeep,
          ...anchors.values(),
        ],
        ...(next.currentModel ? { currentModel: next.currentModel } : {}),
        ...(next.imageModel ? { imageModel: next.imageModel } : {}),
      }
      if (!rpc) {
        // read-only fusion (desktop): the harness routes are not ours to edit;
        // persist office state only
        await officeStateSource.write(office)
        return
      }
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
      // linked default model: propagate a harness-backed office pick into dsh's
      // agent-default-model (the same ns chatop's own picker and the harness
      // settings UI write via settings.update) so the harness perceives office
      // switches; an unchanged value is skipped to avoid churning dsh revisions.
      // Routes added in this same save count as backing (new provider + pick).
      const patch = harnessDefaultPatch(
        next.currentModel,
        next.profiles,
        new Set([...harnessVendorIds, ...wantedByVendor.keys()]),
      )
      if (patch) {
        const dshPick = await readDefaultPick().catch(() => null)
        if (!dshPick || dshPick.provider !== patch.provider || dshPick.model !== patch.model)
          await rpc('settings.update', { ns: 'agent-default-model', patch })
      }
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
