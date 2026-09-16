import { describe, expect, it } from 'vitest'
import {
  SEARCH_PLATFORMS,
  capabilityVendorRows,
  modelHasCapability,
  profileCapabilityModels,
  resolveCapabilityDefault,
} from '../src/capability-tree'
import { migrateSettingsV2 } from '../src/settings-v2'
import type { AiProviderProfile, AiSettingsV2 } from '../src/types'

const profile = (over: Partial<AiProviderProfile>): AiProviderProfile => ({
  id: 'test',
  displayName: 'Test',
  protocol: 'openai-completions',
  baseUrl: 'https://api.test/v1',
  apiKey: 'sk-test',
  auth: 'api-key',
  enabled: true,
  models: [],
  ...over,
})

const settingsWith = (...profiles: AiProviderProfile[]): AiSettingsV2 =>
  migrateSettingsV2({ version: 2, profiles })

describe('capability-tree vendor rows', () => {
  it('lists image-gen vendors with enabled ones first', () => {
    const settings = settingsWith(
      profile({
        id: 'zhipu',
        vendorId: 'zhipu',
        displayName: 'GLM',
        models: [{ id: 'cogview-4' }],
      }),
    )
    const rows = capabilityVendorRows(settings, 'imageGen')
    const ids = rows.map((r) => r.vendorId)
    expect(ids).toContain('zhipu')
    expect(ids).toContain('openai')
    expect(ids).toContain('gemini')
    expect(ids.indexOf('zhipu')).toBeLessThan(ids.indexOf('openai'))
    expect(rows.find((r) => r.vendorId === 'zhipu')?.enabled).toBe(true)
    expect(rows.find((r) => r.vendorId === 'openai')?.enabled).toBe(false)
  })

  it('video understanding covers exactly the video-capable vendors', () => {
    const settings = settingsWith()
    const ids = capabilityVendorRows(settings, 'videoUnderstanding').map((r) => r.vendorId)
    expect(ids.sort()).toEqual(['aliyun-bailian', 'chatoffice', 'gemini', 'volcengine', 'zhipu'])
  })

  it('svg generation lists enabled profiles only', () => {
    const settings = settingsWith(
      profile({ id: 'deepseek', vendorId: 'deepseek', displayName: 'DeepSeek' }),
      profile({ id: 'off', displayName: 'Off', enabled: false }),
    )
    const rows = capabilityVendorRows(settings, 'svgGeneration')
    expect(rows.map((r) => r.vendorId)).toEqual(['deepseek'])
  })
})

describe('capability model filters', () => {
  it('filters image/video generation by model id', () => {
    const p = profile({ id: 'gemini', vendorId: 'gemini' })
    expect(modelHasCapability('imageGen', p, { id: 'gemini-3.1-flash-image' })).toBe(true)
    expect(modelHasCapability('imageGen', p, { id: 'gemini-3.7-flash' })).toBe(false)
    expect(modelHasCapability('videoGen', p, { id: 'veo-4' })).toBe(true)
  })

  it('image understanding follows the capability matrix (vision input)', () => {
    const openai = profile({ id: 'openai', vendorId: 'openai' })
    expect(modelHasCapability('imageUnderstanding', openai, { id: 'gpt-5.6' })).toBe(true)
    const deepseek = profile({ id: 'deepseek', vendorId: 'deepseek' })
    expect(modelHasCapability('imageUnderstanding', deepseek, { id: 'deepseek-v4-flash' })).toBe(
      false,
    )
  })

  it('video understanding only on native video input (gemini/qwen-vl/glm-4v)', () => {
    const gemini = profile({ id: 'gemini', vendorId: 'gemini', protocol: 'gemini-native' })
    expect(modelHasCapability('videoUnderstanding', gemini, { id: 'gemini-3.7-flash' })).toBe(true)
    const openai = profile({ id: 'openai', vendorId: 'openai' })
    expect(modelHasCapability('videoUnderstanding', openai, { id: 'gpt-5.6' })).toBe(false)
    const qwen = profile({ id: 'aliyun-bailian', vendorId: 'aliyun-bailian' })
    expect(modelHasCapability('videoUnderstanding', qwen, { id: 'qwen3-vl-plus' })).toBe(true)
    expect(modelHasCapability('videoUnderstanding', qwen, { id: 'qwen3.8-max' })).toBe(false)
  })
})

