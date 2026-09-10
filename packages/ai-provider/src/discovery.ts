import { aiFetch } from './fetch'
import { httpBodyDetail } from './http-error'
import type { AiModelEntry } from './types'
import type { AiWireProtocol } from './types'

/**
 * Model list discovery, shared by the Electron mains and the BFF. "Test
 * connection" is the same call: a successful list means the URL+key+protocol
 * triple works. Types are inferred lazily by the UI (model-type.ts).
 */

export interface DiscoveryTarget {
  protocol: AiWireProtocol
  baseUrl: string
  apiKey: string
  /** endpoint serves Ollama-style /api/tags instead of /models */
  ollamaLike?: boolean
  /** route discovery through the local Codex app-server CLI catalog */
  codexLike?: boolean
  /** Codex CLI path override; empty = auto-discover on PATH */
  cliPath?: string
  /** when set and apiKey is empty, the backend resolves the stored key for this profile */
  profileId?: string
  signal?: AbortSignal
}

/** Codex CLI catalog: model ids come straight from the local app-server process */
async function codexModels(target: DiscoveryTarget): Promise<AiModelEntry[]> {
  const { listCodexModels } = await import('./codex-app-server')
  const catalog = await listCodexModels(target.cliPath || undefined)
  return catalog.models.map((id) => ({ id }))
}

function originOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin
  } catch {
    return baseUrl.replace(/\/+$/, '')
  }
}

async function fetchJson(
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await aiFetch(url, {
    headers,
    ...(signal ? { signal } : {}),
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${httpBodyDetail(await response.text())}`)
  }
  return response.json()
}

async function openAiStyleModels(target: DiscoveryTarget): Promise<AiModelEntry[]> {
  const base = target.baseUrl.replace(/\/+$/, '')
  const tryUrls = /\/v\d+[^/]*$/.test(base)
    ? [`${base}/models`]
    : [`${base}/models`, `${originOf(base)}/v1/models`]
  let lastError = 'no endpoint tried'
  for (const url of tryUrls) {
    try {
      const json = (await fetchJson(url, { Authorization: `Bearer ${target.apiKey}` }, target.signal)) as {
        data?: Array<{ id?: string }>
      }
      const ids = (json.data ?? []).map((m) => m?.id).filter((id): id is string => !!id)
      if (ids.length) return ids.sort().map((id) => ({ id }))
      lastError = 'the endpoint returned an empty model list'
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
    }
  }
  throw new Error(lastError)
}

async function ollamaTags(target: DiscoveryTarget): Promise<AiModelEntry[]> {
  const json = (await fetchJson(`${originOf(target.baseUrl)}/api/tags`, {}, target.signal)) as {
    models?: Array<{ name?: string }>
  }
  const ids = (json.models ?? []).map((m) => m?.name).filter((id): id is string => !!id)
  if (!ids.length) throw new Error('ollama returned an empty model list')
  return ids.sort().map((id) => ({ id }))
}

async function anthropicModels(target: DiscoveryTarget): Promise<AiModelEntry[]> {
  const base = target.baseUrl.replace(/\/+$/, '')
  const json = (await fetchJson(
    `${base}/v1/models?limit=200`,
    {
      'x-api-key': target.apiKey,
      'anthropic-version': '2023-06-01',
    },
    target.signal,
  )) as { data?: Array<{ id?: string }> }
  const ids = (json.data ?? []).map((m) => m?.id).filter((id): id is string => !!id)
  if (!ids.length) throw new Error('the endpoint returned an empty model list')
  return ids.sort().map((id) => ({ id }))
}

async function geminiModels(target: DiscoveryTarget): Promise<AiModelEntry[]> {
  const base = target.baseUrl.replace(/\/+$/, '')
  const json = (await fetchJson(
    `${base}/models?pageSize=1000`,
    { 'x-goog-api-key': target.apiKey },
    target.signal,
  )) as {
    models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>
  }
  const entries: AiModelEntry[] = []
  for (const m of json.models ?? []) {
    if (!m.name) continue
    const methods = m.supportedGenerationMethods ?? []
    // keep only models this suite can actually drive (chat + tool calling)
    if (methods.length && !methods.includes('generateContent')) continue
    entries.push({ id: m.name.replace(/^models\//, '') })
  }
  if (!entries.length) throw new Error('the endpoint returned an empty model list')
  return entries.sort((a, b) => a.id.localeCompare(b.id))
}

export async function discoverModels(target: DiscoveryTarget): Promise<AiModelEntry[]> {
  if (target.codexLike) return codexModels(target)
  if (target.ollamaLike) return ollamaTags(target)
  switch (target.protocol) {
    case 'anthropic-messages':
      return anthropicModels(target)
    case 'gemini-native':
      return geminiModels(target)
    default:
      return openAiStyleModels(target)
  }
}
