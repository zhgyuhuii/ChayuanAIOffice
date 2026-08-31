/**
 * BFF app assembly (plan v2.1, decisions #6 / #7).
 *
 * One Fastify instance, one service-core. Routes:
 *   GET  /healthz          — liveness + version
 *   POST /rpc/:service/:method — { args } → service API call (request/response channels)
 *   WS   /ws               — push gateway over the core emitter (stream channels)
 *
 * The same image serves the SaaS (form ②) and the embedded sidecar (forms ③④);
 * only configuration differs (auth on/off, storage roots).
 */

import { resolve } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import type { ServiceCore, ServiceDefinition } from '@genoffice/service-core'
import { createCore } from '@genoffice/service-core'
import { chatHistoryService } from '@genoffice/service-core'
import { settingsService } from '@genoffice/service-core'
import { xlsxSidecarService } from '@genoffice/service-core'
import { openLocalArea, type StorageArea } from '@genoffice/storage-adapter'
import { attachAuthHooks, type AuthOptions } from './auth.js'
import { attachWsGateway } from './ws-gateway.js'
import { attachAiProxy, type AiProxyOptions } from './ai-proxy.js'
import { attachStatic } from './static.js'
import { createPptxService } from './services/pptx.js'
import { createSheetsSaveService } from './services/sheets-save.js'

export interface ServerOptions {
  /** Data root for the local/embedded track (default: ./data) */
  dataDir?: string
  /** Pre-built area overrides (tests inject temp areas here) */
  area?: StorageArea
  auth?: AuthOptions
  ai?: AiProxyOptions
  /** Extra services to host alongside the defaults */
  services?: Record<string, ServiceDefinition<unknown>>
  /** Static web root (build:web output); serves the SPA on the same port */
  staticDir?: string
}

export interface BuiltServer {
  app: FastifyInstance
  core: ServiceCore<Record<string, ServiceDefinition<unknown>>>
}

export function defaultServices() {
  return {
    chatHistory: chatHistoryService(),
    settings: settingsService(),
    xlsx: xlsxSidecarService(),
  }
}

export function buildServer(options: ServerOptions = {}): BuiltServer {
  const dataDir = (options.dataDir ?? './data').replace(/\/$/, '')
  const area = options.area ?? openLocalArea({ rootDir: resolve(dataDir, 'area') })

  const services = { ...defaultServices(), ...options.services }
  const core = createCore(services, { storage: { defaultArea: () => area } })

  const app = Fastify({ logger: false })

  app.get('/healthz', async () => ({ ok: true, ts: new Date().toISOString() }))

  // RPC forwarding: POST /rpc/chatHistory/resolveChat  { "args": {...} }
  app.post<{ Params: { service: string; method: string } }>(
    '/rpc/:service/:method',
    async (request, reply) => {
      const service = (core.api as Record<string, unknown>)[request.params.service]
      if (!service) return reply.code(404).send({ error: `unknown service: ${request.params.service}` })
      const method = (service as Record<string, unknown>)[request.params.method]
      if (typeof method !== 'function') {
        return reply.code(404).send({ error: `unknown method: ${request.params.method}` })
      }
      const args = (request.body as { args?: unknown[] } | null)?.args ?? []
      try {
        const result = await (method as (...a: unknown[]) => unknown)(...args)
        return { ok: true, result }
      } catch (err) {
        return reply.code(400).send({ ok: false, error: String(err) })
      }
    },
  )

  // pptx service: object API over the shared render pipeline
  const pptx = createPptxService()
  app.post('/rpc/pptx/openBytes', async (request, reply) => {
    const args = (request.body as { args?: unknown[] } | null)?.args ?? []
    try {
      return { ok: true, result: await pptx.openBytes(args[0] as never) }
    } catch (err) {
      return reply.code(400).send({ ok: false, error: String(err) })
    }
  })
  app.post('/rpc/pptx/newBlank', async (request, reply) => {
    const args = (request.body as { args?: unknown[] } | null)?.args ?? []
    try {
      return { ok: true, result: await pptx.newBlank(args[0] as never) }
    } catch (err) {
      return reply.code(400).send({ ok: false, error: String(err) })
    }
  })
  app.post('/rpc/pptx/saveBytes', async (request, reply) => {
    const args = (request.body as { args?: unknown[] } | null)?.args ?? []
    try {
      return { ok: true, result: await pptx.saveBytes(args[0] as string) }
    } catch (err) {
      return reply.code(400).send({ ok: false, error: String(err) })
    }
  })
  app.post('/rpc/pptx/close', async (request) => {
    const args = (request.body as { args?: unknown[] } | null)?.args ?? []
    await pptx.close(args[0] as string)
    return { ok: true }
  })
  app.get('/rpc/pptx/status', async () => pptx.status())

  // sheets save over the shared pipeline (needs the core xlsx service handle)
  const sheetsSave = createSheetsSaveService({
    xlsx: {
      command: (req) => core.api.xlsx.command(req) as Promise<unknown>,
      sessionInfo: (id) => core.api.xlsx.sessionInfo(id),
    },
  })
  app.post('/rpc/xlsx/saveWorkbookBytes', async (request, reply) => {
    const args = (request.body as { args?: unknown[] } | null)?.args ?? []
    try {
      return { ok: true, result: await sheetsSave.saveWorkbookBytes(args[0] as never) }
    } catch (err) {
      return reply.code(400).send({ ok: false, error: String(err) })
    }
  })

  attachAuthHooks(app, options.auth)
  attachWsGateway(app, core)
  attachAiProxy(app, options.ai ?? {})
  if (options.staticDir) attachStatic(app, options.staticDir)

  return { app, core }
}
