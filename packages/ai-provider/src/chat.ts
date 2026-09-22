import { chatAnthropic } from './protocols/anthropic'
import { chatGemini } from './protocols/gemini'
import { chatOpenAiCompatible } from './protocols/openai-compatible'
import { chatOpenAiResponses } from './protocols/openai-responses'
import { chatCodexAppServer } from './codex-app-server'
import type { ResolvedModelCall } from './settings-v2'
import { getProviderAdapter, type ResolvedEndpoint } from './registry'
import type { AiChatResponse, AiProviderConfig, AiProviderId } from './types'
import { AI_CHAT_RESPONSE_TIMEOUT_MS, createStreamWatchdog } from './watchdog'

/** route a one-shot (non-streaming, non-tool-calling) chat call by provider id */
export async function chatForProvider(
  provider: AiProviderId,
  config: AiProviderConfig,
  system: string,
  user: string,
  signal?: AbortSignal,
): Promise<AiChatResponse> {
  // non-streaming: the server generates the full answer before the headers arrive,
  // so the connect phase gets the long budget; the body read then gets the idle budget
  const wd = createStreamWatchdog(signal, AI_CHAT_RESPONSE_TIMEOUT_MS)
  return wd.guard(() => {
    let endpoint: ResolvedEndpoint
    try {
      endpoint = getProviderAdapter(provider).resolveEndpoint(config)
    } catch (e) {
      // config errors (unknown provider, missing base URL) report as a failed reply, not a rejection
      return Promise.resolve({
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      })
    }
    if (endpoint.model) config = { ...config, model: endpoint.model }
    switch (endpoint.protocol) {
      case 'codex-app-server':
        return chatCodexAppServer(config, system, user, wd.signal)
      case 'anthropic':
        return chatAnthropic(wd, config, system, user, endpoint.baseUrl)
      case 'gemini':
        return chatGemini(wd, config, system, user, endpoint.baseUrl, {
          omitTemperature: endpoint.omitTemperature,
        })
      case 'openai-compatible':
        return chatOpenAiCompatible(wd, endpoint.baseUrl, config, system, user, {
          omitTemperature: endpoint.omitTemperature,
          bodyExtras: endpoint.bodyExtras,
        })
      case 'openai-responses':
        return chatOpenAiResponses(wd, endpoint.baseUrl, config, system, user)
    }
  })
}

/** one-shot chat on a v2 resolved call (profile protocol + endpoint already picked) */
export async function chatResolved(
  call: ResolvedModelCall,
  system: string,
  user: string,
  signal?: AbortSignal,
): Promise<AiChatResponse> {
  const wd = createStreamWatchdog(signal, AI_CHAT_RESPONSE_TIMEOUT_MS)
  return wd.guard(() => {
    const config = { apiKey: call.apiKey, model: call.model }
    switch (call.protocol) {
      case 'anthropic':
        return chatAnthropic(wd, config, system, user, call.baseUrl)
      case 'gemini':
        return chatGemini(wd, config, system, user, call.baseUrl)
      case 'openai-responses':
        return chatOpenAiResponses(wd, call.baseUrl, config, system, user)
      case 'codex-app-server':
        return chatCodexAppServer(config, system, user, wd.signal)
      case 'openai-compatible':
        return chatOpenAiCompatible(wd, call.baseUrl, config, system, user, {
          omitTemperature: call.omitTemperature,
          useMaxCompletionTokens: call.useMaxCompletionTokens,
          bodyExtras: call.bodyExtras,
        })
    }
  })
}
