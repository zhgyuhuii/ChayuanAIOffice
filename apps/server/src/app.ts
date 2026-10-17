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
import type { ServiceCore, ServiceDefinition } from '@chaoffice/service-core'
import { createCore } from '@chaoffice/service-core'
import { chatHistoryService } from '@chaoffice/service-core'
import { remoteStorageService } from '@chaoffice/service-core'
import { settingsService } from '@chaoffice/service-core'
import { xlsxSidecarService } from '@chaoffice/service-core'
import { openLocalArea, RemoteStorageError, type StorageArea } from '@chaoffice/storage-adapter'
import { attachAuthHooks, type AuthOptions } from './auth.js'
import { attachWsGateway } from './ws-gateway.js'
import { attachAiProxy, type AiProxyOptions } from './ai-proxy.js'
import { attachKbProxy, type KbProxyOptions } from './kb-proxy.js'
import { attachMediaRoutes } from './ai-media.js'
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
  /** harness block for the knowledge-base proxy (dsh plugin form); see kb-proxy.ts */
  kbHarness?: KbProxyOptions['harness']
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
    remoteStorage: remoteStorageService(),
  }
}

export function buildServer(options: ServerOptions = {}): BuiltServer {
  const dataDir = (options.dataDir ?? './data').replace(/\/$/, '')
  const area = options.area ?? openLocalArea({ rootDir: resolve(dataDir, 'area') })

  const services = { ...defaultServices(), ...options.services }
  const core = createCore(services, { storage: { defaultArea: () => area } })

  // 默认 1MiB 装不下首页对话历史——生成的图片以 base64 数据 URL 留在会话里，
  // 带图会话的下一轮 /ai/stream 请求体轻松超限 → 413（桌面 IPC 形态无此问题，
  // dsh/web 形态必现）。64MiB 与编辑器附件同量级。
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 * 1024 })

  app.get('/healthz', async () => ({ ok: true, ts: new Date().toISOString() }))

  // RPC forwarding: POST /rpc/chatHistory/resolveChat  { "args": {...} }
  app.post<{ Params: { service: string; method: string } }>(
    '/rpc/:service/:method',
    async (request, reply) => {
      const service = (core.api as Record<string, unknown>)[request.params.service]
      if (!service)
        return reply.code(404).send({ error: `unknown service: ${request.params.service}` })
      const method = (service as Record<string, unknown>)[request.params.method]
      if (typeof method !== 'function') {
        return reply.code(404).send({ error: `unknown method: ${request.params.method}` })
      }
      const args = (request.body as { args?: unknown[] } | null)?.args ?? []
      try {
        const result = await (method as (...a: unknown[]) => unknown)(...args)
        return { ok: true, result }
      } catch (err) {
        if (err instanceof RemoteStorageError) {
          const status = Math.min(Math.max(err.status, 400), 599)
          return reply.code(status).send({ ok: false, error: err.message, code: err.code })
        }
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
  const dshHome = process.env.CHAOFFICE_DSH_HOME
  const dshRpc = process.env.CHAOFFICE_DSH_RPC_ORIGIN
  const dshRpcFile = process.env.CHAOFFICE_DSH_RPC_ORIGIN_FILE
  const ai = attachAiProxy(app, {
    ...options.ai,
    dataDir: options.ai?.dataDir ?? dataDir,
    // dsh plugin form: provider profiles + keys live in the harness settings.
    // The loopback origin may arrive lazily via the file the plugin host writes.
    ...(dshHome && (dshRpc || dshRpcFile)
      ? {
          harness: {
            dshHome,
            rpcOrigin: dshRpc ?? '',
            ...(dshRpcFile ? { rpcOriginFile: dshRpcFile } : {}),
          },
        }
      : {}),
  })
  // media + document channels (the web/dsh port of the desktop ai:media-* IPC
  // and create_document's host write) ride the same runtime and secrets
  attachMediaRoutes(app, ai)
  // knowledge-base read proxy (dsh plugin form: harness origin; web form: absent → degrades)
  attachKbProxy(app, {
    harness:
      options.kbHarness ??
      (dshHome && (dshRpc || dshRpcFile)
        ? {
            dshHome,
            rpcOrigin: dshRpc ?? '',
            ...(dshRpcFile ? { rpcOriginFile: dshRpcFile } : {}),
          }
        : undefined),
  })
  if (options.staticDir) attachStatic(app, options.staticDir)

  return { app, core }
}
