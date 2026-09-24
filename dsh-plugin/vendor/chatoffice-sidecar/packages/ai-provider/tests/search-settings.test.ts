import { describe, expect, it } from 'vitest'
import { defaultAiSettings, resolveAiSettings } from '../src/providers'
import {
  activeSearchProvider,
  defaultAiSearchSettings,
  resolveAiSearchSettings,
} from '../src/search-settings'

describe('search settings', () => {
  it('defaults to duckduckgo and rides along in defaultAiSettings', () => {
    expect(defaultAiSearchSettings()).toEqual({
      provider: 'duckduckgo',
      providers: {},
    })
    expect(defaultAiSettings().search?.provider).toBe('duckduckgo')
    const resolved = resolveAiSettings(
      { search: { provider: 'duckduckgo', providers: {} } } as never,
      defaultAiSettings(),
    )
    expect(resolved.search).toEqual(defaultAiSearchSettings())
  })

  it('merges and trims stored keys', () => {
    const s = resolveAiSearchSettings({
      provider: 'tavily',
      providers: { tavily: { apiKey: ' tvly-1 ' } } as never,
    })
    expect(s.provider).toBe('tavily')
    expect(s.providers.tavily?.apiKey).toBe('tvly-1')
  })

  it('activates a keyed search provider only with a key', () => {
    expect(activeSearchProvider({ search: undefined })).toBe('duckduckgo')
    expect(
      activeSearchProvider({
        search: {
          provider: 'serper',
          providers: { serper: { apiKey: '' } },
        },
      }),
    ).toBe('duckduckgo')
    expect(
      activeSearchProvider({
        search: {
          provider: 'serper',
          providers: { serper: { apiKey: 'k' } },
        },
      }),
    ).toBe('serper')
    // adapted（本地）：空白 key 视为未配置，回落到免钥默认引擎 duckduckgo（上游无免钥引擎故回落 genspark）
    expect(
      activeSearchProvider({
        search: {
          provider: 'serper',
          providers: { serper: { apiKey: '   ' }, tavily: { apiKey: '' } },
        },
      }),
    ).toBe('duckduckgo')
  })

  it('activates a free provider without a key', () => {
    expect(
      activeSearchProvider({ search: { provider: 'bing', providers: {} } }),
    ).toBe('bing')
    expect(
      activeSearchProvider({ search: { provider: 'duckduckgo', providers: {} } }),
    ).toBe('duckduckgo')
  })
})
