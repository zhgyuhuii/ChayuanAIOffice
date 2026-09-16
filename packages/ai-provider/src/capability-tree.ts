/**
 * Capability tree — the declarative registry behind the 生图、媒体与搜索
 * settings page and the global capability defaults. Six user-facing groups
 * (web search / image gen / video gen / image understanding / video
 * understanding / SVG generation); the model-driven groups are projections
 * of the model-settings profiles: which vendors can serve the capability,
 * which of a profile's models qualify, and which selection is the default.
 *
 * Nothing here probes the network — the settings page refresh button drives
 * `discoverModels` and merges capability-matching ids back into the profile.
 */
import { resolveModelCapabilities } from './capabilities'
import { findProfile, isChatModel, isImageGenModel, isVideoGenModel } from './settings-v2'
import { VENDOR_BY_ID } from './vendor-catalog'
import type { AiModelEntry, AiProviderProfile, AiSettingsV2 } from './types'

/** the model-driven capability groups surfaced in the settings tree */
export type AiCapabilityKind =
  'imageGen' | 'videoGen' | 'imageUnderstanding' | 'videoUnderstanding' | 'svgGeneration'

/**
 * Vendor catalog ids that can serve each capability. Mirrors the wired
 * adapters (imagegen.ts / media-jobs.ts) plus the understanding sets the
 * vendors actually support (image: every mainstream multimodal chat vendor;
 * video: native video input — Gemini natively, DashScope/Zhipu via their
 * video part dialects).
 */
const CAPABILITY_VENDORS: Record<AiCapabilityKind, string[]> = {
  imageGen: [
    'openai',
    'gemini',
    'volcengine',
    'zhipu',
    'grok',
    'aliyun-bailian',
    'minimax',
    'recraft',
    'chatoffice',
  ],
  videoGen: [
    'aliyun-bailian',
    'zhipu',
    'minimax',
    'volcengine',
    'gemini',
    'openai',
    'kling',
    'luma',
    'fal',
    'runway',
    'vidu',
    'pixverse',
    'chatoffice',
  ],
  imageUnderstanding: [
    'openai',
    'gemini',
    'volcengine',
    'zhipu',
    'grok',
    'aliyun-bailian',
    'chatoffice',
  ],
  videoUnderstanding: ['gemini', 'volcengine', 'zhipu', 'aliyun-bailian', 'chatoffice'],
  // SVG generation rides chat models: every vendor qualifies, the tree lists
  // enabled profiles only (no point advertising vendors the user never set up)
  svgGeneration: [],
}

/** does one model of a profile qualify for the capability? */
export function modelHasCapability(
  kind: AiCapabilityKind,
  profile: AiProviderProfile,
  entry: AiModelEntry,
): boolean {
  switch (kind) {
    case 'imageGen':
      return isImageGenModel(entry)
    case 'videoGen':
      return isVideoGenModel(entry)
    case 'imageUnderstanding':
    case 'videoUnderstanding': {
      const caps = resolveModelCapabilities({
        vendorId: profile.vendorId ?? profile.id,
        protocol: wireToCapsProtocol(profile.protocol),
        modelId: entry.id,
      })
      return kind === 'imageUnderstanding' ? caps.vision : caps.videoInput
    }
    case 'svgGeneration':
      return isChatModel(entry)
  }
}

/** the wire protocol enum the capability matrix speaks (subset mapping) */
function wireToCapsProtocol(
  wire: AiProviderProfile['protocol'],
): Parameters<typeof resolveModelCapabilities>[0]['protocol'] {
  switch (wire) {
    case 'anthropic-messages':
      return 'anthropic'
    case 'gemini-native':
      return 'gemini'
    case 'openai-responses':
      return 'openai-responses'
    default:
      return 'openai-compatible'
  }
}

