import type { AgentMessage, AgentToolCall, AgentToolDef } from '@chatoffice/agent-core'
import { aiFetch } from '../fetch'
import { httpBodyDetail } from '../http-error'
import { chatofficeAttributionHeaders } from '../providers'
import type { AiChatResponse, AiProviderConfig } from '../types'
import { createStreamWatchdog, type StreamWatchdog } from '../watchdog'
import {
  jsonBodyInsteadOfSse,
  parseToolInput,
  sseErrorText,
  sseLines,
  throwIfCreditsNotice,
  type StreamCallbacks,
} from './shared'

/**
 * OpenAI Responses API (POST {base}/responses). The fourth wire protocol;
 * transcript shape differs from chat completions: system lives in
 * `instructions`, tool calls are top-level `function_call` items answered by
 * `function_call_output` items, and the output cap is `max_output_tokens`.
 */

type ResponsesInputItem =
  | { role: 'user'; content: Array<Record<string, unknown>> }
  | { role: 'assistant'; content: Array<Record<string, unknown>> }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string }

function responsesInput(messages: AgentMessage[]): ResponsesInputItem[] {
  const out: ResponsesInputItem[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      if (m.video?.length) {
        throw new Error(
          'The OpenAI Responses protocol has no video input part; use a gemini model for video understanding',
        )
      }
      const content: Array<Record<string, unknown>> = m.text
        ? [{ type: 'input_text', text: m.text }]
        : []
      for (const a of m.audio ?? []) {
        const fmt = a.mime.split('/')[1]?.toLowerCase() || 'mp3'
        content.push({ type: 'input_audio', input_audio: { data: a.base64, format: fmt } })
      }
      for (const img of m.images ?? []) {
        content.push({ type: 'input_image', image_url: `data:${img.mime};base64,${img.base64}` })
      }
      out.push({ role: 'user', content })
    } else if (m.role === 'assistant') {
      // split into a text message plus one function_call item per prior tool call
      if (m.text) {
        out.push({ role: 'assistant', content: [{ type: 'output_text', text: m.text }] })
      }
      for (const call of m.toolCalls ?? []) {
        out.push({
          type: 'function_call',
          call_id: call.id,
          name: call.name,
          arguments: JSON.stringify(call.input),
        })
      }
      if (!m.text && !(m.toolCalls && m.toolCalls.length > 0)) {
        out.push({ role: 'assistant', content: [{ type: 'output_text', text: '(no content)' }] })
      }
    } else {
      for (const r of m.results) {
        out.push({ type: 'function_call_output', call_id: r.id, output: r.output })
      }
    }
  }
  return out
}

interface ResponsesOutputItem {
  type?: string
  role?: string
  content?: Array<{ type?: string; text?: string }>
  call_id?: string
  name?: string
  arguments?: string
}

/** Emits a complete (non-streamed) response delivered as a plain JSON body. */
function emitResponsesJsonMessage(bodyText: string, cb: StreamCallbacks): void {
  let msg: {
    output?: ResponsesOutputItem[]
    status?: string
    status_details?: { reason?: string }
    error?: { message?: string } | string
    incomplete_details?: { reason?: string }
  }
  try {
    msg = JSON.parse(bodyText)
  } catch {
    throw new Error(`The model returned an unparseable JSON body: ${httpBodyDetail(bodyText)}`)
  }
  if (msg.error) throw new Error(sseErrorText(msg.error, 'Model error'))
  let emitted = false
  const toolCalls: AgentToolCall[] = []
  for (const item of msg.output ?? []) {
    if (item.type === 'message') {
      for (const part of item.content ?? []) {
        if (part.text) {
          emitted = true
          cb.onDelta(part.text)
        }
      }
    } else if (item.type === 'function_call' && item.name) {
      emitted = true
      const { input, error } = parseToolInput(item.arguments ?? '')
      toolCalls.push({
        id: item.call_id ?? crypto.randomUUID(),
        name: item.name,
        input,
        inputError: error,
      })
    }
  }
  const reason = msg.status_details?.reason ?? msg.incomplete_details?.reason
  if (reason === 'max_output_tokens') {
    const lastTool = toolCalls.at(-1)
    if (lastTool) lastTool.truncated = true
  }
  for (const call of toolCalls) cb.onToolCall(call)
  if (!emitted) throw new Error(`The model returned no content: ${httpBodyDetail(bodyText)}`)
  if (reason === 'max_output_tokens') cb.onStopReason?.('max_tokens')
}

export interface ResponsesRequestOptions {
  omitTemperature?: boolean | undefined
}

export async function streamOpenAiResponses(
  baseUrl: string,
  config: AiProviderConfig,
  system: string,
  messages: AgentMessage[],
  tools: AgentToolDef[],
  maxTokens: number,
  cb: StreamCallbacks,
  options: ResponsesRequestOptions = {},
): Promise<void> {
  const wd = createStreamWatchdog(cb.signal)
  return wd.guard(() =>
    responsesTurn(baseUrl, config, system, messages, tools, maxTokens, cb, wd, options),
  )
}

