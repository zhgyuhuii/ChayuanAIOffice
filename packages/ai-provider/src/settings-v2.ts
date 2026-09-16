import { inferModelType, matchesModelType, type AiModelType } from './model-type'
import { CHATOFFICE_LLM_BASE_URLS, clampMaxOutputTokens } from './providers'
import { modelHasFixedSampling, modelLacksVision, type AiProtocol } from './registry'
import type {
  AiImageSource,
  AiMediaSettings,
  AiModelEntry,
  AiModelSelection,
  AiProviderProfile,
  AiSearchSettings,
  AiSettingsV2,
  AiWireProtocol,
} from './types'
import { CHATOFFICE_PRESET_MODELS, VENDOR_BY_ID } from './vendor-catalog'

/**
 * Settings v2 core: migration from v1, and the profile+model → wire-call
 * resolver shared by every backend (Electron mains, BFF, dsh host).
 */

/** v1 provider ids → vendor catalog ids (kimi/glm/qwen/doubao/xai rename onto chatop's rows) */
const V1_TO_VENDOR: Record<string, string> = {
  anthropic: 'anthropic',
  gemini: 'gemini',
  deepseek: 'deepseek',
  openai: 'openai',
  kimi: 'moonshot',
  glm: 'zhipu',
  qwen: 'aliyun-bailian',
  doubao: 'volcengine',
  minimax: 'minimax',
  xai: 'grok',
  mistral: 'mistral',
  openrouter: 'openrouter',
}

const V1_PROTOCOL: Record<string, AiWireProtocol> = {
  anthropic: 'anthropic-messages',
  gemini: 'gemini-native',
}

/** model ids vendors stopped serving, mapped to replacements (carried over from v1) */
const RETIRED_MODELS: Record<string, string> = {
  'deepseek-chat': 'deepseek-v4-flash',
  'deepseek-reasoner': 'deepseek-v4-flash',
}

export const WIRE_TO_INTERNAL: Record<AiWireProtocol, AiProtocol> = {
  'anthropic-messages': 'anthropic',
  'openai-completions': 'openai-compatible',
  'openai-responses': 'openai-responses',
  'gemini-native': 'gemini',
}

/** chatoffice's proxy routes claude onto the Anthropic protocol; everything
 * else (gemini included) rides the OpenAI-compatible endpoint — the proxy's
 * gemini endpoint was removed server-side (405 as of 2026-08-31). */
export function chatofficeEndpointFor(model: string): { protocol: AiProtocol; baseUrl: string } {
  if (model.startsWith('claude'))
    return { protocol: 'anthropic', baseUrl: CHATOFFICE_LLM_BASE_URLS.anthropic }
  return { protocol: 'openai-compatible', baseUrl: CHATOFFICE_LLM_BASE_URLS.openai }
}

export function chatofficeProfile(): AiProviderProfile {
  return {
    id: 'chatoffice',
    vendorId: 'chatoffice',
    displayName: 'ChaAI Office',
    protocol: 'openai-completions', // placeholder; the resolver routes per model
    baseUrl: '',
    auth: 'chatoffice-login',
    enabled: true,
    models: CHATOFFICE_PRESET_MODELS.map((id) => ({ id })),
  }
}

/** Fresh settings: nothing enabled and no default model — the settings page
 * guides configuration (sign in to ChatOffice or add an API-key vendor). */
export function defaultSettingsV2(): AiSettingsV2 {
  return {
    version: 2,
    profiles: [{ ...chatofficeProfile(), enabled: false }],
  }
}

export function findProfile(
  settings: AiSettingsV2,
  profileId: string,
): AiProviderProfile | undefined {
  return settings.profiles.find((p) => p.id === profileId)
}

/** chat-capable = type chat or vision (absent type infers from the id) */
export function isChatModel(entry: AiModelEntry): boolean {
  const type = entry.type ?? inferModelType(entry.id)
  return type === 'chat' || type === 'vision'
}

export function isImageGenModel(entry: AiModelEntry): boolean {
  const type = entry.type ?? inferModelType(entry.id)
  return matchesModelType(type, 'image-generation')
}

/** video-generation entry (absent type infers from the id: veo/sora/vidu/kling/…) */
export function isVideoGenModel(entry: AiModelEntry): boolean {
  const type = entry.type ?? inferModelType(entry.id)
  return matchesModelType(type, 'video-generation')
}

