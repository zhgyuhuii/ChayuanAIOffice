import { normalizeCustomProfile } from './custom-profile'
import { resolveCustomEndpoints } from './custom-endpoints'
import { defaultAiMediaSettings, resolveAiMediaSettings } from './media'
import { defaultAiSearchSettings, resolveAiSearchSettings } from './search-settings'
import type { AiProviderId, AiProviderMeta, AiSettings, LegacyAiSettings } from './types'

/**
 * ChaOffice server-side LLM proxy endpoints. All three protocols share the
 * api_key from the chaoffice login; model ids follow the proxy's own naming scheme,
 * which differs from the official vendor ids.
 */
export const CHAOFFICE_LLM_BASE_URLS = {
  anthropic: 'https://www.genspark.ai/api/anthropic',
  openai: 'https://www.genspark.ai/api/llm_proxy/v1',
} as const

/**
 * Splits ChaOffice usage out of the proxy's default "Claw" billing bucket
 * (the backend attributes chaoffice-key traffic by X-Agent-Type). Only sent to the
 * ChaOffice proxy — never to direct vendor APIs.
 */
export const CHAOFFICE_AGENT_TYPE = 'chaoffice'

export function chaofficeAttributionHeaders(baseUrl?: string): Record<string, string> {
  return baseUrl?.startsWith('https://www.genspark.ai')
    ? { 'X-Agent-Type': CHAOFFICE_AGENT_TYPE }
    : {}
}

/**
 * OpenCode Zen / Go route and cache per conversation and answer 400
 * MissingSessionID without this header (chaoffice#331). The renderer's
 * transport id is stable for a chat; a one-shot call is its own conversation.
 */
export function opencodeSessionHeaders(
  baseUrl: string | undefined,
  sessionId?: string,
): Record<string, string> {
  return baseUrl?.startsWith('https://opencode.ai/')
    ? { 'x-opencode-session': sessionId || crypto.randomUUID() }
    : {}
}

/**
 * DeepSeek V4.1 Flash under the Genspark pool spelling. Only the proxy serves
 * this id; api.deepseek.com knows the model as `deepseek-flash`, so the direct
 * provider lists the vendor spelling and keeps this one as an accepted alias.
 */
export const DEEPSEEK_V41_FLASH = 'deep-seek-v4.1-flash'

