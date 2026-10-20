import type { AiStreamChunk } from '@chaoffice/ai-provider'

/**
 * Renderer-side keepalive for slow turns. The stream watchdogs live in two
 * places: the main-process stream watchdog (idle budget from the profile —
 * the liveness authority that decides "the server stopped talking") and the
 * renderer's IPC silence timer (a transport-level failsafe with a fixed
 * 240s budget that cannot see profile budgets). During a slow local-server
 * prefill neither side has wire bytes to forward, so the renderer timer fires
 * first and kills a healthy turn with the localized timeout message.
 *
 * This emits synthetic `ping` chunks on an interval for the life of one
 * stream: the renderer timer stays armed while the main watchdog still owns
 * the real timeout decision. Pings are what the runtime already sends on wire
 * activity, so consumers need no new chunk shape.
 */
export function attachStreamHeartbeat(
  send: (chunk: AiStreamChunk) => void,
  requestId: string,
  intervalMs = 15_000,
): () => void {
  const timer = setInterval(() => {
    send({ requestId, type: 'ping' })
  }, intervalMs)
  return () => clearInterval(timer)
}
