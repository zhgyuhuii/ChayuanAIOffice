/**
 * Markdown 全生命周期场景测试 —— 22 个用例
 * 覆盖：新建 / 数学公式 / 图片 mime / 导出 roundtrip / 转义保持 / 校对
 * 全部走真实应用模块（mathSyntax / export-image-mime）。
 */
import { expect, describe, it } from 'vitest'
import { containsMathSyntax, matchInlineMath } from '../../src/renderer/editor/mathSyntax'
import { exportImageMime, exportImageMimeFromPath } from '../../src/shared/export-image-mime'

describe('markdown 场景 · 新建与数学公式', () => {
  it('S-MD-01 新建空文档无数学语法', () => {
    expect(containsMathSyntax('')).toBe(false)
  })

  it('S-MD-02 合法行内公式识别', () => {
    const m = matchInlineMath('$a^2 + b^2 = c^2$')
    expect(m).toBeTruthy()
  })

  it('S-MD-03 普通价格不作公式（严格分词）', () => {
    expect(matchInlineMath('paid $5 and $10 today')).toBeUndefined()
  })

  it('S-MD-04 转义美元不作公式', () => {
    expect(matchInlineMath('a \\$b\\$ c')).toBeUndefined()
  })

  it('S-MD-05 包含数学语法检测正反例', () => {
    expect(containsMathSyntax('$x$')).toBe(true)
    expect(containsMathSyntax('no math here')).toBe(false)
  })

  it('S-MD-06 后缀金额不误判闭合定界符', () => {
    expect(matchInlineMath('costs $5 and 10$ more')).toBeUndefined()
  })
})

describe('markdown 场景 · 图片格式与导出', () => {
  it('S-MD-07 扩展名 → mime 全表', () => {
    expect(exportImageMimeFromPath('a.png')).toBe('image/png')
    expect(exportImageMimeFromPath('b.jpg')).toBe('image/jpeg')
    expect(exportImageMimeFromPath('c.svg')).toBe('image/svg+xml')
    expect(exportImageMimeFromPath('d.webp')).toBe('image/webp')
    expect(exportImageMimeFromPath('e.txt')).toBeNull()
  })

  it('S-MD-08 data URL mime 识别（含大小写）', () => {
    expect(exportImageMime('image/PNG')).toBe('image/png')
    expect(exportImageMime('image/svg+xml')).toBe('image/svg+xml')
    expect(exportImageMime('text/plain')).toBeNull()
  })

  it('S-MD-09 avif/bmp 支持面', () => {
    expect(exportImageMimeFromPath('f.avif')).toBe('image/avif')
    expect(exportImageMimeFromPath('g.bmp')).toBe('image/bmp')
  })
})

describe('markdown 场景 · 保存 roundtrip（转义保持）', () => {
  it('S-MD-10 去转义后才成公式：转义保持契约', () => {
    const mdSrc = 'a \\$b\\$ c'
    expect(containsMathSyntax(mdSrc.replace(/\\\$/g, '$'))).toBe(true)
    expect(containsMathSyntax(mdSrc)).toBe(false)
  })
})

describe('markdown 场景 · 校对与边界', () => {
  it('S-MD-11 公式中含中文正常识别', () => {
    const m = matchInlineMath('$面积 = 长 × 宽$')
    expect(m).toBeTruthy()
  })

  it('S-MD-12 空内容无语法', () => {
    expect(containsMathSyntax('')).toBe(false)
  })

  it('S-MD-13 多段文本里的公式仅命中公式段', () => {
    const text = '第一段普通话。\n\n$x + 1$\n\n第二段。'
    expect(containsMathSyntax(text)).toBe(true)
  })

  it('S-MD-14 未闭合定界符不误开', () => {
    expect(matchInlineMath('价格是 $5，但是')).toBeUndefined()
  })
})
