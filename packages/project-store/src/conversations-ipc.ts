/**
 * LOCAL(2026-09-21, d8201ad0): 多会话对话索引的 IPC 通道注册(主进程侧)。
 * 刻意不依赖 Electron:调用方(app main)注入 handle 注册函数与 sessionId 反查,
 * 三端(docs/sheets/slides)复用同一份处理逻辑,通道名沿用 project: 惯例。
 * 上游无此文件(B 区);若上游原生实现多会话索引,评估取上游并删除(收敛条件)。
 */
import type { ConversationStore } from './conversations.js'

export interface ConversationsScopeInput {
  filePath: string | null
  tempChatId?: string
  sessionId?: string
}

export function bindConversationsIpc(opts: {
  /** typically (channel, handler) => ipcMain.handle(channel, (event, payload) => handler(event, payload)) */
  handle: <T>(channel: string, handler: (event: unknown, payload: T) => unknown) => void
  getStore: () => ConversationStore
  /** sessionId → 文件路径反查(sheets/shell 模式);无映射返回 null */
  sessionPath: (event: unknown, sessionId: string) => string | null
}): void {
  const { handle, getStore, sessionPath } = opts

  const scope = (
    event: unknown,
    args: ConversationsScopeInput,
  ): { filePath: string | null; tempChatId?: string } => {
    let filePath = args.filePath ?? null
    if (!filePath && args.sessionId) filePath = sessionPath(event, args.sessionId)
    return {
      filePath,
      ...(args.tempChatId !== undefined ? { tempChatId: args.tempChatId } : {}),
    }
  }

  handle<ConversationsScopeInput>('project:conversationsList', (event, args) => {
    const s = scope(event, args)
    return getStore().list(s.filePath, s.tempChatId)
  })

  handle<ConversationsScopeInput>('project:conversationCreate', (event, args) => {
    const s = scope(event, args)
    return getStore().create(s.filePath, s.tempChatId)
  })

  handle<
    ConversationsScopeInput & { chatId: string; title?: string; lastActiveAt?: number }
  >('project:conversationMeta', (event, args) => {
    const s = scope(event, args)
    getStore().meta(
      s.filePath,
      args.chatId,
      {
        ...(args.title !== undefined ? { title: args.title } : {}),
        ...(args.lastActiveAt !== undefined ? { lastActiveAt: args.lastActiveAt } : {}),
      },
      s.tempChatId,
    )
  })

  handle<ConversationsScopeInput & { openIds: string[]; activeId: string | null }>(
    'project:conversationsOpenSet',
    (event, args) => {
      const s = scope(event, args)
      getStore().openSet(s.filePath, args.openIds, args.activeId, s.tempChatId)
    },
  )

  handle<ConversationsScopeInput & { chatId: string }>('project:conversationDelete', (event, args) => {
    const s = scope(event, args)
    getStore().deleteOne(s.filePath, args.chatId, s.tempChatId)
  })

  handle<ConversationsScopeInput & { openIds: string[] }>('project:conversationsDeleteAll', (event, args) => {
    const s = scope(event, args)
    getStore().deleteAllExceptOpen(s.filePath, args.openIds, s.tempChatId)
  })

  handle<{ oldPath: string; newPath: string }>('project:conversationsRebind', (_event, args) => {
    getStore().rebind(args.oldPath, args.newPath)
  })
}
