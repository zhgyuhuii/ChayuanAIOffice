import type { AiModelEntry, AiProviderProfile } from './types'

/**
 * chatop-models local-model fusion: the harness's installed local models
 * surface as a synthetic provider profile routed through the harness model
 * proxy (127.0.0.1:<proxyPort>, namespace local/<id>, lazy-load on demand),
 * next to the chatop-* vendor routes the settings source already merges.
 *
 * Soft dependency exactly like chatop-kb: all facts come from files under the
 * dsh home (`storages/chatop-models/{state,registry,proxy-keys}.json`); when
 * the model service is absent the group simply does not appear. Parsing is
 * pure and renderer-safe — every read is injected by the caller.
 */

/** fixed profile id for the synthetic local group (also the harness provider name) */
export const CHATOP_LOCAL_PROFILE_ID = 'chatop-local'

/** pseudo credential ref on the synthetic profile; the server resolves it to a
 * proxy virtual key (agentId 'chatoffice') instead of the credentials file */
export const CHATOP_LOCAL_KEY_REF = '__chatop_proxy_key__'

/** the agentId the office sidecar identifies as when issuing a proxy key */
export const CHATOP_LOCAL_AGENT_ID = 'chatoffice'

export interface ChatopLocalModelInfo {
  /** bare harness model id (without the local/ namespace) */
  id: string
  running: boolean
  caps: string[]
}

export interface ChatopLocalSource {
  profile: AiProviderProfile
  /** bare id of a currently running chat-capable model, if any */
  runningChatId: string | null
}

/** model id → capability heuristic when no running instance carries real caps
 * (mirrors chatop-kb's capsHeuristic: five-piece defaults + common naming) */
export function chatopCapsHeuristic(id: string): string[] {
  const s = id.toLowerCase()
  if (/(embed|bge(?!-rerank))/.test(s)) return ['embedding']
  if (/rerank/.test(s)) return ['rerank']
  if (/(whisper|sensevoice|-stt|asr)/.test(s)) return ['audio-stt']
  if (/(piper|kokoro|tts|huayan)/.test(s)) return ['audio-tts']
  return ['chat']
}

/** registry installed ids + live instances merged into one model list */
export function chatopLocalModels(
  state: { instances?: Array<{ modelId?: string; caps?: string[] }> } | null,
  registry: { installed?: string[] } | null,
): ChatopLocalModelInfo[] {
  const running = new Map<string, { caps?: string[] }>()
  for (const inst of state?.instances ?? []) {
    if (typeof inst?.modelId === 'string' && inst.modelId) running.set(inst.modelId, inst)
  }
  const ids = [...(registry?.installed ?? [])]
  for (const id of running.keys()) if (!ids.includes(id)) ids.push(id)
  return ids
    .filter((id) => typeof id === 'string' && id.length > 0)
    .map((id) => ({
      id,
      running: running.has(id),
      caps: running.get(id)?.caps ?? chatopCapsHeuristic(id),
    }))
}

/** state.json + registry.json (already parsed) → the synthetic local source,
 *  or null when the model proxy is not running / no chat-capable model exists */
export function parseChatopLocalSource(
  state: { proxyPort?: number; instances?: Array<{ modelId?: string; caps?: string[] }> } | null,
  registry: { installed?: string[] } | null,
): ChatopLocalSource | null {
  const port = typeof state?.proxyPort === 'number' ? state.proxyPort : null
  if (!port) return null
  const chats = chatopLocalModels(state, registry).filter((m) => m.caps.includes('chat'))
  if (chats.length === 0) return null
  // running models first so the picker's default order matches availability
  chats.sort((a, b) => Number(b.running) - Number(a.running))
  const entries: AiModelEntry[] = chats.map((m) => ({
    id: `local/${m.id}`,
    type: 'chat',
    ...(m.running ? { name: m.id, running: true } : {}),
  }))
  return {
    profile: {
      id: CHATOP_LOCAL_PROFILE_ID,
      displayName: '察元OS 本地模型',
      protocol: 'openai-completions',
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKeyRef: CHATOP_LOCAL_KEY_REF,
      auth: 'api-key',
      enabled: true,
      models: entries,
    },
    runningChatId: chats.find((m) => m.running)?.id ?? null,
  }
}

/** proxy-keys.json text → the live virtual key issued for agentId, if any */
export function parseChatopProxyKey(
  proxyKeysJson: string,
  agentId = CHATOP_LOCAL_AGENT_ID,
): string | null {
  try {
    const doc = JSON.parse(proxyKeysJson) as {
      keys?: Array<{ agentId?: string; key?: string; revoked?: boolean }>
    }
    const hit = (doc.keys ?? []).find(
      (k) => k?.agentId === agentId && k.revoked !== true && typeof k.key === 'string' && k.key,
    )
    return hit?.key ?? null
  } catch {
    return null
  }
}

/** read the local model state through an injected dsh-home file reader */
export async function readChatopLocalSource(
  readDshFile: (relativePath: string) => Promise<string>,
): Promise<ChatopLocalSource | null> {
  const [stateText, registryText] = await Promise.all([
    readDshFile('storages/chatop-models/state.json').catch(() => null),
    readDshFile('storages/chatop-models/registry.json').catch(() => null),
  ])
  if (stateText === null) return null
  let state: Parameters<typeof parseChatopLocalSource>[0] = null
  try {
    state = JSON.parse(stateText)
  } catch {
    return null
  }
  let registry: { installed?: string[] } | null = null
  if (registryText !== null) {
    try {
      registry = JSON.parse(registryText)
    } catch {
      registry = null
    }
  }
  return parseChatopLocalSource(state, registry)
}
