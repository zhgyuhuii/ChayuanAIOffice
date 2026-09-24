import { describe, expect, it } from 'vitest'
import { parseDocx } from '../src/index'
import { buildDocx, IMAGE_PARAGRAPH_XML } from './helpers/build-docx'

const withBlip = (inner: string): string =>
  IMAGE_PARAGRAPH_XML.replace(
    '<a:blip r:embed="rId10"/>',
    `<a:blip r:embed="rId10">${inner}</a:blip>`,
  )

async function effectsOf(bodyXml: string) {
  const doc = await parseDocx(await buildDocx({ bodyXml, withImage: true }))
  return doc.blocks[0].imageEffects
}

// adapted: e42da7c7 — 本地图片编辑通道把 a:lum 解析进 imageLum（千分比整数，可写回），
// imageEffects 只承载 a:grayscl / a:biLevel，避免渲染双重滤镜；断言改走 imageLum。
describe('picture recolor (a:lum / a:grayscl / a:biLevel)', () => {
  it('reads brightness and contrast into the local imageLum channel', async () => {
    const doc = await parseDocx(
      await buildDocx({ bodyXml: withBlip('<a:lum bright="40000" contrast="40000"/>'), withImage: true }),
    )
    expect(doc.blocks[0].imageLum).toEqual({ bright: 40000, contrast: 40000 })
    expect(doc.blocks[0].imageEffects).toBeUndefined()
    const doc2 = await parseDocx(
      await buildDocx({ bodyXml: withBlip('<a:lum contrast="-20000"/>'), withImage: true }),
    )
    expect(doc2.blocks[0].imageLum).toEqual({ bright: 0, contrast: -20000 })
  })

  it('reads grayscale and the bi-level threshold (default 50%)', async () => {
    expect(await effectsOf(withBlip('<a:grayscl/>'))).toEqual({ grayscale: true })
    expect(await effectsOf(withBlip('<a:biLevel thresh="25000"/>'))).toEqual({
      biLevelThresh: 0.25,
    })
    expect(await effectsOf(withBlip('<a:biLevel/>'))).toEqual({ biLevelThresh: 0.5 })
    expect(await effectsOf(withBlip('<a:biLevel thresh="0"/>'))).toEqual({ biLevelThresh: 0 })
  })

  it('does not read a later picture through a self-closing first blip', async () => {
    const second = withBlip('<a:lum bright="40000"/>').replace(/^<w:p>|<\/w:p>$/g, '')
    const xml = IMAGE_PARAGRAPH_XML.replace('</w:p>', `${second}</w:p>`)
    expect(await effectsOf(xml)).toBeUndefined()
  })

  it('leaves a plain blip without effects', async () => {
    expect(await effectsOf(IMAGE_PARAGRAPH_XML)).toBeUndefined()
    expect(await effectsOf(withBlip('<a:lum/>'))).toBeUndefined()
  })
})
