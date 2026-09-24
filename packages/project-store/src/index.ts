export { ProjectStore } from './store.js'
export { ConversationStore } from './conversations.js'
export { bindConversationsIpc, type ConversationsScopeInput } from './conversations-ipc.js'
export type {
  ChatMessage,
  ChatMeta,
  ChatScope,
  ProjectData,
  ProjectIndex,
  ProjectInfo,
  ProjectSummary,
  TimelineEntry,
  ToolActivity,
} from './types.js'
export type {
  ConversationMeta,
  ConversationsState,
} from './conversations.js'
export type {
  AppendChatArgs,
  ConversationsScopeArgs,
  ConversationMetaArgs,
  ConversationsOpenSetArgs,
  ConversationDeleteArgs,
  ConversationsDeleteAllArgs,
  ConversationsRebindArgs,
  LoadChatArgs,
  ProjectApi,
  RebindChatArgs,
  ResolveChatArgs,
  ResolveChatResult,
} from './ipc.js'
