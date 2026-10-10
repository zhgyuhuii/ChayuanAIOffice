/**
 * listMediaModels（插入媒体对话框的模型清单）必须与设置页「生图、媒体与搜索」
 * 的资格裁定一致：image 清单是 model-driven —— 只要启用的 profile 里有
 * image-generation 类型的模型就列出，不看 vendor 白名单。曾卡
 * IMAGE_GEN_VENDOR_IDS，导致设置页里能设默认生图的自定义/中转站 profile 在
 * 对话框下拉里凭空消失。video 维持 vendor 白名单（适配器按 vendor 接线）。
 */
import { describe, expect, it } from 'vitest'
import { createAiRuntime } from '../src/runtime'
import {
  getMediaJobAdapter,
  resolveVideoAdapterVendor,
} from '../src/media-jobs'
import type { AiSettingsSource } from '../src/settings-source'
import type { AiSettingsV2 } from '../src/types'

const relaySettings = (vendorId: string): AiSettingsV2 =>
  ({
    version: 2,
    profiles: [
      {
        id: 'p1',
        vendorId,
        displayName: 'Relay',
        protocol: 'openai-completions',
        baseUrl: 'https://relay.example.com/v1',
        apiKey: 'sk-test',
        auth: 'api-key',
        enabled: true,
        models: [
          { id: 'gpt-image-x', type: 'image-generation' },
          { id: 'veo-x', type: 'video-generation' },
          { id: 'gpt-chat', type: 'chat' },
        ],
      },
    ],
  }) as unknown as AiSettingsV2

const runtimeWith = (settings: AiSettingsV2): ReturnType<typeof createAiRuntime> =>
  createAiRuntime({
    source: { read: async () => settings, write: async () => {} } satisfies AiSettingsSource,
    chatoffice: {
      apiKey: () => '',
      hasAuth: () => false,
      status: async () => ({ loggedIn: false }),
    },
    translate: (key) => key,
  })

describe('listMediaModels', () => {
  it('lists image AND video models for a custom openai-wire vendor', async () => {
    // image is model-driven; video now resolves through the profile's wire
    // protocol (videos 协议 on the profile's own baseUrl) — the whitelist
    // previously hid both kinds for custom/relay profiles
    const runtime = runtimeWith(relaySettings('my-relay'))
    const models = await runtime.listMediaModels()
    expect(models).toEqual([
      expect.objectContaining({ kind: 'image', profileId: 'p1', modelId: 'gpt-image-x' }),
      expect.objectContaining({ kind: 'video', profileId: 'p1', modelId: 'veo-x' }),
    ])
  })

  it("lists agnes's video model (catalog vendor, no dedicated adapter)", async () => {
    // agnes is a catalog vendor with an openai-compatible endpoint but no
    // vendor-specific MediaJobClient registration — the reported case
    const runtime = runtimeWith(relaySettings('agnes'))
    const models = await runtime.listMediaModels()
    expect(models).toEqual([
      expect.objectContaining({ kind: 'image', modelId: 'gpt-image-x' }),
      expect.objectContaining({ kind: 'video', modelId: 'veo-x' }),
    ])
  })

  it('still lists image models for catalog vendors (no regression)', async () => {
    const runtime = runtimeWith(relaySettings('openai'))
    const models = await runtime.listMediaModels()
    expect(models).toEqual([
      expect.objectContaining({ kind: 'image', modelId: 'gpt-image-x' }),
      expect.objectContaining({ kind: 'video', modelId: 'veo-x' }),
    ])
  })

  it('lists video models on generic OpenAI-compatible vendors (openAiVideosAdapter)', async () => {
    // relay/oneapi-style gateways proxy the {base}/videos protocol on their
    // own baseUrl — previously the vendor whitelist hid these models, so the
    // insert-media dialog's video picker stayed empty despite a configured model
    const runtime = runtimeWith(relaySettings('openai-compatible'))
    const models = await runtime.listMediaModels()
    expect(models).toEqual([
      expect.objectContaining({ kind: 'image', modelId: 'gpt-image-x' }),
      expect.objectContaining({ kind: 'video', modelId: 'veo-x' }),
    ])
    const adapter = getMediaJobAdapter('openai-compatible')
    expect(adapter).toBeTruthy()
  })

  it('hides video for profiles whose protocol cannot serve it (anthropic wire)', async () => {
    const settings = relaySettings('my-anthropic-relay')
    settings.profiles[0]!.protocol = 'anthropic-messages'
    const models = await runtimeWith(settings).listMediaModels()
    expect(models).toEqual([
      expect.objectContaining({ kind: 'image', modelId: 'gpt-image-x' }),
    ])
  })

  it('skips disabled profiles', async () => {
    const settings = relaySettings('my-relay')
    settings.profiles[0]!.enabled = false
    const models = await runtimeWith(settings).listMediaModels()
    expect(models).toEqual([])
  })
})

describe('resolveVideoAdapterVendor', () => {
  it('keeps dedicated registrations and maps the rest through the wire protocol', () => {
    // dedicated adapters win
    expect(resolveVideoAdapterVendor('kling', 'openai-completions')).toBe('kling')
    expect(resolveVideoAdapterVendor('openai', undefined)).toBe('openai')
    // catalog/custom vendors ride the protocol-level adapters
    expect(resolveVideoAdapterVendor('agnes', 'openai-completions')).toBe('openai')
    expect(resolveVideoAdapterVendor('my-relay', 'openai-responses')).toBe('openai')
    expect(resolveVideoAdapterVendor('my-gemini-relay', 'gemini-native')).toBe('gemini')
    // anthropic wire has no video API: unchanged so runMediaJob's error surfaces
    expect(resolveVideoAdapterVendor('my-anthropic-relay', 'anthropic-messages')).toBe(
      'my-anthropic-relay',
    )
  })
})
