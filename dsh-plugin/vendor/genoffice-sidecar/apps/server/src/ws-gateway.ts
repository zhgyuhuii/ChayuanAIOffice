/**
 * Push gateway (plan v2.1, decision #6): the core emitter is the single
 * source of push events (AI stream chunks, file-change notices). Electron
 * forwards them over webContents.send; here they go over WebSocket.
 *
 * Protocol: client sends { "subscribe": ["ai:stream-chunk", ...] }, server
 * pushes { "event": name, "payload": ... }. One socket, many subscriptions.
 */

import type { FastifyInstance } from 'fastify'
import type { ServiceCore, ServiceDefinition } from '@genoffice/service-core'
import { WebSocketServer, type WebSocket } from 'ws'

interface WsSession {
  socket: WebSocket
  subscriptions: Set<string>
}

export type BroadcastFn = (event: string, payload: unknown) => void

export function attachWsGateway(
  app: FastifyInstance,
  core: ServiceCore<Record<string, ServiceDefinition<unknown>>>,
): void {
  const sessions = new Set<WsSession>()
  const wss = new WebSocketServer({ noServer: true })

  app.server.on('upgrade', (request, socket, head) => {
    if (!(request.url ?? '').startsWith('/ws')) return
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request))
  })

  wss.on('connection', (socket: WebSocket) => {
    const session: WsSession = { socket, subscriptions: new Set() }
    sessions.add(session)
    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as { subscribe?: string[]; unsubscribe?: string[] }
        for (const name of msg.subscribe ?? []) session.subscriptions.add(name)
        for (const name of msg.unsubscribe ?? []) session.subscriptions.delete(name)
      } catch {
        socket.send(JSON.stringify({ error: 'bad message' }))
      }
    })
    socket.on('close', () => sessions.delete(session))
  })

  const broadcast: BroadcastFn = (event, payload) => {
    const text = JSON.stringify({ event, payload })
    for (const session of sessions) {
      if (session.subscriptions.has(event)) session.socket.send(text)
    }
  }

  // Forward every emitter event to subscribed sockets (emit is fire-and-forget).
  const originalEmit = core.events.emit.bind(core.events)
  core.events.emit = (<T>(event: string, payload: T) => {
    originalEmit(event, payload)
    broadcast(event, payload)
  }) as typeof core.events.emit

  app.decorate('wsBroadcast', broadcast)
  app.addHook('onClose', async () => {
    for (const session of sessions) session.socket.close()
    wss.close()
  })
}
