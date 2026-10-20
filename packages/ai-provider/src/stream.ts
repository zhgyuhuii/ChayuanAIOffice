import type { AgentMessage, AgentToolDef } from '@chaoffice/agent-core'
import { withOutputCapFallback } from './output-cap'
import { streamAnthropic } from './protocols/anthropic'
import { streamGemini } from './protocols/gemini'
import { streamOpenAiCompatible } from './protocols/openai-compatible'
import { streamOpenAiResponses } from './protocols/openai-responses'
import { streamCodexAppServer } from './codex-app-server'
import type { StreamCallbacks } from './protocols/shared'
import type { ResolvedModelCall } from './settings-v2'
import { getProviderAdapter, type AiProtocol } from './registry'
import type { AiProviderConfig, AiProviderId } from './types'

export { streamAnthropic } from './protocols/anthropic'
export { streamGemini } from './protocols/gemini'
export { streamOpenAiCompatible } from './protocols/openai-compatible'
export { streamOpenAiResponses } from './protocols/openai-responses'
export { AiCreditsError, sseLines } from './protocols/shared'
export type { StreamCallbacks } from './protocols/shared'

/**
 * Route one v2 model call: the profile resolver already picked the protocol,
 * base URL, and vendor quirks; this dispatches to the protocol streamer.
 */
export async function streamResolved(
  call: ResolvedModelCall,
  system: string,
  messages: AgentMessage[],
  tools: AgentToolDef[],
  maxTokens: number,
  cb: StreamCallbacks,
): Promise<void> {
  const config: AiProviderConfig = { apiKey: call.apiKey, model: call.model, baseUrl: call.baseUrl }
  switch (call.protocol) {
    case 'anthropic':
      return streamAnthropic(config, system, messages, tools, maxTokens, cb, call.baseUrl)
    case 'gemini':
      return streamGemini(config, system, messages, tools, maxTokens, cb, call.baseUrl)
    case 'openai-responses':
      return streamOpenAiResponses(call.baseUrl, config, system, messages, tools, maxTokens, cb, {
        omitTemperature: call.omitTemperature,
      })
    case 'openai-compatible':
      return streamOpenAiCompatible(call.baseUrl, config, system, messages, tools, maxTokens, cb, {
        omitTemperature: call.omitTemperature,
        useMaxCompletionTokens: call.useMaxCompletionTokens,
        bodyExtras: call.bodyExtras,
        // LOCAL: the resolved call's idle budget must reach the stream watchdog
        // (slow local engines take minutes to first token; the shipped default
        // is 180s and kills a healthy prefill)
        ...(call.idleTimeoutMs !== undefined ? { idleTimeoutMs: call.idleTimeoutMs } : {}),
      })
  }
}

/** route a streaming, tool-calling-capable turn by provider id */
export async function streamForProvider(
  provider: AiProviderId,
  config: AiProviderConfig,
  system: string,
  messages: AgentMessage[],
  tools: AgentToolDef[],
  maxTokens: number,
  cb: StreamCallbacks,
): Promise<void> {
  const endpoint = getProviderAdapter(provider).resolveEndpoint(config)
  const { baseUrl } = endpoint
  if (endpoint.model) config = { ...config, model: endpoint.model }
  if (endpoint.protocol === 'codex-app-server') {
    return streamCodexAppServer(config, system, messages, tools, maxTokens, cb)
  }
  // A model the user declared a ceiling for outranks the caller's budget; the
  // endpoint's own 400 would otherwise cost a billed round trip.
  const cap = endpoint.maxTokens !== undefined ? Math.min(maxTokens, endpoint.maxTokens) : maxTokens
  const protocol: Exclude<AiProtocol, 'codex-app-server'> = endpoint.protocol
  return withOutputCapFallback(baseUrl, config.model, cap, (tokens) => {
    switch (protocol) {
      case 'anthropic':
        return streamAnthropic(config, system, messages, tools, tokens, cb, baseUrl, {
          headers: endpoint.headers,
          idleTimeoutMs: endpoint.idleTimeoutMs,
        })
      case 'gemini':
        return streamGemini(config, system, messages, tools, tokens, cb, baseUrl, {
          omitTemperature: endpoint.omitTemperature,
          headers: endpoint.headers,
          idleTimeoutMs: endpoint.idleTimeoutMs,
        })
      case 'openai-compatible':
        return streamOpenAiCompatible(baseUrl, config, system, messages, tools, tokens, cb, {
          omitTemperature: endpoint.omitTemperature,
          useMaxCompletionTokens: endpoint.useMaxCompletionTokens,
          bodyExtras: endpoint.bodyExtras,
          echoReasoning: endpoint.echoReasoning,
          headers: endpoint.headers,
          idleTimeoutMs: endpoint.idleTimeoutMs,
        })
      default:
        return streamOpenAiResponses(baseUrl, config, system, messages, tools, cap, cb, {
          omitTemperature: endpoint.omitTemperature,
        })
    }
  })
}
