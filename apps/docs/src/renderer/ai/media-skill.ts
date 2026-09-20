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

const wire = (window as unknown as Record<string, MediaWire>).desktop

export function createDocsMediaSkill(): AgentSkill {
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
      image: 'Insert it into the document with insert_image (url).',
      video:
        'Word documents cannot embed video files — report the saved file path to the user instead of inserting.',
      speech: 'Word documents cannot embed audio files — report the saved file path to the user.',
      analysis: '',
      transcript:
        'Act on the transcript per the user request (summarize in chat, or insert with insert_content / write_document).',
    },
    skip: ['generate_image'],
  }
  return createMediaSkill(bridge)
}
