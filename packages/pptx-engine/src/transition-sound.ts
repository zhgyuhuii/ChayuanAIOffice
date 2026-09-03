/**
 * Transition sounds (the Transitions tab 声音 dropdown) — WPS-style preset effects.
 *
 * Each preset is synthesized on demand (pure math, no asset files): a short mono
 * 44.1kHz 16-bit PCM wav is generated, embedded as a ppt/media part, and referenced
 * from <p:transition><p:sndAc><p:stSnd><p:snd r:embed name="preset.wav"/>. The same
 * synth backs the renderer's playback (bytes served over IPC), so what the editor
 * plays is byte-identical to what PowerPoint plays back from the saved file.
 */
import type { Slide } from './types'
import type { OpenedPptx } from './index'
import { buildTransitionSoundXml, patchSlideTransitionSoundXml } from './generate'
import { appendRels, ensureDefaultContentType, newMediaPart } from './media-insert'

/** Preset keys — also the p:snd name and the i18n key suffix (transSound*). */
export const TRANSITION_SOUND_KEYS = [
  'explosion',
  'typewriter',
  'chime',
  'applause',
  'brake',
  'whoosh',
  'coffee',
  'push',
  'hammer',
  'voltage',
] as const
export type TransitionSoundKey = (typeof TRANSITION_SOUND_KEYS)[number]

const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const AUDIO_REL_TYPE = `${R_NS}/audio`

const SR = 44100

/** Deterministic RNG so the synthesized bytes are stable across processes (tests, caches). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Float samples → mono 16-bit PCM wav container. */
function wavBytes(samples: Float32Array): Buffer {
  const data = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i]! * 32767))), i * 2)
  }
  const hdr = Buffer.alloc(44)
  hdr.write('RIFF', 0, 'ascii')
  hdr.writeUInt32LE(36 + data.length, 4)
  hdr.write('WAVEfmt ', 8, 'ascii')
  hdr.writeUInt32LE(16, 16) // fmt chunk size
  hdr.writeUInt16LE(1, 20) // PCM
  hdr.writeUInt16LE(1, 22) // mono
  hdr.writeUInt32LE(SR, 24)
  hdr.writeUInt32LE(SR * 2, 28) // byte rate
  hdr.writeUInt16LE(2, 32) // block align
  hdr.writeUInt16LE(16, 34) // bits
  hdr.writeUInt32LE(data.length, 40)
  return Buffer.concat([hdr, data])
}

/** One-pole lowpass applied in place-ish (returns new array); alpha∈(0,1], 1 = passthrough. */
function lowpass(x: Float32Array, alpha: number): Float32Array {
  const out = new Float32Array(x.length)
  let y = 0
  for (let i = 0; i < x.length; i++) {
    y += alpha * (x[i]! - y)
    out[i] = y
  }
  return out
}

function synthExplosion(): Float32Array {
  const n = Math.floor(SR * 1.0)
  const rnd = mulberry32(101)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const env = Math.exp(-3.2 * t)
    out[i] = (rnd() * 2 - 1) * env * 0.75
    out[i] += Math.sin(2 * Math.PI * (55 - 20 * t) * t) * Math.exp(-2.2 * t) * 0.5
  }
  return lowpass(out, 0.42)
}

function synthTypewriter(): Float32Array {
  const n = Math.floor(SR * 1.05)
  const out = new Float32Array(n)
  const rnd = mulberry32(202)
  const strike = (at: number) => {
    const i0 = Math.floor(at * SR)
    for (let i = i0; i < Math.min(n, i0 + Math.floor(0.05 * SR)); i++) {
      const t = (i - i0) / SR
      out[i]! += (rnd() * 2 - 1) * Math.exp(-260 * t) * 0.8
      out[i]! += Math.sin(2 * Math.PI * 1500 * t) * Math.exp(-180 * t) * 0.25
    }
  }
  for (let k = 0; k < 7; k++) strike(0.02 + k * 0.11)
  // carriage-return ding
  const d0 = Math.floor(0.85 * SR)
  for (let i = d0; i < n; i++) {
    const t = (i - d0) / SR
    out[i]! += Math.sin(2 * Math.PI * 2450 * t) * Math.exp(-6 * t) * 0.5
  }
  return out
}

function synthChime(): Float32Array {
  const n = Math.floor(SR * 1.3)
  const out = new Float32Array(n)
  const freqs = [1318.5, 1568, 2093]
  freqs.forEach((f, k) => {
    const i0 = Math.floor((0.02 + k * 0.16) * SR)
    for (let i = i0; i < n; i++) {
      const t = (i - i0) / SR
      out[i]! +=
        (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(2 * Math.PI * f * 2.01 * t)) *
        Math.exp(-2.6 * t) *
        0.4
    }
  })
  return out
}

function synthApplause(): Float32Array {
  const n = Math.floor(SR * 1.1)
  const out = new Float32Array(n)
  const rnd = mulberry32(404)
  for (let c = 0; c < 46; c++) {
    const at = rnd() * 0.9
    const amp = 0.25 + rnd() * 0.55
    const i0 = Math.floor(at * SR)
    for (let i = i0; i < Math.min(n, i0 + Math.floor(0.02 * SR)); i++) {
      const t = (i - i0) / SR
      out[i]! += (rnd() * 2 - 1) * Math.exp(-220 * t) * amp
    }
  }
  return lowpass(out, 0.8)
}

