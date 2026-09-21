import { describe, expect, it } from 'vitest'
import type { AiSettingsV2 } from '@chatoffice/ai-provider'
import {
  hasMediaCapability,
  resolveMediaCapability,
  resolveMediaCapabilityChain,
} from '../src/capability-runtime'

const settings = (models: Array<{ id: string; type?: string }>): AiSettingsV2 =>
  ({
    version: 2,
    profiles: [
      {
        id: 'p1',
        displayName: 'P1',
        protocol: 'openai-completions',
        baseUrl: 'https://example.com/v1',
        apiKey: 'sk-test',
        auth: 'api-key',
        enabled: true,
        models: models.map((m) => ({ ...m })),
      },
    ],
  }) as unknown as AiSettingsV2

describe('resolveMediaCapability', () => {
  it('resolves an explicit image default', async () => {
    const s = settings([{ id: 'img-model', type: 'image-generation' }])
    const call = await resolveMediaCapability(s, 'image')
    expect(call?.model).toBe('img-model')
    expect(call?.apiKey).toBe('sk-test')
    expect(call?.protocol).toBe('openai-compatible') // wire 'openai-completions' maps here
  })

  it('auto-detects by inferred model type when no default is set', async () => {
    const s = settings([{ id: 'whisper-1' }])
    const call = await resolveMediaCapability(s, 'asr')
    expect(call?.model).toBe('whisper-1')
  })

  it('returns undefined when nothing of the kind is configured', async () => {
    const s = settings([{ id: 'gpt-x' }])
    expect(await resolveMediaCapability(s, 'video')).toBeUndefined()
    expect(await resolveMediaCapability(s, 'tts')).toBeUndefined()
  })

  it('treats a keyless profile as not resolvable', async () => {
    const s = settings([{ id: 'fake-video', type: 'video-generation' }])
    ;(s.profiles[0] as { apiKey: string }).apiKey = ''
    expect(await resolveMediaCapability(s, 'video')).toBeUndefined()
    expect(hasMediaCapability(s, 'video')).toBe(false)
  })

  it('falls back to the resolveSecret hook for reference-only profiles', async () => {
    const s = settings([{ id: 'tts-1' }])
    ;(s.profiles[0] as { apiKey: string }).apiKey = ''
    const call = await resolveMediaCapability(s, 'tts', {
      resolveSecret: async () => 'sk-harness',
    })
    expect(call?.apiKey).toBe('sk-harness')
  })
})

describe('resolveMediaCapabilityChain', () => {
  it('orders the default first, then the remaining capable models', async () => {
    const s = settings([{ id: 'img-b' }, { id: 'chat-1' }, { id: 'img-a' }]) as Awaited<
      ReturnType<typeof resolveMediaCapability>
    > extends never
      ? never
      : Parameters<typeof resolveMediaCapabilityChain>[0]
    const chain = await resolveMediaCapabilityChain(s, 'image')
    // explicit default unset → auto picks the first image-gen model (img-b);
    // the chain then appends the rest in profile/model order
    expect(chain.map((c) => c.model)).toEqual(['img-b', 'img-a'])
  })

  it('is empty when nothing of the kind is configured', async () => {
    const s = settings([{ id: 'chat-1' }])
    expect(await resolveMediaCapabilityChain(s, 'video')).toEqual([])
  })
})