export const AI_PROVIDERS: AiProviderMeta[] = [
  {
    id: 'chaoffice',
    label: 'ChaAI Office',
    // must stay within the proxy's served set (GET /api/llm_proxy/v1/models);
    // bare gpt-5.6 and the gemini family dropped off it (verified 2026-08-31).
    // DeepSeek goes by the proxy's hyphenated pool id; V4.1 Flash takes images
    // (live-verified 2026-09-15). gpt-6-astra: chat, tool call and image
    // input all live-verified through the proxy 2026-09-17; claude-opus-5-5,
    // gpt-6-sol and gpt-6-luna the same way 2026-09-24. Opus 4.7/4.8 dropped
    // 2026-10-09: 5.5 is cheaper and supersedes both.
    models: [
      'claude-opus-5-5',
      'claude-sonnet-4-6',
      'gpt-6-astra',
      'gpt-6-sol',
      'gpt-6-luna',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      DEEPSEEK_V41_FLASH,
    ],
    defaultModel: 'claude-opus-5-5',
    keyPlaceholder: 'Not required - sign in to ChaAI Office',
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    // Populated at runtime from codex app-server model/list. Empty also lets
    // the CLI select the account's current default without a stale hardcode.
    models: [],
    defaultModel: '',
    keyPlaceholder: '',
    needsCliPath: true,
  },
  {
    id: 'anthropic',
    label: 'Claude',
    // current-generation ids per platform.claude.com models overview (2026-10-09).
    // Fable needs data retention enabled on the org, otherwise the API answers
    // model_not_available; every other id is served to any key.
    models: [
      'claude-opus-5-5',
      'claude-sonnet-5',
      'claude-fable-5-1',
      'claude-opus-5',
      'claude-fable-5',
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-sonnet-4-6',
      'claude-haiku-5-5',
    ],
    defaultModel: 'claude-sonnet-5',
    keyPlaceholder: 'sk-ant-api03-...',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    // 3.x lineup per ai.google.dev/gemini-api/docs/models (2026-08). 3.7 Flash is
    // the current stable Flash; 3.1 Pro is still preview-only.
    models: [
      'gemini-3.7-flash',
      'gemini-3.1-pro-preview',
      'gemini-3.6-flash',
      'gemini-3.5-flash-lite',
    ],
    defaultModel: 'gemini-3.7-flash',
    keyPlaceholder: 'AIza...',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    // GET api.deepseek.com/v1/models and the vendor's quick-start table both
    // name `deepseek-flash` (served by DeepSeek-V4.1-Flash-1017, native vision)
    // and `deepseek-v4-pro` (list verified 2026-09-21, docs re-read 2026-10-18).
    // List the vendor's own ids: this picker is what a user carries into curl
    // or another client, and `deep-seek-v4.1-flash` is the Genspark pool
    // spelling, which the direct API does not know. Saved picks of that alias
    // are still rewritten on load (see RETIRED_MODELS).
    models: ['deepseek-v4-pro', 'deepseek-flash'],
    defaultModel: 'deepseek-v4-pro',
    keyPlaceholder: 'sk-...',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    // GPT-5.6 naming: sol is the flagship (the bare `gpt-5.6` alias resolves to
    // it, but spell it out so the picker says which tier it is), terra balances
    // cost/intelligence, luna is the high-volume tier (2026-08). gpt-6-astra
    // is deliberately absent: OpenAI serves its tool calls only through the
    // Responses API, which has no protocol here (2026-09-17)
    models: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'],
    defaultModel: 'gpt-5.6-terra',
    keyPlaceholder: 'sk-...',
  },
  {
    id: 'kimi',
    label: 'Kimi',
    models: ['kimi-k3'],
    defaultModel: 'kimi-k3',
    keyPlaceholder: 'sk-...',
  },
  {
    id: 'glm',
    label: 'GLM',
    // bigmodel.cn text-model lineup (2026-08); 5.3 and 5.2 share a base model.
    // 5.3-Flash is the first multimodal GLM-5 and the documented successor to
    // 5-Turbo, which Z.ai delisted from its price card in late August and
    // Tencent CloudBase retires on 2026-10-30 with migration advice pointing
    // here. 5.2 is marked deprecated on third-party catalogues but is still
    // sold pay-as-you-go, so it stays listed.
    models: ['glm-5.3', 'glm-5.3-flash', 'glm-5.2'],
    defaultModel: 'glm-5.3',
    keyPlaceholder: 'xxxxxxxx.xxxxxxxx',
  },
  {
    id: 'qwen',
    label: 'Qwen',
    // Versioned DashScope ids: the bare qwen-max alias still points at a
    // Qwen2.5-era snapshot, so name the 3.x tiers explicitly (2026-08).
    // 3.8 ships as Max and Flash only — there is no 3.8-Plus tier, and
    // 3.7-Flash is still the listed high-volume option.
    models: ['qwen3.8-max', 'qwen3.8-flash', 'qwen3.7-plus', 'qwen3.7-flash'],
    defaultModel: 'qwen3.8-max',
    keyPlaceholder: 'sk-...',
  },
  {
    id: 'doubao',
    label: 'Doubao',
    // Ark ids are dashed and date-pinned; it also accepts ep-... inference
    // endpoint ids in the model field
    models: ['doubao-seed-2-1-pro-260628', 'doubao-seed-2-1-turbo-260628'],
    defaultModel: 'doubao-seed-2-1-pro-260628',
    keyPlaceholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
  },
  {
    id: 'mimo',
    label: 'MiMo',
    // Xiaomi's open-weight omni-modal pair (released 2026-09-22): Pro is the
    // trillion-parameter flagship, Flash the efficiency/cost tier. Both take
    // text, image, video and audio input; a -pro-ultraspeed tier also exists but
    // is the same weights behind a faster serving path, so it is not a
    // separate model to pick here.
    models: ['mimo-v2.6-pro', 'mimo-v2.6-flash'],
    defaultModel: 'mimo-v2.6-pro',
    keyPlaceholder: 'sk-...',
  },
  {
    id: 'hunyuan',
    label: 'Hunyuan',
    // Tencent's TokenHub chat models (docs 1823/132252, read 2026-09-30).
    // hy4-preview is the 1M-context flagship and has deep thinking on by
    // default; hy3 is the 256k balanced tier. Every other provider here
    // defaults to its flagship, so this does too.
    models: ['hy4-preview', 'hy3'],
    defaultModel: 'hy4-preview',
    keyPlaceholder: 'sk-...',
  },
  {
    id: 'ling',
    label: 'Ling',
    // Ids as listed by developer.ant-ling.com (Ring = reasoning line); only
    // Ling-3.0-flash-VL takes images, see modelLacksVision()
    models: [
      'Ling-3.0-flash',
      'Ling-3.0-flash-VL',
      'Ling-3.0-tiny',
      'Ling-2.6-1T',
      'Ring-2.6-1T',
      'Ling-2.6-flash',
    ],
    defaultModel: 'Ling-3.0-flash',
    keyPlaceholder: 'API Key',
  },
  {
    id: 'spark',
    label: 'Spark',
    // iFlytek MaaS: lower-case model id and ak- key prefix are the vendor's own spelling
    models: ['spark-x2.5'],
    defaultModel: 'spark-x2.5',
    keyPlaceholder: 'ak-...',
  },
  {
    id: 'longcat',
    label: 'LongCat',
    // 2.5-Preview is the multimodal tier; 2.0 stays default so a fresh config avoids a preview
    models: ['LongCat-2.5-Preview', 'LongCat-2.0'],
    defaultModel: 'LongCat-2.0',
    keyPlaceholder: 'API Key',
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    // M3 is the current agentic/tool-use model; M2.5 moved to the legacy tier
    models: ['MiniMax-M3', 'MiniMax-M2.7'],
    defaultModel: 'MiniMax-M3',
    keyPlaceholder: 'eyJ...',
  },
  {
    id: 'xai',
    label: 'Grok',
    // 4.7 (2026-09-21) is 2.1T / 500K context at 4.6's price. 4.6 stays the
    // default so a fresh config does not silently move to a model released
    // this month; say the word and the default follows the flagship like every
    // other provider here.
    models: ['grok-4.7', 'grok-4.6', 'grok-4.5'],
    defaultModel: 'grok-4.6',
    keyPlaceholder: 'xai-...',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    // `-latest` aliases track the newest GA snapshot. Medium 3.5 is Mistral's
    // agentic tier; codestral is a code-completion/FIM model, not an agent driver.
    models: ['mistral-medium-latest', 'mistral-large-latest', 'mistral-small-latest'],
    defaultModel: 'mistral-medium-latest',
    keyPlaceholder: 'API Key',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    // vendor-prefixed slugs exactly as openrouter.ai/api/v1/models lists them —
    // there is no `openai/gpt-5.6` alias there, only the per-tier ids. Shown
    // until the live catalog (several hundred ids) replaces them.
    liveModels: true,
    models: [
      'openrouter/auto',
      'anthropic/claude-sonnet-5',
      'openai/gpt-6-astra',
      'openai/gpt-5.6-sol',
      'moonshotai/kimi-k3',
    ],
    defaultModel: 'openrouter/auto',
    keyPlaceholder: 'sk-or-...',
  },
  {
    id: 'requesty',
    label: 'Requesty',
    // Managed policy ids exactly as GET router.requesty.ai/v1/models/managed
    // lists them (2026-09-11): short stable names Requesty routes across
    // providers, used as-is in the model field. The full vendor-prefixed
    // catalog (GET /v1/models, e.g. openai/gpt-4o-mini) works too when typed
    // in. Ids ending "@eu" route through EU providers only.
    models: [
      'claude-sonnet-5',
      'claude-opus-4-8',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gemini-3.7-flash',
      'deepseek-v4-pro',
      'kimi-k3',
    ],
    defaultModel: 'claude-sonnet-5',
    keyPlaceholder: 'sk-...',
  },
  {
    id: 'agnes',
    label: 'Agnes AI（爱思）',
    // Agnes 爱思 self-owned tiers as the platform model page lists them
    // (verified 2026-09-13, wiki.agnes-ai.cn): two flash generations, the
    // 2.5 pro beta and its GA snapshot
    models: ['agnes-2.5-flash', 'agnes-3.0-flash', 'agnes-2.5-pro-beta', 'agnes-2.5-pro'],
    defaultModel: 'agnes-2.5-flash',
    keyPlaceholder: 'agnes-ai.cn 控制台生成的 API Key',
  },
  {
    id: 'opper',
    label: 'Opper',
    // Pool ids exactly as GET api.opper.ai/v3/models lists them (2026-09-14):
    // a bare name is an Opper pool, and Opper picks the serving provider and
    // region per request. The vendor-prefixed catalog (anthropic/claude-sonnet-4-6,
    // azure/gpt-5, …) pins one provider and works as-is when typed in.
    // Full list at opper.ai/models.
    models: [
      'claude-sonnet-4-6',
      'claude-opus-5',
      'gpt-5.5',
      'gpt-5.4-mini',
      'gemini-3.8-flash',
      'deepseek-v4-pro',
      'kimi-k3',
      'mistral-large-2512',
    ],
    defaultModel: 'claude-sonnet-4-6',
    keyPlaceholder: 'API Key',
  },
  {
    id: 'cheaperinference',
    label: 'Cheaper Inference',
    // Bare model ids as GET api.cheaperinference.com/v1/models lists them (the
    // chat rows, type "text"): no vendor prefix, one key for every lab. Other
    // ids from that list work as-is when typed in. Full list at
    // cheaperinference.com/#models.
    models: ['gpt-5.4-mini', 'gpt-5.4', 'claude-sonnet-5', 'gemini-3.1-pro'],
    defaultModel: 'gpt-5.4-mini',
    keyPlaceholder: 'ci_live_...',
  },
  {
    id: 'atlascloud',
    label: 'Atlas Cloud',
    // Lab-namespaced ids exactly as GET api.atlascloud.ai/v1/models lists them
    // (2026-10-08, public endpoint, no key needed); the rest of the 117-model
    // catalog works as-is when typed in. Chat, temperature and — for the
    // multimodal ids — data-URI image input are live-verified. The text-only
    // ids (deepseek-v4-*, glm-5.3, both MiniMax) are listed in
    // modelLacksVision(); Atlas Cloud serves MiniMax M3 text-only even though
    // MiniMax's own API takes images.
    models: [
      'deepseek-ai/deepseek-v4-pro',
      'deepseek-ai/deepseek-v4-flash',
      'moonshotai/kimi-k3',
      'moonshotai/kimi-k2.6',
      'zai-org/glm-5.3',
      'zai-org/glm-5.3-flash',
      'qwen/qwen3.8-max',
      'qwen/qwen3.5-flash',
      'minimaxai/minimax-m3',
      'minimaxai/minimax-m2.5',
    ],
    defaultModel: 'deepseek-ai/deepseek-v4-pro',
    keyPlaceholder: 'apikey-...',
  },
  {
    id: 'opencode-zen',
    label: 'OpenCode Zen',
    // Pay-as-you-go gateway (opencode.ai/docs/zen); ids exactly as GET
    // /zen/v1/models lists them (2026-10-09). GPT-5.x/6, Grok and Muse Spark
    // are served only through the Responses API, which has no protocol here,
    // so they stay out until one exists.
    models: [
      'claude-sonnet-5',
      'claude-opus-5',
      'claude-fable-5-1',
      'claude-haiku-5-5',
      'gemini-3.7-flash',
      'gemini-3.1-pro',
      'kimi-k3',
      'kimi-k2.7-code',
      'deepseek-v4-pro',
      'deepseek-v4-flash',
      'glm-5.2',
      'minimax-m3',
      'qwen3.6-plus',
    ],
    defaultModel: 'claude-sonnet-5',
    keyPlaceholder: 'API Key',
  },
  {
    id: 'opencode-go',
    label: 'OpenCode Go',
    // $10/month subscription to open-weight coding models (opencode.ai/docs/go),
    // same key as Zen; ids exactly as GET /zen/go/v1/models lists them
    // (re-read 2026-09-30). GPT-5.6 Luna, Grok and Muse Spark are
    // Responses-only and left out for the same reason as above.
    models: [
      'kimi-k2.7-code',
      'kimi-k3',
      'kimi-k2.6',
      'glm-5.3',
      'glm-5.3-flash',
      'glm-5.2',
      'deepseek-v4-pro',
      'deepseek-v4-flash',
      'deepseek-v4.1-flash',
      'qwen3.8-max',
      'qwen3.8-flash',
      'minimax-m3',
      'minimax-m2.7',
      'mimo-v2.5-pro',
      'mimo-v2.6-pro',
      'mimo-v2.6-flash',
      'longcat-2.0',
      'longcat-2.5-preview-free',
      'hy4-preview',
      'hy3',
    ],
    defaultModel: 'kimi-k2.7-code',
    keyPlaceholder: 'API Key',
  },
  {
    id: 'custom',
    label: 'Custom',
    models: [],
    defaultModel: '',
    keyPlaceholder: 'API Key',
    needsBaseUrl: true,
  },
]

