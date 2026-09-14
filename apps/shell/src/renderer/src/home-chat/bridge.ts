import { resolveCurrentModel } from '@chatoffice/ai-provider/browser'
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
    createDocument: (request) => window.chatOffice.createDocument({ ...request, dock: true }),
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
  }
}
