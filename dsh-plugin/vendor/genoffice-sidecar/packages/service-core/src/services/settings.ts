/**
 * Settings service (plan v2.1, decision #3): app settings (language, theme,
 * AI provider credentials in later phases) read/write one JSON document in
 * the default storage area. On the local track this is the userData
 * equivalent; on cloud/embedded the same logic serves the account settings.
 *
 * Write failures throw (settings are user-visible state, unlike chat appends
 * which must never break a turn).
 */

import { join } from 'node:path'
import type { StorageArea } from '@genoffice/storage-adapter'
import { openLocalArea } from '@genoffice/storage-adapter'
import type { ServiceContext } from '../runtime.js'
import { defineService, ServiceEmitter } from '../runtime.js'

const SETTINGS_PATH = 'settings.json'

export interface SettingsApi {
  getAll<T extends Record<string, unknown>>(): T
  get<T>(key: string): T | undefined
  set(key: string, value: unknown): void
  /** Merges and persists a partial settings object */
  patch(values: Record<string, unknown>): void
}

function readAll(context: ServiceContext): Record<string, unknown> {
  const fs = context.storage.defaultArea().fs
  try {
    if (!fs.existsSync(SETTINGS_PATH)) return {}
    return JSON.parse(fs.readFileSync(SETTINGS_PATH)) as Record<string, unknown>
  } catch {
    return {}
  }
}

function writeAll(context: ServiceContext, values: Record<string, unknown>): void {
  const fs = context.storage.defaultArea().fs
  if (!fs.existsSync('')) fs.mkdirSync('')
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(values, null, 2))
}

export function settingsService() {
  return defineService<SettingsApi>({
    name: 'settings',
    create(context: ServiceContext): SettingsApi {
      return {
        getAll<T extends Record<string, unknown>>(): T {
          return readAll(context) as T
        },
        get<T>(key: string): T | undefined {
          return readAll(context)[key] as T | undefined
        },
        set(key: string, value: unknown): void {
          const all = readAll(context)
          all[key] = value
          writeAll(context, all)
        },
        patch(values: Record<string, unknown>): void {
          writeAll(context, { ...readAll(context), ...values })
        },
      }
    },
  })
}

/** Standalone convenience for Electron main / tests (mirrors createChatHistoryApi). */
export function createSettingsApi(params: { userDataPath?: string; area?: StorageArea }): SettingsApi {
  const area =
    params.area ?? openLocalArea({ rootDir: join(params.userDataPath ?? '.', 'settings') })
  const context: ServiceContext = {
    events: new ServiceEmitter(),
    storage: { defaultArea: () => area },
  }
  return settingsService().create(context)
}
