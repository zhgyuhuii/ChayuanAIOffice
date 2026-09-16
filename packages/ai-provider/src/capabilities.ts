import type { AiProtocol } from './registry'
import { inferModelType } from './model-type'

/**
 * Capability matrix — the single declarative source for "what can this
 * (vendor, protocol, model) triple actually do". The matrix exists because
 * model-id type inference alone cannot express the real gates:
 *
 * - FC (function calling) is a property the type system does not capture —
 *   legacy ids (`deepseek-r1*`, o1-preview/mini) return text only, so such a
 *   model silently "talks but never works" in an agent loop. The list is
 *   conservative and dated: DeepSeek's V4-era `deepseek-reasoner` alias DOES
 *   return tool_calls (verified against the live API 2026-09, both with and
 *   without the registry's thinking-disabled patch), so it is no longer
 *   listed — the loop's silent-turn probe remains the dynamic fallback if a
 *   vendor regresses.
 * - Multimodal input parts are protocol-gated: anthropic has no audio/video
 *   endpoints at all, openai-compatible video is per-vendor (dashscope
 *   `type:'video'` part lists, zhipu `video_url`, OpenAI itself: none).
 * - Media-generation channels are vendor-gated (only vendors wired to the
 *   MediaJobClient adapters can generate video/images).
 *
 * Everything here is declarative + regex; nothing probes the network. The
 * settings UI consumes reasons for disabled/hover states, the agent runtime
 * consumes `functionCalling` for the degraded JSON-text fallback.
 */

export interface ModelCapabilityQuery {
  vendorId: string
  protocol: AiProtocol
  modelId: string
}

export interface ModelCapabilities {
  /** the model can join a tool-calling agent loop as the operator */
  functionCalling: boolean
  /** chat/vision model accepts image input */
  vision: boolean
  /** audio attachments can be sent as native parts */
  audioInput: boolean
  /** video attachments can be sent as native parts */
  videoInput: boolean
  /** a media-generation channel is wired for this vendor+model */
  imageGeneration: boolean
  videoGeneration: boolean
}

export interface CapabilityVerdict {
  supported: boolean
  /** short English reason for UI hover/disabled states; present when unsupported */
  reason?: string
}

/** chatoffice's proxy normalizes its preset models behind stable endpoints */
const PROXY_GUARANTEED_VENDORS = new Set(['chatoffice'])

/**
 * Known no-FC models on their official APIs. Self-hosted engines (vLLM with a
 * tool parser) differ — a custom endpoint can override via the model id not
 * matching, which is why this list is conservative and exact.
 */
const NO_FUNCTION_CALLING: Array<{ test: RegExp; reason: string }> = [
  { test: /^deep-?seek-r1/i, reason: 'DeepSeek R1 does not support tool calls' },
  { test: /^o1-(preview|mini)$/i, reason: 'o1-preview/mini do not support tool calls' },
  {
    test: /-(base|instruct)$/i,
    reason: 'Base/completion-style models do not support tool calls',
  },
]

/**
 * Per-protocol audio/video input support. openai-compatible audio follows the
 * standard `input_audio` part; video has no cross-vendor standard, so it is
 * gated by the vendor adapter list below.
 */
function protocolMediaInput(protocol: AiProtocol): { audio: boolean; video: boolean | 'vendor' } {
  switch (protocol) {
    case 'gemini':
      return { audio: true, video: true }
    case 'anthropic':
      return { audio: false, video: false }
    case 'openai-compatible':
    case 'openai-responses':
      return { audio: true, video: 'vendor' }
    case 'codex-app-server':
      // coding-agent bridge: image parts only, no audio/video input
      return { audio: false, video: false }
  }
}

/**
 * Vendors whose openai-compatible dialect has a working video input part for
 * their vision models (dashscope qwen-vl `type:'video'` part lists, zhipu
 * `video_url`). OpenAI itself has none — the adapter list is the whitelist.
 */
const OPENAI_VIDEO_INPUT_VENDORS = new Set(['aliyun-bailian', 'zhipu'])

// qwen-vl spans generations (qwen2-vl / qwen3-vl); glm-4v and bare glm-4 cover Zhipu's VL line
const OPENAI_VIDEO_INPUT_MODELS = /qwen(?:\d+)?-vl|glm-4v|glm-4(?!\w)/i

