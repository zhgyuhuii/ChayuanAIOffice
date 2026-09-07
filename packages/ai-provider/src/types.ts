import type { AgentMessage, AgentToolCall, AgentToolDef } from '@chatoffice/agent-core'
import type { AiModelType } from './model-type'

export type AiProviderId =
  | 'chatoffice'
  | 'anthropic'
  | 'gemini'
  | 'deepseek'
  | 'openai'
  | 'kimi'
  | 'glm'
  | 'qwen'
  | 'doubao'
  | 'minimax'
  | 'xai'
  | 'mistral'
  | 'openrouter'
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
}

/** Which model a run uses: profile id + model id, never a secret. */
export interface AiModelSelection {
  profileId: string
  modelId: string
}

export interface AiProviderProfile {
  /** unique within the settings file; 'chatoffice' is the fixed login-backed profile */
  id: string
  /** link into the vendor catalog (defaults, logo, key console page); absent for ad-hoc custom profiles */
  vendorId?: string
  displayName: string
  protocol: AiWireProtocol
  baseUrl: string
  /** inline secret (desktop local file / docker server file); empty for chatoffice-login or ref-backed profiles */
  apiKey?: string
  /** backend-resolved credential ref (harness settings source writes refs, not secrets) */
  apiKeyRef?: string
  auth: 'api-key' | 'chatoffice-login'
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
  /** chatoffice cloud tools toggle (search backends); default on */
  chatofficeToolsEnabled?: boolean
  /**
   * Per-turn output-token cap across all profiles (upstream f105f36; absent =
   * the per-vendor default). Clamped to [MIN,MAX]_MAX_OUTPUT_TOKENS on read.
   */
  maxOutputTokens?: number
  /** stock-photo library API keys (Pexels/Pixabay) for the insert-image dialog */
  stockApiKeys?: { pexels?: string; pixabay?: string }
  /** web-search service API keys (Serper) — settings-first, env var as fallback */
  searchApiKeys?: { serper?: string }
  /** deck/document imagery source default; per-run UI overrides write back here (last-use-wins) */
  imageSource?: AiImageSource
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

/** ChatOffice account status (chatoffice login state; the sole auth source for AI features) */
export interface ChatOfficeAccountStatus {
  loggedIn: boolean
  email?: string
}

export interface AiProviderConfig {
  apiKey: string
  model: string
  /** required for custom; for other direct providers it overrides the default endpoint (regional mirrors) */
  baseUrl?: string | undefined
}

export interface AiProviderMeta {
  id: AiProviderId
  label: string
  models: string[]
  defaultModel: string
  keyPlaceholder: string
  needsBaseUrl?: boolean
}

export interface AiSettings {
  provider: AiProviderId
  providers: Record<AiProviderId, AiProviderConfig>
  /**
   * ChatOffice cloud tools (web/image search via chatoffice, image generation, media
   * analysis). Default true; false makes tools skip the chatoffice backend entirely
   * (search falls back to free sources, chatoffice-only tools are unavailable).
   * Only meaningful while signed in — signed out, the chatoffice backend is
   * unavailable regardless.
   */
  chatofficeToolsEnabled?: boolean
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
  settings: AiSettings
  system: string
  messages: AgentMessage[]
  tools?: AgentToolDef[]
  maxTokens?: number
}

export interface AiStreamChunk {
  requestId: string
  /** 'ping' = wire-level keepalive so the renderer can tell a live stream from a dead one;
   * 'reasoning' = model thinking delta (text carries it), stored for interleaved-thinking echo */
  type: 'delta' | 'reasoning' | 'tool-call' | 'done' | 'error' | 'ping'
  text?: string
  /** complete parsed tool call (emitted once its arguments finish streaming) */
  toolCall?: AgentToolCall
  error?: string
  /** machine-readable error cause ('timeout', exhausted 'credits', 'network' connectivity failure, 'overloaded' capacity/rate limit); lets the renderer localize the message */
  errorCode?: 'timeout' | 'credits' | 'network' | 'overloaded'
  /** normalized stop reason carried on 'done' ('max_tokens' = output cut off by the token limit) */
  stopReason?: string
}
