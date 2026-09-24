/**
 * imageSource sidecar key: v2 blobs keep a valid value through the normalize
 * round-trip; invalid values are dropped (old blobs, typos). The legacy v1
 * path has no source field and must not invent one.
 */
import { describe, expect, it } from 'vitest'
import { migrateSettingsV2 } from '../src/settings-v2'

const baseV2 = () =>
  migrateSettingsV2({
    version: 2,
    profiles: [
      {
        id: 'p1',
        displayName: 'P1',
        protocol: 'openai-completions',
        baseUrl: 'https://api.example.com/v1',
        auth: 'api-key',
        enabled: true,
        models: [{ id: 'm1' }],
      },
    ],
  })

describe('imageSource setting', () => {
  it('defaults to undefined (auto) when absent', () => {
    expect(baseV2().imageSource).toBeUndefined()
  })

  it('keeps a valid value through the normalize round-trip', () => {
    for (const source of ['auto', 'web', 'model', 'local', 'svg'] as const) {
      const settings = baseV2()
      settings.imageSource = source
      const r = migrateSettingsV2(JSON.parse(JSON.stringify(settings)))
      expect(r.imageSource).toBe(source)
    }
  })

  it('drops invalid values instead of carrying them', () => {
    const settings = baseV2() as unknown as Record<string, unknown>
    settings.imageSource = 'sketch'
    const r = migrateSettingsV2(settings as never)
    expect(r.imageSource).toBeUndefined()
  })
})