/**
 * Fresh settings with every provider's default model and an empty key,
 * except providers listed in `defaultApiKeys` (e.g. an app-specific
 * preconfigured Anthropic key). Callers own that policy; this package
 * has no hardcoded keys.
 */
export function defaultAiSettings(
  defaultApiKeys?: Partial<Record<AiProviderId, string>>,
): AiSettings {
  const providers = {} as AiSettings['providers']
  for (const meta of AI_PROVIDERS) {
    providers[meta.id] = {
      apiKey: defaultApiKeys?.[meta.id] ?? '',
      model: meta.defaultModel,
      baseUrl: meta.needsBaseUrl ? '' : undefined,
      cliPath: meta.needsCliPath ? '' : undefined,
    }
  }
  return {
    provider: 'chaoffice',
    providers,
    media: defaultAiMediaSettings(),
    search: defaultAiSearchSettings(),
  }
}


/**
 * The stored provider selection is honored only when its config is usable
 * (api-key providers need a key and a model id; custom also needs a base URL).
 * Codex can auto-discover its executable. Anything else — including unknown
 * ids from a hand-edited
 * settings file — falls back to chaoffice, so a half-filled setup degrades
 * to the signed-in default instead of silently disabling AI.
 */
export function activeProvider(settings: AiSettings): AiProviderId {
  const provider = settings.provider
  if (provider === 'chaoffice') return 'chaoffice'
  const meta = AI_PROVIDERS.find((m) => m.id === provider)
  const config = settings.providers?.[provider]
  if (!meta || !config) return 'chaoffice'
  if (meta.needsCliPath) return provider
  // Trim-aware: in-memory settings bypass the trimConfigs applied to
  // persisted files, and a whitespace-only key/URL/model is a 401, not a config.
  if (!config.model?.trim()) return 'chaoffice'
  if (meta.needsBaseUrl) {
    // Custom OpenAI-compatible endpoints (Ollama, LM Studio, vLLM) accept
    // anonymous requests: base URL + model suffice, the key stays optional.
    if (!config.baseUrl?.trim()) return 'chaoffice'
    return provider
  }
  if (!config.apiKey?.trim()) return 'chaoffice'
  return provider
}

