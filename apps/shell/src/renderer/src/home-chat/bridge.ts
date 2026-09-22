import { pickImageModel, resolveCurrentModel } from '@chatoffice/ai-provider/browser'
import type { AiModelSelection } from '@chatoffice/ai-provider'
import type { AgentMessage } from '@chatoffice/agent-core'
import type { HomeAgentBridge } from './agent'

/**
 * Renderer-side HomeAgentBridge: wires window.chatOffice into the home agent
 * and caches the current-model selection so getCurrentModel can answer
 * synchronously (the agent loop reads it on the send path, not per chunk).
 * Call refreshHomeModelCache on mount, window focus, and when the settings
 * modal closes — a stale cache only ever causes a spurious setup-required
 * card, never a wrong-model request.
 */
let cachedModel: AiModelSelection | null | undefined

export async function refreshHomeModelCache(): Promise<void> {
  try {
    const settings = await window.chatOffice.getAiSettings()
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
    aiStream: (request) => window.chatOffice.aiStream(request),
    aiStreamCancel: (requestId) => window.chatOffice.aiStreamCancel(requestId),
    onAiStream: (listener) => window.chatOffice.onAiStream(listener),
    ...(window.chatOffice.searchCapabilities
      ? {
          searchCapabilities: () =>
            window.chatOffice.searchCapabilities!() as Promise<{ search: boolean }>,
        }
      : {}),
    createDocument: (request) => window.chatOffice.createDocument({ ...request, dock: false }),
    readAttachment: (path, offset, maxChars) =>
      window.chatOffice.readAttachment(path, offset, maxChars),
    readAttachmentImage: async (path) => {
      try {
        return await window.chatOffice.readAttachmentImage(path)
      } catch {
        return { ok: false }
      }
    },
    recents: (query) => window.chatOffice.recents(query),
    starred: (query) => window.chatOffice.starred(query),
    listProjectFiles: async () => {
      const id = getProjectId()
      if (!id) return []
      try {
        return (await window.chatOfficeProject?.listFiles(id)) ?? []
      } catch {
        return []
      }
    },
    // P1 停靠契约: open_document docks the file into the Home right pane and
    // the conversation stays right here, beside the document
    openWithHandoff: async (path: string, _transcript: AgentMessage[]) => {
      await window.chatOffice.openPath(path, { dock: true })
    },
    getCurrentModel: () => {
      if (!cachedModel) throw new Error('no usable model configured')
      return cachedModel
    },
    systemFileSearch: (query, ext) => window.chatOffice.systemFileSearch(query, ext),
    // 生图、媒体与搜索 capability tools: web search always available (free
    // DuckDuckGo tier backs it up); image generation rides the default model
    webSearch: (query, maxResults) => window.chatOffice.webSearch(query, maxResults),
    generateImage: (op) =>
      window.chatOffice.mediaGenerate({
        prompt: op.prompt,
        ...(op.aspectRatio ? { params: { aspectRatio: op.aspectRatio } } : {}),
      }),
    imageGenReady: async () => {
      try {
        const settings = await window.chatOffice.getAiSettings()
        return !!pickImageModel(settings)
      } catch {
        return false
      }
    },
    // unified media capability channels (main: registerMediaIpc in docs-main,
    // process-wide for the shell aggregate)
    mediaCapabilities: async () => {
      try {
        const r = (await window.chatOffice.mediaCapabilities()) as {
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
    mediaVideo: (op) => window.chatOffice.mediaVideo(op) as Promise<{ url?: string; filePath?: string; model?: string; error?: string }>,
    mediaUnderstand: (op) => window.chatOffice.mediaUnderstand(op) as Promise<{ text?: string; error?: string }>,
    mediaAsr: (op) => window.chatOffice.mediaAsr(op) as Promise<{ text?: string; error?: string }>,
    mediaTts: (op) => window.chatOffice.mediaTts(op) as Promise<{ url?: string; mime?: string; error?: string }>,
    // 外部 MCP (MCP 管理): enabled servers' tools enter the agent; calls relay
    // back through the main process's cached connections
    listMcpTools: async () => {
      try {
        return (await window.chatOfficeMcp?.listAgentTools()) ?? []
      } catch {
        return []
      }
    },
    callMcpTool: (serverId, toolName, args) => {
      if (!window.chatOfficeMcp) return Promise.resolve({ ok: false, output: 'MCP unavailable' })
      return window.chatOfficeMcp.callTool(serverId, toolName, args)
    },
  }
}
