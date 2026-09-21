import { afterEach, describe, expect, it, vi } from 'vitest'
import { createKbFetchBridge, kbApiBase, kbFileUrl } from '../src/kb-bridge'

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

describe('kbFileUrl / bridge.file', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds the same-origin download URL, prefix included', async () => {
    vi.stubGlobal('window', {
      location: { origin: 'http://127.0.0.1:52584', pathname: '/chatoffice-app/' },
    })
    const url = kbFileUrl({ kbId: '公司制度库', docId: 'd1' }, '/chatoffice-app')
    expect(url).toBe(
      'http://127.0.0.1:52584/chatoffice-app/kb/file?kbId=' +
        encodeURIComponent('公司制度库') +
        '&docId=d1',
    )
    const bridge = createKbFetchBridge('/chatoffice-app')
    await expect(bridge.file({ kbId: 'k', docId: 'd2' })).resolves.toMatchObject({
      ok: true,
      url: 'http://127.0.0.1:52584/chatoffice-app/kb/file?kbId=k&docId=d2',
    })
  })
})
