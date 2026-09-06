/**
 * SVG double-part vector pictures (roadmap v3 §8 Q2): a:blip → raster fallback +
 * a:extLst → asvg:svgBlip → svg part. Covers insertion (media/rels/ContentTypes),
 * parse (svgMediaRef, raster stays mediaRef), in-place vector replacement via
 * replacePictureBytes, and the raster-over-svg strip.
 */
import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import {
  openPptx,
  savePptx,
  addPicture,
  addSvgPicture,
  replacePictureBytes,
  createBlankPptx,
} from '../src/index'
import { parseSlide } from '../src/parse'
import type { PictureElement } from '../src/types'

const OFF = { x: 914400, y: 914400, cx: 1828800, cy: 914400 }

// 1x1 red PNG (raster fallback)
const PNG_1PX = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
)

const SVG_BLUE_CIRCLE = Uint8Array.from(
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#1565C0"/></svg>',
    'utf8',
  ),
)

const asPic = (el: unknown): PictureElement => el as PictureElement

describe('addSvgPicture (double part)', () => {
  it('lands svg + raster parts, ContentTypes, rels, and the svgBlip ext', async () => {
    const opened = await openPptx(await createBlankPptx())
    const slide = opened.deck.slides[0]!
    const el = asPic(addSvgPicture(opened, slide, { svgBytes: SVG_BLUE_CIRCLE, bytes: PNG_1PX, offset: OFF }))
    expect(el).not.toBeNull()
    expect(el!.mediaRef).toMatch(/^ppt\/media\/image\d+\.png$/)
    expect(el!.svgMediaRef).toMatch(/^ppt\/media\/image\d+\.svg$/)

    const out = await savePptx(opened)
    const zip = await JSZip.loadAsync(out)
    expect(zip.file(el!.mediaRef)).not.toBeNull()
    expect(zip.file(el!.svgMediaRef!)).not.toBeNull()
    const ct = await zip.file('[Content_Types].xml')!.async('string')
    expect(ct).toContain('<Default Extension="png"')
    expect(ct).toContain('<Default Extension="svg" ContentType="image/svg+xml"/>')
    const rels = await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string')
    expect(rels).toContain(`Target="../${el!.mediaRef.replace('ppt/media/', 'media/')}"`)
    expect(rels).toContain(`Target="../${el!.svgMediaRef!.replace('ppt/media/', 'media/')}"`)
    // blip → raster (rId2; rId1 is the slideLayout), extLst → svgBlip with its own rId
    expect(el!.anchor.originalXml).toContain('<a:blip r:embed="rId2">')
    expect(el!.anchor.originalXml).toContain('uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"')
    expect(el!.anchor.originalXml).toContain('r:embed="rId3"')
  })

  it('survives save → reopen with both refs intact', async () => {
    const opened = await openPptx(await createBlankPptx())
    const slide = opened.deck.slides[0]!
    const el = asPic(addSvgPicture(opened, slide, { svgBytes: SVG_BLUE_CIRCLE, bytes: PNG_1PX, offset: OFF }))
    const out = await savePptx(opened)
    const reopened = await openPptx(out)
    const pic = asPic(reopened.deck.slides[0]!.elements.find((e) => e.type === 'picture'))
    expect(pic.mediaRef).toBe(el!.mediaRef)
    expect(pic.svgMediaRef).toBe(el!.svgMediaRef)
  })
})