/**
 * Model ids a vendor has stopped serving, mapped to their replacement. A
 * stored selection outlives the provider list, so without this remap an old
 * settings file keeps sending an id the API now rejects.
 */
const RETIRED_MODELS: Partial<Record<AiProviderId, Record<string, string>>> = {
  // chat/reasoner retired 2026-07-24 (thinking became a request parameter);
  // V4 Flash and V4 Flash Vision Exp retired 2026-09-10 in favour of V4.1
  // Flash; every one of them, and the Genspark pool spelling that was the
  // listed id until 0.11, now resolves to the vendor's own `deepseek-flash`.
  deepseek: {
    'deepseek-chat': 'deepseek-flash',
    'deepseek-reasoner': 'deepseek-flash',
    'deepseek-v4-flash': 'deepseek-flash',
    'deepseek-v4-flash-vision-exp': 'deepseek-flash',
    [DEEPSEEK_V41_FLASH]: 'deepseek-flash',
  },
  // proxy stopped serving bare gpt-5.6 (400) and removed the gemini route
  // entirely (405), verified 2026-08-31; gemini selections fall back to the
  // provider default since no gemini id is served at all
  chaoffice: {
    'gpt-5.6': 'gpt-5.6-terra',
    'gemini-3.1-pro-preview': 'claude-opus-5-5',
    'gemini-3-flash-preview': 'claude-opus-5-5',
    'gemini-3.7-flash': 'claude-opus-5-5',
    'claude-opus-4-7': 'claude-opus-5-5',
    'claude-opus-4-8': 'claude-opus-5-5',
  },
  // 5-Turbo left the Z.ai price card late 2026-08; 5.3 Flash is the cheap tier now
  glm: { 'glm-5-turbo': 'glm-5.3-flash' },
}

