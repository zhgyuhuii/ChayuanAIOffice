import { describe, expect, it } from 'vitest'
import { NO_MODELS_API, VENDORS, VENDOR_BY_ID } from '../src/vendor-catalog'

/**
 * Vendors that intentionally ship without a defaultUrl: the endpoint is
 * deployment-specific (azure/vertex/bedrock carry per-tenant hosts), handed
 * out on invite pages (mirror aggregators), regional consoles, or the vendor
 * is the login-backed suite profile (chaoffice — its pane fetches the proxy's
 * own model list). Everything else must be configurable out of the box.
 */
const INTENTIONALLY_BLANK = new Set([
  // the catch-all custom entry: the URL is the user's input by definition
  'openai-compatible',
  'tencent-cloud-ti',
  'tianyi-xirang',
  'netease-youdao',
  'azure-openai',
  'vertex-ai',
  'aws-bedrock',
  'routeway',
  'bazaarlink',
  'ainative',
  'aion-labs',
  'navyai',
  'nararouter',
  'ai-horde',
  // login-backed suite profile: no user-supplied URL, dedicated pane
  'chaoffice',
])

/**
 * Catalog hygiene: a vendor row the UI offers must be configurable end-to-end
 * (a key-bearing vendor with no defaultUrl cannot be saved by a user who does
 * not know the endpoint by heart — Agnes shipped that way once), and no vendor
 * may carry a built-in model list: every model list in the UI is fetched live
 * from the endpoint ("获取什么显示什么").
 */
describe('vendor catalog: configurability invariants', () => {
  it('every key-bearing vendor is either keyless or has a defaultUrl', () => {
    for (const v of VENDORS) {
      if (v.ollamaLike || v.codexLike || INTENTIONALLY_BLANK.has(v.id)) continue
      if (!v.defaultUrl) {
        throw new Error(
          `${v.id}: no defaultUrl — the settings form opens with a blank URL and nothing to fetch models from`,
        )
      }
    }
  })

  it('no vendor carries built-in models — lists are fetched live only', () => {
    for (const v of VENDORS) {
      expect(Object.hasOwn(v, 'presets'), `${v.id} ships built-in models`).toBe(false)
    }
  })

  it('first-party model vendors sit under 国内平台, not API 聚合', () => {
    // Agnes (爱思) and LongCat (美团) build and serve their own models — they
    // are vendors, not aggregators; only multi-lab gateways belong in 'agg'
    expect(VENDOR_BY_ID.get('agnes-ai')?.group).toBe('cn')
    expect(VENDOR_BY_ID.get('longcat')?.group).toBe('cn')
  })

  it('agnes-ai keeps the harness-parity entry (URL, key/docs links, free tier)', () => {
    const agnes = VENDOR_BY_ID.get('agnes-ai')!
    expect(agnes.defaultUrl).toBe('https://api.agnes-ai.cn/v1')
    expect(agnes.keyUrl).toBe('https://www.agnes-ai.cn')
    expect(agnes.docsUrl).toBe('https://wiki.agnes-ai.cn/zh-Hans/docs/overview')
    expect(agnes.free).toBe('freekey')
  })

  it('keeps NO_MODELS_API honest: agnes serves a live /models endpoint', () => {
    expect(NO_MODELS_API.has('agnes-ai')).toBe(false)
  })
})
