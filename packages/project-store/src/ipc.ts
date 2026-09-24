/**
 * IPC interface type definitions (shared by the renderer and main processes).
 * No Electron dependency; importable from the renderer.
 */
import type {
  ChatAttachment,
  ChatMessage,
  ChatMeta,
  ChatScope,
  ProjectSummary,
  TimelineEntry,
  ToolActivity,
} from './types.js'
import type { ConversationMeta, ConversationsState } from './conversations.js'

export type {
  ChatAttachment,
  ChatMessage,
  ChatMeta,
  ChatScope,
  ProjectSummary,
  TimelineEntry,
  ToolActivity,
} from './types.js'
export type { ConversationMeta, ConversationsState } from './conversations.js'

export interface AppendChatArgs {
  projectId: string
  chatId: string
  role: 'user' | 'assistant'
  text: string
  tools?: ToolActivity[]
  attachments?: ChatAttachment[]
  scope?: ChatScope
  /** LOCAL(2026-09-21, d8201ad0): D10 中断标记——半截轮次照常落盘 */
  interrupted?: boolean
}

export interface LoadChatArgs {
  projectId: string
  chatId: string
  limit?: number
}

export interface ResolveChatArgs {
  /** Absolute path of the currently open file; null means an unsaved new file */
  filePath: string | null
  /** Temp chatId for unsaved files, e.g. "unsaved-<timestamp>" */
  tempChatId?: string
  /** Sheets mode: look up the file path by sessionId (handled in the main process) */
  sessionId?: string
}

export interface ResolveChatResult {
  projectId: string
  chatId: string
}

export interface RebindChatArgs {
  projectId: string
  tempChatId: string
  /** Specify the new chatId directly; one of newChatId / newFilePath / sessionId */
  newChatId?: string
  /** File path where the unsaved session first hit disk: the main process derives the chatId from it and registers fileMap */
  newFilePath?: string
  /** Sheets mode: the renderer can't get the path, so it passes sessionId for the main process to look up and rebind */
  sessionId?: string
}

// ── P1 extensions ──────────────────────────────────────────

export interface CreateProjectArgs {
  name: string
}

export interface RenameProjectArgs {
  id: string
  name: string
}

export interface DeleteProjectArgs {
  id: string
}

export interface MoveFileArgs {
  filePath: string
  projectId: string
}

export interface GetTimelineArgs {
  projectId: string
  limit?: number
}

// ── LOCAL(2026-09-21, d8201ad0): 多会话对话索引(追加式 C 区)──────────

/** 共同定位参数:真实文件传 filePath;未保存文档传 tempChatId;sheets 由主进程经 sessionId 反查路径 */
export interface ConversationsScopeArgs {
  filePath: string | null
  tempChatId?: string
  sessionId?: string
}

export interface ConversationMetaArgs extends ConversationsScopeArgs {
  chatId: string
  title?: string
  lastActiveAt?: number
}

export interface ConversationsOpenSetArgs extends ConversationsScopeArgs {
  openIds: string[]
  activeId: string | null
}

export interface ConversationDeleteArgs extends ConversationsScopeArgs {
  chatId: string
}

export interface ConversationsDeleteAllArgs extends ConversationsScopeArgs {
  /** 只删除不在此集合里的会话(打开中的 tab 绝不误伤) */
  openIds: string[]
}

export interface ConversationsRebindArgs {
  oldPath: string
  newPath: string
}

/** Project storage API the main process exposes to the renderer */
export interface ProjectApi {
  /**
   * Resolves projectId and chatId from a file path.
   * When filePath is null, returns the default project + tempChatId (if provided).
   */
  resolveChat(args: ResolveChatArgs): Promise<ResolveChatResult>
  /** Appends one message to the JSONL */
  appendChat(args: AppendChatArgs): Promise<void>
  /** Reads the most recent `limit` messages */
  loadChat(args: LoadChatArgs): Promise<ChatMessage[]>
  /** Renames the JSONL file (called after the file first hits disk); returns the new projectId/chatId */
  rebindChat(args: RebindChatArgs): Promise<ResolveChatResult>
  // ── P1 extensions ──
  /** Lists all projects (with file count + last active time) */
  listProjects(): Promise<ProjectSummary[]>
  /** Creates a project */
  createProject(args: CreateProjectArgs): Promise<ProjectSummary>
  /** Renames a project */
  renameProject(args: RenameProjectArgs): Promise<void>
  /** Soft-deletes a project (directory moved into .trash) */
  deleteProject(args: DeleteProjectArgs): Promise<void>
  /** Moves a file into the given project */
  moveFile(args: MoveFileArgs): Promise<void>
  /** Gets the project timeline */
  getTimeline(args: GetTimelineArgs): Promise<TimelineEntry[]>
  // ── LOCAL(2026-09-21, d8201ad0): 多会话对话索引(追加式)──
  /** 列出文件的多会话状态;首次未命中播种存量单会话(老用户升级等价);附 projectId 供 body 调 appendChat/loadChat */
  conversationsList(args: ConversationsScopeArgs): Promise<ConversationsState & { projectId: string }>
  /** 新建一个会话(新 chatId)并激活 */
  conversationCreate(args: ConversationsScopeArgs): Promise<{ projectId: string; chatId: string }>
  /** 更新一个会话的标题/最后活跃时间 */
  conversationMeta(args: ConversationMetaArgs): Promise<void>
  /** 持久化打开集合 + 激活项 */
  conversationsOpenSet(args: ConversationsOpenSetArgs): Promise<void>
  /** 删除一个历史会话(元数据 + jsonl) */
  conversationDelete(args: ConversationDeleteArgs): Promise<void>
  /** 全部删除历史会话(跳过 openIds 中的打开会话) */
  conversationsDeleteAll(args: ConversationsDeleteAllArgs): Promise<void>
  /** 未保存文档首次保存 / 文件重命名时迁移索引键(打开集合与标题跟随文件) */
  conversationsRebind(args: ConversationsRebindArgs): Promise<void>
}
