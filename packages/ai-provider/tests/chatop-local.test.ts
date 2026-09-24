import { describe, expect, it } from 'vitest'
import {
  CHATOP_LOCAL_PROFILE_ID,
  chatopCapsHeuristic,
  chatopLocalModels,
  parseChatopLocalSource,
  parseChatopProxyKey,
} from '../src/chatop-local'

describe('chatop-local: capability heuristic', () => {
  it('maps the five-piece defaults and common naming', () => {
    expect(chatopCapsHeuristic('qwen3-4b-instruct-2507-q3ks')).toEqual(['chat'])
    expect(chatopCapsHeuristic('bge-m3')).toEqual(['embedding'])
    expect(chatopCapsHeuristic('bge-reranker-v2-m3')).toEqual(['rerank'])
    expect(chatopCapsHeuristic('whisper-small-int8')).toEqual(['audio-stt'])
    expect(chatopCapsHeuristic('piper-huayan')).toEqual(['audio-tts'])
  })
})

describe('chatop-local: model merge', () => {
  it('registry installed + live instances; running instance caps win; unregistered running ids included', () => {
    const models = chatopLocalModels(
      {
        instances: [
          { modelId: 'bge-m3', caps: ['embedding'] },
          { modelId: 'ad-hoc-model', caps: ['chat'] },
        ],
      },
      { installed: ['qwen3-4b', 'bge-m3'] },
    )
    const byId = new Map(models.map((m) => [m.id, m]))
    expect(byId.get('qwen3-4b')).toMatchObject({ running: false, caps: ['chat'] })
    expect(byId.get('bge-m3')).toMatchObject({ running: true, caps: ['embedding'] })
    expect(byId.has('ad-hoc-model')).toBe(true)
  })
})

describe('chatop-local: source parsing', () => {
  const STATE = {
    proxyPort: 52581,
    instances: [
      { modelId: 'bge-m3', port: 18080, caps: ['embedding'] },
      { modelId: 'qwen3-4b', port: 18082, caps: ['chat'] },
    ],
  }
  const REGISTRY = { installed: ['qwen3-4b', 'bge-m3', 'whisper-small-int8'] }

  it('builds the synthetic profile: chat-only, running first, proxy namespace + running marker', () => {
    const src = parseChatopLocalSource(STATE, REGISTRY)
    expect(src).not.toBeNull()
    expect(src!.profile.id).toBe(CHATOP_LOCAL_PROFILE_ID)
    expect(src!.profile.baseUrl).toBe('http://127.0.0.1:52581/v1')
    expect(src!.profile.apiKeyRef).toBe('__chatop_proxy_key__')
    expect(src!.profile.models.map((m) => m.id)).toEqual(['local/qwen3-4b'])
    expect(src!.profile.models[0]).toMatchObject({ type: 'chat', running: true })
    expect(src!.runningChatId).toBe('qwen3-4b')
  })

  it('stopped local chat models still list (lazy-load), running flag off', () => {
    const src = parseChatopLocalSource({ proxyPort: 52581, instances: [] }, REGISTRY)
    expect(src!.profile.models).toEqual([{ id: 'local/qwen3-4b', type: 'chat' }])
    expect(src!.runningChatId).toBeNull()
  })

  it('null when the proxy is not running or no chat-capable model exists', () => {
    expect(parseChatopLocalSource({ instances: [] }, REGISTRY)).toBeNull()
    expect(
      parseChatopLocalSource({ proxyPort: 52581, instances: [] }, { installed: ['bge-m3'] }),
    ).toBeNull()
    expect(parseChatopLocalSource(null, null)).toBeNull()
  })
})

describe('chatop-local: proxy key parsing', () => {
  it('finds the live key for the chatoffice agent; skips revoked and foreign agents', () => {
    const doc = JSON.stringify({
      keys: [
        { agentId: 'chatop-kb', key: 'chatop-agent-chatop-kb-x', revoked: false },
        { agentId: 'chatoffice', key: 'chatop-agent-chatoffice-old', revoked: true },
        { agentId: 'chatoffice', key: 'chatop-agent-chatoffice-live', revoked: false },
      ],
    })
    expect(parseChatopProxyKey(doc)).toBe('chatop-agent-chatoffice-live')
    expect(parseChatopProxyKey('{"keys":[]}', 'chatop-kb')).toBeNull()
    expect(parseChatopProxyKey('not json')).toBeNull()
  })
})
