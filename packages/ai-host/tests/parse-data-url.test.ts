/**
 * parseDataUrlImage — 生图结果内联形态的解码。imagegen 主进程侧已把
 * Gemini inlineData / OpenAI b64_json 拼成 data: URL，ai:media-generate 的
 * downloadAsDataUrl 必须就地解码而不是交给 SSRF 守卫（只放行 http(s)），
 * 否则每张生成图都被拒成 unreachable，对话框兜底 image download failed。
 */
import { describe, expect, it } from 'vitest'
import { mimeFromContentType, parseDataUrlImage } from '../src/index'

describe('parseDataUrlImage', () => {
  it('decodes a base64 image data URL with its mime normalized to the pipeline four', () => {
    expect(parseDataUrlImage('data:image/png;base64,iVBORw0KGgo=')).toEqual({
      base64: 'iVBORw0KGgo=',
      mime: 'image/png',
    })
    expect(parseDataUrlImage('data:image/webp;base64,AAA=')).toEqual({
      base64: 'AAA=',
      mime: 'image/webp',
    })
    // insert pipelines only label png/gif/webp/jpeg — anything else (e.g.
    // avif from a content-negotiating CDN) maps to jpeg like the http path
    expect(parseDataUrlImage('data:image/avif;base64,AAA=')).toEqual({
      base64: 'AAA=',
      mime: 'image/jpeg',
    })
  })

  it('strips whitespace inside the base64 payload', () => {
    expect(parseDataUrlImage('data:image/png;base64,iVBOR\nw0KG go=')).toEqual({
      base64: 'iVBORw0KGgo=',
      mime: 'image/png',
    })
  })

  it('rejects non-data URLs, percent-encoded payloads, and empty mimes', () => {
    expect(parseDataUrlImage('https://cdn.example.com/x.png')).toBeNull()
    expect(parseDataUrlImage('data:image/png,%89PNG%0D')).toBeNull() // not base64
    expect(parseDataUrlImage('data:;base64,AAA=')).toBeNull() // no mime
    expect(parseDataUrlImage('data:image/png;base64,')).toBeNull() // no bytes
  })
})

describe('mimeFromContentType', () => {
  it('maps the labeled four and defaults to jpeg', () => {
    expect(mimeFromContentType('image/png')).toBe('image/png')
    expect(mimeFromContentType('image/gif')).toBe('image/gif')
    expect(mimeFromContentType('image/webp')).toBe('image/webp')
    expect(mimeFromContentType('image/jpeg')).toBe('image/jpeg')
    expect(mimeFromContentType('application/octet-stream')).toBe('image/jpeg')
    expect(mimeFromContentType('')).toBe('image/jpeg')
  })
})
