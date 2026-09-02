/**
 * Persisted remote-storage settings: the provider config list plus the single
 * "default save location" pointer (plan consensus Q7/Q8).
 *
 * Storage follows the established ai-settings.json pattern: plaintext JSON,
 * file mode 0600 (no-op where the OS ignores modes), atomic tmp+rename writes.
 * Self-hosted deployments can seed a default config via CHATOFFICE_STORAGE_*
 * environment variables, mirroring how MINIO_ROOT_* is handled in compose.
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { RemoteStorageConfig, RemoteStorageProtocol, RemoteStorageSettings } from './types.js'

export const REMOTE_STORAGE_SETTINGS_VERSION = 1
export const DEFAULT_REMOTE_PREFIX = 'chatoffice/'
export const ENV_SEEDED_CONFIG_ID = 'env-default'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asProtocol(value: unknown): RemoteStorageProtocol {
  return value === 'aliyun-oss' ? 'aliyun-oss' : 's3'
}

function normalizeConfig(raw: unknown): RemoteStorageConfig | null {
  if (!isPlainObject(raw)) return null
  const id = asString(raw.id)
  if (!id || id.includes('/')) return null
  return {
    id,
    name: asString(raw.name) || 'Unnamed storage',
    protocol: asProtocol(raw.protocol),
    endpoint: asString(raw.endpoint).replace(/\/+$/, ''),
    region: asString(raw.region),
    bucket: asString(raw.bucket),
    accessKeyId: asString(raw.accessKeyId),
    secretAccessKey: asString(raw.secretAccessKey),
    prefix: asString(raw.prefix) || DEFAULT_REMOTE_PREFIX,
    pathStyle: raw.pathStyle === true,
    enabled: raw.enabled !== false,
  }
}

/** Coerces unknown parsed JSON into a valid settings object, dropping junk entries. */
export function normalizeRemoteStorageSettings(raw: unknown): RemoteStorageSettings {
  const source = isPlainObject(raw) ? raw : {}
  const configs: RemoteStorageConfig[] = []
  const seen = new Set<string>()
  for (const entry of Array.isArray(source.configs) ? source.configs : []) {
    const config = normalizeConfig(entry)
    if (config && !seen.has(config.id)) {
      seen.add(config.id)
      configs.push(config)
    }
  }
  let defaultLocation: RemoteStorageSettings['defaultLocation'] = null
  const rawDefault = isPlainObject(source.defaultLocation) ? source.defaultLocation : null
  if (rawDefault) {
    const configId = asString(rawDefault.configId)
    const prefix = asString(rawDefault.prefix)
    if (configId && seen.has(configId)) {
      defaultLocation = { configId, ...(prefix ? { prefix } : {}) }
    }
  }
  return { version: REMOTE_STORAGE_SETTINGS_VERSION, configs, defaultLocation }
}

export function emptyRemoteStorageSettings(): RemoteStorageSettings {
  return { version: REMOTE_STORAGE_SETTINGS_VERSION, configs: [], defaultLocation: null }
}

/** Creates a config with server-side defaults filled in (id, prefix, enabled). */
export function createRemoteStorageConfig(
  input: Omit<RemoteStorageConfig, 'id'> & Partial<Pick<RemoteStorageConfig, 'id'>>,
): RemoteStorageConfig {
  const id = input.id && !input.id.includes('/') ? input.id : randomUUID()
  return {
    ...input,
    id,
    name: input.name.trim() || 'Unnamed storage',
    protocol: input.protocol ?? 's3',
    endpoint: input.endpoint.replace(/\/+$/, ''),
    region: input.region ?? '',
    bucket: input.bucket ?? '',
    accessKeyId: input.accessKeyId ?? '',
    secretAccessKey: input.secretAccessKey ?? '',
    prefix: input.prefix?.trim() || DEFAULT_REMOTE_PREFIX,
    pathStyle: input.pathStyle === true,
    enabled: input.enabled !== false,
  }
}

