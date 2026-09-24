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
  getTransitionSoundBytes,
  setSlideTransitionCustomSound,
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
    body = patchSlideTransitionSoundXml(body, buildTransitionSoundXml('chime.wav', 'rId9', true))
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

describe('custom transition sound (其他声音…)', () => {
  it('embeds user bytes and serves them back via getTransitionSoundBytes', async () => {
    const opened = await openPptx(fx('01_standard_business.pptx'))
    const slide = opened.deck.slides[0]!
    setSlideTransition(slide, 'fade', {})
    const mp3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0]) // fake ID3 header
    expect(
      setSlideTransitionCustomSound(
        opened,
        slide,
        { name: 'clap.mp3', bytes: mp3, ext: 'mp3' },
        true,
      ),
    ).toBe(true)
    expect(slide.bodySuffix).toContain('name="clap.mp3"')
    expect(slide.bodySuffix).toContain('loop="1"')
    const served = getTransitionSoundBytes(opened, slide)
    expect(served?.name).toBe('clap.mp3')
    expect(Array.from(served!.bytes)).toEqual(Array.from(mp3))
    expect(
      setSlideTransitionCustomSound(
        opened,
        slide,
        { name: 'x.exe', bytes: mp3, ext: 'exe' },
        false,
      ),
    ).toBe(false)
  })

  it('preset embeds are also served from the media part', async () => {
    const opened = await openPptx(fx('01_standard_business.pptx'))
    const slide = opened.deck.slides[0]!
    setSlideTransitionSound(opened, slide, 'chime', false)
    const served = getTransitionSoundBytes(opened, slide)
    expect(served?.name).toBe('chime')
    expect(served!.bytes.length).toBe(synthTransitionSound('chime').length)
  })
})

describe('second-batch transition kernels', () => {
  const base = '<p:sld><p:cSld><p:spTree/></p:cSld></p:sld>'
  const KINDS = [
    ['blinds', '<p:blinds dir="u"/>'],
    ['checker', '<p:checker dir="u"/>'],
    ['comb', '<p:comb dir="horz"/>'],
    ['cut', '<p:cut/>'],
    ['diamond', '<p:diamond/>'],
    ['newsflash', '<p:newsflash/>'],
    ['plus', '<p:plus/>'],
    ['randomBar', '<p:randomBar dir="u"/>'],
    ['strips', '<p:strips dir="ld"/>'],
    ['wedge', '<p:wedge/>'],
    ['wheel', '<p:wheel spokes="4"/>'],
  ] as const

  it('writes each kernel element and round-trips through the spec read', () => {
    for (const [kind, xml] of KINDS) {
      const out = patchSlideTransitionXml(base, kind)
      expect(out).toContain(xml)
      const spec = readSlideTransitionSpecXml(out)
      expect(spec.kind).toBe(kind)
      expect(spec.durationMs).toBeNull()
    }
  })

  it('supports 4-way dirs on blinds/checker/randomBar and 8-way on strips', () => {
    expect(patchSlideTransitionXml(base, 'blinds', { dir: 'r' })).toContain('<p:blinds dir="r"/>')
    expect(patchSlideTransitionXml(base, 'checker', { dir: 'd' })).toContain('<p:checker dir="d"/>')
    expect(patchSlideTransitionXml(base, 'randomBar', { dir: 'l' })).toContain(
      '<p:randomBar dir="l"/>',
    )
    expect(patchSlideTransitionXml(base, 'strips', { dir: 'ru' })).toContain('<p:strips dir="ru"/>')
    expect(
      readSlideTransitionSpecXml(patchSlideTransitionXml(base, 'strips', { dir: 'ru' })).dir,
    ).toBe('ru')
  })
})

describe('spd → durationMs echo (A1-7)', () => {
  const base = '<p:sld><p:cSld><p:spTree/></p:cSld></p:sld>'
  it('infers legacy spd buckets when no p14:dur is present', () => {
    let body = patchSlideTransitionXml(base, 'fade').replace(
      '<p:transition>',
      '<p:transition spd="slow">',
    )
    expect(readSlideTransitionSpecXml(body).durationMs).toBe(1000)
    body = patchSlideTransitionXml(base, 'fade').replace(
      '<p:transition>',
      '<p:transition spd="fast">',
    )
    expect(readSlideTransitionSpecXml(body).durationMs).toBe(500)
    // explicit p14:dur still wins
    const explicit = patchSlideTransitionXml(base, 'fade', { durationMs: 1300 })
    expect(readSlideTransitionSpecXml(explicit).durationMs).toBe(1300)
  })
})

describe('p14 extension kernels (third batch)', () => {
  const base = '<p:sld><p:cSld><p:spTree/></p:cSld></p:sld>'
  const KINDS = [
    'ripple',
    'glitter',
    'vortex',
    'doors',
    'window',
    'honeycomb',
    'flash',
    'ferris',
    'gallery',
    'conveyor',
  ] as const

  it('writes AC-wrapped p14 kernels with a fade fallback and round-trips', () => {
    for (const kind of KINDS) {
      const out = patchSlideTransitionXml(base, kind, { durationMs: 900 })
      expect(out).toContain('Requires="p14"')
      expect(out).toContain(`<p14:${kind}/>`)
      expect(out).toContain('<mc:Fallback>')
      expect(out).toContain('p14:dur="900"')
      const spec = readSlideTransitionSpecXml(out)
      expect(spec.kind).toBe(kind)
      expect(spec.durationMs).toBe(900)
    }
  })

  it('keeps a configured sound in both AC branches', () => {
    let body = patchSlideTransitionXml(base, 'vortex', {})
    body = patchSlideTransitionSoundXml(body, buildTransitionSoundXml('chime.wav', 'rId3', false))
    expect((body.match(/<p:sndAc>/g) ?? []).length).toBe(2)
    expect(readSlideTransitionSoundXml(body)?.name).toBe('chime')
  })
})
