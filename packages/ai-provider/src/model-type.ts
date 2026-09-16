/**
 * Model type inference — harvested from chatop's desktop/models/model-type.js.
 * Infers chat / embedding / image-generation / video-generation / tts / asr /
 * vision / audio-understanding from a model id; the check order is the priority.
 * Labels are the UI's concern (packages/ui); this module stays i18n-free.
 */

export type AiModelType =
  | 'chat'
  | 'vision'
  | 'embedding'
  | 'image-generation'
  | 'video-generation'
  | 'tts'
  | 'asr'
  | 'audio-understanding'
  | 'video-understanding'

const EMBEDDING = [
  /^text-embedding-/i,
  /embedding/i,
  /^embed-/i,
  /-embed$/i,
  /bge-|e5-|multilingual-e5/i,
  /jina-embeddings|voyage-|gte-|m3e-/i,
]
const IMAGE_GEN = [
  /^gpt-image/i,
  /dall-e/i,
  /stable-diffusion/i,
  /sdxl|flux|midjourney/i,
  /(^|[-_])(image|img)([-_]|$)/i,
  /image-generation|text-to-image|txt2img|t2i/i,
  /imagen|kandinsky|qwen-image|wanx.*t2i|ideogram|recraft/i,
  /cogview|seedream|grok-imagine/i,
]
const VIDEO_GEN = [
  /video-generation|text-to-video|txt2video|t2v/i,
  /(^|[-_])video([-_]|$)/i,
  /runway|sora|veo|kling|hailuo-video|pika|vidu/i,
  /wanx.*t2v/i,
]
const TTS = [
  /(^|[-_])tts($|[-_])/i,
  /text-to-speech/i,
  /voice|vits|cosyvoice|bark/i,
  /speech(-|_)?synthesis/i,
]
const ASR = [/(^|[-_])asr($|[-_])/i, /whisper/i, /speech-to-text/i, /transcri/i]
const AUDIO_U = [/audio-understanding/i, /audio-analysis/i, /audio-qa/i]
const VISION = [/vision/i, /qwen-vl|internvl|minicpm-v/i]
const VIDEO_U = [/video-understanding/i, /video-analysis/i]

const matches = (id: string, patterns: RegExp[]): boolean => patterns.some((p) => p.test(id))

/** Infer the type from a model id; anything unmatched counts as a chat model. */
export function inferModelType(modelId: string): AiModelType {
  const id = String(modelId || '')
  if (matches(id, EMBEDDING)) return 'embedding'
  if (matches(id, VIDEO_U)) return 'video-understanding'
  if (matches(id, ASR)) return 'asr'
  if (matches(id, AUDIO_U)) return 'audio-understanding'
  if (matches(id, VISION)) return 'vision'
  if (matches(id, IMAGE_GEN)) return 'image-generation'
  if (matches(id, VIDEO_GEN)) return 'video-generation'
  if (matches(id, TTS)) return 'tts'
  return 'chat'
}

const TYPE_ALIASES: Record<string, string[]> = {
  image: ['image', 'image-generation'],
  'image-generation': ['image-generation', 'image'],
  video: ['video', 'video-generation'],
  'video-generation': ['video-generation', 'video'],
  voice: ['voice', 'tts'],
  tts: ['tts', 'voice'],
}

/** Type match considering the image/video/voice alias pairs. */
export function matchesModelType(actual: string, expected: string): boolean {
  const a = TYPE_ALIASES[actual] ?? [actual]
  const e = TYPE_ALIASES[expected] ?? [expected]
  return a.some((x) => e.includes(x))
}

/** Group display order: chat first, the rest by magnitude. */
export const TYPE_ORDER: AiModelType[] = [
  'chat',
  'vision',
  'embedding',
  'image-generation',
  'video-generation',
  'tts',
  'asr',
  'audio-understanding',
  'video-understanding',
]

export interface TypedModelEntry {
  id: string
  name?: string
  type: AiModelType
  enabled?: boolean
}

/** Group a model list by inferred type, keeping TYPE_ORDER for display. */
export function groupByType<T extends { id: string; name?: string; type?: string }>(
  models: T[],
): Array<{ type: AiModelType; models: Array<T & { type: AiModelType }> }> {
  const buckets = new Map<AiModelType, Array<T & { type: AiModelType }>>()
  for (const m of models) {
    const type = inferModelType(m.id)
    if (!buckets.has(type)) buckets.set(type, [])
    buckets.get(type)!.push({ ...m, type })
  }
  return TYPE_ORDER.filter((t) => buckets.has(t)).map((type) => ({ type, models: buckets.get(type)! }))
}
