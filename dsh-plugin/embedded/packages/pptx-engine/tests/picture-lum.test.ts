/** Picture lum: a:lum parsing + byte-surgery write-back (sibling of opacity). */
import { describe, it, expect } from 'vitest'
import { parseSlide, setPictureLum } from '../src/index'
import type { PictureElement } from '../src/types'

const slideWith = (inner: string) =>
  '<?xml version="1.0"?><p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld>' +
  `<p:spTree><p:nvGrpSpPr/><p:grpSpPr/>${inner}</p:spTree></p:cSld></p:sld>`
const pic = (blip: string) =>
  '<p:pic><p:nvPicPr><p:cNvPr id="7" name="P"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>' +
  `<p:blipFill>${blip}<a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
  '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr></p:pic>'

const parseOne = (blip: string) =>
  parseSlide({ path: 'ppt/slides/slide1.xml', slideXml: slideWith(pic(blip)), ctx: {} })

describe('picture lum', () => {
  it('parses a:lum → PictureElement.lum (-1..1)', () => {
    const slide = parseOne('<a:blip r:embed="rId2"><a:lum bright="20000" contrast="-10000"/></a:blip>')
    const el = slide.elements[0] as PictureElement
    expect(el.lum).toEqual({ bright: 0.2, contrast: -0.1 })
  })

  it('setting lum: self-closing blip expanded; zero lum removes the marker', () => {
    const slide = parseOne('<a:blip r:embed="rId2"/>')
    const el = slide.elements[0] as PictureElement
    expect(setPictureLum(slide, el.id, { bright: 0.3, contrast: -0.2 })).toBe(true)
    expect(el.anchor.originalXml).toContain(
      '<a:blip r:embed="rId2"><a:lum bright="30000" contrast="-20000"/></a:blip>',
    )
    expect(el.lum).toEqual({ bright: 0.3, contrast: -0.2 })
    expect(setPictureLum(slide, el.id, null)).toBe(true)
    expect(el.anchor.originalXml).not.toContain('<a:lum')
    expect(el.lum).toBeUndefined()
  })

  it('existing a:lum is replaced, not stacked', () => {
    const slide = parseOne('<a:blip r:embed="rId2"><a:lum bright="20000" contrast="0"/></a:blip>')
    const el = slide.elements[0] as PictureElement
    setPictureLum(slide, el.id, { bright: 0, contrast: 0.5 })
    const hits = el.anchor.originalXml.match(/<a:lum/g) ?? []
    expect(hits.length).toBe(1)
    expect(el.anchor.originalXml).toContain('contrast="50000"')
  })

  it('keeps sibling transforms (alphaModFix) untouched and inserts before a:tint', () => {
    const slide = parseOne(
      '<a:blip r:embed="rId2"><a:alphaModFix amt="40000"/></a:blip>',
    )
    const el = slide.elements[0] as PictureElement
    setPictureLum(slide, el.id, { bright: 0.1, contrast: 0 })
    expect(el.anchor.originalXml).toContain('<a:alphaModFix amt="40000"/>')
    expect(el.anchor.originalXml).toContain('<a:lum bright="10000" contrast="0"/>')
  })
})
