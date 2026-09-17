import { describe, expect, it } from 'vitest'
import { kbApiBase } from '../src/kb-bridge'

describe('kbApiBase', () => {
  it('keeps the /chatoffice-app prefix behind the dsh plugin proxy', () => {
    expect(kbApiBase('/chatoffice-app/')).toBe('/chatoffice-app')
    expect(kbApiBase('/chatoffice-app/editors/docs/')).toBe('/chatoffice-app')
  })

  it('uses the origin root in the plain web form', () => {
    expect(kbApiBase('/')).toBe('')
    expect(kbApiBase('/editors/docs/')).toBe('')
  })
})
