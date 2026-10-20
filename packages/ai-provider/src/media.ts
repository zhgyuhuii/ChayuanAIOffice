import type {
  AiMediaProviderConfig,
  AiMediaProviderId,
  AiMediaProviderMeta,
  AiMediaSettings,
  AiSettings,
} from './types'

export const OPENAI_IMAGES_BASE_URL = 'https://api.openai.com/v1'
export const GEMINI_MEDIA_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
export const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
export const ZHIPU_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4'
export const XAI_BASE_URL = 'https://api.x.ai/v1'
/** DashScope root: images ride /api/v1/services/aigc/..., understanding rides /compatible-mode/v1 */
export const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com'
export const MINIMAX_BASE_URL = 'https://api.minimax.io/v1'
/** DeepSeek's OpenAI-compatible root; the Vision + Files API live at https://api.deepseek.com */
export const DEEPSEEK_MEDIA_BASE_URL = 'https://api.deepseek.com/v1'

// No built-in model lists: every model in the UI comes from a live fetch (the
// settings page and the media capabilities channel drive discoverModels), and
// the user pins what the endpoint actually serves. Meta carries only the wire
// capability — which protocols this vendor can serve — never model ids.
export const AI_MEDIA_PROVIDERS: AiMediaProviderMeta[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    description: 'GPT Image for generation and editing; GPT chat models for image analysis',
    keyPlaceholder: 'sk-...',
    defaultBaseUrl: OPENAI_IMAGES_BASE_URL,
    imageProtocol: 'openai-images',
    analysisProtocol: 'openai-chat',
    videoAnalysis: false,
  },
  {
    id: 'gemini',
    label: 'Gemini',
    description:
      'Gemini native image output (Nano Banana) and Imagen; Gemini reads images, video and audio',
    keyPlaceholder: 'AIza...',
    defaultBaseUrl: GEMINI_MEDIA_BASE_URL,
    imageProtocol: 'gemini',
    analysisProtocol: 'gemini',
    videoAnalysis: true,
  },
  {
    id: 'doubao',
    label: 'Doubao (Volcengine Ark)',
    description: 'Seedream image generation and editing; Doubao Seed reads images and video',
    keyPlaceholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    defaultBaseUrl: ARK_BASE_URL,
    imageProtocol: 'openai-images',
    analysisProtocol: 'openai-chat',
    videoAnalysis: true,
  },
  {
    id: 'glm',
    label: 'GLM (Zhipu)',
    description: 'CogView image generation; GLM-V reads images and video',
    keyPlaceholder: 'xxxxxxxx.xxxxxxxx',
    defaultBaseUrl: ZHIPU_BASE_URL,
    imageProtocol: 'openai-images',
    analysisProtocol: 'openai-chat',
    videoAnalysis: true,
  },
  {
    id: 'xai',
    label: 'Grok (xAI)',
    description: 'Grok Imagine image generation; Grok reads images',
    keyPlaceholder: 'xai-...',
    defaultBaseUrl: XAI_BASE_URL,
    imageProtocol: 'openai-images',
    analysisProtocol: 'openai-chat',
    videoAnalysis: false,
  },
  {
    id: 'qwen',
    label: 'Qwen (Alibaba Cloud)',
    description: 'Qwen-Image generation; Qwen-VL reads images and video (DashScope)',
    keyPlaceholder: 'sk-...',
    defaultBaseUrl: DASHSCOPE_BASE_URL,
    imageProtocol: 'dashscope',
    analysisProtocol: 'openai-chat',
    videoAnalysis: true,
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    description:
      'Image generation; MiniMax-M3 reads images and video (use api.minimaxi.com/v1 for CN)',
    keyPlaceholder: 'eyJ...',
    defaultBaseUrl: MINIMAX_BASE_URL,
    imageProtocol: 'minimax',
    analysisProtocol: 'openai-chat',
    videoAnalysis: true,
  },
  {
    id: 'pollinations',
    label: 'Pollinations AI',
    description: 'Free image generation — no API key required',
    keyPlaceholder: '',
    needsKey: false,
    defaultBaseUrl: 'https://image.pollinations.ai',
    imageProtocol: 'pollinations',
    videoAnalysis: false,
  },
  {
    id: 'agnes',
    label: 'Agnes AI',
    description: 'Free image generation — no API key required',
    keyPlaceholder: '',
    needsKey: false,
    defaultBaseUrl: 'https://agnes.ai',
    imageProtocol: 'pollinations',
    videoAnalysis: false,
  },
  {
    id: 'huggingface',
    label: 'Hugging Face',
    description: 'Free-tier image generation via Inference API',
    keyPlaceholder: 'hf_...',
    defaultBaseUrl: 'https://api-inference.huggingface.co',
    imageProtocol: 'openai-images',
    videoAnalysis: false,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    // native multimodal (V4.1 Flash = wire id deepseek-flash): reads JPEG/PNG/GIF/WebP,
    // no image generation and no video/audio, so it only appears for image analysis
    description: 'DeepSeek V4.1 Flash reads images (native multimodal); no image generation',
    keyPlaceholder: 'sk-...',
    defaultBaseUrl: DEEPSEEK_MEDIA_BASE_URL,
    analysisProtocol: 'openai-chat',
    videoAnalysis: false,
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'Any OpenAI-compatible endpoint: /images/generations and /chat/completions',
    keyPlaceholder: 'API Key',
    needsBaseUrl: true,
    defaultBaseUrl: '',
    imageProtocol: 'openai-images',
    analysisProtocol: 'openai-chat',
    videoAnalysis: false,
  },
]

