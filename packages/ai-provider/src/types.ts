import type { AgentMessage, AgentToolCall, AgentToolDef } from '@chaoffice/agent-core'
import type { AiModelType } from './model-type'

export type AiProviderId =
  | 'chaoffice'
  | 'codex'
  | 'anthropic'
  | 'gemini'
  | 'deepseek'
  | 'openai'
  | 'kimi'
  | 'glm'
  | 'qwen'
  | 'doubao'
  | 'mimo'
  | 'hunyuan'
  | 'ling'
  | 'spark'
  | 'longcat'
  | 'minimax'
  | 'xai'
  | 'mistral'
  | 'openrouter'
  | 'requesty'
  | 'agnes'
  | 'opper'
  | 'cheaperinference'
  | 'atlascloud'
  | 'opencode-zen'
  | 'opencode-go'
  | 'custom'

// ---- settings v2: multi-profile, multi-model, user-chosen wire protocol ----

/**
 * Wire protocol ids as the user picks them in the settings UI, aligned with
 * chatop/dsh llm-pi-ai `api` naming so profiles round-trip losslessly.
 */
export type AiWireProtocol =
  'anthropic-messages' | 'openai-completions' | 'openai-responses' | 'gemini-native'

export interface AiModelEntry {
  id: string
  /** display alias when it differs from the id */
  name?: string
  /** inferred model type (chat/vision/image-generation/...); absent = infer from id */
  type?: AiModelType
  /** user-authored invocation notes (usage constraints/examples) surfaced to agents */
  notes?: string
  /** live marker on the synthetic chatop-local group: a harness instance is
   * currently running this model (picker renders a running badge) */
  running?: boolean
}

/** Which model a run uses: profile id + model id, never a secret. */
export interface AiModelSelection {
  profileId: string
  modelId: string
}

export interface AiProviderProfile {
  /** unique within the settings file; 'chaoffice' is the fixed login-backed profile */
  id: string
  /** link into the vendor catalog (defaults, logo, key console page); absent for ad-hoc custom profiles */
  vendorId?: string
  displayName: string
  protocol: AiWireProtocol
  baseUrl: string
  /** inline secret (desktop local file / docker server file); empty for chaoffice-login or ref-backed profiles */
  apiKey?: string
  /** backend-resolved credential ref (harness settings source writes refs, not secrets) */
  apiKeyRef?: string
  auth: 'api-key' | 'chaoffice-login'
  /** endpoint accepts an empty key (ollama-like local runtimes) */
  ollamaLike?: boolean
  enabled: boolean
  models: AiModelEntry[]
  updatedAt?: string
}

/** Where deck/document imagery comes from; 'auto' = model→web→svg chain. */
export type AiImageSource = 'auto' | 'web' | 'model' | 'local' | 'svg'

export interface AiSettingsV2 {
  version: 2
  profiles: AiProviderProfile[]
  /** office-side current model (the chat default), shared by all four apps; absent = none selected yet */
  currentModel?: AiModelSelection
  /** dedicated image-generation model; absent = first enabled image-gen model */
  imageModel?: AiModelSelection
  /** per-purpose default picks for the non-chat kinds (tts/asr/video/embedding); absent entry = auto */
  modelDefaults?: Record<string, AiModelSelection>
  /**
   * Per-turn output-token cap across all profiles (upstream f105f36; absent =
   * the per-vendor default). Clamped to [MIN,MAX]_MAX_OUTPUT_TOKENS on read.
   */
  maxOutputTokens?: number
  /** active web-search provider; absent = first keyless or keyed provider */
  webSearchProvider?: AiSearchProviderId
  /** active image-search provider; absent = first keyless or keyed provider */
  imageSearchProvider?: AiSearchProviderId
  /** API keys for search services (Serper / Tavily / Linkup) and SearxNG base URL */
  searchApiKeys?: {
    serper?: string
    tavily?: string
    linkup?: string
    searxngBaseUrl?: string
  }
  /** stock-photo library API keys for the insert-image dialog */
  stockApiKeys?: { pexels?: string; pixabay?: string; unsplash?: string; wikimedia?: string }
  /** deck/document imagery source default; per-run UI overrides write back here (last-use-wins) */
  imageSource?: AiImageSource
  /** media (generate_image / analyze_media) provider settings; nested v1 shape for tool compatibility */
  media?: AiMediaSettings
  /** web/image search backend settings; nested v1 shape for tool compatibility */
  search?: AiSearchSettings
}

