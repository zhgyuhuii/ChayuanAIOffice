import { describe, expect, it } from 'vitest'

import { applyVisualEdits } from '@chatoffice/xlsx-gateway/gateway/xlsx-drawing-edit'
import { applyPictureFormat } from '@chatoffice/xlsx-gateway/gateway/xlsx-picture-xml'
import type { MutablePackage } from '@chatoffice/xlsx-gateway/gateway/xlsx-drawing-add'

const BASE_PIC =
  '<xdr:pic>' +
  '<xdr:nvPicPr><xdr:cNvPr id="2" name="Picture 2"/></xdr:nvPicPr>' +
  '<xdr:blipFill>' +
  '<a:blip r:embed="rId8"/>' +
  '<a:stretch><a:fillRect/></a:stretch>' +
  '</xdr:blipFill>' +
  '<xdr:spPr>' +
  '<a:xfrm><a:off x="0" y="0"/><a:ext cx="1905000" cy="952500"/></a:xfrm>' +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
  '</xdr:spPr>' +
  '</xdr:pic>'

describe('applyPictureFormat', () => {
  it('writes srcRect between the blip and the stretch, idempotently', () => {
    const once = applyPictureFormat(BASE_PIC, { srcRect: { l: 10_000, t: 0, r: 0, b: 20_000 } })
    expect(once).toContain('<a:srcRect l="10000" t="0" r="0" b="20000"/>')
    expect(once.indexOf('<a:srcRect')).toBeGreaterThan(once.indexOf('<a:blip'))
    expect(once.indexOf('<a:srcRect')).toBeLessThan(once.indexOf('<a:stretch'))
    const twice = applyPictureFormat(once, { srcRect: { l: 30_000, t: 0, r: 0, b: 0 } })
    expect(twice.match(/<a:srcRect/g)).toHaveLength(1)
    expect(twice).toContain('l="30000"')
  })

  it('expands a self-closed blip for lum and opacity, then rewrites in place', () => {
    const once = applyPictureFormat(BASE_PIC, {
      lum: { bright: 20_000, contrast: -10_000 },
      opacity: 0.5,
    })
    expect(once).toContain('<a:alphaModFix amt="50000"/>')
    expect(once).toContain('<a:lum bright="20000" contrast="-10000"/>')
    expect(once.indexOf('<a:alphaModFix')).toBeLessThan(once.indexOf('<a:lum'))
    const twice = applyPictureFormat(once, { lum: { bright: 0, contrast: 30_000 } })
    expect(twice.match(/<a:lum/g)).toHaveLength(1)
    expect(twice).toContain('contrast="30000"')
    // alphaModFix untouched when the patch doesn't mention opacity
    expect(twice).toContain('<a:alphaModFix amt="50000"/>')
  })

  it('null clears the aspect; undefined leaves existing XML untouched', () => {
    const withLum = applyPictureFormat(BASE_PIC, { lum: { bright: 5_000, contrast: 0 } })
    expect(applyPictureFormat(withLum, {})).toContain('<a:lum')
    expect(applyPictureFormat(withLum, { lum: null })).not.toContain('<a:lum')
  })

  it('replaces the outline wholesale and rewrites xfrm rotation/flip attributes', () => {
    const withLine = applyPictureFormat(BASE_PIC, { lineColor: '#FF0000', lineWidth: 1.5 })
    expect(withLine).toContain('<a:ln w="19050"><a:solidFill><a:srgbClr val="FF0000"/>')
    const replaced = applyPictureFormat(withLine, { lineColor: '#00AA00', lineWidth: 2 })
    expect(replaced.match(/<a:ln\b/g)).toHaveLength(1)
    expect(replaced).toContain('<a:srgbClr val="00AA00"/>')

    const rotated = applyPictureFormat(BASE_PIC, { rotation: 90, flipH: true })
    expect(rotated).toContain('<a:xfrm rot="5400000" flipH="1">')
    // off/ext children survive the attribute rewrite
    expect(rotated).toContain('<a:off x="0" y="0"/><a:ext cx="1905000" cy="952500"/>')
    const cleared = applyPictureFormat(rotated, { rotation: null, flipH: null })
    expect(cleared).not.toContain('rot=')
    expect(cleared).not.toContain('flipH=')
    expect(cleared).toContain('<a:xfrm><a:off')
  })
})

// ---- end-to-end through the drawing editor ----

const marker = (prefix: 'from' | 'to', col: number, row: number): string =>
  `<xdr:${prefix}><xdr:col>${col}</xdr:col><xdr:colOff>0</xdr:colOff>` +
  `<xdr:row>${row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:${prefix}>`

