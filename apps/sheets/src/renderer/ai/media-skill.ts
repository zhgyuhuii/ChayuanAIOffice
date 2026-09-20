import { createMediaSkill, type AgentSkill, type MediaSkillBridge } from '@chatoffice/agent-core'

/**
 * This app's media-model skill: generate_video / analyze_media /
 * transcribe_audio / generate_speech (generate_image ships in the app's own
 * tools, wired to its insertion flow). Pure adapter — the shared factory in
 * agent-core owns the tool schemas, gating and execution; the bridge maps to
 * the unified ai:media-* channels registered by the main process.
 */

interface MediaWire {
  mediaCapabilities(): Promise<{ flags?: Record<string, boolean>; models?: Record<string, string> }>
  mediaImage(op: {
    prompt: string
    aspectRatio?: string
  }): Promise<{ url?: string; model?: string; error?: string }>
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
}

const wireRaw = (window as unknown as { desktopApi?: MediaWire }).desktopApi
if (!wireRaw) throw new Error('media bridge unavailable')
const wire: MediaWire = wireRaw

export function createSheetsMediaSkill(): AgentSkill {
  const bridge: MediaSkillBridge = {
    capabilities: async () => {
      const r = await wire.mediaCapabilities()
      const f = r.flags ?? {}
      return {
        image: !!f.image,
        video: !!f.video,
        imageUnderstanding: !!f.imageUnderstanding,
        videoUnderstanding: !!f.videoUnderstanding,
        tts: !!f.tts,
        asr: !!f.asr,
      }
    },
    generateImage: (op) => wire.mediaImage(op),
    generateVideo: (op) => wire.mediaVideo(op),
    understandMedia: (op) => wire.mediaUnderstand(op),
    transcribeAudio: (op) => wire.mediaAsr(op),
    generateSpeech: (op) => wire.mediaTts(op),
    placement: {
      image: 'Place it with propose_operations {op:"add_image", sheetId, path:<url>, anchorCell}.',
      video: 'Spreadsheets cannot embed video files — report the saved file path to the user.',
      speech: 'Spreadsheets cannot embed audio files — report the saved file path to the user.',
      analysis: '',
      transcript:
        'Act on the transcript per the user request (answer in chat or write into cells).',
    },
    skip: ['generate_image'],
  }
  return createMediaSkill(bridge)
}