/** vendors wired to imagegen / MediaJobClient video adapters */
export const IMAGE_GEN_VENDOR_IDS = new Set([
  'gemini',
  'openai',
  'aliyun-bailian',
  'recraft',
  'chatoffice',
])
/** Must stay in sync with the adapters registered in media-jobs.ts — a
 * vendor listed here without a wired adapter would promise what runMediaJob
 * then refuses ("No media-generation adapter"). */
export const VIDEO_GEN_VENDOR_IDS = new Set([
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
])

function fcVerdict(q: ModelCapabilityQuery): CapabilityVerdict {
  if (PROXY_GUARANTEED_VENDORS.has(q.vendorId)) return { supported: true }
  for (const { test, reason } of NO_FUNCTION_CALLING) {
    if (test.test(q.modelId)) return { supported: false, reason }
  }
  return { supported: true }
}

/** FC support with a UI-facing reason — the gate for operator-model selection. */
export function functionCallingVerdict(q: ModelCapabilityQuery): CapabilityVerdict {
  return fcVerdict(q)
}

export function resolveModelCapabilities(q: ModelCapabilityQuery): ModelCapabilities {
  const type = inferModelType(q.modelId)
  const isChatLike = type === 'chat' || type === 'vision'
  const media = protocolMediaInput(q.protocol)
  const fc = fcVerdict(q)

  const videoVendorOk =
    q.protocol === 'openai-compatible' || q.protocol === 'openai-responses'
      ? OPENAI_VIDEO_INPUT_VENDORS.has(q.vendorId) && OPENAI_VIDEO_INPUT_MODELS.test(q.modelId)
      : media.video === true

  return {
    functionCalling: isChatLike && fc.supported,
    vision: isChatLike && visionOk(q.modelId),
    audioInput: isChatLike && media.audio,
    videoInput: isChatLike && videoVendorOk,
    imageGeneration: type === 'image-generation' && IMAGE_GEN_VENDOR_IDS.has(q.vendorId),
    videoGeneration: type === 'video-generation' && VIDEO_GEN_VENDOR_IDS.has(q.vendorId),
  }
}

/** vendor-declared text-only models (e.g. DeepSeek V4 Pro/Flash) lose image input
 * even though the vendor advertises vision generally — mirrors registry.modelLacksVision */
function visionOk(modelId: string): boolean {
  return !/(^|\/)deep-?seek-v4-(?:pro(?:$|-)|flash(?!-vision))/.test(modelId)
}

/** Flat "why not" list for the settings UI; empty = fully usable in the role. */
export function capabilityBlockers(
  q: ModelCapabilityQuery,
  role: 'operator' | 'image' | 'video' | 'attachment-audio' | 'attachment-video',
): string[] {
  const caps = resolveModelCapabilities(q)
  const blockers: string[] = []
  switch (role) {
    case 'operator':
      if (!caps.functionCalling) blockers.push(fcVerdict(q).reason ?? 'tool calls unsupported')
      break
    case 'image':
      if (!caps.imageGeneration) blockers.push('no image-generation channel for this vendor')
      break
    case 'video':
      if (!caps.videoGeneration) blockers.push('no video-generation channel for this vendor')
      break
    case 'attachment-audio':
      if (!caps.audioInput) blockers.push('this model/protocol cannot accept audio attachments')
      break
    case 'attachment-video':
      if (!caps.videoInput) blockers.push('this model/protocol cannot accept video attachments')
      break
  }
  return blockers
}

/**
 * Per-vendor maximum output tokens for tool-driving turns. The runtime's
 * historical blanket 8192 fallback sits below several vendors' real caps and
 * truncates long tool arguments (generate_deck page briefs) mid-JSON. Only
 * vendors with verified higher caps are listed; everything else keeps 8192.
 * Values per official API references as of 2026-09; DeepSeek raised its cap
 * 4K -> 8K -> 64K across V3 -> V3.1+ (api-docs.deepseek.com).
 */
export const MAX_OUTPUT_TOKENS: Record<string, number> = {
  deepseek: 65536,
}

export function maxOutputTokensFor(vendorId: string | undefined, modelId: string): number {
  if (!vendorId) return 8192
  const cap = MAX_OUTPUT_TOKENS[vendorId]
  if (!cap) return 8192
  // DeepSeek raised the cap in the V3.1 era; older ids on the same vendor stay
  // at the conservative 8192 (the API still accepts them, but larger values
  // only ever pay off on models that actually write that much).
  if (vendorId === 'deepseek' && !/^deep-?seek-(chat|reasoner|v[3-9])/i.test(modelId)) return 8192
  return cap
}