const DRAWING =
  '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing">' +
  `<xdr:twoCellAnchor>${marker('from', 5, 1)}${marker('to', 9, 9)}` +
  '<xdr:pic><xdr:blipFill><a:blip r:embed="rId8"/></xdr:blipFill>' +
  '<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1905000" cy="952500"/></a:xfrm>' +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>' +
  '<xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>'

const DRAWING_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId8" ' +
  'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" ' +
  'Target="../media/image1.png"/></Relationships>'

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/></Types>'

const PATH = 'xl/drawings/drawing1.xml'

function fakePackage(
  entries: Map<string, string>,
  binaries: Map<string, Uint8Array>,
): MutablePackage {
  return {
    paths: () => Promise.resolve([...entries.keys()]),
    has: (path) => Promise.resolve(entries.has(path)),
    readText: (path) => {
      const content = entries.get(path)
      if (content === undefined) return Promise.reject(new Error(`missing ${path}`))
      return Promise.resolve(content)
    },
    write: (path, content) => void entries.set(path, content),
    add: (path, content) => void entries.set(path, content),
    addBinary: (path, bytes) => {
      entries.set(path, 'binary')
      binaries.set(path, bytes)
    },
    remove: (path) => void entries.delete(path),
  }
}

describe('picture edits through applyVisualEdits', () => {
  it('patches the pic in place without touching the anchor markers', async () => {
    const entries = new Map([
      [PATH, DRAWING],
      ['xl/drawings/_rels/drawing1.xml.rels', DRAWING_RELS],
      ['[Content_Types].xml', CONTENT_TYPES],
    ])
    await applyVisualEdits(
      fakePackage(entries, new Map()),
      [
        {
          drawingPath: PATH,
          drawingIndex: 0,
          picture: {
            srcRect: { l: 10_000, t: 10_000, r: 10_000, b: 10_000 },
            lum: { bright: 10_000, contrast: 0 },
            rotation: 180,
          },
        },
      ],
      new Set(),
    )
    const xml = entries.get(PATH)!
    expect(xml).toContain('<a:srcRect l="10000" t="10000" r="10000" b="10000"/>')
    expect(xml).toContain('<a:lum bright="10000" contrast="0"/>')
    expect(xml).toContain('<a:xfrm rot="10800000">')
    expect(xml).toContain(marker('from', 5, 1))
  })

  it('rewrites editAs on the anchor open tag (and strips it back for twoCell)', async () => {
    const entries = new Map([
      [PATH, DRAWING],
      ['xl/drawings/_rels/drawing1.xml.rels', DRAWING_RELS],
      ['[Content_Types].xml', CONTENT_TYPES],
    ])
    await applyVisualEdits(
      fakePackage(entries, new Map()),
      [{ drawingPath: PATH, drawingIndex: 0, editAs: 'oneCell' }],
      new Set(),
    )
    expect(entries.get(PATH)).toContain('<xdr:twoCellAnchor editAs="oneCell">')
    const again = new Map([
      [PATH, entries.get(PATH)!],
      ['xl/drawings/_rels/drawing1.xml.rels', DRAWING_RELS],
      ['[Content_Types].xml', CONTENT_TYPES],
    ])
    await applyVisualEdits(
      fakePackage(again, new Map()),
      [{ drawingPath: PATH, drawingIndex: 0, editAs: 'twoCell' }],
      new Set(),
    )
    expect(again.get(PATH)).toContain('<xdr:twoCellAnchor>')
    expect(again.get(PATH)).not.toContain('editAs=')
  })

  it('更改图片 adds a media part, repoints r:embed, and drops the orphaned rel', async () => {
    const entries = new Map([
      [PATH, DRAWING],
      ['xl/drawings/_rels/drawing1.xml.rels', DRAWING_RELS],
      ['[Content_Types].xml', CONTENT_TYPES],
    ])
    const binaries = new Map<string, Uint8Array>()
    await applyVisualEdits(
      fakePackage(entries, binaries),
      [
        {
          drawingPath: PATH,
          drawingIndex: 0,
          mediaReplace: {
            mediaType: 'image/jpeg',
            base64: 'AAAA',
          },
        },
      ],
      new Set(),
    )
    expect(binaries.has('xl/media/image1.jpeg')).toBe(true)
    const xml = entries.get(PATH)!
    expect(xml).not.toContain('r:embed="rId8"')
    expect(xml).toMatch(/r:embed="rId\d+"/)
    const rels = entries.get('xl/drawings/_rels/drawing1.xml.rels')!
    expect(rels).not.toContain('Id="rId8"')
    expect(rels).toContain('Target="../media/image1.jpeg"')
  })
})