/** a v2 stream request carries only the selection — the backend owning the settings resolves the secret */
export interface AiStreamRequestV2 {
  requestId: string
  selection: AiModelSelection
  system: string
  messages: AgentMessage[]
  tools?: AgentToolDef[]
  maxTokens?: number
  /** host-attached abort (IPC cancel / HTTP disconnect) */
  signal?: AbortSignal
}

/** ChaOffice account status (chaoffice login state; the sole auth source for AI features) */
export interface ChaOfficeAccountStatus {
  loggedIn: boolean
  email?: string
}

export interface AiProviderConfig {
  apiKey: string
  model: string
  /** required for custom; for other direct providers it overrides the default endpoint (regional mirrors) */
  baseUrl?: string | undefined
  /** optional Codex CLI override; empty means auto-detect the current authenticated install */
  cliPath?: string | undefined
  /** the declarative profile of the active user-hosted endpoint (custom only) */
  profile?: AiCustomProfile | undefined
}

/**
 * Wire protocols a user-hosted endpoint can speak. The three the package
 * already implements, so a self-hosted gateway that ships an Anthropic- or
 * Gemini-shaped route becomes reachable without any code change.
 */
export type AiCustomProtocol = 'openai-compatible' | 'anthropic' | 'gemini'

/**
 * Vendor quirks an endpoint can declare instead of leaving the built-in
 * model-name heuristics to guess. Absent means "fall through to the
 * heuristic", so an endpoint that says nothing behaves exactly as before.
 */
export interface AiCustomCompat {
  /** the endpoint 400s on a temperature field (fixed-sampling models behind a proxy) */
  omitTemperature?: boolean | undefined
  /** the endpoint wants `reasoning_content` echoed back on assistant tool turns */
  echoReasoning?: boolean | undefined
  /** false declares a text-only endpoint so screenshots are never sent to it */
  vision?: boolean | undefined
  /** send the output cap as `max_completion_tokens` (OpenAI renamed field) */
  useMaxCompletionTokens?: boolean | undefined
}

/**
 * One model declared by the user for their endpoint, so a vendor's newest
 * release — which no shipped heuristic knows yet — carries real facts instead
 * of a guess. Fields left unset fall through to the endpoint compat, then the
 * heuristics; `alias` maps the listed id to the spelling the wire expects.
 */
export interface AiCustomModelProfile {
  id: string
  /** the id to put on the wire when the endpoint spells this model differently */
  alias?: string | undefined
  /** display name for the picker (a vendor's marketing spelling of the id) */
  name?: string | undefined
  /** declared capabilities; absent = inherit the endpoint compat, then heuristics */
  vision?: boolean | undefined
  omitTemperature?: boolean | undefined
  echoReasoning?: boolean | undefined
  useMaxCompletionTokens?: boolean | undefined
  /** this model's per-turn output ceiling; a server 400s anything above it */
  maxTokens?: number | undefined
  /** the model's context window, when the endpoint publishes one */
  contextWindow?: number | undefined
}

/**
 * The declarative half of a custom endpoint. It mirrors into
 * `providers.custom.profile` so the protocol layer reads one config object,
 * and it is what makes a self-hosted or regional gateway fully describable
 * without touching code: protocol, headers, credential indirection, timeouts,
 * vendor switches, and a per-model capability list.
 */
