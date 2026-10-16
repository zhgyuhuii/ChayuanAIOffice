import { pickImageModel, resolveCurrentModel } from '@chaoffice/ai-provider/browser'
import type { AiModelSelection } from '@chaoffice/ai-provider'
import type { AgentMessage } from '@chaoffice/agent-core'
import type { HomeAgentBridge } from './agent'

/**
 * Renderer-side HomeAgentBridge: wires window.chaOffice into the home agent
 * and caches the current-model selection so getCurrentModel can answer
 * synchronously (the agent loop reads it on the send path, not per chunk).
 * Call refreshHomeModelCache on mount, window focus, and when the settings
 * modal closes — a stale cache only ever causes a spurious setup-required
 * card, never a wrong-model request.
 */
let cachedModel: AiModelSelection | null | undefined

export async function refreshHomeModelCache(): Promise<void> {
  try {
    const settings = await window.chaOffice.getAiSettings()
    cachedModel = resolveCurrentModel(settings) ?? null
  } catch {
    cachedModel = null
  }
}

export function createHomeChatBridge(
  getProjectId: () => string | null,
  /** P1-7 项目中心模型: lazily create the project for an unattached
   *  session's first document and re-scope that session (ChatPanel supplies
   *  it — it owns the store and the project IPC). */
  ensureProject?: (title: string) => Promise<string | null>,
): HomeAgentBridge {
  return {
    ...(ensureProject ? { ensureProject: (title) => ensureProject(title) } : {}),
    aiStream: (request) => window.chaOffice.aiStream(request),
    aiStreamCancel: (requestId) => window.chaOffice.aiStreamCancel(requestId),
    onAiStream: (listener) => window.chaOffice.onAiStream(listener),
    ...(window.chaOffice.searchCapabilities
      ? {
          searchCapabilities: () =>
            window.chaOffice.searchCapabilities!() as Promise<{ search: boolean }>,
        }
      : {}),
    createDocument: (request) => window.chaOffice.createDocument({ ...request, dock: false }),
    readAttachment: (path, offset, maxChars) =>
      window.chaOffice.readAttachment(path, offset, maxChars),
    readAttachmentImage: async (path) => {
      try {
        return await window.chaOffice.readAttachmentImage(path)
      } catch {
        return { ok: false }
      }
    },
    recents: (query) => window.chaOffice.recents(query),
    starred: (query) => window.chaOffice.starred(query),
    listProjectFiles: async () => {
      const id = getProjectId()
      if (!id) return []
      try {
        return (await window.chaOfficeProject?.listFiles(id)) ?? []
      } catch {
        return []
      }
    },
    // P1 停靠契约: open_document docks the file into the Home right pane and
    // the conversation stays right here, beside the document
    openWithHandoff: async (path: string, _transcript: AgentMessage[]) => {
      await window.chaOffice.openPath(path, { dock: true })
    },
    getCurrentModel: () => {
      if (!cachedModel) throw new Error('no usable model configured')
      return cachedModel
    },
    systemFileSearch: (query, ext) => window.chaOffice.systemFileSearch(query, ext),
    // 生图、媒体与搜索 capability tools: web search always available (free
    // DuckDuckGo tier backs it up); image generation rides the default model
    webSearch: (query, maxResults) => window.chaOffice.webSearch(query, maxResults),
    generateImage: (op) =>
      window.chaOffice.mediaGenerate({
        prompt: op.prompt,
        ...(op.aspectRatio ? { params: { aspectRatio: op.aspectRatio } } : {}),
      }),
    imageGenReady: async () => {
      try {
        const settings = await window.chaOffice.getAiSettings()
        return !!pickImageModel(settings)
      } catch {
        return false
      }
    },
    // unified media capability channels (main: registerMediaIpc in docs-main,
    // process-wide for the shell aggregate)
    mediaCapabilities: async () => {
      try {
        const r = (await window.chaOffice.mediaCapabilities()) as {
          flags?: Record<string, boolean>
        }
        const f = r.flags ?? {}
        return {
          image: !!f.image,
          video: !!f.video,
          imageUnderstanding: !!f.imageUnderstanding,
          videoUnderstanding: !!f.videoUnderstanding,
          tts: !!f.tts,
          asr: !!f.asr,
        }
      } catch {
        return {
          image: false,
          video: false,
          imageUnderstanding: false,
          videoUnderstanding: false,
          tts: false,
          asr: false,
        }
      }
    },
    mediaVideo: (op) => window.chaOffice.mediaVideo(op) as Promise<{ url?: string; filePath?: string; model?: string; error?: string }>,
    mediaUnderstand: (op) => window.chaOffice.mediaUnderstand(op) as Promise<{ text?: string; error?: string }>,
    mediaAsr: (op) => window.chaOffice.mediaAsr(op) as Promise<{ text?: string; error?: string }>,
    mediaTts: (op) => window.chaOffice.mediaTts(op) as Promise<{ url?: string; mime?: string; error?: string }>,
    // 外部 MCP (MCP 管理): enabled servers' tools enter the agent; calls relay
    // back through the main process's cached connections
    listMcpTools: async () => {
      try {
        return (await window.chaOfficeMcp?.listAgentTools()) ?? []
      } catch {
        return []
      }
    },
    callMcpTool: (serverId, toolName, args) => {
      if (!window.chaOfficeMcp) return Promise.resolve({ ok: false, output: 'MCP unavailable' })
      return window.chaOfficeMcp.callTool(serverId, toolName, args)
    },
  }
}
