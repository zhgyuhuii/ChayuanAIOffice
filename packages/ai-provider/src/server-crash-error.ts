import { isUpstreamHardError } from '@chaoffice/agent-core'

export { isUpstreamHardError }

/**
 * Human text for a model server that died mid-request (worker crash wrapper
 * like `[address=host:port, pid=N] 'id'`, bare KeyError, HTTP 5xx). The raw
 * signature stays embedded so downstream classifiers (the agent loop's
 * degraded retry) still recognize the failure, and the user sees a cause and
 * a fix instead of a naked Python exception.
 */
export function describeAiServerCrash(message: string): string {
  return (
    'The model server crashed while handling this request. Self-hosted engines usually fail this way when a ' +
    'tools request reaches an engine without tool-call support (or on an outdated engine) — enable a tool parser ' +
    'on the server (vLLM: --enable-auto-tool-choice --tool-call-parser hermes) or upgrade it, and check its worker ' +
    `logs for the real traceback. Original error: ${message}`
  )
}