export interface AiCustomProfile {
  /** wire protocol; absent means 'openai-compatible' (the pre-profile shape) */
  api?: AiCustomProtocol | undefined
  /**
   * Name of an environment variable the main process resolves to the key at
   * request time. Lets a settings file carry no secret, so it can be synced or
   * shared; an inline `apiKey` always wins.
   */
  apiKeyEnv?: string | undefined
  /** static request headers (tenant ids, gateway routing keys) */
  headers?: Record<string, string> | undefined
  /** stream idle budget for slow local servers (quantized models take minutes to first token) */
  idleTimeoutMs?: number | undefined
  /** endpoint-wide vendor switches, overridden per model by `modelProfiles` */
  compat?: AiCustomCompat | undefined
  /** vendor-specific fields merged into the request body (vLLM `chat_template_kwargs`, …) */
  bodyExtras?: Record<string, unknown> | undefined
  /** per-model declarations, matched to the configured id on request */
  modelProfiles?: AiCustomModelProfile[] | undefined
  /**
   * Capability facts the last `/models` probe observed, kept beside the id list
   * as a cache. They answer for a model the user has not declared — the whole
   * point, since a gateway knows things no shipped heuristic does — and they
   * are replaced wholesale by the next probe, so a model the server stops
   * serving stops being described. The user's `modelProfiles` always outrank
   * them.
   */
  probedProfiles?: AiCustomModelProfile[] | undefined
}

/** The profile fields, spread flat so a hand-edited settings file stays readable */
export interface AiCustomEndpoint extends AiCustomProfile {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
  /** ids the server advertised on the last `/models` probe, so the composer chip can list them offline */
  models?: string[] | undefined
}

/** Live picker data returned by Codex app-server's model/list method. */
export interface CodexModelCatalog {
  models: string[]
  defaultModel: string
  /**
   * Capability declarations derived from a custom endpoint's own `/models`
   * metadata (vision, output ceiling, context window). Absent for Codex and
   * for endpoints whose listing carries no such fields — the settings pane
   * folds them into the endpoint's model declarations on save.
   */
  profiles?: AiCustomModelProfile[] | undefined
}

export interface AiProviderMeta {
  id: AiProviderId
  label: string
  models: string[]
  defaultModel: string
  keyPlaceholder: string
  needsBaseUrl?: boolean
  needsCliPath?: boolean
}

/** Image generation / media analysis backends (separate from the chat provider) */
export type AiMediaProviderId =
  | 'chaoffice'
  | 'openai'
  | 'gemini'
  | 'doubao'
  | 'glm'
  | 'xai'
  | 'qwen'
  | 'minimax'
  | 'deepseek'
  | 'pollinations'
  | 'agnes'
  | 'huggingface'
  | 'custom'

/** wire shape of the image endpoint */
export type AiImageProtocol = 'openai-images' | 'gemini' | 'dashscope' | 'minimax' | 'pollinations'
/** wire shape of the understanding endpoint */
export type AiAnalysisProtocol = 'openai-chat' | 'gemini'

export interface AiMediaProviderConfig {
  apiKey: string
  /** required for custom; for the others it overrides the official endpoint (regional mirrors) */
  baseUrl?: string | undefined
  /** image generation model (empty = the provider default) */
  imageModel: string
  /** image/video understanding model (empty = the provider default) */
  analysisModel: string
}

export interface AiMediaProviderMeta {
  id: AiMediaProviderId
  label: string
  /** one-line English blurb shown on the provider card */
  description: string
  keyPlaceholder: string
  needsBaseUrl?: boolean
  /** the provider requires an API key to be usable; free/keyless providers set this to false */
  needsKey?: boolean
  /** '' for custom (user-supplied) and pollinations (keyless) */
  defaultBaseUrl: string
  /** absent = the provider does not generate images */
  imageProtocol?: AiImageProtocol
  imageModels: string[]
  defaultImageModel: string
  /** absent = the provider does not analyze media */
  analysisProtocol?: AiAnalysisProtocol
  analysisModels: string[]
  defaultAnalysisModel: string
  /** the analysis model accepts video input (Gemini natively; OpenAI-compatible vendors via a video_url part) */
  videoAnalysis: boolean
}

export interface AiMediaSettings {
  /** provider behind generate_image */
  imageProvider: AiMediaProviderId
  /** provider behind analyze_media for images */
  analysisProvider: AiMediaProviderId
  /** provider behind analyze_media when the input has video/audio (only video-capable vendors qualify) */
  videoAnalysisProvider: AiMediaProviderId
  providers: Record<AiMediaProviderId, AiMediaProviderConfig>
  /** pre-catalog shape (one provider for both); migrated by resolveAiMediaSettings */
  provider?: AiMediaProviderId | undefined
}

