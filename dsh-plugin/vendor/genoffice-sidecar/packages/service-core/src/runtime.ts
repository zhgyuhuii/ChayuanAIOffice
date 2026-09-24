/**
 * Service-core runtime (plan v2.1, decision #6).
 *
 * All handler business logic lives in services created here. A service is a
 * factory receiving a ServiceContext and returning its typed API (the same
 * request/response types the preload bridges expose today). Hosts:
 *
 *   - Electron main: createCore() once, IPC handlers forward to core.api.*
 *   - BFF (Fastify): createCore() once, routes forward to core.api.*
 *   - tests: createCore() with temp areas
 *
 * Push channels (AI stream chunks, file-change notifications) flow through the
 * shared emitter; each host forwards emitter events over its own transport
 * (webContents.send / WebSocket).
 */

import type { StorageArea, StorageTrack } from '@genoffice/storage-adapter'

// ── Event bus ───────────────────────────────────────────────

export type Listener<T> = (payload: T) => void

/** Minimal typed pub/sub; unsubscribing is idempotent. */
export class ServiceEmitter {
  private readonly listeners = new Map<string, Set<Listener<unknown>>>()

  on<T>(event: string, listener: Listener<T>): () => void {
    const set = this.listeners.get(event) ?? new Set()
    set.add(listener as Listener<unknown>)
    this.listeners.set(event, set)
    return () => set.delete(listener as Listener<unknown>)
  }

  emit<T>(event: string, payload: T): void {
    const set = this.listeners.get(event)
    if (!set) return
    for (const listener of [...set]) {
      try {
        listener(payload)
      } catch (err) {
        console.warn(`[service-core] listener for "${event}" threw:`, err)
      }
    }
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0
  }
}

// ── Context ─────────────────────────────────────────────────

/**
 * Area registry the host fills in. The default area backs account-local
 * stores (chat history today); named tracks arrive with cloud documents
 * (decision #17: history follows the document's track).
 */
export interface StorageRegistry {
  defaultArea(): StorageArea
  areaFor?(track: StorageTrack): StorageArea
}

export interface ServiceContext {
  events: ServiceEmitter
  storage: StorageRegistry
}

// ── Service definition & core assembly ──────────────────────

export interface ServiceDefinition<TApi> {
  /** Stable service name; doubles as the api key on the core. */
  name: string
  create(context: ServiceContext): TApi
}

export function defineService<TApi>(definition: ServiceDefinition<TApi>): ServiceDefinition<TApi> {
  return definition
}

export interface CoreOptions {
  storage: StorageRegistry
  /** Extra context fields for host-specific wiring (kept minimal on purpose). */
  events?: ServiceEmitter
}

export interface ServiceCore<TServices extends Record<string, ServiceDefinition<unknown>>> {
  events: ServiceEmitter
  storage: StorageRegistry
  /** api[serviceName] → that service's API instance */
  api: { [K in keyof TServices]: TServices[K] extends ServiceDefinition<infer TApi> ? TApi : never }
}

export function createCore<TServices extends Record<string, ServiceDefinition<unknown>>>(
  services: TServices,
  options: CoreOptions,
): ServiceCore<TServices> {
  const events = options.events ?? new ServiceEmitter()
  const context: ServiceContext = { events, storage: options.storage }
  const api = {} as ServiceCore<TServices>['api']
  for (const [key, definition] of Object.entries(services)) {
    ;(api as Record<string, unknown>)[key] = definition.create(context)
  }
  return { events, storage: options.storage, api }
}
