// @vitest-environment jsdom
/**
 * ensurePipelineImage — 插入管线格式收口。docx/xlsx 落盘只认 png/jpeg/gif，
 * webp/bmp/avif（Gemini 生图回复、CDN 缩略图、本地文件）此前被插入守卫
 * 静默拒绝且对话框已关——「窗口一闪、没插入」。这里验证：支持格式直通、
 * 非 image data URL 拒绝、canvas 不可用时优雅返回 null（真实浏览器里
 * webp→png 的 canvas 路径由 e2e 覆盖）。
 */
import { describe, expect, it } from 'vitest'
import { ensurePipelineImage } from '../src/image-transcode'

describe('ensurePipelineImage', () => {
  it('passes png/jpeg/gif straight through (animated gif included)', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgo='
    const jpeg = 'data:image/jpeg;base64,/9j/4AAQ='
    const gif = 'data:image/gif;base64,R0lGODlh='
    await expect(ensurePipelineImage(png)).resolves.toBe(png)
    await expect(ensurePipelineImage(jpeg)).resolves.toBe(jpeg)
    await expect(ensurePipelineImage(gif)).resolves.toBe(gif)
  })

  it('rejects non-image data URLs outright', async () => {
    await expect(ensurePipelineImage('data:text/html;base64,PGh0bWw+')).resolves.toBeNull()
    await expect(ensurePipelineImage('https://cdn.example.com/x.webp')).resolves.toBeNull()
    await expect(ensurePipelineImage('')).resolves.toBeNull()
  })

  it('returns null when decode never settles (8s timeout guards the flow)', async () => {
    // jsdom 的 Image 既不 onload 也不 onerror——恰好覆盖「解码永久挂起」：
    // loadImage 的超时必须兜住，否则对话框会永远开着无反馈
    await expect(ensurePipelineImage('data:image/webp;base64,UklGRh4=')).resolves.toBeNull()
  }, 12_000)
})
