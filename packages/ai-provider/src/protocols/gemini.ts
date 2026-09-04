import type { AgentMessage, AgentToolDef } from '@chatoffice/agent-core'
import { aiFetch } from '../fetch'
import { httpBodyDetail } from '../http-error'
import { chatofficeAttributionHeaders } from '../providers'
import type { AiChatResponse, AiProviderConfig } from '../types'
import { createStreamWatchdog, type StreamWatchdog } from '../watchdog'
import {
  jsonBodyInsteadOfSse,
  sseErrorText,
  sseLines,
  throwIfCreditsNotice,
  type StreamCallbacks,
} from './shared'

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

/**
 * Convert a JSON Schema (with union types like `type: ['number','null']` and
 * `$ref`/`definitions`) into a Gemini-compatible Schema.
 *
 * Gemini's FunctionDeclaration parameters use a restricted subset of JSON
 * Schema: `type` must be a single string (not an array), `items` must be a
 * single Schema (not a tuple array), and `$ref`/`definitions` are not
 * understood. Union `['number','null']` appears in docs insert_chart/edit_chart
 * (`values: {type: ['number','null']}`) and triggers HTTP 400:
 *   "Unknown name \"type\" at '...value.items': Proto field is not repeating,
 *    cannot start list."
 * because the proto's `type` field is not repeated. See #186.
 */
function sanitizeGeminiSchema(schema: unknown, definitions?: Record<string, unknown>): unknown {
  if (schema == null || typeof schema !== 'object') return schema
  if (Array.isArray(schema)) {
    // Tuple `items: [ {...}, {...} ]` is not supported — take first element
    return sanitizeGeminiSchema((schema as unknown[])[0], definitions)
  }
  const s = schema as Record<string, unknown>
  // Resolve $ref (e.g. slides add_text_box paragraphs: {$ref: '#/definitions/paragraphs'})
  if (typeof s.$ref === 'string') {
    const ref = s.$ref as string
    if (ref.startsWith('#/definitions/') && definitions) {
      const key = ref.slice('#/definitions/'.length)
      const resolved = (definitions as Record<string, unknown>)[key] as
        Record<string, unknown> | undefined
      if (resolved) {
        const { $ref: _r, definitions: _d, ...rest } = s
        const base = sanitizeGeminiSchema(resolved, definitions) as Record<string, unknown>
        // Merge sibling fields (e.g. description) over the resolved base
        if (Object.keys(rest).length === 0) return base
        return { ...base, ...(sanitizeGeminiSchema(rest, definitions) as object) }
      }
    }
    const { $ref: _r, ...rest } = s
    return sanitizeGeminiSchema(rest, definitions)
  }

  const out: Record<string, unknown> = {}
  // type: handle union like ['number','null'] -> 'number' + nullable
  if (Array.isArray(s.type)) {
    const arr = s.type as string[]
    const nonNull = arr.filter((t) => t !== 'null')
    if (nonNull.length > 0) out.type = nonNull[0]
    if (arr.includes('null')) (out as Record<string, unknown>).nullable = true
  } else if (typeof s.type === 'string') {
    out.type = s.type
  }
  if (typeof s.description === 'string') out.description = s.description
  if (s.enum !== undefined) out.enum = s.enum
  if (typeof s.format === 'string') out.format = s.format
  if (Array.isArray(s.required)) out.required = s.required
  if (s.properties && typeof s.properties === 'object' && !Array.isArray(s.properties)) {
    const props: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(s.properties as Record<string, unknown>)) {
      props[k] = sanitizeGeminiSchema(v, definitions)
    }
    out.properties = props
  }
  if (s.items !== undefined) {
    if (Array.isArray(s.items)) {
      out.items = sanitizeGeminiSchema((s.items as unknown[])[0], definitions)
    } else {
      out.items = sanitizeGeminiSchema(s.items, definitions)
    }
  }
  // definitions are resolved via $ref, not emitted
  return out
}

function toGeminiParameters(inputSchema: unknown): unknown {
  if (inputSchema == null || typeof inputSchema !== 'object') return inputSchema
  const s = inputSchema as Record<string, unknown>
  const defs = s.definitions as Record<string, unknown> | undefined
  const sanitized = sanitizeGeminiSchema(s, defs) as Record<string, unknown>
  // Strip definitions from top-level output
  if (sanitized && typeof sanitized === 'object' && 'definitions' in sanitized) {
    const { definitions: _d, ...rest } = sanitized as Record<string, unknown>
    return rest
  }
  return sanitized
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
    error?: { message?: string } | string
  }>
  let emitted = false
  let stopReason: string | undefined
  let abnormalFinish: string | undefined
  for (const event of events) {
    if (event.error) throw new Error(sseErrorText(event.error, 'Gemini error'))
    if (event.promptFeedback?.blockReason) {
      throw new Error(`Gemini blocked the prompt (${event.promptFeedback.blockReason})`)
    }
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
}

export async function streamGemini(
  config: AiProviderConfig,
  system: string,
  messages: AgentMessage[],
  tools: AgentToolDef[],
  maxTokens: number,
  cb: StreamCallbacks,
  baseUrl = GEMINI_BASE_URL,
): Promise<void> {
  const wd = createStreamWatchdog(cb.signal)
  return wd.guard(() => geminiTurn(config, system, messages, tools, maxTokens, cb, baseUrl, wd))
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
      ...chatofficeAttributionHeaders(baseUrl),
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
                  parameters: toGeminiParameters(t.inputSchema),
                })),
              },
            ],
          }
        : {}),
      generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens },
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
  for await (const line of sseLines(response.body, onBytes)) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (!payload) continue
    // A truncated frame or a non-JSON keep-alive from a proxy should skip
    // that event, not kill the entire AI turn with a parser error.
    let event
    try {
      event = JSON.parse(payload) as {
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
        error?: { message?: string } | string
      }
    } catch {
      continue
    }
    if (event.error) throw new Error(sseErrorText(event.error, 'Gemini stream error'))
    if (event.promptFeedback?.blockReason) {
      throw new Error(`Gemini blocked the prompt (${event.promptFeedback.blockReason})`)
    }
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
}

export async function chatGemini(
  wd: StreamWatchdog,
  config: AiProviderConfig,
  system: string,
  user: string,
  baseUrl = GEMINI_BASE_URL,
): Promise<AiChatResponse> {
  const url = `${baseUrl.replace(/\/$/, '')}/models/${config.model}:generateContent`
  const response = await aiFetch(url, {
    method: 'POST',
    signal: wd.signal,
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': config.apiKey,
      ...chatofficeAttributionHeaders(baseUrl),
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0.3 },
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