/** web/image search backends; Parallel supports both a user key and free keyless search */
export type AiSearchProviderId =
  | 'genspark'
  | 'serper'
  | 'serply'
  | 'tavily'
  | 'parallel'
  | 'exa'
  | 'firecrawl'
  | 'linkup'
  | 'searxng'
  | 'duckduckgo'
  | 'bing'
  | 'openverse'

export interface AiSearchProviderMeta {
  id: AiSearchProviderId
  label: string
  keyPlaceholder: string
  /** the backend can serve image search (otherwise it is web-search only) */
  imageSearch: boolean
  /** an API key / base URL is required to use this backend */
  needsKey: boolean
}

export interface AiSearchSettings {
  provider: AiSearchProviderId
  providers: Partial<
    Record<Exclude<AiSearchProviderId, 'duckduckgo' | 'bing' | 'openverse'>, { apiKey: string }>
  >
}

export interface AiSettings {
  /** media (generate_image / analyze_media) provider settings; absent = ChaOffice CLI behind the login gate */
  media?: AiMediaSettings | undefined
  /** web/image search backend settings; absent = CLI when signed in, then the free chain */
  search?: AiSearchSettings | undefined
  provider: AiProviderId
  providers: Record<AiProviderId, AiProviderConfig>
  /** every saved custom endpoint; absent on files written before the list existed */
  customEndpoints?: AiCustomEndpoint[] | undefined
  /** id of the endpoint `providers.custom` mirrors */
  customEndpoint?: string | undefined
  /**
   * Output-token cap for ONE model turn of agent runs (default
   * DEFAULT_MAX_OUTPUT_TOKENS). Reasoning models bill their thinking against
   * this same budget, so a heavy edit turn can consume all of it and close with
   * finish_reason=length and no prose at all — raising it is the user's lever
   * (absent = the default, so pre-existing settings files keep working).
   */
  maxOutputTokens?: number | undefined
}

/** pre-provider settings shape (single OpenAI-compatible endpoint); migrated into "custom" */
export interface LegacyAiSettings {
  baseUrl?: string
  apiKey?: string
  model?: string
}

export interface AiChatRequest {
  settings: AiSettings
  system: string
  user: string
}

export interface AiChatResponse {
  ok: boolean
  content?: string
  error?: string
}

export interface AiStreamRequest {
  requestId: string
  /** Stable renderer transport id used to retain native provider sessions. */
  sessionId?: string
  settings: AiSettings
  system: string
  messages: AgentMessage[]
  tools?: AgentToolDef[]
  maxTokens?: number
}

/** Token usage a provider reported for one model turn. Both fields are best-effort:
 * some providers (and the Genspark proxy) never report usage, and consumers must
 * treat an absent figure as "unknown", never as zero. */
export interface AiTokenUsage {
  inputTokens?: number
  outputTokens?: number
}

export interface AiStreamChunk {
  requestId: string
  /** 'ping' = wire-level keepalive so the renderer can tell a live stream from a dead one;
   * 'reasoning' = model thinking delta (text carries it), stored for interleaved-thinking echo */
  type: 'delta' | 'reasoning' | 'tool-call' | 'usage' | 'done' | 'error' | 'ping'
  text?: string
  /** complete parsed tool call (emitted once its arguments finish streaming) */
  toolCall?: AgentToolCall
  error?: string
  /** machine-readable error cause ('timeout', exhausted 'credits', 'network' connectivity failure, 'overloaded' capacity/rate limit); lets the renderer localize the message */
  errorCode?: 'timeout' | 'credits' | 'network' | 'overloaded'
  /** normalized stop reason carried on 'done' ('max_tokens' = output cut off by the token limit) */
  stopReason?: string
  /** tokens the provider billed for this turn, carried on 'usage' (always sent before 'done') */
  usage?: AiTokenUsage
}