/** catalog vendor rows for a capability group, enabled profiles first */
export function capabilityVendorRows(
  settings: Pick<AiSettingsV2, 'profiles'>,
  kind: AiCapabilityKind,
): Array<{ vendorId: string; name: string; nameZh?: string; enabled: boolean; keyUrl?: string }> {
  if (kind === 'svgGeneration') {
    return settings.profiles
      .filter((p) => p.enabled)
      .map((p) => ({
        vendorId: p.vendorId ?? p.id,
        name: p.displayName || p.id,
        enabled: true,
        ...(VENDOR_BY_ID.get(p.vendorId ?? '')?.keyUrl
          ? { keyUrl: VENDOR_BY_ID.get(p.vendorId ?? '')!.keyUrl }
          : {}),
      }))
  }
  const byId = new Map(settings.profiles.map((p) => [p.vendorId ?? p.id, p]))
  return CAPABILITY_VENDORS[kind]
    .map((vendorId) => {
      const vendor = VENDOR_BY_ID.get(vendorId)
      const profile = byId.get(vendorId)
      return {
        vendorId,
        name: vendor?.name ?? vendorId,
        ...(vendor?.nameZh ? { nameZh: vendor.nameZh } : {}),
        enabled: !!profile?.enabled,
        ...(vendor?.keyUrl ? { keyUrl: vendor.keyUrl } : {}),
      }
    })
    .sort((a, b) => Number(b.enabled) - Number(a.enabled))
}

/** the capability-qualifying models of one enabled profile */
export function profileCapabilityModels(
  settings: Pick<AiSettingsV2, 'profiles'>,
  kind: AiCapabilityKind,
  profileId: string,
): AiModelEntry[] {
  const profile = findProfile(settings as AiSettingsV2, profileId)
  if (!profile?.enabled) return []
  return profile.models.filter((m) => modelHasCapability(kind, profile, m))
}

/** where each capability's explicit default selection lives in AiSettingsV2 */
export function capabilityDefaultSelection(
  settings: AiSettingsV2,
  kind: AiCapabilityKind,
): { profileId: string; modelId: string } | undefined {
  return settings.modelDefaults?.[kind]
}

function selectionQualifies(
  settings: AiSettingsV2,
  kind: AiCapabilityKind,
  sel: { profileId: string; modelId: string } | undefined,
): sel is { profileId: string; modelId: string } {
  if (!sel) return false
  const profile = findProfile(settings, sel.profileId)
  if (!profile?.enabled) return false
  const entry = profile.models.find((m) => m.id === sel.modelId)
  return !!entry && modelHasCapability(kind, profile, entry)
}

/**
 * The effective default for a capability: the explicit pick when it still
 * points at an enabled qualifying model, else the first qualifying model
 * across enabled profiles of capability vendors (svgGeneration scans every
 * enabled profile). Image generation rides the legacy dedicated
 * `imageModel` field — the two surfaces stay in sync.
 */
export function resolveCapabilityDefault(
  settings: AiSettingsV2,
  kind: AiCapabilityKind,
): { profileId: string; modelId: string } | undefined {
  const explicit =
    kind === 'imageGen' ? settings.imageModel : capabilityDefaultSelection(settings, kind)
  if (selectionQualifies(settings, kind, explicit)) return explicit
  const vendorGate = new Set(CAPABILITY_VENDORS[kind])
  for (const profile of settings.profiles) {
    if (!profile.enabled) continue
    if (vendorGate.size > 0 && !vendorGate.has(profile.vendorId ?? profile.id)) continue
    const entry = profile.models.find((m) => modelHasCapability(kind, profile, m))
    if (entry) return { profileId: profile.id, modelId: entry.id }
  }
  return undefined
}

/** can a vendor's model list be re-fetched (login-backed profiles cannot)? */
export function capabilityVendorRefreshable(vendorId: string): boolean {
  return vendorId !== 'chatoffice'
}

