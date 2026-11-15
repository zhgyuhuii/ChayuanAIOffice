import type { AgentMessage, AgentToolDef } from '@chaoffice/agent-core'
import { geminiThinkingBudget } from '../capabilities'
import { aiFetch } from '../fetch'
import { httpBodyDetail } from '../http-error'
import { chaofficeAttributionHeaders, opencodeSessionHeaders } from '../providers'
import type { AiChatResponse, AiProviderConfig, AiTokenUsage } from '../types'
import { createStreamWatchdog, type StreamWatchdog } from '../watchdog'
import { toGeminiSchema } from './gemini-schema'
import {
  jsonBodyInsteadOfSse,
  sseErrorText,
  sseDataEvents,
  throwIfCreditsNotice,
  usageCount,
  type StreamCallbacks,
} from './shared'

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

interface GeminiUsage {
  promptTokenCount?: unknown
  candidatesTokenCount?: unknown
  cachedContentTokenCount?: unknown
}

/** Merge a Gemini usageMetadata object into an accumulator (every stream chunk carries
 * one; the last chunk's counts are the turn's totals). */
function mergeGeminiUsage(target: AiTokenUsage, usage: GeminiUsage | undefined): void {
  if (!usage) return
  const input = usageCount(usage.promptTokenCount)
  const output = usageCount(usage.candidatesTokenCount)
  const cached = usageCount(usage.cachedContentTokenCount)
  if (input !== undefined) target.inputTokens = input
  if (output !== undefined) target.outputTokens = output
  if (cached !== undefined) target.cacheReadTokens = cached
}

function geminiContents(messages: AgentMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === 'user') {
      const parts: unknown[] = m.text ? [{ text: m.text }] : []
      // Gemini carries audio/video inline natively (base64, size-capped by the API)
      for (const a of m.audio ?? []) {
        parts.push({ inline_data: { mime_type: a.mime, data: a.base64 } })
      }
      for (const v of m.video ?? []) {
        if (!v.base64) {
          throw new Error('gemini video input requires inline base64 data; no URL-only video here')
        }
        parts.push({ inline_data: { mime_type: v.mime, data: v.base64 } })
      }
      if (!m.images?.length && parts.length === 1 && m.text) {
        return { role: 'user', parts: [{ text: m.text }] }
      }
      for (const img of m.images ?? []) {
        parts.push({ inline_data: { mime_type: img.mime, data: img.base64 } })
      }
      return { role: 'user', parts }
    }
    if (m.role === 'assistant') {
      const parts: unknown[] = []
      if (m.text) parts.push({ text: m.text })
      for (const call of m.toolCalls ?? []) {
        parts.push({ functionCall: { name: call.name, args: call.input } })
      }
      // Gemini rejects model turns with empty parts lists.
      if (parts.length === 0) parts.push({ text: '(no content)' })
      return { role: 'model', parts }
    }
    return {
      role: 'user',
      parts: m.results.map((r) => ({
        functionResponse: {
          name: r.name,
          response: r.isError ? { error: r.output } : { result: r.output },
        },
      })),
    }
  })
}

/**
 * Emits a complete (non-streamed) Gemini response delivered as a plain JSON body.
 * `streamGenerateContent` without SSE framing yields an array of chunks; a gateway
 * may also send a single `generateContent`-shaped object — handle both.
 */
function emitGeminiJsonMessage(bodyText: string, cb: StreamCallbacks): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    throw new Error(`Gemini returned an unparseable JSON body: ${httpBodyDetail(bodyText)}`)
  }
  const events = (Array.isArray(parsed) ? parsed : [parsed]) as Array<{
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string
          functionCall?: { name?: string; args?: Record<string, unknown> }
        }>
      }
      finishReason?: string
    }>
    promptFeedback?: { blockReason?: string }
    usageMetadata?: GeminiUsage
    error?: { message?: string } | string
  }>
  let emitted = false
  let stopReason: string | undefined
  let abnormalFinish: string | undefined
  const usage: AiTokenUsage = {}
  for (const event of events) {
    if (event.error) throw new Error(sseErrorText(event.error, 'Gemini error'))
    if (event.promptFeedback?.blockReason) {
      throw new Error(`Gemini blocked the prompt (${event.promptFeedback.blockReason})`)
    }
    mergeGeminiUsage(usage, event.usageMetadata)
    const finishReason = event.candidates?.[0]?.finishReason
    if (finishReason === 'MAX_TOKENS') stopReason = 'max_tokens'
    else if (finishReason && finishReason !== 'STOP') abnormalFinish = finishReason
    for (const part of event.candidates?.[0]?.content?.parts ?? []) {
      if (part.text) {
        emitted = true
        cb.onDelta(part.text)
      }
      if (part.functionCall?.name) {
        emitted = true
        cb.onToolCall({
          id: crypto.randomUUID(),
          name: part.functionCall.name,
          input: part.functionCall.args ?? {},
        })
      }
    }
  }
  if (!emitted) {
    throw new Error(
      abnormalFinish
        ? `Gemini returned no content (finishReason=${abnormalFinish})`
        : `Gemini returned no content: ${httpBodyDetail(bodyText)}`,
    )
  }
  if (stopReason) cb.onStopReason?.(stopReason)
  if (usage.inputTokens !== undefined || usage.outputTokens !== undefined) cb.onUsage?.(usage)
}