/** flat chat-model list for the quick switcher: {profileId, modelId, label} */
export function enabledChatModels(
  settings: AiSettingsV2,
): Array<{ profileId: string; modelId: string; label: string }> {
  const out: Array<{ profileId: string; modelId: string; label: string }> = []
  for (const profile of settings.profiles) {
    if (!profile.enabled) continue
    for (const m of profile.models) {
      if (!isChatModel(m)) continue
      out.push({
        profileId: profile.id,
        modelId: m.id,
        label: m.name && m.name !== m.id ? `${m.name} (${m.id})` : m.id,
      })
    }
  }
  return out
}

/** image model resolution: explicit pick when still valid, else first enabled image-gen model */
export function pickImageModel(settings: AiSettingsV2): AiModelSelection | undefined {
  if (settings.imageModel) {
    const profile = findProfile(settings, settings.imageModel.profileId)
    const entry = profile?.models.find((m) => m.id === settings.imageModel!.modelId)
    if (profile?.enabled && entry && isImageGenModel(entry)) return settings.imageModel
  }
  for (const profile of settings.profiles) {
    if (!profile.enabled) continue
    const entry = profile.models.find((m) => isImageGenModel(m))
    if (entry) return { profileId: profile.id, modelId: entry.id }
  }
  return undefined
}

/** validate the stored selection; fall back to the first enabled chat model */
export function resolveCurrentModel(settings: AiSettingsV2): AiModelSelection | undefined {
  if (settings.currentModel) {
    const profile = findProfile(settings, settings.currentModel.profileId)
    const entry = profile?.models.find((m) => m.id === settings.currentModel!.modelId)
    if (profile?.enabled && entry && isChatModel(entry)) return settings.currentModel
  }
  const first = enabledChatModels(settings)[0]
  return first ? { profileId: first.profileId, modelId: first.modelId } : undefined
}

/** the runtime shape every protocol streamer consumes */
export interface ResolvedModelCall {
  protocol: AiProtocol
  baseUrl: string
  apiKey: string
  model: string
  /** originating vendor (capability lookups: output caps, media channels) */
  vendorId?: string
  omitTemperature?: boolean
  useMaxCompletionTokens?: boolean
  bodyExtras?: Record<string, unknown>
}

function normalizeGeminiBase(baseUrl: string): string {
  // a chatop-style OpenAI-compat URL pasted for the native protocol: strip the compat suffix
  return baseUrl.replace(/\/v1beta\/openai\/?$/i, '/v1beta').replace(/\/openai\/?$/i, '')
}

/**
 * Resolve one model call: protocol endpoint + per-vendor quirks. The caller
 * supplies the secret (inline key, harness credential ref, or chatoffice session) —
 * this function never reads storage.
 */
export function resolveModelCall(
  settings: AiSettingsV2,
  selection: AiModelSelection,
  apiKey: string,
): ResolvedModelCall {
  const profile = findProfile(settings, selection.profileId)
  if (!profile) throw new Error(`Unknown model profile: ${selection.profileId}`)
  const entry = profile.models.find((m) => m.id === selection.modelId)
  if (!entry) throw new Error(`Model ${selection.modelId} is not enabled on ${profile.displayName}`)

  if (profile.auth === 'chatoffice-login') {
    const ep = chatofficeEndpointFor(selection.modelId)
    return {
      protocol: ep.protocol,
      baseUrl: ep.baseUrl,
      apiKey,
      model: selection.modelId,
      vendorId: 'chatoffice',
      ...(modelHasFixedSampling(selection.modelId) ? { omitTemperature: true } : {}),
    }
  }

  if (profile.vendorId === 'codex' || profile.id === 'codex') {
    // Codex endpoints are the locally spawned app-server; no base URL exists.
    return {
      protocol: 'codex-app-server',
      baseUrl: '',
      apiKey,
      model: selection.modelId,
      vendorId: 'codex',
    }
  }
  const vendor = profile.vendorId ? VENDOR_BY_ID.get(profile.vendorId) : undefined
  const baseUrl = (profile.baseUrl || vendor?.defaultUrl || '').replace(/\/+$/, '')
  if (!baseUrl) throw new Error(`${profile.displayName} has no API base URL configured`)

  const protocol = WIRE_TO_INTERNAL[profile.protocol]
  const isMoonshot = /api\.moonshot\.(cn|ai)/i.test(baseUrl)
  const isOpenAiOfficial = /(^|\.)api\.openai\.com$/i.test(new URL(baseUrl).hostname)
  const isDeepSeek = /(^|\.)api\.deepseek\.com$/i.test(new URL(baseUrl).hostname)

  return {
    protocol,
    baseUrl: protocol === 'gemini' ? normalizeGeminiBase(baseUrl) : baseUrl,
    apiKey,
    model: selection.modelId,
    vendorId: profile.vendorId ?? profile.id,
    ...(modelHasFixedSampling(selection.modelId) || isMoonshot ? { omitTemperature: true } : {}),
    ...(isOpenAiOfficial && protocol !== 'anthropic' ? { useMaxCompletionTokens: true } : {}),
    ...(isDeepSeek && protocol === 'openai-compatible'
      ? { bodyExtras: { thinking: { type: 'disabled' } } }
      : {}),
  }
}