export type MediaCapability = 'image' | 'analysis' | 'video'

export function getMediaProviderMeta(id: AiMediaProviderId): AiMediaProviderMeta | undefined {
  return AI_MEDIA_PROVIDERS.find((m) => m.id === id)
}

export function providerHasCapability(
  meta: AiMediaProviderMeta,
  capability: MediaCapability,
): boolean {
  if (capability === 'image') return !!meta.imageProtocol
  if (capability === 'video') return !!meta.analysisProtocol && meta.videoAnalysis
  return !!meta.analysisProtocol
}

export function defaultAiMediaSettings(): AiMediaSettings {
  const providers = {} as AiMediaSettings['providers']
  for (const meta of AI_MEDIA_PROVIDERS) {
    providers[meta.id] = {
      apiKey: '',
      imageModel: '',
      analysisModel: '',
      baseUrl: meta.needsBaseUrl ? '' : undefined,
    }
  }
  return {
    imageProvider: 'chaoffice',
    analysisProvider: 'chaoffice',
    videoAnalysisProvider: 'chaoffice',
    providers,
  }
}

/**
 * Merge a stored media block over defaults, trimming pasted whitespace. The
 * pre-catalog `provider` field (one choice for both tools) seeds both
 * per-capability choices. Unknown provider ids are kept and simply never activate.
 */
export function resolveAiMediaSettings(
  stored: Partial<AiMediaSettings> | undefined,
): AiMediaSettings {
  const defaults = defaultAiMediaSettings()
  if (!stored) return defaults
  const providers = { ...defaults.providers }
  for (const [id, config] of Object.entries(stored.providers ?? {})) {
    if (!config || typeof config !== 'object') continue
    // Hand-edited settings files can carry non-string values: trim only
    // strings (like the search-settings guard) instead of crashing.
    const str = (v: unknown, fallback: string): string =>
      typeof v === 'string' ? v.trim() : fallback
    const base = providers[id as AiMediaProviderId]
    providers[id as AiMediaProviderId] = {
      apiKey: str(config.apiKey, base?.apiKey ?? ''),
      imageModel: str(config.imageModel, base?.imageModel ?? ''),
      analysisModel: str(config.analysisModel, base?.analysisModel ?? ''),
      ...(config.baseUrl !== undefined
        ? { baseUrl: str(config.baseUrl, base?.baseUrl ?? '') }
        : base?.baseUrl !== undefined
          ? { baseUrl: base.baseUrl }
          : {}),
    }
  }
  const legacy = stored.provider
  const analysisProvider = stored.analysisProvider ?? legacy ?? defaults.analysisProvider
  return {
    imageProvider: stored.imageProvider ?? legacy ?? defaults.imageProvider,
    analysisProvider,
    // a pre-split file used one vendor for all media analysis
    videoAnalysisProvider: stored.videoAnalysisProvider ?? analysisProvider,
    providers,
  }
}