describe('parse svgBlip', () => {
  it('double part: raster stays mediaRef, svg lands in svgMediaRef', () => {
    const slideXml =
      '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<p:cSld><p:spTree><p:grpSpPr/>' +
      '<p:pic><p:nvPicPr><p:cNvPr id="5" name="Logo"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>' +
      '<p:blipFill><a:blip r:embed="rId1"><a:extLst>' +
      '<a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}">' +
      '<asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="rId2"/>' +
      '</a:ext></a:extLst></a:blip><a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
      '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>' +
      '</p:spTree></p:cSld></p:sld>'
    const mediaRels = new Map([
      ['rId1', 'ppt/media/image1.png'],
      ['rId2', 'ppt/media/image2.svg'],
    ])
    const slide = parseSlide({
      path: 'ppt/slides/slide1.xml',
      slideXml,
      ctx: { mediaRels },
    })
    const pic = slide.elements[0] as PictureElement
    expect(pic.mediaRef).toBe('ppt/media/image1.png')
    expect(pic.svgMediaRef).toBe('ppt/media/image2.svg')
  })

  it('SVG-only bare blip: mediaRef is the svg part, no separate svgMediaRef', () => {
    const slideXml =
      '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<p:cSld><p:spTree><p:grpSpPr/>' +
      '<p:pic><p:nvPicPr><p:cNvPr id="6" name="Vector"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>' +
      '<p:blipFill><a:blip><a:extLst>' +
      '<a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}">' +
      '<asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="rId7"/>' +
      '</a:ext></a:extLst></a:blip><a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
      '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>' +
      '</p:spTree></p:cSld></p:sld>'
    const slide = parseSlide({
      path: 'ppt/slides/slide1.xml',
      slideXml,
      ctx: { mediaRels: new Map([['rId7', 'ppt/media/image9.svg']]) },
    })
    const pic = slide.elements[0] as PictureElement
    expect(pic.mediaRef).toBe('ppt/media/image9.svg')
    expect(pic.svgMediaRef).toBeUndefined()
  })
})

describe('replacePictureBytes with svgBytes', () => {
  it('swaps the vector source in place and rewrites the svgBlip rId', async () => {
    const opened = await openPptx(await createBlankPptx())
    const slide = opened.deck.slides[0]!
    const el = asPic(addSvgPicture(opened, slide, { svgBytes: SVG_BLUE_CIRCLE, bytes: PNG_1PX, offset: OFF }))
    const svgV2 = Uint8Array.from(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="#E53935"/></svg>',
        'utf8',
      ),
    )
    expect(replacePictureBytes(opened, slide, el!.id, PNG_1PX, 'png', { svgBytes: svgV2 })).toBe(true)
    expect(el!.svgMediaRef).toMatch(/^ppt\/media\/image\d+\.svg$/)
    expect(el!.svgMediaRef).not.toBe('ppt/media/image2.svg') // a fresh part
    expect(el!.anchor.originalXml).toContain('r:embed="rId4"') // svg rel re-targeted
    expect(el!.anchor.originalXml).not.toContain('fill="#1565C0"')

    const out = await savePptx(opened)
    const reopened = await openPptx(out)
    const pic = asPic(reopened.deck.slides[0]!.elements.find((e) => e.type === 'picture'))
    expect(pic.svgMediaRef).toBe(el!.svgMediaRef)
  })

  it('raster replacement over a double-part picture strips the svgBlip and svgMediaRef', async () => {
    const opened = await openPptx(await createBlankPptx())
    const slide = opened.deck.slides[0]!
    const el = asPic(addSvgPicture(opened, slide, { svgBytes: SVG_BLUE_CIRCLE, bytes: PNG_1PX, offset: OFF }))
    const svgPart = el!.svgMediaRef!
    const pngV2 = Uint8Array.from(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    )
    expect(replacePictureBytes(opened, slide, el!.id, pngV2, 'png')).toBe(true)
    expect(el!.svgMediaRef).toBeUndefined()
    expect(el!.anchor.originalXml).not.toContain('svgBlip')
    // the orphaned svg part + rel are reclaimed
    expect(opened.archive.has(svgPart)).toBe(false)
  })
})

describe('addImageMediaAndRel svg gate', () => {
  it('svg is now an accepted image media extension', async () => {
    const opened = await openPptx(await createBlankPptx())
    const slide = opened.deck.slides[0]!
    // direct svg-only insert via the raster gate stays possible (bare blip is
    // resolved by blipEmbedId's svgBlip fallback upstream)
    const el = asPic(addPicture(opened, slide, { bytes: SVG_BLUE_CIRCLE, ext: 'svg', offset: OFF }))
    expect(el).not.toBeNull()
    expect(el!.mediaRef).toMatch(/\.svg$/)
  })
})
