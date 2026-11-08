import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAiHttpBridge } from '../src/ai-bridge'

/** node-env fetch double: one canned response per call, recorded URLs */
function stubFetch(respond: (url: string, init?: RequestInit) => unknown) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const value = respond(String(url), init)
    calls.push({ url: String(url), init })
    const raw = value as { ok?: boolean }
    if (value instanceof Response || raw?.ok === false) return value as unknown as Response
    return {
      ok: true,
      status: 200,
      json: async () => value,
      text: async () => String(value),
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fetch)
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ai-bridge skills', () => {
  it('skillsList GETs the skills route behind the /chaoffice-app base', async () => {
    const calls = stubFetch(() => [
      { name: 'invoice-tax', description: 'Checks invoices', path: 'invoice-tax/SKILL.md', relevant: true },
    ])
    const bridge = createAiHttpBridge('/chaoffice-app')
    const skills = await bridge.skillsList()
    expect(skills).toHaveLength(1)
    expect(skills[0]?.name).toBe('invoice-tax')
    expect(calls[0]?.url).toBe('/chaoffice-app/ai/skills')
    expect((calls[0]?.init as RequestInit | undefined)?.method).toBe('GET')
  })

  it('skillText encodes the name into the clipped-text route', async () => {
    const calls = stubFetch(() => 'Step one: read the export.')
    const bridge = createAiHttpBridge('')
    const body = await bridge.skillText('meeting notes')
    expect(body).toContain('Step one')
    expect(calls[0]?.url).toBe('/ai/skills/text?name=meeting%20notes')
  })

  it('skillText surfaces the sidecar error for an unknown skill', async () => {
    stubFetch(() => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'no installed skill named "ghost"' }),
    }) as unknown as Response)
    const bridge = createAiHttpBridge('')
    await expect(bridge.skillText('ghost')).rejects.toThrow('no installed skill named "ghost"')
  })
})