/**
 * Per-turn output cap applied when the settings carry none. The historic 8192
 * was the budget a reasoning model burns on thinking before it writes any prose,
 * and too small for a large sheet DSL or long-form generation in one turn. Models
 * whose own ceiling is lower reject this and are retried at that ceiling
 * (see output-cap.ts).
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 32768
/** bounds accepted for AiSettings.maxOutputTokens: below the first a short answer cannot even finish, above the second one turn risks the whole context window */
export const MIN_MAX_OUTPUT_TOKENS = 1024
export const MAX_MAX_OUTPUT_TOKENS = 131072

/** Out-of-range or non-finite input falls back to a bound / the default (a mistyped settings field must not kill AI features) */
export function clampMaxOutputTokens(value: unknown): number {
  const n = typeof value === 'number' ? Math.floor(value) : Number.NaN
  if (!Number.isFinite(n)) return DEFAULT_MAX_OUTPUT_TOKENS
  return Math.min(MAX_MAX_OUTPUT_TOKENS, Math.max(MIN_MAX_OUTPUT_TOKENS, n))
}

/** The effective per-turn output cap of a settings object (clamped; absent → default) */
export function maxOutputTokensOf(
  settings: Pick<AiSettings, 'maxOutputTokens'> | null | undefined,
): number {
  return settings?.maxOutputTokens === undefined
    ? DEFAULT_MAX_OUTPUT_TOKENS
    : clampMaxOutputTokens(settings.maxOutputTokens)
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** pasted keys/URLs/model ids often carry stray whitespace, which turns into a 401 with a valid key */
function trimConfigs(providers: Record<string, unknown>): AiSettings['providers'] {
  const trimmed: Record<string, unknown> = {}
  for (const [id, config] of Object.entries(providers)) {
    if (!isRecord(config)) continue
    // A stored profile is user data like the rest: normalizeCustomProfile
    // bounds and drops what it cannot honor (an absent/empty one stays absent).
    const profile = normalizeCustomProfile(config.profile)
    trimmed[id] = {
      ...config,
      apiKey: str(config.apiKey),
      model: str(config.model),
      ...(config.baseUrl !== undefined ? { baseUrl: str(config.baseUrl) } : {}),
      ...(config.cliPath !== undefined ? { cliPath: str(config.cliPath) } : {}),
      ...(profile ? { profile } : {}),
    }
  }
  return trimmed as AiSettings['providers']
}

function migrateRetiredModels(providers: AiSettings['providers']): AiSettings['providers'] {
  const migrated = { ...providers }
  for (const [id, replacements] of Object.entries(RETIRED_MODELS)) {
    const config = migrated[id as AiProviderId]
    const replacement = config?.model ? replacements[config.model] : undefined
    if (replacement) migrated[id as AiProviderId] = { ...config, model: replacement }
  }
  return migrated
}

/**
 * Merge on-disk settings over freshly computed defaults, migrating the
 * pre-provider shape (a single OpenAI-compatible endpoint) into the
 * "custom" provider slot. `stored` is whatever the caller read from its
 * settings file (already JSON-parsed); this function does no file I/O.
 */
export function resolveAiSettings(
  stored: Partial<AiSettings> & LegacyAiSettings,
  defaults: AiSettings,
): AiSettings {
  if (!stored.providers) {
    if (stored.apiKey) {
      defaults.providers.custom = {
        apiKey: str(stored.apiKey),
        model: str(stored.model),
        baseUrl: str(stored.baseUrl) || 'https://api.openai.com/v1',
      }
    }
    defaults.media = resolveAiMediaSettings(stored.media ?? defaults.media)
    defaults.search = resolveAiSearchSettings(stored.search ?? defaults.search)
    return resolveCustomEndpoints(defaults)
  }
  return resolveCustomEndpoints({
    provider: stored.provider ?? defaults.provider,
    customEndpoints: stored.customEndpoints,
    customEndpoint: stored.customEndpoint,
    // Trim before migrating: a pasted " deepseek-reasoner " must still hit
    // the retired-id remap instead of being sent to the API verbatim.
    providers: migrateRetiredModels(trimConfigs({ ...defaults.providers, ...stored.providers })),
    media: resolveAiMediaSettings(stored.media ?? defaults.media),
    search: resolveAiSearchSettings(stored.search ?? defaults.search),
    // clamped on read: a hand-edited settings file with an absurd cap must not be
    // forwarded to the endpoint verbatim
    ...(stored.maxOutputTokens !== undefined || defaults.maxOutputTokens !== undefined
      ? {
          maxOutputTokens: clampMaxOutputTokens(stored.maxOutputTokens ?? defaults.maxOutputTokens),
        }
      : {}),
  })
}