describe('resolveCapabilityDefault', () => {
  it('image generation rides the legacy imageModel field', () => {
    const settings = settingsWith(
      profile({
        id: 'openai',
        vendorId: 'openai',
        models: [{ id: 'gpt-5.6' }, { id: 'gpt-image-2' }],
      }),
    )
    expect(resolveCapabilityDefault(settings, 'imageGen')).toEqual({
      profileId: 'openai',
      modelId: 'gpt-image-2',
    })
    const picked = { ...settings, imageModel: { profileId: 'openai', modelId: 'gpt-image-2' } }
    expect(resolveCapabilityDefault(picked, 'imageGen')).toEqual({
      profileId: 'openai',
      modelId: 'gpt-image-2',
    })
  })

  it('explicit modelDefaults win when they still qualify', () => {
    const base = settingsWith(
      profile({
        id: 'zhipu',
        vendorId: 'zhipu',
        models: [{ id: 'glm-4.6v' }, { id: 'glm-5-air' }],
      }),
    )
    expect(resolveCapabilityDefault(base, 'imageUnderstanding')).toEqual({
      profileId: 'zhipu',
      modelId: 'glm-4.6v',
    })
    // glm-5-air is a chat model on a vision-capable vendor → still qualifies
    const explicit: AiSettingsV2 = {
      ...base,
      modelDefaults: { imageUnderstanding: { profileId: 'zhipu', modelId: 'glm-5-air' } },
    }
    expect(resolveCapabilityDefault(explicit, 'imageUnderstanding')).toEqual({
      profileId: 'zhipu',
      modelId: 'glm-5-air',
    })
    // a pick on a vendor outside the capability set is ignored in favor of auto
    const foreign: AiSettingsV2 = {
      ...base,
      modelDefaults: { imageUnderstanding: { profileId: 'nope', modelId: 'x' } },
    }
    expect(resolveCapabilityDefault(foreign, 'imageUnderstanding')).toEqual({
      profileId: 'zhipu',
      modelId: 'glm-4.6v',
    })
  })

  it('skips vendors outside the capability set when auto-detecting', () => {
    const settings = settingsWith(
      profile({ id: 'deepseek', vendorId: 'deepseek', models: [{ id: 'deepseek-v4-flash' }] }),
      profile({
        id: 'gemini',
        vendorId: 'gemini',
        protocol: 'gemini-native',
        models: [{ id: 'gemini-3.7-flash' }],
      }),
    )
    expect(resolveCapabilityDefault(settings, 'imageUnderstanding')).toEqual({
      profileId: 'gemini',
      modelId: 'gemini-3.7-flash',
    })
  })

  it('svg generation accepts any enabled chat model', () => {
    const settings = settingsWith(
      profile({ id: 'deepseek', vendorId: 'deepseek', models: [{ id: 'deepseek-v4-flash' }] }),
    )
    expect(resolveCapabilityDefault(settings, 'svgGeneration')).toEqual({
      profileId: 'deepseek',
      modelId: 'deepseek-v4-flash',
    })
  })

  it('profileCapabilityModels returns only qualifying entries of enabled profiles', () => {
    const settings = settingsWith(
      profile({
        id: 'openai',
        vendorId: 'openai',
        models: [{ id: 'gpt-5.6' }, { id: 'gpt-image-2' }, { id: 'text-embedding-3' }],
      }),
    )
    expect(profileCapabilityModels(settings, 'imageGen', 'openai').map((m) => m.id)).toEqual([
      'gpt-image-2',
    ])
  })
})

describe('search platforms registry', () => {
  it('covers the nine user-facing platforms with metadata', () => {
    expect(SEARCH_PLATFORMS.map((p) => p.id)).toEqual([
      'serper',
      'tavily',
      'linkup',
      'searxng',
      'duckduckgo',
      'bing',
      'pexels',
      'pixabay',
      'unsplash',
    ])
    for (const p of SEARCH_PLATFORMS) {
      expect(p.descZh.length).toBeGreaterThan(4)
      expect(p.descEn.length).toBeGreaterThan(4)
      if (p.needsKey && p.id !== 'searxng') expect(p.keyUrl).toBeTruthy()
    }
  })

  it('image-search-capable platforms are exactly serper/bing plus the stock trio', () => {
    expect(SEARCH_PLATFORMS.filter((p) => p.imageSearch).map((p) => p.id)).toEqual([
      'serper',
      'bing',
      'pexels',
      'pixabay',
      'unsplash',
    ])
  })
})

describe('settings roundtrip of the new default kinds', () => {
  it('normalizeV2 keeps imageUnderstanding/videoUnderstanding/svgGeneration picks', () => {
    const stored: AiSettingsV2 = {
      version: 2,
      profiles: [
        profile({
          id: 'gemini',
          vendorId: 'gemini',
          protocol: 'gemini-native',
          models: [{ id: 'gemini-3.7-flash' }, { id: 'veo-4' }],
        }),
        profile({ id: 'deepseek', vendorId: 'deepseek', models: [{ id: 'deepseek-v4-flash' }] }),
      ],
      modelDefaults: {
        imageUnderstanding: { profileId: 'gemini', modelId: 'gemini-3.7-flash' },
        videoUnderstanding: { profileId: 'gemini', modelId: 'gemini-3.7-flash' },
        svgGeneration: { profileId: 'deepseek', modelId: 'deepseek-v4-flash' },
      },
    }
    const next = migrateSettingsV2(stored)
    expect(next.modelDefaults).toEqual(stored.modelDefaults)
    expect(resolveCapabilityDefault(next, 'svgGeneration')).toEqual({
      profileId: 'deepseek',
      modelId: 'deepseek-v4-flash',
    })
  })
})
