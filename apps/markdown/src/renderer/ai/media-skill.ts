import { createMediaSkill, type AgentSkill, type MediaSkillBridge } from '@chatoffice/agent-core'

/**
 * This app's media-model skill: generate_video / analyze_media /
 * transcribe_audio / generate_speech (generate_image ships in the app's own
 * tools, wired to its insertion flow). Pure adapter — the shared factory in
 * agent-core owns the tool schemas, gating and execution; the bridge maps to
 * the unified ai:media-* channels registered by the main process.
 * Every bridge method degrades honestly ({error:'unavailable'}) when the
 * preload bridge is absent (tests / older shells).
 */

interface MediaWire {
  mediaCapabilities(): Promise<{
    flags?: Record<string, boolean>
    models?: Record<string, string>
    notes?: Record<string, string | undefined>
  }>
  mediaImage(op: {
    prompt: string
    aspectRatio?: string
  }): Promise<{
    url?: string
    model?: string
    error?: string
    attempts?: Array<{ model: string; error: string; notes?: string }>
  }>
  mediaVideo(op: {
    prompt: string
    aspectRatio?: string
    durationSeconds?: number
  }): Promise<{ url?: string; filePath?: string; model?: string; error?: string }>
  mediaUnderstand(op: {
    kind: 'image' | 'video' | 'auto'
    sources: string[]
    requirements: string
  }): Promise<{ text?: string; error?: string }>
  mediaAsr(op: { source: string; language?: string }): Promise<{ text?: string; error?: string }>
  mediaTts(op: {
    text: string
    voice?: string
  }): Promise<{ url?: string; mime?: string; error?: string }>
  imageSearch?: (
    query: string,
    maxResults?: number,
  ) => Promise<{
    images: Array<{ imageUrl: string }>
    method: string
    error?: string
  }>
}

const wire: MediaWire | undefined = (window as unknown as Record<string, MediaWire | undefined>)
  .markdownApi
let notesCache: Record<string, string | undefined> = {}
const unavailable = <T>(what: string): Promise<T> =>
  Promise.reject(new Error(`${what} is unavailable`))

export function createMarkdownMediaSkill(): AgentSkill {
  const flagsOff = {
    image: false,
    video: false,
    imageUnderstanding: false,
    videoUnderstanding: false,
    tts: false,
    asr: false,
  }
  const bridge: MediaSkillBridge = {
    modelNotes: async () => notesCache,
    capabilities: async () => {
      if (!wire) return flagsOff
      try {
        const r = await wire.mediaCapabilities()
        const f = r.flags ?? {}
        notesCache = r.notes ?? {}
        return {
          image: !!f.image,
          video: !!f.video,
          imageUnderstanding: !!f.imageUnderstanding,
          videoUnderstanding: !!f.videoUnderstanding,
          tts: !!f.tts,
          asr: !!f.asr,
        }
      } catch {
        return flagsOff
      }
    },
    generateImage: (op) => (wire ? wire.mediaImage(op) : unavailable('image generation')),
    generateVideo: (op) => (wire ? wire.mediaVideo(op) : unavailable('video generation')),
    understandMedia: (op) => (wire ? wire.mediaUnderstand(op) : unavailable('media analysis')),
    transcribeAudio: (op) => (wire ? wire.mediaAsr(op) : unavailable('transcription')),
    generateSpeech: (op) => (wire ? wire.mediaTts(op) : unavailable('speech synthesis')),
    ...(wire?.imageSearch
      ? {
          searchImages: async (query: string, max: number) => {
            const r = await wire.imageSearch!(query, max)
            return r.method === 'error' ? [] : r.images
          },
        }
      : {}),
    hasGenerateSvg: true,
    placement: {
      image: 'Insert it into the document with insert_image (url).',
      video:
        'Markdown documents cannot embed video files — report the saved file path to the user.',
      speech:
        'Markdown documents cannot embed audio files — report the saved file path to the user.',
      analysis: '',
      transcript:
        'Act on the transcript per the user request (summarize in chat, or insert into the document).',
    },
    skip: ['generate_image'],
  }
  return createMediaSkill(bridge)
}