function synthBrake(): Float32Array {
  const n = Math.floor(SR * 0.9)
  const out = new Float32Array(n)
  const rnd = mulberry32(505)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const f = 2800 * Math.exp(-0.9 * t) + 900
    const vib = 1 + 0.012 * Math.sin(2 * Math.PI * 28 * t)
    const s = Math.sin(2 * Math.PI * f * vib * t)
    out[i] = s * Math.exp(-1.6 * t) * 0.5 + (rnd() * 2 - 1) * Math.exp(-2.5 * t) * 0.12
  }
  return out
}

function synthWhoosh(): Float32Array {
  const n = Math.floor(SR * 0.6)
  const rnd = mulberry32(606)
  const raw = new Float32Array(n)
  for (let i = 0; i < n; i++) raw[i] = rnd() * 2 - 1
  const out = new Float32Array(n)
  let y = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const alpha = 0.06 + 0.4 * Math.sin((Math.PI * t) / 0.6)
    y += alpha * (raw[i]! - y)
    out[i] = y * Math.sin((Math.PI * t) / 0.6) * 1.1
  }
  return out
}

function synthCoffee(): Float32Array {
  const n = Math.floor(SR * 0.95)
  const out = new Float32Array(n)
  const rnd = mulberry32(707)
  for (let b = 0; b < 11; b++) {
    const at = 0.03 + b * 0.075 + rnd() * 0.02
    const f = 280 + b * 65
    const i0 = Math.floor(at * SR)
    for (let i = i0; i < Math.min(n, i0 + Math.floor(0.045 * SR)); i++) {
      const t = (i - i0) / SR
      out[i]! += Math.sin(2 * Math.PI * f * (1 + 3 * t) * t) * Math.exp(-90 * t) * 0.6
    }
  }
  return out
}

function synthPush(): Float32Array {
  const n = Math.floor(SR * 0.35)
  const out = new Float32Array(n)
  const rnd = mulberry32(808)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const f = 130 * Math.exp(-4 * t) + 55
    out[i] = Math.sin(2 * Math.PI * f * t) * Math.exp(-9 * t) * 0.9
    if (t < 0.004) out[i] += (rnd() * 2 - 1) * 0.3
  }
  return out
}

function synthHammer(): Float32Array {
  const n = Math.floor(SR * 0.4)
  const out = new Float32Array(n)
  const rnd = mulberry32(909)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    out[i] = Math.sin(2 * Math.PI * (95 - 25 * t) * t) * Math.exp(-11 * t) * 0.9
    if (t < 0.003) out[i] += (rnd() * 2 - 1) * 0.5
  }
  return out
}

function synthVoltage(): Float32Array {
  const n = Math.floor(SR * 0.5)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const f = 150 + 3850 * Math.exp(-6.5 * t)
    const ph = 2 * Math.PI * (f * t)
    const saw = 2 * (ph / (2 * Math.PI) - Math.floor(ph / (2 * Math.PI) + 0.5))
    out[i] = saw * Math.exp(-2 * t) * 0.55
  }
  return lowpass(out, 0.9)
}

const SYNTHS: Record<TransitionSoundKey, () => Float32Array> = {
  explosion: synthExplosion,
  typewriter: synthTypewriter,
  chime: synthChime,
  applause: synthApplause,
  brake: synthBrake,
  whoosh: synthWhoosh,
  coffee: synthCoffee,
  push: synthPush,
  hammer: synthHammer,
  voltage: synthVoltage,
}

const cache = new Map<TransitionSoundKey, Buffer>()

/** Synthesize a preset's wav bytes (memoized). */
export function synthTransitionSound(key: TransitionSoundKey): Buffer {
  const hit = cache.get(key)
  if (hit) return hit
  const bytes = wavBytes(SYNTHS[key]())
  cache.set(key, bytes)
  return bytes
}

/**
 * Set/clear the slide's transition sound: embeds the synthesized wav as a media
 * part + slide relationship and rewrites the <p:sndAc> block (keeping the effect
 * and advTm untouched). name=null clears the sound. Returns false on an unknown
 * preset key (no changes made).
 */
export function setSlideTransitionSound(
  opened: OpenedPptx,
  slide: Slide,
  name: TransitionSoundKey | null,
  loop: boolean,
): boolean {
  if (name != null && !TRANSITION_SOUND_KEYS.includes(name)) return false
  if (name == null) {
    slide.bodySuffix = patchSlideTransitionSoundXml(slide.bodySuffix, null)
    slide.structureDirty = true
    return true
  }
  const bytes = synthTransitionSound(name)
  const mediaPath = newMediaPart(opened, 'media', 'wav', bytes)
  ensureDefaultContentType(opened, 'wav', 'audio/wav')
  const [rId] = appendRels(opened, slide, [
    { type: AUDIO_REL_TYPE, target: `../media/${mediaPath.split('/').pop()}` },
  ])
  slide.bodySuffix = patchSlideTransitionSoundXml(
    slide.bodySuffix,
    buildTransitionSoundXml(name, rId!, loop),
  )
  slide.structureDirty = true
  return true
}