// ---- migration ----

function migrateV1Provider(
  id: string,
  config: { apiKey?: string; model?: string; baseUrl?: string },
): AiProviderProfile | null {
  if (id === 'chatoffice') return null // handled separately as the login profile
  const modelId = (config.model ?? '').trim()
  const model = RETIRED_MODELS[modelId] ?? modelId
  const apiKey = (config.apiKey ?? '').trim()
  // v1 files carry a default model for every provider; only key-bearing rows were ever configured
  if (!apiKey) return null
  if (id === 'custom') {
    return {
      id: 'custom',
      displayName: 'Custom',
      protocol: 'openai-completions',
      baseUrl: config.baseUrl?.trim() ?? '',
      apiKey,
      auth: 'api-key',
      enabled: true,
      models: model ? [{ id: model }] : [],
    }
  }
  const vendorId = V1_TO_VENDOR[id] ?? id
  const vendor = VENDOR_BY_ID.get(vendorId)
  const baseUrl = (config.baseUrl?.trim() || vendor?.defaultUrl || '').trim()
  if (!baseUrl) return null
  return {
    id: vendorId,
    vendorId,
    displayName: vendor?.name ?? id,
    protocol: V1_PROTOCOL[id] ?? 'openai-completions',
    baseUrl,
    apiKey,
    auth: 'api-key',
    enabled: true,
    models: model ? [{ id: model }] : [],
  }
}

/** whatever a settings file may hold — user data, parsed tolerantly */
export interface StoredAiSettings {
  version?: number
  provider?: string
  providers?: Record<string, { apiKey?: string; model?: string; baseUrl?: string }>
  /** legacy field — read for migration, no longer written */
  chatofficeToolsEnabled?: boolean
  /** per-turn output-token cap (upstream f105f36; clamped on read) */
  maxOutputTokens?: number
  /** legacy pre-provider shape */
  apiKey?: string
  baseUrl?: string
  model?: string
  /** v2 fields */
  profiles?: AiProviderProfile[]
  currentModel?: AiModelSelection
  imageModel?: AiModelSelection
  webSearchProvider?: string
  imageSearchProvider?: string
  searchApiKeys?: Record<string, string>
  stockApiKeys?: Record<string, string>
  imageSource?: string
  /** media (generate_image / analyze_media) provider settings */
  media?: AiMediaSettings
  /** web/image search backend settings */
  search?: AiSearchSettings
}

/**
 * Accept whatever JSON a settings file holds and produce v2: an existing v2
 * blob is normalized in place, v1 `{provider, providers}` shapes migrate, and
 * the pre-provider legacy shape becomes a custom profile. No file I/O here.
 */
