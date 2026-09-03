/**
 * Transitions-tab extras: 速度 (p14:dur), 效果选项 (dir/split/zoom/thruBlk),
 * 声音 (sndAc + synthesized wav embedding). WPS 切换 tab parity.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  getSlideTransitionSound,
  getSlideTransitionSpec,
  openPptx,
  patchSlideTransitionXml,
  readSlideTransitionSpecXml,
  readSlideTransitionSoundXml,
  patchSlideTransitionSoundXml,
  buildTransitionSoundXml,
  setSlideTransition,
  setSlideTransitionSound,
  synthTransitionSound,
  TRANSITION_SOUND_KEYS,
} from '../src/index'

const here = dirname(fileURLToPath(import.meta.url))
const fx = (name: string) => readFileSync(join(here, 'fixtures', name))

describe('transition 速度 (durationMs → p14:dur + spd fallback)', () => {
  it('writes an AlternateContent pair with p14:dur and a legacy spd', () => {
    const out = patchSlideTransitionXml('<p:sld><p:cSld><p:spTree/></p:cSld></p:sld>', 'fade', {
      durationMs: 700,
    })
    expect(out).toContain('mc:AlternateContent')
    expect(out).toContain('p14:dur="700"')
    expect(out).toContain('spd="med"')
    expect(out.match(/<p:fade\/>/g)?.length).toBe(2) // Choice + Fallback both carry the effect
  })

  it('buckets durations into the legacy spd (WPS 00.50-style speeds)', () => {
    const fast = patchSlideTransitionXml('<p:sld><p:cSld><p:spTree/></p:cSld></p:sld>', 'push', {
      durationMs: 400,
    })
    expect(fast).toContain('spd="fast"')
    const slow = patchSlideTransitionXml('<p:sld><p:cSld><p:spTree/></p:cSld></p:sld>', 'push', {
      durationMs: 1500,
    })
    expect(slow).toContain('spd="slow"')
  })

  it('keeps the plain form without an explicit duration', () => {
    const out = patchSlideTransitionXml('<p:sld><p:cSld><p:spTree/></p:cSld></p:sld>', 'fade')
    expect(out).not.toContain('mc:AlternateContent')
    expect(out).toContain('<p:fade/>')
  })

  it('round-trips durationMs through the spec read', () => {
    let body = '<p:sld><p:cSld><p:spTree/></p:cSld></p:sld>'
    body = patchSlideTransitionXml(body, 'fade', { durationMs: 1250 })
    expect(readSlideTransitionSpecXml(body)).toEqual({ kind: 'fade', durationMs: 1250 })
    // no explicit duration → null (kernel default), not a fabricated number
    body = patchSlideTransitionXml(body, 'fade')
    expect(readSlideTransitionSpecXml(body)).toEqual({ kind: 'fade', durationMs: null })
  })

  it('honors a custom morph duration in both AC branches', () => {
    const out = patchSlideTransitionXml('<p:sld><p:cSld><p:spTree/></p:cSld></p:sld>', 'morph', {
      durationMs: 400,
    })
    expect(out.match(/p14:dur="400"/g)?.length).toBe(1)
    expect(out.match(/spd="fast"/g)?.length).toBe(2)
    expect(readSlideTransitionSpecXml(out)).toEqual({ kind: 'morph', durationMs: 400 })
  })
})

describe('transition 效果选项 (dir/split/zoom/thruBlk)', () => {
  const base = '<p:sld><p:cSld><p:spTree/></p:cSld></p:sld>'

  it('writes 8-way directions for cover/pull and 4-way for push/wipe', () => {
    expect(patchSlideTransitionXml(base, 'cover', { dir: 'rd' })).toContain('<p:cover dir="rd"/>')
    expect(patchSlideTransitionXml(base, 'pull', { dir: 'lu' })).toContain('<p:pull dir="lu"/>')
    expect(patchSlideTransitionXml(base, 'push', { dir: 'r' })).toContain('<p:push dir="r"/>')
    expect(patchSlideTransitionXml(base, 'wipe', { dir: 'u' })).toContain('<p:wipe dir="u"/>')
  })

  it('rejects diagonal directions on the 4-way kernels (schema-safe no-op)', () => {
    expect(patchSlideTransitionXml(base, 'push', { dir: 'ru' })).toContain('<p:push dir="u"/>')
  })

  it('writes split orient×dir and zoom in/out variants', () => {
    expect(patchSlideTransitionXml(base, 'split', { split: 'vertIn' })).toContain(
      '<p:split orient="vert" dir="in"/>',
    )
    expect(patchSlideTransitionXml(base, 'zoom', { zoom: 'out' })).toContain('<p:zoom dir="out"/>')
    expect(patchSlideTransitionXml(base, 'fade', { fadeBlack: true })).toContain(
      '<p:fade thruBlk="1"/>',
    )
  })

  it('round-trips every option field through the spec read', () => {
    let body = patchSlideTransitionXml(base, 'cover', { dir: 'ld', durationMs: 900 })
    expect(readSlideTransitionSpecXml(body)).toEqual({ kind: 'cover', durationMs: 900, dir: 'ld' })
    body = patchSlideTransitionXml(base, 'split', { split: 'horzIn' })
    expect(readSlideTransitionSpecXml(body).split).toBe('horzIn')
    body = patchSlideTransitionXml(base, 'zoom', { zoom: 'in' })
    expect(readSlideTransitionSpecXml(body).zoom).toBe('in')
    body = patchSlideTransitionXml(base, 'fade', { fadeBlack: true })
    expect(readSlideTransitionSpecXml(body).fadeBlack).toBe(true)
  })

  it('switching effects keeps advTm and the configured sound', () => {
    let body = patchSlideTransitionXml(base, 'fade')
    body = patchSlideTransitionSoundXml(body, buildTransitionSoundXml('chime', 'rId9', true))
    body = body.replace('<p:transition>', '<p:transition advTm="5000">')
    const next = patchSlideTransitionXml(body, 'push', { durationMs: 600 })
    expect(next).toContain('advTm="5000"')
    expect(next).toContain('name="chime.wav"')
    expect(next).toContain('loop="1"')
    const snd = readSlideTransitionSoundXml(next)
    expect(snd).toEqual({ name: 'chime', loop: true })
  })

  it('无切换 removes the effect together with its sound, but keeps advTm', () => {
    let body = patchSlideTransitionXml(base, 'fade')
    body = patchSlideTransitionSoundXml(body, buildTransitionSoundXml('push', 'rId2', false))
    body = patchSlideTransitionXml(body, 'none')
    expect(body).not.toContain('p:sndAc')
    expect(body).not.toContain('<p:fade/>')
    expect(body).toBe(base)
    body = patchSlideTransitionXml(base, 'fade')
    body = body.replace('<p:transition>', '<p:transition advTm="3000">')
    const cleared = patchSlideTransitionXml(body, 'none')
    expect(cleared).toContain('advTm="3000"')
    expect(cleared).not.toContain('<p:fade/>')
  })
})

describe('transition 声音 (preset synth + embed)', () => {
  it('synthesizes deterministic wav bytes for every preset', () => {
    for (const key of TRANSITION_SOUND_KEYS) {
      const a = synthTransitionSound(key)
      const b = synthTransitionSound(key)
      expect(a.length).toBeGreaterThan(1000)
      expect(a.equals(b)).toBe(true) // memoized bytes are stable
      expect(a.subarray(0, 4).toString('ascii')).toBe('RIFF')
      expect(a.toString('ascii', 8, 12)).toBe('WAVE')
    }
  })

  it('embeds the wav part + rel and writes sndAc into every transition branch', async () => {
    const opened = await openPptx(fx('01_standard_business.pptx'))
    const slide = opened.deck.slides[0]!
    setSlideTransition(slide, 'fade', { durationMs: 800 })
    expect(setSlideTransitionSound(opened, slide, 'applause', false)).toBe(true)
    expect(slide.bodySuffix).toContain('name="applause.wav"')
    expect(slide.bodySuffix).not.toContain('loop="1"')
    // both Choice and Fallback carry the sndAc
    expect(slide.bodySuffix.match(/<p:sndAc>/g)?.length).toBe(2)
    // media part landed in the archive + a slide rel points at it
    const mediaNames = [...opened.archive.entries.keys()].filter((k) =>
      k.startsWith('ppt/media/media'),
    )
    expect(mediaNames.length).toBeGreaterThanOrEqual(1)
    const rels = opened.archive.readText(slide.path.replace(/([^/]+)$/, '_rels/$1') + '.rels') ?? ''
    expect(rels).toContain('/audio"')
    // read-back
    expect(getSlideTransitionSound(slide)).toEqual({ name: 'applause', loop: false })
    expect(getSlideTransitionSpec(slide)).toEqual({ kind: 'fade', durationMs: 800 })

    // loop toggle rewrites the block; clear removes it everywhere
    expect(setSlideTransitionSound(opened, slide, 'applause', true)).toBe(true)
    expect(getSlideTransitionSound(slide)).toEqual({ name: 'applause', loop: true })
    expect(setSlideTransitionSound(opened, slide, null, false)).toBe(true)
    expect(getSlideTransitionSound(slide)).toBeNull()
    expect(slide.bodySuffix).not.toContain('p:sndAc')
    expect(setSlideTransitionSound(opened, slide, 'nope' as 'chime', false)).toBe(false)
  })

  it('adds a bare transition host when sound is set with no effect', async () => {
    const opened = await openPptx(fx('01_standard_business.pptx'))
    const slide = opened.deck.slides[0]!
    setSlideTransitionSound(opened, slide, 'voltage', false)
    expect(slide.bodySuffix).toContain('<p:transition><p:sndAc>')
  })
})
