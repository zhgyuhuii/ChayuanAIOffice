/**
 * AI relay + metering (plan v2.1, decision #3 / horizontal constraint):
 * BYOK and Genspark traffic flows through the BFF so keys never reach the
 * browser and every call is metered from day one. The provider call itself
 * reuses @genoffice/ai-provider once wired; this module owns routing shape,
 * metering persistence, and the harness-channel adapter seam (decision #16).
 */

import type { FastifyInstance } from 'fastify'

export interface AiCallRecord {
  ts: string
  channel: string
  model: string
  requestId: string
  /** Usage when the provider reports it; call count is metered regardless */
  inputTokens?: number
  outputTokens?: number
}

export interface AiProxyOptions {
  /** Metering sink; default keeps an in-memory ring (Postgres lands in phase 1 proper). */
  onCall?: (record: AiCallRecord) => void
}

export function attachAiProxy(app: FastifyInstance, options: AiProxyOptions): void {
  const records: AiCallRecord[] = []
  const record = (r: AiCallRecord) => {
    records.push(r)
    if (records.length > 1000) records.shift()
    options.onCall?.(r)
  }

  // Relay seam: POST /ai/relay { channel, model, requestId, payload }
  app.post<{ Body: { channel: string; model: string; requestId: string; payload?: unknown } }>(
    '/ai/relay',
    async (request, reply) => {
      const { channel, model, requestId } = request.body ?? ({} as typeof request.body)
      if (!channel || !model || !requestId) {
        return reply.code(400).send({ error: 'channel, model and requestId are required' })
      }
      record({ ts: new Date().toISOString(), channel, model, requestId })
      // Provider dispatch (ai-provider / harness channel) lands with the AI
      // service migration; the route, auth position, and metering are stable.
      return reply.code(501).send({ error: 'ai relay provider dispatch not wired yet' })
    },
  )

  // Metering read-back (ops/debug until the usage dashboard exists)
  app.get('/ai/usage', async () => ({ calls: records.length, records }))
}