export function migrateSettingsV2(stored: StoredAiSettings | null | undefined): AiSettingsV2 {
  if (
    stored &&
    (stored as AiSettingsV2).version === 2 &&
    Array.isArray((stored as AiSettingsV2).profiles)
  ) {
    return normalizeV2(stored as AiSettingsV2)
  }

  // chatoffice is born disabled: enabling it is an explicit user act (login +
  // model pick in the settings page), never a default
  const profiles: AiProviderProfile[] = [{ ...chatofficeProfile(), enabled: false }]
  let currentModel: AiModelSelection | undefined

  if (stored?.providers) {
    for (const [id, config] of Object.entries(stored.providers)) {
      const profile = migrateV1Provider(id, config)
      if (profile && !profiles.some((p) => p.id === profile.id)) profiles.push(profile)
    }
    // honor the v1 active provider when it migrated into a usable profile
    const active =
      stored.provider && stored.provider !== 'chatoffice'
        ? migrateV1Provider(
            stored.provider,
            stored.providers[stored.provider] ?? { apiKey: '', model: '' },
          )
        : null
    if (active?.models.length) {
      currentModel = { profileId: active.id, modelId: active.models[0]!.id }
    }
  } else if (stored?.apiKey) {
    // pre-provider legacy shape: a single OpenAI-compatible endpoint
    profiles.push({
      id: 'custom',
      displayName: 'Custom',
      protocol: 'openai-completions',
      baseUrl: (stored.baseUrl ?? 'https://api.openai.com/v1').trim(),
      apiKey: stored.apiKey.trim(),
      auth: 'api-key',
      enabled: true,
      models: stored.model ? [{ id: stored.model }] : [],
    })
    if (stored.model) currentModel = { profileId: 'custom', modelId: stored.model }
  }

  const fallback = currentModel ?? resolveCurrentModel({ version: 2, profiles })
  return {
    version: 2,
    profiles,
    ...(fallback ? { currentModel: fallback } : {}),
    ...(stored?.maxOutputTokens !== undefined
      ? { maxOutputTokens: clampMaxOutputTokens(stored.maxOutputTokens) }
      : {}),
    ...(stored?.media ? { media: stored.media } : {}),
    ...(stored?.search ? { search: stored.search } : {}),
  }
}

/** legacy identifiers written before the de-Genspark rebrand (settings JSON) */
const LEGACY_PROFILE_ID = 'genspark'
/** legacy auth kind; the type union no longer carries it, hence the string cast */
const LEGACY_AUTH = 'gsk-login'

/** remap a legacy profile id (persisted selections point at the old id) */
function migratedProfileId(id: string | undefined): string | undefined {
  return id === LEGACY_PROFILE_ID ? 'chatoffice' : id
}

/** trim/dedupe an existing v2 blob and drop selections that no longer resolve */
function normalizeV2(settings: AiSettingsV2): AiSettingsV2 {
  const remapSelection = (sel: AiModelSelection | undefined): AiModelSelection | undefined => {
    if (!sel) return sel
    const profileId = migratedProfileId(sel.profileId) ?? sel.profileId
    return profileId === sel.profileId ? sel : { ...sel, profileId }
  }
  const seen = new Set<string>()
  const profiles = settings.profiles
    .filter((p) => {
      if (!p || !p.id || seen.has(p.id)) return false
      seen.add(p.id)
      return true
    })
    .map((p) => {
      const id = migratedProfileId(p.id) ?? p.id
      const vendorId = p.vendorId ? migratedProfileId(p.vendorId) : undefined
      return {
        ...p,
        // legacy blob: login-backed profile stored under its old id/auth kind
        id,
        ...(vendorId ? { vendorId } : {}),
        ...(p.auth === (LEGACY_AUTH as string) ? { auth: 'chatoffice-login' as const } : {}),
        displayName: p.displayName?.trim() || p.id,
        baseUrl: p.baseUrl?.trim() ?? '',
        apiKey: p.apiKey?.trim() ?? '',
        models: p.models?.filter((m) => m?.id) ?? [],
      }
    })
  const next: AiSettingsV2 = {
    version: 2,
    profiles: profiles.length ? profiles : [{ ...chatofficeProfile(), enabled: false }],
    ...(settings.maxOutputTokens !== undefined
      ? { maxOutputTokens: clampMaxOutputTokens(settings.maxOutputTokens) }
      : {}),
    // sidecar keys ride outside the profile model; normalizeV2 must carry them
    // through or every save silently wipes them (they never touch the view merge)
    ...(settings.stockApiKeys ? { stockApiKeys: settings.stockApiKeys } : {}),
    ...(settings.searchApiKeys ? { searchApiKeys: settings.searchApiKeys } : {}),
    ...(settings.webSearchProvider ? { webSearchProvider: settings.webSearchProvider } : {}),
    ...(settings.imageSearchProvider ? { imageSearchProvider: settings.imageSearchProvider } : {}),
    ...normalizeImageSource(settings.imageSource),
    ...(settings.media ? { media: settings.media } : {}),
    ...(settings.search ? { search: settings.search } : {}),
  }
  const current = remapSelection(settings.currentModel)
  const resolvedCurrent = resolveCurrentModel({
    ...next,
    ...(current !== undefined ? { currentModel: current } : {}),
  })
  if (resolvedCurrent) next.currentModel = resolvedCurrent
  const legacyImage = remapSelection(settings.imageModel)
  if (legacyImage) {
    const profile = next.profiles.find((p) => p.id === legacyImage.profileId)
    if (profile?.models.some((m) => m.id === legacyImage.modelId)) {
      next.imageModel = legacyImage
    }
  }
  if (settings.modelDefaults) {
    const defaults: Record<string, AiModelSelection> = {}
    for (const [kind, sel] of Object.entries(settings.modelDefaults)) {
      const remapped = remapSelection(sel ?? undefined)
      if (
        remapped &&
        selectionAlive(next, remapped, DEFAULT_KIND_TYPES[kind as AiDefaultKind] ?? [])
      ) {
        defaults[kind] = remapped
      }
    }
    if (Object.keys(defaults).length > 0) {
      next.modelDefaults = defaults
    }
  }
  return next
}

