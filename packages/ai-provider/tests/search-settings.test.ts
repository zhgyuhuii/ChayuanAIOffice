import { describe, expect, it } from 'vitest'
import { defaultAiSettings, resolveAiSettings } from '../src/providers'
import {
  AI_SEARCH_PROVIDERS,
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

// adapted: 上游 #2124 Keenable 用例按本地免钥默认 duckduckgo + needsKey 元数据语义改编
// （上游默认 genspark、keenable key 经 resolve 恢复；本地 resolve 只持久化 KEYED_PROVIDERS，
// keenable key 走 raw settings 直读，与 parallel 先例一致）
describe('Keenable search settings', () => {
  it('is in the catalog without image search and keyless like parallel', () => {
    const meta = AI_SEARCH_PROVIDERS.find((m) => m.id === 'keenable')
    expect(meta?.imageSearch).toBe(false)
    expect(meta?.needsKey).toBe(false)
    expect(defaultAiSearchSettings().providers.keenable).toBeUndefined()
  })

  it('keeps Keenable selected for free search even with a blank key', () => {
    expect(
      activeSearchProvider({
        search: { provider: 'keenable', providers: { keenable: { apiKey: '   ' } } },
      }),
    ).toBe('keenable')
    expect(
      activeSearchProvider({ search: { provider: 'keenable', providers: {} } }),
    ).toBe('keenable')
  })

  it('leaves the default provider on duckduckgo', () => {
    expect(defaultAiSearchSettings().provider).toBe('duckduckgo')
    expect(activeSearchProvider({ search: defaultAiSearchSettings() })).toBe('duckduckgo')
  })
})