/** Per-endpoint request shaping resolved from the provider registry. */
export interface GeminiRequestOptions {
  omitTemperature?: boolean | undefined
  /** static headers a user-hosted Gemini-shaped endpoint needs (merged last, so they win) */
  headers?: Record<string, string> | undefined
  /** stream idle budget override for slow local servers */
  idleTimeoutMs?: number | undefined
  /** generationConfig.thinkingConfig.thinkingLevel for the 3/4.x families
   * (their docs reject the 2.5-era thinkingBudget); absent = the model's
   * dynamic default. The level only exists nested under thinkingConfig: a
   * flat generationConfig.thinkingLevel is an unknown field and a 400. */
  thinkingLevel?: string | undefined
}

export async function streamGemini(
  config: AiProviderConfig,
  system: string,
  messages: AgentMessage[],
  tools: AgentToolDef[],
  maxTokens: number,
  cb: StreamCallbacks,
  baseUrl = GEMINI_BASE_URL,
  options: GeminiRequestOptions = {},
): Promise<void> {
  const wd = createStreamWatchdog(cb.signal, undefined, options.idleTimeoutMs)
  return wd.guard(() =>
    geminiTurn(config, system, messages, tools, maxTokens, cb, baseUrl, wd, options),
  )
}

async function geminiTurn(
  config: AiProviderConfig,
  system: string,
  messages: AgentMessage[],
  tools: AgentToolDef[],
  maxTokens: number,
  cb: StreamCallbacks,
  baseUrl: string,
  wd: StreamWatchdog,
  options: GeminiRequestOptions,
): Promise<void> {
  const onBytes = () => {
    wd.touch()
    cb.onActivity?.()
  }
  const url = `${baseUrl.replace(/\/$/, '')}/models/${config.model}:streamGenerateContent?alt=sse`
  const response = await aiFetch(url, {
    method: 'POST',
    signal: wd.signal,
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': config.apiKey,
      ...chaofficeAttributionHeaders(baseUrl),
      ...opencodeSessionHeaders(baseUrl, cb.sessionId),
      ...options.headers,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: geminiContents(messages),
      ...(tools.length > 0
        ? {
            tools: [
              {
                functionDeclarations: tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  // JSON Schema constructs the Gemini proto lacks (type unions,
                  // $ref, ...) fail the whole request with HTTP 400
                  parameters: toGeminiSchema(t.inputSchema),
                })),
              },
            ],
          }
        : {}),
      // Google recommends the default temperature (1.0) for the Gemini 3
      // family — lower values may cause looping or degraded reasoning —
      // so omit our hard-coded 0.3 for those models via omitTemperature.
      generationConfig: {
        ...(options.omitTemperature ? {} : { temperature: 0.3 }),
        ...(options.thinkingLevel
          ? { thinkingConfig: { thinkingLevel: options.thinkingLevel } }
          : {}),
        maxOutputTokens: maxTokens,
        // 2.5 thinks by default and bills it against maxOutputTokens; without
        // a cap deep thinking crowds the actual prose out of a big budget
        ...(geminiThinkingBudget(config.model, maxTokens) !== undefined
          ? {
              thinkingConfig: {
                thinkingBudget: geminiThinkingBudget(config.model, maxTokens),
              },
            }
          : {}),
      },
    }),
  })
  // headers arrived: ping the renderer watchdog too, or a slow first chunk could trip it
  onBytes()
  if (!response.ok || !response.body) {
    throw new Error(`Gemini HTTP ${response.status}: ${httpBodyDetail(await response.text())}`)
  }
  const jsonBody = await jsonBodyInsteadOfSse(response)
  if (jsonBody !== null) {
    throwIfCreditsNotice(jsonBody)
    return emitGeminiJsonMessage(jsonBody, cb)
  }
  let stopReason: string | undefined
  let abnormalFinish: string | undefined
  let sawFinish = false
  let emitted = false
  const turnUsage: AiTokenUsage = {}
  for await (const sse of sseDataEvents(response.body, onBytes)) {
    // A truncated frame or a non-JSON keep-alive from a proxy skips that event
    // rather than killing the turn.
    if (sse.json === undefined) continue
    const event = sse.json as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string
            functionCall?: { name?: string; args?: Record<string, unknown> }
          }>
        }
        finishReason?: string
      }>
      promptFeedback?: { blockReason?: string }
      usageMetadata?: GeminiUsage
      error?: { message?: string } | string
    }
    if (event.error) throw new Error(sseErrorText(event.error, 'Gemini stream error'))
    if (event.promptFeedback?.blockReason) {
      throw new Error(`Gemini blocked the prompt (${event.promptFeedback.blockReason})`)
    }
    // every chunk carries usageMetadata; later chunks supersede earlier ones
    mergeGeminiUsage(turnUsage, event.usageMetadata)
    const finishReason = event.candidates?.[0]?.finishReason
    if (finishReason) sawFinish = true
    if (finishReason === 'MAX_TOKENS') stopReason = 'max_tokens'
    else if (finishReason && finishReason !== 'STOP') abnormalFinish = finishReason
    for (const part of event.candidates?.[0]?.content?.parts ?? []) {
      if (part.text) {
        emitted = true
        cb.onDelta(part.text)
      }
      // Gemini emits function calls whole, never as partial JSON
      if (part.functionCall?.name) {
        emitted = true
        cb.onToolCall({
          id: crypto.randomUUID(),
          name: part.functionCall.name,
          input: part.functionCall.args ?? {},
        })
      }
    }
  }
  // A safety/recitation stop that produced nothing, or a stream with no message
  // framing at all (gateway soft-failure), would otherwise look like an empty
  // success; a genuine empty turn still carries finishReason=STOP and passes
  if (!emitted && abnormalFinish) {
    throw new Error(`Gemini returned no content (finishReason=${abnormalFinish})`)
  }
  if (!emitted && !sawFinish) {
    throw new Error('Gemini returned no content (empty stream)')
  }
  if (stopReason) cb.onStopReason?.(stopReason)
  if (turnUsage.inputTokens !== undefined || turnUsage.outputTokens !== undefined)
    cb.onUsage?.(turnUsage)
}

