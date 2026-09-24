import type { AgentMessage, AgentToolDef } from '@chatoffice/agent-core'
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
  const protocol: Exclude<AiProtocol, 'codex-app-server'> = endpoint.protocol
  return withOutputCapFallback(baseUrl, config.model, maxTokens, (cap) => {
    switch (protocol) {
      case 'anthropic':
        return streamAnthropic(config, system, messages, tools, cap, cb, baseUrl)
      case 'gemini':
        return streamGemini(config, system, messages, tools, cap, cb, baseUrl, {
          omitTemperature: endpoint.omitTemperature,
        })
      case 'openai-compatible':
        return streamOpenAiCompatible(baseUrl, config, system, messages, tools, cap, cb, {
          omitTemperature: endpoint.omitTemperature,
          useMaxCompletionTokens: endpoint.useMaxCompletionTokens,
          bodyExtras: endpoint.bodyExtras,
        })
      default:
        return streamOpenAiResponses(baseUrl, config, system, messages, tools, cap, cb, {
          omitTemperature: endpoint.omitTemperature,
        })
    }
  })
}
