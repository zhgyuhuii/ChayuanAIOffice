import { afterEach, describe, expect, it, vi } from 'vitest'
import { createKbFetchBridge, kbApiBase, kbFileUrl } from '../src/kb-bridge'

describe('kbApiBase', () => {
  it('keeps the /chaoffice-app prefix behind the dsh plugin proxy', () => {
    expect(kbApiBase('/chaoffice-app/')).toBe('/chaoffice-app')
    expect(kbApiBase('/chaoffice-app/editors/docs/')).toBe('/chaoffice-app')
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
      location: { origin: 'http://127.0.0.1:52584', pathname: '/chaoffice-app/' },
    })
    const url = kbFileUrl({ kbId: '公司制度库', docId: 'd1' }, '/chaoffice-app')
    expect(url).toBe(
      'http://127.0.0.1:52584/chaoffice-app/kb/file?kbId=' +
        encodeURIComponent('公司制度库') +
        '&docId=d1',
    )
    const bridge = createKbFetchBridge('/chaoffice-app')
    await expect(bridge.file({ kbId: 'k', docId: 'd2' })).resolves.toMatchObject({
      ok: true,
      url: 'http://127.0.0.1:52584/chaoffice-app/kb/file?kbId=k&docId=d2',
    })
  })
})
