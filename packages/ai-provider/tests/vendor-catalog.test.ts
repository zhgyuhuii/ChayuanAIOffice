import { describe, expect, it } from 'vitest'
import { NO_MODELS_API, VENDORS, VENDOR_BY_ID } from '../src/vendor-catalog'

/**
 * Vendors that intentionally ship without a defaultUrl or presets: the
 * endpoint is deployment-specific (azure/vertex/bedrock carry per-tenant
 * hosts) or handed out on invite pages (mirror aggregators) or regional
 * consoles. Everything else must be configurable out of the box.
 */
const INTENTIONALLY_BLANK = new Set([
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
])

/**
 * Catalog hygiene for the settings page's configuration flow: a vendor row the
 * UI offers must be configurable end-to-end. A key-bearing vendor with neither
 * a defaultUrl nor presets cannot be saved by a user who does not know the
 * endpoint by heart (Agnes shipped that way once — blank URL field, empty
 * model list, nothing clickable).
 */
describe('vendor catalog: configurability invariants', () => {
  it('every key-bearing vendor is either keyless, has a defaultUrl, or carries presets', () => {
    for (const v of VENDORS) {
      if (v.ollamaLike || v.codexLike || INTENTIONALLY_BLANK.has(v.id)) continue
      if (!v.defaultUrl && !(v.presets?.length ?? 0)) {
        throw new Error(
          `${v.id}: no defaultUrl and no presets — the settings form opens with a blank URL and no model fallback`,
        )
      }
    }
  })

  it('agnes-ai carries the harness-parity entry (URL, key/docs links, curated presets)', () => {
    const agnes = VENDOR_BY_ID.get('agnes-ai')!
    expect(agnes.defaultUrl).toBe('https://api.agnes-ai.cn/v1')
    expect(agnes.keyUrl).toBe('https://www.agnes-ai.cn')
    expect(agnes.docsUrl).toBe('https://wiki.agnes-ai.cn/zh-Hans/docs/overview')
    expect(agnes.free).toBe('freekey')
    // curated chat tiers — fetch works live, but the free tier rate-limits and
    // the presets are the fetchModels fallback
    expect(agnes.presets?.map((m) => m.id)).toEqual([
      'agnes-2.5-flash',
      'agnes-3.0-flash',
      'agnes-2.5-pro-beta',
      'agnes-2.5-pro',
    ])
  })

  it('keeps NO_MODELS_API honest: agnes serves a live /models endpoint', () => {
    expect(NO_MODELS_API.has('agnes-ai')).toBe(false)
  })
})