/** default-model kinds surfaced in the settings window's 默认模型 pane */
export type AiDefaultKind =
  | 'chat'
  | 'generation'
  | 'qc'
  | 'image'
  | 'videoGeneration'
  | 'tts'
  | 'asr'
  // 生图、媒体与搜索 capability defaults (capability-tree resolution)
  | 'imageUnderstanding'
  | 'videoUnderstanding'
  | 'svgGeneration'

const IMAGE_SOURCES: AiImageSource[] = ['auto', 'web', 'model', 'local', 'svg']

/** pass through a valid persisted image source; drop anything else (old blobs, typos) */
function normalizeImageSource(value: AiImageSource | undefined): Pick<AiSettingsV2, 'imageSource'> {
  return value && (IMAGE_SOURCES as string[]).includes(value) ? { imageSource: value } : {}
}

/** the model types each default kind accepts */
export const DEFAULT_KIND_TYPES: Record<AiDefaultKind, AiModelType[]> = {
  chat: ['chat', 'vision'],
  // page-spec writer for generate_deck — a strong chat model, any protocol
  generation: ['chat', 'vision'],
  // visual QC reviewer — needs native image input
  qc: ['vision'],
  image: ['image-generation'],
  videoGeneration: ['video-generation'],
  tts: ['tts'],
  asr: ['asr'],
  // understanding/SVG defaults resolve through capability-tree's vendor-aware
  // predicates; the type list here only keeps normalizeV2 from dropping them
  imageUnderstanding: ['chat', 'vision'],
  videoUnderstanding: ['chat', 'vision'],
  svgGeneration: ['chat', 'vision'],
}

function selectionAlive(
  settings: AiSettingsV2,
  sel: AiModelSelection | undefined,
  kinds: AiModelType[],
): boolean {
  if (!sel) return false
  const profile = findProfile(settings, sel.profileId)
  const entry = profile?.models.find((m) => m.id === sel.modelId)
  if (!profile?.enabled || !entry) return false
  const type = entry.type ?? inferModelType(entry.id)
  return kinds.includes(type)
}

/**
 * Resolve the effective default for a kind: the explicit pick when it still
 * points at an enabled model of that kind, else auto-detect the first enabled
 * model of the kind across profiles (the "识别到的" fallback).
 */
export function resolveDefaultModel(
  settings: AiSettingsV2,
  kind: AiDefaultKind,
): AiModelSelection | undefined {
  const kinds = DEFAULT_KIND_TYPES[kind]
  const explicit =
    kind === 'chat'
      ? settings.currentModel
      : kind === 'image'
        ? settings.imageModel
        : settings.modelDefaults?.[kind]
  if (selectionAlive(settings, explicit, kinds)) return explicit
  for (const profile of settings.profiles) {
    if (!profile.enabled) continue
    for (const m of profile.models) {
      const type = m.type ?? inferModelType(m.id)
      if (kinds.includes(type)) return { profileId: profile.id, modelId: m.id }
    }
  }
  return undefined
}

/** can a model accept image input (vision) on this call? */
export function modelAcceptsImages(modelId: string): boolean {
  return !modelLacksVision(modelId)
}