/** Returns human-readable validation failures; an empty list means the config is usable. */
export function validateRemoteStorageConfig(config: RemoteStorageConfig): string[] {
  const errors: string[] = []
  if (!config.name.trim()) errors.push('name is required')
  try {
    const url = new URL(config.endpoint)
    if (url.protocol !== 'https:' && url.protocol !== 'http:')
      errors.push('endpoint must be an http(s) URL')
  } catch {
    errors.push('endpoint must be an absolute http(s) URL')
  }
  if (!config.region.trim()) errors.push('region is required')
  if (!config.bucket.trim() || config.bucket.includes('/'))
    errors.push('bucket must be a single path segment')
  if (!config.accessKeyId.trim()) errors.push('accessKeyId is required')
  if (!config.secretAccessKey.trim()) errors.push('secretAccessKey is required')
  return errors
}

/** Reads and normalizes the settings file; null when missing or unreadable. */
export function readRemoteStorageSettingsFile(file: string): RemoteStorageSettings | null {
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return null
  }
  try {
    return normalizeRemoteStorageSettings(JSON.parse(raw))
  } catch {
    return null
  }
}

/** Atomically writes the settings file with mode 0600. */
export function writeRemoteStorageSettingsFile(
  file: string,
  settings: RemoteStorageSettings,
): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, file)
}

/**
 * Seeds a default config from CHATOFFICE_STORAGE_* environment variables, but
 * only into an otherwise-empty config list (env is a bootstrap, not an
 * override): ENDPOINT, REGION, BUCKET, ACCESS_KEY_ID, SECRET_ACCESS_KEY are
 * required; NAME, PROTOCOL, PREFIX, PATH_STYLE are optional.
 */
export function applyRemoteStorageEnvSeed(
  settings: RemoteStorageSettings,
  env: Record<string, string | undefined> = process.env,
): RemoteStorageSettings {
  if (settings.configs.length > 0) return settings
  const endpoint = env.CHATOFFICE_STORAGE_ENDPOINT
  const bucket = env.CHATOFFICE_STORAGE_BUCKET
  const accessKeyId = env.CHATOFFICE_STORAGE_ACCESS_KEY_ID
  const secretAccessKey = env.CHATOFFICE_STORAGE_SECRET_ACCESS_KEY
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return settings
  const config: RemoteStorageConfig = {
    id: ENV_SEEDED_CONFIG_ID,
    name: env.CHATOFFICE_STORAGE_NAME || 'Server storage',
    protocol: asProtocol(env.CHATOFFICE_STORAGE_PROTOCOL),
    endpoint: endpoint.replace(/\/+$/, ''),
    region: env.CHATOFFICE_STORAGE_REGION || 'us-east-1',
    bucket,
    accessKeyId,
    secretAccessKey,
    prefix: env.CHATOFFICE_STORAGE_PREFIX || DEFAULT_REMOTE_PREFIX,
    pathStyle:
      env.CHATOFFICE_STORAGE_PATH_STYLE === 'true' || env.CHATOFFICE_STORAGE_PATH_STYLE === '1',
    enabled: true,
  }
  return { ...settings, configs: [config], defaultLocation: { configId: config.id } }
}

export interface DefaultSaveTarget {
  config: RemoteStorageConfig
  /** Effective key prefix, always ending with `/`. */
  prefix: string
}

/** Resolves the default save location to an enabled config + effective prefix; null when unset or dangling. */
export function resolveDefaultSaveTarget(
  settings: RemoteStorageSettings,
): DefaultSaveTarget | null {
  const pointer = settings.defaultLocation
  if (!pointer) return null
  const config = settings.configs.find((entry) => entry.id === pointer.configId)
  if (!config || !config.enabled) return null
  const rawPrefix = pointer.prefix?.trim() || config.prefix || DEFAULT_REMOTE_PREFIX
  const prefix = rawPrefix.endsWith('/') ? rawPrefix : `${rawPrefix}/`
  return { config, prefix }
}

/** Builds the object key for a file saved into the default location. */
export function defaultSaveKey(
  settings: RemoteStorageSettings,
  fileName: string,
): { config: RemoteStorageConfig; key: string } | null {
  const target = resolveDefaultSaveTarget(settings)
  if (!target) return null
  return { config: target.config, key: `${target.prefix}${fileName}` }
}
