/**
 * Chat history service (first service-core resident, plan v2.1 decision #17).
 *
 * Wraps ProjectStore behind the ProjectApi contract already shared with the
 * renderers, so both the Electron IPC forwarder and the BFF routes call the
 * exact same logic. Sheets' sessionId lookups stay in the host (they need the
 * main-process session table) and are resolved to a filePath before entering
 * this service.
 */

import { ProjectStore } from '@chatoffice/project-store'
import type { ProjectApi } from '@chatoffice/project-store'
import type { StorageArea } from '@chatoffice/storage-adapter'
import { openLocalArea } from '@chatoffice/storage-adapter'
import type { ServiceContext } from '../runtime.js'
import { defineService, ServiceEmitter } from '../runtime.js'

export interface ChatHistoryDeps {
  /** Resolves a sheets sessionId to its file path; injected by the host. */
  resolveSessionPath?(sessionId: string): string | null
}

/**
 * Host convenience: a standalone chatHistory API bound to a userData path
 * (local track) or an explicit StorageArea. Electron main uses this today;
 * the BFF uses createCore so it can host several services over one registry.
 */
export function createChatHistoryApi(
  deps: ChatHistoryDeps & { userDataPath?: string; area?: StorageArea } = {},
): ProjectApi {
  const area =
    deps.area ?? openLocalArea({ rootDir: deps.userDataPath ?? '.' })
  const context: ServiceContext = {
    events: new ServiceEmitter(),
    storage: { defaultArea: () => area },
  }
  return chatHistoryService(deps).create(context)
}

export function chatHistoryService(deps: ChatHistoryDeps = {}) {
  return defineService<ProjectApi>({
    name: 'chatHistory',
    create(context: ServiceContext): ProjectApi {
      // ProjectStore is path-based (appends 'projects' itself), so pass the area root
      const store = new ProjectStore(context.storage.defaultArea().rootDir)
      return {
        async resolveChat(args) {
          let filePath = args.filePath ?? null
          if (filePath === null && args.sessionId) {
            filePath = deps.resolveSessionPath?.(args.sessionId) ?? null
          }
          if (filePath === null) {
            store.ensureDefaultProject()
            return { projectId: 'default', chatId: args.tempChatId ?? `unsaved-${Date.now()}` }
          }
          return store.resolveChatForFile(filePath)
        },
        async appendChat(args) {
          store.appendChatMessage(args.projectId, args.chatId, {
            role: args.role,
            text: args.text,
            ...(args.tools ? { tools: args.tools } : {}),
            ...(args.attachments ? { attachments: args.attachments } : {}),
          })
        },
        async loadChat(args) {
          return store.loadChat(args.projectId, args.chatId, args.limit)
        },
        async rebindChat(args) {
          let filePath = args.newFilePath ?? null
          if (filePath === null && args.sessionId) {
            filePath = deps.resolveSessionPath?.(args.sessionId) ?? null
          }
          if (filePath !== null) {
            return store.rebindChatToFile(args.projectId, args.tempChatId, filePath)
          }
          if (args.newChatId !== undefined) {
            store.rebindChat(args.projectId, args.tempChatId, args.newChatId)
            return { projectId: args.projectId, chatId: args.newChatId }
          }
          throw new Error('rebindChat needs one of newChatId / newFilePath / sessionId')
        },
        async listProjects() {
          return store.listProjectsSummary()
        },
        async createProject(args) {
          const data = store.createProject(args.name)
          return {
            id: data.id,
            name: data.name,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            fileCount: 0,
            lastActiveAt: data.updatedAt,
            isDefault: data.id === 'default',
          }
        },
        async renameProject(args) {
          store.renameProject(args.id, args.name)
        },
        async deleteProject(args) {
          store.deleteProject(args.id)
        },
        async moveFile(args) {
          store.moveFileToProject(args.filePath, args.projectId)
        },
        async getTimeline(args) {
          return store.getProjectTimeline(args.projectId, args.limit)
        },
      }
    },
  })
}