/** Key (or base URL for custom) present — the minimum for a BYOK media provider to be honored */
export function mediaConfigUsable(
  meta: AiMediaProviderMeta,
  config: AiMediaProviderConfig | undefined,
): boolean {
  if (!config) return false
  // Trim-aware like activeProvider: whitespace-only survivors of in-memory
  // settings are not usable configs.
  if (meta.needsBaseUrl) return !!config.baseUrl?.trim()
  if (meta.needsKey === false) return true
  return !!config.apiKey?.trim()
}

/**
 * The stored provider for one capability, honored only when it exists, has
 * that capability and is usable; anything else returns '' (no provider).
 */
export function activeMediaProvider(
  settings: Pick<AiSettings, 'media'>,
  capability: MediaCapability,
): AiMediaProviderId {
  const media = settings.media
  if (!media) return 'chaoffice'
  const id =
    capability === 'image'
      ? media.imageProvider
      : capability === 'video'
        ? media.videoAnalysisProvider
        : media.analysisProvider
  if (!id) return 'chaoffice'
  const meta = getMediaProviderMeta(id)
  if (!meta || !providerHasCapability(meta, capability)) return 'chaoffice'
  if (!mediaConfigUsable(meta, media.providers?.[id])) return 'chaoffice'
  return id
}

/** the active BYOK config for one capability, or null when none is configured */
export function activeMediaConfig(
  settings: Pick<AiSettings, 'media'>,
  capability: MediaCapability,
): { provider: Exclude<AiMediaProviderId, 'chaoffice'>; config: AiMediaProviderConfig } | null {
  const provider = activeMediaProvider(settings, capability)
  if (provider === 'chaoffice') return null
  return { provider, config: settings.media!.providers[provider] }
}

/** the model the user pinned for one capability; '' when none — no vendor default exists */
export function pinnedMediaModel(
  settings: Pick<AiSettings, 'media'>,
  capability: MediaCapability,
): string {
  const active = activeMediaConfig(settings, capability)
  if (!active) return ''
  return capability === 'image' ? active.config.imageModel : active.config.analysisModel
}

function capabilityAvailable(
  settings: Pick<AiSettings, 'media'> | null | undefined,
  capability: MediaCapability,
): boolean {
  return pinnedMediaModel(settings ?? {}, capability) !== ''
}

/** live predicate for the generate_image tool: a BYOK image model is pinned */
export function imageGenerationAvailable(
  settings: Pick<AiSettings, 'media'> | null | undefined,
  _gskLoggedIn: boolean,
): boolean {
  return capabilityAvailable(settings, 'image')
}

/** live predicate for the analyze_media tool: image analysis or video analysis reachable */
export function mediaAnalysisAvailable(
  settings: Pick<AiSettings, 'media'> | null | undefined,
  _gskLoggedIn: boolean,
): boolean {
  return (
    capabilityAvailable(settings, 'analysis') ||
    capabilityAvailable(settings, 'video')
  )
}

export function videoAnalysisAvailable(
  settings: Pick<AiSettings, 'media'> | null | undefined,
  _gskLoggedIn: boolean,
): boolean {
  return capabilityAvailable(settings, 'video')
}
