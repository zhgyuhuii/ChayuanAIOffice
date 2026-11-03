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
  anthropic: 'https://www.chaoffice.ai/api/anthropic',
  openai: 'https://www.chaoffice.ai/api/llm_proxy/v1',
} as const

/**
 * Splits ChaOffice usage out of the proxy's default "Claw" billing bucket
 * (the backend attributes chaoffice-key traffic by X-Agent-Type). Only sent to the
 * ChaOffice proxy — never to direct vendor APIs.
 */
export const CHAOFFICE_AGENT_TYPE = 'chaoffice'

export function chaofficeAttributionHeaders(baseUrl?: string): Record<string, string> {
  return baseUrl?.startsWith('https://www.chaoffice.ai')
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
 * DeepSeek V4.1 Flash under the ChaAI Office pool spelling. Only the proxy serves
 * this id; api.deepseek.com knows the model as `deepseek-flash`, so the direct
 * provider lists the vendor spelling and keeps this one as an accepted alias.
 */
export const DEEPSEEK_V41_FLASH = 'deep-seek-v4.1-flash'

/**
 * Provider display metadata only — no model ids. Every model list in the UI is
 * fetched live from the vendor's own /models endpoint (discoverModels); what
 * the endpoint serves is what the user sees and picks. Retired-id rewriting
 * (RETIRED_AI_MODELS) keeps old saved selections loadable without dictating
 * what may be chosen.
 */
export const AI_PROVIDERS: AiProviderMeta[] = [
  {
    id: 'chaoffice',
    label: 'ChaAI Office',
    keyPlaceholder: 'Not required - sign in to ChaAI Office',
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    keyPlaceholder: '',
    needsCliPath: true,
  },
  {
    id: 'anthropic',
    label: 'Claude',
    keyPlaceholder: 'sk-ant-api03-...',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    keyPlaceholder: 'AIza...',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    keyPlaceholder: 'sk-...',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    keyPlaceholder: 'sk-...',
  },
  {
    id: 'kimi',
    label: 'Kimi',
    keyPlaceholder: 'sk-...',
  },
  {
    id: 'glm',
    label: 'GLM',
    keyPlaceholder: 'xxxxxxxx.xxxxxxxx',
  },
  {
    id: 'qwen',
    label: 'Qwen',
    keyPlaceholder: 'sk-...',
  },
  {
    id: 'doubao',
    label: 'Doubao',
    keyPlaceholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
  },
  {
    id: 'mimo',
    label: 'MiMo',
    keyPlaceholder: 'sk-...',
  },
  {
    id: 'hunyuan',
    label: 'Hunyuan',
    keyPlaceholder: 'sk-...',
  },
  {
    id: 'ling',
    label: 'Ling',
    keyPlaceholder: 'API Key',
  },
  {
    id: 'spark',
    label: 'Spark',
    keyPlaceholder: 'ak-...',
  },
  {
    id: 'longcat',
    label: 'LongCat',
    keyPlaceholder: 'API Key',
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    keyPlaceholder: 'eyJ...',
  },
  {
    id: 'xai',
    label: 'Grok',
    keyPlaceholder: 'xai-...',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    keyPlaceholder: 'API Key',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    keyPlaceholder: 'sk-or-...',
  },
  {
    id: 'requesty',
    label: 'Requesty',
    keyPlaceholder: 'sk-...',
  },
  {
    id: 'agnes',
    label: 'Agnes AI（爱思）',
    keyPlaceholder: 'agnes-ai.cn 控制台生成的 API Key',
  },
  {
    id: 'opper',
    label: 'Opper',
    keyPlaceholder: 'API Key',
  },
  {
    id: 'cheaperinference',
    label: 'Cheaper Inference',
    keyPlaceholder: 'ci_live_...',
  },
  {
    id: 'atlascloud',
    label: 'Atlas Cloud',
    keyPlaceholder: 'apikey-...',
  },
  {
    id: 'runcrate',
    label: 'Runcrate',
    // Lab-namespaced ids exactly as GET api.runcrate.ai/v1/models lists them;
    // the catalog works as-is when typed in. Chat, streaming and tool calls
    // are live-verified; the text-only ids (Qwen3.8 Flash, gpt-oss 120B) are
    // covered by modelLacksVision().
    keyPlaceholder: 'rc_live_...',
  },
  {
    id: 'cloudgpu',
    label: 'CloudGPU',
    // LOCAL: static models/defaultModel stripped per live-discovery (R35 Kimi /
    // R36 Runcrate precedent; catalog arrives via /v1/models). Upstream lists
    // deepseek-v4.1-flash/deepseek-v4-pro/glm-5.3-flash/kimi-k2.6/minimax-m3
    // (https://cloudgpu.app/api/docs); vision follows modelLacksVision().
    keyPlaceholder: 'sk-...',
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow',
    // Lab-namespaced ids exactly as the pricing page and GET
    // api.siliconflow.cn/v1/models (type=text&sub_type=chat) list them
    // (2026-11-02); the rest of the catalog works as-is when typed in, and a
    // Pro/<id> prefix selects the accelerated serving. OpenAI-compatible
    // /chat/completions; docs: https://api-docs.siliconflow.cn. The CN and
    // global platforms (api.siliconflow.com) do not share keys or base URLs.
    keyPlaceholder: 'sk-...',
  },
  {
    id: 'ppio',
    label: 'PPIO',
    // Lowercase lab-namespaced ids exactly as GET <base>/models lists them for
    // the OpenAI-compatible endpoint (2026-11-02); the rest of the catalog
    // works as-is when typed in. Docs: https://ppio.com/docs/model/llm — the
    // official SDK base_url is https://api.ppio.com/openai, so the chat
    // endpoint rides /openai/v1.
    keyPlaceholder: 'sk-...',
  },
  {
    id: 'opencode-zen',
    label: 'OpenCode Zen',
    keyPlaceholder: 'API Key',
  },
  {
    id: 'opencode-go',
    label: 'OpenCode Go',
    keyPlaceholder: 'API Key',
  },
  {
    id: 'commandcode',
    label: 'Command Code',
    // Coding-plan gateway (commandcode.ai/docs/provider): one key serves
    // OpenAI Chat Completions and Anthropic Messages at
    // api.commandcode.ai/provider/v1; every plan except the $1 Go tier has
    // API access (GOAT = $10/month). Vendor-prefixed ids exactly as the CLI
    // model reference lists them (2026-11-03); the rest of the catalog works
    // as-is when typed in. Claude ids answer only on /v1/messages, so they
    // ride the Anthropic route. GPT-5.4+/6 call tools only over the Responses
    // API, which this route does not take, so GPT and Grok stay out as on the
    // OpenCode tiers.
    keyPlaceholder: 'CMD API key',
  },
  {
    id: 'custom',
    label: 'Custom',
    keyPlaceholder: 'API Key',
    needsBaseUrl: true,
  },
]

/**
 * Fresh settings with an empty key and an empty model per provider (the model
 * comes from a live fetch in the settings page), except providers listed in
 * `defaultApiKeys` (e.g. an app-specific preconfigured Anthropic key). Callers
 * own that policy; this package has no hardcoded keys.
 */
export function defaultAiSettings(
  defaultApiKeys?: Partial<Record<AiProviderId, string>>,
): AiSettings {
  const providers = {} as AiSettings['providers']
  for (const meta of AI_PROVIDERS) {
    providers[meta.id] = {
      apiKey: defaultApiKeys?.[meta.id] ?? '',
      model: '',
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
  // Flash; every one of them, and the ChaAI Office pool spelling that was the
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
