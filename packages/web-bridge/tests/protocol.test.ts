import { describe, expect, it } from 'vitest'
import {
  BRIDGE_PROTOCOL,
  isBridgeRequest,
  isBridgeSubscribe,
  degradeInfo,
  degradedChannels,
  registerBatch1Degradations,
  UNSUPPORTED_IN_BROWSER,
} from '../src/index.js'

describe('protocol guards', () => {
  it('accepts a well-formed request', () => {
    const msg = { proto: BRIDGE_PROTOCOL, id: 1, kind: 'rpc', channel: 'chatHistory.listProjects', args: [] }
    expect(isBridgeRequest(msg)).toBe(true)
  })

  it('rejects malformed or foreign messages', () => {
    expect(isBridgeRequest(null)).toBe(false)
    expect(isBridgeRequest({ proto: 'other', id: 1, kind: 'rpc', channel: 'x', args: [] })).toBe(false)
    expect(isBridgeRequest({ proto: BRIDGE_PROTOCOL, id: '1', kind: 'rpc', channel: 'x', args: [] })).toBe(false)
    expect(isBridgeRequest({ proto: BRIDGE_PROTOCOL, id: 1, kind: 'weird', channel: 'x', args: [] })).toBe(false)
  })

  it('recognizes subscribe messages', () => {
    expect(isBridgeSubscribe({ proto: BRIDGE_PROTOCOL, subscribe: ['tabs:changed'] })).toBe(true)
    expect(isBridgeSubscribe({ proto: BRIDGE_PROTOCOL })).toBe(false)
  })
})

describe('degrade registry', () => {
  it('reports batch info for degraded channels', () => {
    registerBatch1Degradations()
    const info = degradeInfo('chatOffice.cloudProjectsSync')
    expect(info?.batch).toBeTruthy()
    expect(degradedChannels()).toContain('chatOffice.cloudProjectsSync')
  })

  it('marks physically impossible channels as unsupported forever', () => {
    for (const ch of UNSUPPORTED_IN_BROWSER) {
      expect(degradeInfo(ch)?.reason).toContain('浏览器')
    }
  })

  it('returns null for implemented channels', () => {
    expect(degradeInfo('markdown.readFile')).toBeNull()
  })
})
