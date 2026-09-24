/**
 * Auth skeleton (plan v2.1, decision #3): product account = self-hosted Logto
 * issuing JWTs. Verification is a structural check now; JWKS validation lands
 * with the Logto deployment in phase 1 proper. CHATOFFICE_AUTH=off disables
 * enforcement (embedded sidecar ③④ runs without an account).
 */

import type { FastifyInstance } from 'fastify'

export interface AuthOptions {
  /** 'off' skips enforcement entirely (default until Logto is wired) */
  mode?: 'jwt' | 'off'
  /** Expected audience claim */
  audience?: string
}

const BEARER = /^Bearer\s+(.+)$/

export function attachAuthHooks(app: FastifyInstance, options: AuthOptions = {}): void {
  const mode = options.mode ?? process.env.CHATOFFICE_AUTH === 'jwt' ? 'jwt' : 'off'

  app.decorateRequest('userId', '')

  app.addHook('onRequest', async (request, reply) => {
    if (mode !== 'jwt') return
    // Health and RPC-less probes stay open
    if (request.url === '/healthz') return
    const match = BEARER.exec(request.headers.authorization ?? '')
    const token = match?.[1]
    if (!token) return reply.code(401).send({ error: 'missing bearer token' })
    const claims = decodeJwt(token)
    if (!claims || typeof claims.sub !== 'string') {
      return reply.code(401).send({ error: 'invalid token' })
    }
    if (options.audience && claims.aud !== options.audience) {
      return reply.code(401).send({ error: 'audience mismatch' })
    }
    ;(request as unknown as { userId: string }).userId = claims.sub
  })
}

/** Payload-only decode for the skeleton; signature verification comes with JWKS. */
export function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}