// ── search platforms (网络搜索 group children) ─────────────────────────
// Web-search platforms + stock photo libraries unified for the settings tree
// and the insert-media dialog's source list. ids align with AiSearchProviderId
// / stockApiKeys keys so the settings storage needs no new fields.

export type SearchPlatformKind = 'web' | 'stock'

export interface SearchPlatformMeta {
  id: string
  label: string
  kind: SearchPlatformKind
  /** the platform can serve the insert-dialog image gallery */
  imageSearch: boolean
  /** key/base URL required to use the platform */
  needsKey: boolean
  /** console page where a key can be created */
  keyUrl?: string
  /** zh/en one-line descriptions for the settings right pane */
  descZh: string
  descEn: string
}

export const SEARCH_PLATFORMS: SearchPlatformMeta[] = [
  {
    id: 'serper',
    label: 'Serper',
    kind: 'web',
    imageSearch: true,
    needsKey: true,
    keyUrl: 'https://serper.dev/api-key',
    descZh: 'Google 搜索结果 API（网页 + 图片），速度快，免费额度 2500 次/月。',
    descEn: 'Google results API (web + images); fast, 2,500 free queries/month.',
  },
  {
    id: 'tavily',
    label: 'Tavily',
    kind: 'web',
    imageSearch: false,
    needsKey: true,
    keyUrl: 'https://app.tavily.com/home',
    descZh: '为 AI 应用优化的网页搜索 API，返回直接答案与摘要。',
    descEn: 'Web search API optimized for AI apps; returns direct answers and snippets.',
  },
  {
    id: 'linkup',
    label: 'Linkup',
    kind: 'web',
    imageSearch: false,
    needsKey: true,
    keyUrl: 'https://linkup.so/profile-api',
    descZh: '欧洲网页搜索 API，提供来源标注的搜索结果。',
    descEn: 'European web search API with sourced results.',
  },
  {
    id: 'searxng',
    label: 'SearxNG',
    kind: 'web',
    imageSearch: false,
    needsKey: true,
    descZh: '自建元搜索引擎：在「API Key」处填入实例地址（如 https://searxng.example.com）。',
    descEn:
      'Self-hosted metasearch: paste your instance URL (https://searxng.example.com) as the key.',
  },
  {
    id: 'duckduckgo',
    label: 'DuckDuckGo',
    kind: 'web',
    imageSearch: false,
    needsKey: false,
    descZh: '免 Key 网页搜索（内置兜底）。',
    descEn: 'Keyless web search (built-in fallback).',
  },
  {
    id: 'bing',
    label: 'Bing',
    kind: 'web',
    imageSearch: true,
    needsKey: false,
    descZh: '免 Key 图片搜索（必应图片，国内可达）。',
    descEn: 'Keyless image search (Bing images; reachable from China).',
  },
  {
    id: 'pexels',
    label: 'Pexels',
    kind: 'stock',
    imageSearch: true,
    needsKey: true,
    keyUrl: 'https://www.pexels.com/api/',
    descZh: '高质量免费图库，需要免费 API Key。',
    descEn: 'Free high-quality stock photos; free API key required.',
  },
  {
    id: 'pixabay',
    label: 'Pixabay',
    kind: 'stock',
    imageSearch: true,
    needsKey: true,
    keyUrl: 'https://pixabay.com/api/docs/',
    descZh: '免费图片/插画图库，需要免费 API Key。',
    descEn: 'Free photos and illustrations; free API key required.',
  },
  {
    id: 'unsplash',
    label: 'Unsplash Access',
    kind: 'stock',
    imageSearch: true,
    needsKey: true,
    keyUrl: 'https://unsplash.com/developers',
    descZh: '高清摄影图库，需要 Access Key。',
    descEn: 'High-resolution photography; Access Key required.',
  },
]

export function searchPlatformMeta(id: string): SearchPlatformMeta | undefined {
  return SEARCH_PLATFORMS.find((p) => p.id === id)
}
