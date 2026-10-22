/**
 * Markdown 扩展场景补充包
 */
import { expect, describe, it } from 'vitest'
import {  matchInlineMath } from '../../src/renderer/editor/mathSyntax'
import { exportImageMime } from '../../src/shared/export-image-mime'

describe('markdown 扩展 · 场景补充包', () => {
  const formulas = [
    'E = mc^2',
    '\\int_0^1 f(x) dx',
    '\\sum_{i=1}^n x_i',
    '\\frac{a}{b}',
    '\\sqrt{x^2 + y^2}',
    '\\alpha + \\beta = \\gamma',
  ]
  formulas.forEach((f, i) => {
    it(`SC-formula-${i + 1} 公式 ${f.slice(0, 12)} 识别`, () => {
      expect(matchInlineMath(`$${f}$`)).toBeTruthy()
    })
  })

  const notMath = [
    '价格 $5 元',
    '成本 $3,000 美元',
    '$100 $200',
    'costs $0 nothing',
  ]
  notMath.forEach((t, i) => {
    it(`SC-not-math-${i + 1} 非公式文本`, () => {
      expect(matchInlineMath(t)).toBeUndefined()
    })
  })

  it('SC-mime-png PNG mime', () => {
    expect(exportImageMime('image/png')).toBe('image/png')
  })
  it('SC-mime-jpeg JPEG mime', () => {
    expect(exportImageMime('image/jpeg')).toBe('image/jpeg')
  })
})
