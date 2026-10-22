/**
 * HTML 扩展场景补充包
 */
import { expect, describe, it } from 'vitest'

describe('html 扩展 · 场景补充包', () => {
  const protocols: Array<[string, boolean]> = [
    ['https://a.com', true], ['http://b.com', true],
    ['ftp://c.com', false], ['file:///etc', false],
    ['data:text/html,x', false], ['javascript:void(0)', false],
  ]
  for (const [url, ok] of protocols) {
    it(`SC-proto-${url.split(':')[0]} 协议判断`, () => {
      expect(/^https?:\/\//.test(url)).toBe(ok)
    })
  }
})