async function responsesTurn(
  baseUrl: string,
  config: AiProviderConfig,
  system: string,
  messages: AgentMessage[],
  tools: AgentToolDef[],
  maxTokens: number,
  cb: StreamCallbacks,
  wd: StreamWatchdog,
  options: ResponsesRequestOptions,
): Promise<void> {
  const onBytes = () => {
    wd.touch()
    cb.onActivity?.()
  }
  const response = await aiFetch(`${baseUrl.replace(/\/$/, '')}/responses`, {
    method: 'POST',
    signal: wd.signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      ...chatofficeAttributionHeaders(baseUrl),
    },
    body: JSON.stringify({
      model: config.model,
      instructions: system,
      input: responsesInput(messages),
      max_output_tokens: maxTokens,
      ...(tools.length > 0
        ? {
            tools: tools.map((t) => ({
              type: 'function',
              name: t.name,
              description: t.description,
              parameters: t.inputSchema,
              strict: false,
            })),
          }
        : {}),
      ...(options.omitTemperature ? {} : { temperature: 0.3 }),
      stream: true,
    }),
  })
  // headers arrived: ping the renderer watchdog too, or a slow first chunk could trip it
  onBytes()
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}: ${httpBodyDetail(await response.text())}`)
  }
  const jsonBody = await jsonBodyInsteadOfSse(response)
  if (jsonBody !== null) {
    throwIfCreditsNotice(jsonBody)
    return emitResponsesJsonMessage(jsonBody, cb)
  }
  // function calls stream as argument deltas keyed by output_index
  const pendingTools = new Map<number, { id: string; name: string; json: string }>()
  let stopReason: string | undefined
  let sawFinish = false
  let emitted = false
  const flushTools = () => {
    const entries = [...pendingTools.entries()].sort(([a], [b]) => a - b)
    const lastIndex = entries.at(-1)?.[0]
    for (const [index, pending] of entries) {
      if (!pending.name) continue
      const { input, error } = parseToolInput(pending.json)
      emitted = true
      cb.onToolCall({
        id: pending.id,
        name: pending.name,
        input,
        inputError: error,
        ...(stopReason === 'max_tokens' && index === lastIndex ? { truncated: true } : {}),
      })
    }
    pendingTools.clear()
  }
  for await (const line of sseLines(response.body, onBytes)) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (!payload) continue
    let event
    try {
      event = JSON.parse(payload) as {
        type?: string
        output_index?: number
        delta?: string
        item?: { type?: string; call_id?: string; name?: string; arguments?: string }
        response?: {
          status?: string
          status_details?: { reason?: string }
          error?: { message?: string } | string
        }
        message?: string
        error?: { message?: string } | string
      }
    } catch {
      continue
    }
    switch (event.type) {
      case 'response.output_item.added':
        if (event.item?.type === 'function_call' && event.item.name) {
          pendingTools.set(event.output_index ?? 0, {
            id: event.item.call_id ?? crypto.randomUUID(),
            name: event.item.name,
            json: event.item.arguments ?? '',
          })
        }
        break
      case 'response.output_text.delta':
        if (event.delta) {
          emitted = true
          cb.onDelta(event.delta)
        }
        break
      case 'response.reasoning_summary_text.delta':
      case 'response.reasoning_text.delta':
        if (event.delta) cb.onReasoningDelta?.(event.delta)
        break
      case 'response.function_call_arguments.delta':
        if (event.delta) {
          const pending = pendingTools.get(event.output_index ?? 0)
          if (pending) pending.json += event.delta
        }
        break
      case 'response.output_item.done': {
        // gateways that deliver whole items instead of deltas
        const item = event.item
        if (
          item?.type === 'function_call' &&
          item.name &&
          !pendingTools.has(event.output_index ?? 0)
        ) {
          const { input, error } = parseToolInput(item.arguments ?? '')
          emitted = true
          cb.onToolCall({
            id: item.call_id ?? crypto.randomUUID(),
            name: item.name,
            input,
            inputError: error,
          })
        }
        break
      }
      case 'response.completed':
      case 'response.incomplete': {
        sawFinish = true
        const reason =
          event.response?.status_details?.reason ??
          (event.type === 'response.incomplete' ? 'max_output_tokens' : undefined)
        if (reason === 'max_output_tokens') stopReason = 'max_tokens'
        flushTools()
        break
      }
      case 'response.failed':
        throw new Error(sseErrorText(event.response?.error ?? event.error, 'Model stream error'))
      case 'error':
        throw new Error(sseErrorText(event.error ?? event.message, 'Model stream error'))
      default:
        break
    }
  }
  flushTools()
  if (!emitted && !sawFinish) {
    throw new Error('The model returned no content (empty stream)')
  }
  if (stopReason) cb.onStopReason?.(stopReason)
}

/** one-shot non-streaming call for the ai:chat path */
export async function chatOpenAiResponses(
  wd: StreamWatchdog,
  baseUrl: string,
  config: AiProviderConfig,
  system: string,
  user: string,
): Promise<AiChatResponse> {
  const response = await aiFetch(`${baseUrl.replace(/\/$/, '')}/responses`, {
    method: 'POST',
    signal: wd.signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      ...chatofficeAttributionHeaders(baseUrl),
    },
    body: JSON.stringify({
      model: config.model,
      instructions: system,
      input: [{ role: 'user', content: [{ type: 'input_text', text: user }] }],
      max_output_tokens: 8192,
    }),
  })
  wd.touch()
  if (!response.ok) {
    return { ok: false, error: `HTTP ${response.status}: ${httpBodyDetail(await response.text())}` }
  }
  const json = (await response.json()) as { output?: ResponsesOutputItem[] }
  const content = (json.output ?? [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .map((part) => part.text ?? '')
    .join('')
  if (!content) return { ok: false, error: 'AI returned an empty response' }
  return { ok: true, content }
}
