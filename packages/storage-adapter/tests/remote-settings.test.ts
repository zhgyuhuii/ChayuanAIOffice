import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  applyRemoteStorageEnvSeed,
  createRemoteStorageConfig,
  defaultSaveKey,
  DEFAULT_REMOTE_PREFIX,
  emptyRemoteStorageSettings,
  normalizeRemoteStorageSettings,
  readRemoteStorageSettingsFile,
  resolveDefaultSaveTarget,
  validateRemoteStorageConfig,
  writeRemoteStorageSettingsFile,
} from '../src/index.js'
import type { RemoteStorageConfig } from '../src/index.js'

const dirs: string[] = []

function tempFile(name = 'storage-settings.json'): string {
  const dir = mkdtempSync(join(tmpdir(), 'chatoffice-storage-settings-'))
  dirs.push(dir)
  return join(dir, name)
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function validConfig(overrides: Partial<RemoteStorageConfig> = {}): RemoteStorageConfig {
  const base: RemoteStorageConfig = {
    id: 'cfg-1',
    name: 'Company MinIO',
    protocol: 's3',
    endpoint: 'http://minio.internal:9000',
    region: 'us-east-1',
    bucket: 'docs',
    accessKeyId: 'AK',
    secretAccessKey: 'SK',
    prefix: DEFAULT_REMOTE_PREFIX,
    pathStyle: true,
    enabled: true,
  }
  return { ...base, ...overrides }
}

describe('normalizeRemoteStorageSettings', () => {
  it('fills defaults on empty input', () => {
    expect(normalizeRemoteStorageSettings(undefined)).toEqual({
      version: 1,
      configs: [],
      defaultLocation: null,
    })
  })

  it('drops junk configs, duplicate ids and dangling default pointers', () => {
    const settings = normalizeRemoteStorageSettings({
      configs: [
        validConfig(),
        validConfig({ id: 'cfg-1', name: 'duplicate' }),
        'garbage',
        { id: 'bad/id', endpoint: 'https://x' },
      ],
      defaultLocation: { configId: 'missing' },
    })
    expect(settings.configs).toHaveLength(1)
    expect(settings.defaultLocation).toBeNull()
  })

  it('coerces protocol and flags defensively', () => {
    const config = normalizeRemoteStorageSettings({
      configs: [
        { id: 'c', endpoint: 'https://x', protocol: 'weird', pathStyle: 'yes', enabled: false },
      ],
    }).configs[0]
    expect(config?.protocol).toBe('s3')
    expect(config?.pathStyle).toBe(false)
    expect(config?.enabled).toBe(false)
    expect(config?.prefix).toBe(DEFAULT_REMOTE_PREFIX)
  })
})

describe('createRemoteStorageConfig / validateRemoteStorageConfig', () => {
  it('generates an id and default prefix when omitted', () => {
    const config = createRemoteStorageConfig({
      name: 'Aliyun',
      endpoint: 'https://oss.cn',
    } as never)
    expect(config.id).toBeTruthy()
    expect(config.prefix).toBe(DEFAULT_REMOTE_PREFIX)
    expect(config.enabled).toBe(true)
    expect(config.pathStyle).toBe(false)
  })

  it('keeps a provided safe id', () => {
    expect(
      createRemoteStorageConfig({ id: 'env-default', name: 'x', endpoint: 'https://x' } as never)
        .id,
    ).toBe('env-default')
  })

  it('collects validation failures', () => {
    const bad = {
      ...validConfig(),
      name: '   ',
      endpoint: 'not-a-url',
      region: '',
      bucket: 'a/b',
      accessKeyId: '',
      secretAccessKey: '',
    }
    const errors = validateRemoteStorageConfig(bad)
    expect(errors).toContain('name is required')
    expect(errors).toContain('endpoint must be an absolute http(s) URL')
    expect(errors).toContain('region is required')
    expect(errors).toContain('bucket must be a single path segment')
    expect(errors).toContain('accessKeyId is required')
    expect(errors).toContain('secretAccessKey is required')
    expect(validateRemoteStorageConfig(validConfig())).toEqual([])
  })
})

describe('settings file round-trip', () => {
  it('writes atomically with mode 0600 and reads back', () => {
    const file = tempFile()
    const settings = {
      version: 1,
      configs: [validConfig()],
      defaultLocation: { configId: 'cfg-1' },
    }
    writeRemoteStorageSettingsFile(file, settings)
    expect(existsSync(`${file}.tmp-`)).toBe(false)
    if (process.platform !== 'win32') {
      expect(statSync(file).mode & 0o777).toBe(0o600)
    }
    expect(readRemoteStorageSettingsFile(file)).toEqual(settings)
  })

  it('tightens the mode of an existing loose file', () => {
    const file = tempFile()
    writeFileSync(file, '{}', { mode: 0o644 })
    chmodSync(file, 0o644)
    writeRemoteStorageSettingsFile(file, emptyRemoteStorageSettings())
    if (process.platform !== 'win32') {
      expect(statSync(file).mode & 0o777).toBe(0o600)
    }
  })

  it('returns null for missing or corrupt files', () => {
    expect(readRemoteStorageSettingsFile(tempFile('missing.json'))).toBeNull()
    const corrupt = tempFile()
    writeFileSync(corrupt, '{not json')
    expect(readRemoteStorageSettingsFile(corrupt)).toBeNull()
  })

  it('serializes with a trailing newline and stable shape', () => {
    const file = tempFile()
    writeRemoteStorageSettingsFile(file, emptyRemoteStorageSettings())
    expect(readFileSync(file, 'utf8').endsWith('\n')).toBe(true)
  })
})

describe('applyRemoteStorageEnvSeed', () => {
  const env = {
    CHATOFFICE_STORAGE_ENDPOINT: 'http://minio:9000',
    CHATOFFICE_STORAGE_BUCKET: 'docs',
    CHATOFFICE_STORAGE_ACCESS_KEY_ID: 'AK',
    CHATOFFICE_STORAGE_SECRET_ACCESS_KEY: 'SK',
    CHATOFFICE_STORAGE_NAME: 'Docker MinIO',
    CHATOFFICE_STORAGE_PATH_STYLE: 'true',
    CHATOFFICE_STORAGE_PREFIX: 'office/',
  }

  it('seeds an empty config list and points the default location at it', () => {
    const seeded = applyRemoteStorageEnvSeed(emptyRemoteStorageSettings(), env)
    expect(seeded.configs).toHaveLength(1)
    const config = seeded.configs[0]
    expect(config.id).toBe('env-default')
    expect(config.name).toBe('Docker MinIO')
    expect(config.pathStyle).toBe(true)
    expect(config.prefix).toBe('office/')
    expect(seeded.defaultLocation).toEqual({ configId: 'env-default' })
  })

  it('never overrides existing configs', () => {
    const existing = {
      version: 1,
      configs: [validConfig()],
      defaultLocation: { configId: 'cfg-1' },
    }
    expect(applyRemoteStorageEnvSeed(existing, env)).toBe(existing)
  })

  it('requires the mandatory variables', () => {
    expect(
      applyRemoteStorageEnvSeed(emptyRemoteStorageSettings(), {
        CHATOFFICE_STORAGE_ENDPOINT: 'http://x',
      }).configs,
    ).toHaveLength(0)
  })
})

describe('resolveDefaultSaveTarget / defaultSaveKey', () => {
  it('resolves config + effective prefix with a trailing slash', () => {
    const settings = {
      version: 1,
      configs: [validConfig({ prefix: 'office' })],
      defaultLocation: { configId: 'cfg-1', prefix: 'reports' },
    }
    expect(resolveDefaultSaveTarget(settings)).toEqual({
      config: settings.configs[0],
      prefix: 'reports/',
    })
    expect(defaultSaveKey(settings, 'a.docx')?.key).toBe('reports/a.docx')
  })

  it('falls back to the config prefix, and returns null when unset/disabled/missing', () => {
    const withConfigPrefix = {
      version: 1,
      configs: [validConfig()],
      defaultLocation: { configId: 'cfg-1' },
    }
    expect(resolveDefaultSaveTarget(withConfigPrefix)?.prefix).toBe(DEFAULT_REMOTE_PREFIX)
    expect(defaultSaveKey(withConfigPrefix, 'a.docx')?.key).toBe(`${DEFAULT_REMOTE_PREFIX}a.docx`)

    const disabled = {
      version: 1,
      configs: [validConfig({ enabled: false })],
      defaultLocation: { configId: 'cfg-1' },
    }
    expect(resolveDefaultSaveTarget(disabled)).toBeNull()
    expect(resolveDefaultSaveTarget(emptyRemoteStorageSettings())).toBeNull()
    expect(defaultSaveKey(emptyRemoteStorageSettings(), 'a.docx')).toBeNull()
  })
})
