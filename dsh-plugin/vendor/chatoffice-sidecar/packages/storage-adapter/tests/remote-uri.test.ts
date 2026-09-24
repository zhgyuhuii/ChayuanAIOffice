import { describe, expect, it } from 'vitest'
import { formatRemoteUri, isRemoteUri, parseRemoteUri } from '../src/remote/uri.js'

describe('formatRemoteUri / parseRemoteUri', () => {
  it('round-trips plain keys', () => {
    const uri = formatRemoteUri('cfg-1', 'chatoffice/report.docx')
    expect(uri).toBe('remote://cfg-1/chatoffice/report.docx')
    expect(parseRemoteUri(uri)).toEqual({ configId: 'cfg-1', key: 'chatoffice/report.docx' })
  })

  it('round-trips CJK names, spaces and special characters', () => {
    const key = 'chatoffice/会议纪要 final (v2)!.docx'
    expect(parseRemoteUri(formatRemoteUri('cfg-1', key))?.key).toBe(key)
  })

  it('preserves empty path segments', () => {
    const key = 'chatoffice//weird//name.txt'
    expect(parseRemoteUri(formatRemoteUri('cfg-1', key))?.key).toBe(key)
  })

  it('rejects unusable ids and keys when formatting', () => {
    expect(() => formatRemoteUri('', 'a.txt')).toThrow()
    expect(() => formatRemoteUri('a/b', 'a.txt')).toThrow()
    expect(() => formatRemoteUri('cfg', '')).toThrow()
    expect(() => formatRemoteUri('cfg', '/abs.txt')).toThrow()
  })

  it('returns null for non-remote or malformed URIs', () => {
    expect(isRemoteUri('/Users/someone/report.docx')).toBe(false)
    expect(isRemoteUri('remote:/only-one-slash')).toBe(false)
    expect(parseRemoteUri('/Users/someone/report.docx')).toBeNull()
    expect(parseRemoteUri('remote://')).toBeNull()
    expect(parseRemoteUri('remote://only-id')).toBeNull()
    expect(parseRemoteUri('remote:///no-config-id')).toBeNull()
    expect(parseRemoteUri('remote://cfg/%zz-bad-encoding')).toBeNull()
    expect(parseRemoteUri('remote://cfg/')).toBeNull()
  })
})
