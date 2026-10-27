import { afterEach, describe, expect, it, vi } from 'vitest'
import { findHostOpenExternal, openExternalUrl, sanitizeExternalUrl } from '../src/host/open-external.js'

describe('sanitizeExternalUrl', () => {
  it('passes http(s) through normalized', () => {
    expect(sanitizeExternalUrl('https://github.com/zhgyuhuii/ChayuanAIOffice')).toBe(
      'https://github.com/zhgyuhuii/ChayuanAIOffice',
    )
    expect(sanitizeExternalUrl('http://aidooo.com/a?b=1')).toBe('http://aidooo.com/a?b=1')
  })

  it('drops dangerous schemes and garbage (shell main openExternal 同口径)', () => {
    expect(sanitizeExternalUrl('javascript:alert(1)')).toBeNull()
    expect(sanitizeExternalUrl('file:///etc/passwd')).toBeNull()
    expect(sanitizeExternalUrl('data:text/html,<script>')).toBeNull()
    expect(sanitizeExternalUrl('not a url')).toBeNull()
    expect(sanitizeExternalUrl('')).toBeNull()
  })
})

describe('findHostOpenExternal', () => {
  it('finds the chatop desktop bridge on the first usable frame', () => {
    const openExternal = async () => undefined
    const frames = [{}, { chatopDesktop: { openExternal } }]
    const found = findHostOpenExternal(frames)
    expect(found).toBeTypeOf('function')
    expect(found).not.toBeNull()
  })

  it('walks past cross-origin frames whose property access throws', () => {
    const openExternal = async () => undefined
    const crossOrigin = {
      get chatopDesktop(): never {
        throw new Error('SecurityError: cross-origin')
      },
    }
    const found = findHostOpenExternal([crossOrigin, { chatopDesktop: { openExternal } }])
    expect(found).not.toBeNull()
  })

  it('skips bridges whose openExternal is not a function', () => {
    const frames = [{ chatopDesktop: { openExternal: 'nope' } }, { chatopDesktop: {} }]
    expect(findHostOpenExternal(frames)).toBeNull()
  })

  it('returns null in a standalone browser (no bridge anywhere)', () => {
    expect(findHostOpenExternal([{}, {}, null])).toBeNull()
  })

  it('survives null frames', () => {
    expect(findHostOpenExternal([null, undefined, { chatopDesktop: undefined }])).toBeNull()
  })
})

describe('openExternalUrl wiring', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubWindow(top: unknown, parent?: unknown) {
    const self: Record<string, unknown> = { opened: [] as string[] }
    self.open = (...args: unknown[]) => {
      ;(self.opened as string[]).push(String(args[0]))
      return args
    }
    self.top = top ?? self
    self.parent = parent ?? self
    vi.stubGlobal('window', self)
    return self
  }

  it('routes through the parent-frame desktop bridge when embedded (察元OS 内嵌)', async () => {
    const seen: string[] = []
    const bridge = { openExternal: (url: string) => { seen.push(url); return Promise.resolve() } }
    const self = stubWindow(null)
    const parent: Record<string, unknown> = { chatopDesktop: bridge }
    self.parent = parent
    await openExternalUrl('https://github.com/zhgyuhuii/ChayuanAIOffice')
    expect(seen).toEqual(['https://github.com/zhgyuhuii/ChayuanAIOffice'])
    expect((self as { opened: string[] }).opened).toEqual([])
  })

  it('falls back to window.open in a standalone browser (网页版直开)', async () => {
    const self = stubWindow(null)
    await openExternalUrl('https://aidooo.com')
    expect((self as { opened: string[] }).opened.length).toBe(1)
  })

  it('falls back to window.open when the desktop bridge rejects', async () => {
    const self = stubWindow(null)
    const parent: Record<string, unknown> = {
      chatopDesktop: { openExternal: () => Promise.reject(new Error('refused')) },
    }
    self.parent = parent
    await openExternalUrl('https://aidooo.com')
    expect((self as { opened: string[] }).opened.length).toBe(1)
  })

  it('opens nothing for non-http(s) urls', async () => {
    const self = stubWindow(null)
    await openExternalUrl('javascript:alert(1)')
    expect((self as { opened: string[] }).opened).toEqual([])
  })
})
