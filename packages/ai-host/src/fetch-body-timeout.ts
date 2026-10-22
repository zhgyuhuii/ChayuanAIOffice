/**
 * Node's undici (the engine behind global fetch) terminates a response body
 * after 5 minutes without bytes (`bodyTimeout`, default 300s). A slow local
 * engine's prefill runs longer than that with zero body bytes, so the turn
 * dies as `terminated` no matter what the stream watchdogs say — the HTTP
 * layer preempts them (observed live: the 600s profile budget never got to
 * speak because undici hung up at 300s first).
 *
 * Relax the process-wide body-idle gap to "off": liveness during a turn is
 * owned by the stream watchdogs (main-process profile budget + renderer
 * heartbeat), not by the HTTP transport. headersTimeout keeps its default —
 * a server that cannot even return response headers in 5 minutes is dead.
 *
 * Must run once, before the first AI request (setGlobalDispatcher bridges to
 * Node's built-in fetch via the shared undici global symbol — verified live).
 */
let applied = false

export function relaxFetchBodyTimeout(): void {
  if (applied) return
  applied = true
  try {
    // require (not import) so bundlers keep this as a runtime resolution and
    // the app still boots if undici is absent from the dependency graph
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const undici = require('undici') as {
      Agent: new (options: { bodyTimeout: number; headersTimeout: number }) => unknown
      setGlobalDispatcher: (dispatcher: unknown) => void
    }
    undici.setGlobalDispatcher(new undici.Agent({ bodyTimeout: 0, headersTimeout: 300_000 }))
  } catch {
    // no undici in the graph: global fetch keeps stock timeouts; the stream
    // watchdogs still bound every turn
  }
}