export async function chatGemini(
  wd: StreamWatchdog,
  config: AiProviderConfig,
  system: string,
  user: string,
  baseUrl = GEMINI_BASE_URL,
  options: GeminiRequestOptions = {},
): Promise<AiChatResponse> {
  const url = `${baseUrl.replace(/\/$/, '')}/models/${config.model}:generateContent`
  const response = await aiFetch(url, {
    method: 'POST',
    signal: wd.signal,
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': config.apiKey,
      ...chaofficeAttributionHeaders(baseUrl),
      ...opencodeSessionHeaders(baseUrl),
      ...options.headers,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        ...(options.omitTemperature ? {} : { temperature: 0.3 }),
        ...(options.thinkingLevel
          ? { thinkingConfig: { thinkingLevel: options.thinkingLevel } }
          : {}),
      },
    }),
  })
  wd.touch()
  if (!response.ok) {
    return {
      ok: false,
      error: `Gemini HTTP ${response.status}: ${httpBodyDetail(await response.text())}`,
    }
  }
  // A 200 with an HTML shell / empty / truncated body (gateway soft-failure)
  // would make response.json() throw; return ok:false instead of leaking a
  // raw SyntaxError to the caller.
  const bodyText = await response.text()
  let json: {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  try {
    json = JSON.parse(bodyText) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
  } catch {
    return {
      ok: false,
      error: `Gemini returned a non-JSON response: ${httpBodyDetail(bodyText)}`,
    }
  }
  const content = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('')
  if (!content) return { ok: false, error: 'Gemini returned an empty response' }
  return { ok: true, content }
}
