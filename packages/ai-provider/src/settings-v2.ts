import { inferModelType, matchesModelType, type AiModelType } from './model-type'
import { GENSPARK_LLM_BASE_URLS } from './providers'
import { modelHasFixedSampling, modelLacksVision, type AiProtocol } from './registry'
import type {
  AiModelEntry,
  AiModelSelection,
  AiProviderProfile,
  AiSettingsV2,
  AiWireProtocol,
} from './types'
import { GENSPARK_PRESET_MODELS, VENDOR_BY_ID } from './vendor-catalog'

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

/** genspark's proxy speaks all three protocols; route by model id prefix like the v1 adapter did */
export function gensparkEndpointFor(
  model: string,
): { protocol: AiProtocol; baseUrl: string } {
  if (model.startsWith('claude')) return { protocol: 'anthropic', baseUrl: GENSPARK_LLM_BASE_URLS.anthropic }
  if (model.startsWith('gemini')) return { protocol: 'gemini', baseUrl: GENSPARK_LLM_BASE_URLS.gemini }
  return { protocol: 'openai-compatible', baseUrl: GENSPARK_LLM_BASE_URLS.openai }
}

export function gensparkProfile(): AiProviderProfile {
  return {
    id: 'genspark',
    vendorId: 'genspark',
    displayName: 'Genspark',
    protocol: 'openai-completions', // placeholder; the resolver routes per model
    baseUrl: '',
    auth: 'gsk-login',
    enabled: true,
    models: GENSPARK_PRESET_MODELS.map((id) => ({ id })),
  }
}

/** Fresh settings: the login-backed genspark profile with its default model selected. */
export function defaultSettingsV2(): AiSettingsV2 {
  return {
    version: 2,
    profiles: [gensparkProfile()],
    currentModel: { profileId: 'genspark', modelId: GENSPARK_PRESET_MODELS[0]! },
    gskToolsEnabled: true,
  }
}

export function findProfile(settings: AiSettingsV2, profileId: string): AiProviderProfile | undefined {
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

/** flat chat-model list for the quick switcher: {profileId, modelId, label} */
export function enabledChatModels(
  settings: AiSettingsV2,
): Array<{ profileId: string; modelId: string; label: string }> {
  const out: Array<{ profileId: string; modelId: string; label: string }> = []
  for (const profile of settings.profiles) {
    if (!profile.enabled) continue
    for (const m of profile.models) {
      if (!isChatModel(m)) continue
      out.push({ profileId: profile.id, modelId: m.id, label: m.name && m.name !== m.id ? `${m.name} (${m.id})` : m.id })
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
 * supplies the secret (inline key, harness credential ref, or gsk session) —
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

  if (profile.auth === 'gsk-login') {
    const ep = gensparkEndpointFor(selection.modelId)
    return {
      protocol: ep.protocol,
      baseUrl: ep.baseUrl,
      apiKey,
      model: selection.modelId,
      ...(modelHasFixedSampling(selection.modelId) ? { omitTemperature: true } : {}),
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
  if (id === 'genspark') return null // handled separately as the login profile
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
  gskToolsEnabled?: boolean
  /** legacy pre-provider shape */
  apiKey?: string
  baseUrl?: string
  model?: string
  /** v2 fields */
  profiles?: AiProviderProfile[]
  currentModel?: AiModelSelection
  imageModel?: AiModelSelection
}

/**
 * Accept whatever JSON a settings file holds and produce v2: an existing v2
 * blob is normalized in place, v1 `{provider, providers}` shapes migrate, and
 * the pre-provider legacy shape becomes a custom profile. No file I/O here.
 */
export function migrateSettingsV2(stored: StoredAiSettings | null | undefined): AiSettingsV2 {
  if (stored && (stored as AiSettingsV2).version === 2 && Array.isArray((stored as AiSettingsV2).profiles)) {
    return normalizeV2(stored as AiSettingsV2)
  }

  const profiles: AiProviderProfile[] = [gensparkProfile()]
  let currentModel: AiModelSelection | undefined

  if (stored?.providers) {
    for (const [id, config] of Object.entries(stored.providers)) {
      const profile = migrateV1Provider(id, config)
      if (profile && !profiles.some((p) => p.id === profile.id)) profiles.push(profile)
    }
    // honor the v1 active provider when it migrated into a usable profile
    const active = stored.provider && stored.provider !== 'genspark'
      ? migrateV1Provider(stored.provider, stored.providers[stored.provider] ?? { apiKey: '', model: '' })
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
    currentModel: fallback ?? { profileId: 'genspark', modelId: GENSPARK_PRESET_MODELS[0]! },
    ...(stored?.gskToolsEnabled !== undefined ? { gskToolsEnabled: stored.gskToolsEnabled } : {}),
  }
}

/** trim/dedupe an existing v2 blob and drop selections that no longer resolve */
function normalizeV2(settings: AiSettingsV2): AiSettingsV2 {
  const seen = new Set<string>()
  const profiles = settings.profiles
    .filter((p) => {
      if (!p || !p.id || seen.has(p.id)) return false
      seen.add(p.id)
      return true
    })
    .map((p) => ({
      ...p,
      displayName: p.displayName?.trim() || p.id,
      baseUrl: p.baseUrl?.trim() ?? '',
      apiKey: p.apiKey?.trim() ?? '',
      models: p.models?.filter((m) => m?.id) ?? [],
    }))
  const next: AiSettingsV2 = {
    version: 2,
    profiles: profiles.length ? profiles : [gensparkProfile()],
    ...(settings.gskToolsEnabled !== undefined ? { gskToolsEnabled: settings.gskToolsEnabled } : {}),
  }
  const current = resolveCurrentModel({
    ...next,
    ...(settings.currentModel !== undefined ? { currentModel: settings.currentModel } : {}),
  })
  if (current) next.currentModel = current
  if (settings.imageModel) {
    const profile = next.profiles.find((p) => p.id === settings.imageModel!.profileId)
    if (profile?.models.some((m) => m.id === settings.imageModel!.modelId)) {
      next.imageModel = settings.imageModel
    }
  }
  if (settings.modelDefaults) {
    const defaults: Record<string, AiModelSelection> = {}
    for (const [kind, sel] of Object.entries(settings.modelDefaults)) {
      if (sel && selectionAlive(next, sel, DEFAULT_KIND_TYPES[kind as AiDefaultKind] ?? [])) {
        defaults[kind] = sel
      }
    }
    if (Object.keys(defaults).length > 0) {
      next.modelDefaults = defaults
    }
  }
  return next
}

/** default-model kinds surfaced in the settings window's 默认模型 pane */
export type AiDefaultKind = 'chat' | 'image' | 'videoGeneration' | 'tts' | 'asr'

/** the model types each default kind accepts */
export const DEFAULT_KIND_TYPES: Record<AiDefaultKind, AiModelType[]> = {
  chat: ['chat', 'vision'],
  image: ['image-generation'],
  videoGeneration: ['video-generation'],
  tts: ['tts'],
  asr: ['asr'],
}

function selectionAlive(settings: AiSettingsV2, sel: AiModelSelection | undefined, kinds: AiModelType[]): boolean {
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
