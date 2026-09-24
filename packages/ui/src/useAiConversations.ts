/**
 * LOCAL(2026-09-21, d8201ad0): 多会话对话池 hook(B 区,上游无此文件)。
 * 单端接入点:六端 AI 面板用同一个 hook 管理会话(tab)模型——打开集合、激活项、
 * 历史列表、运行态、标题与活跃时间。持久化走 window.projectApi 的
 * project:conversations* 通道;API 缺失(web 预览等)时降级为纯内存态
 * (历史列表只含本次关闭的会话,计划 §2.1 末条)。
 *
 * 激活态仲裁(单一真源,计划 §4.2;D13 增量 2026-09-22:历史不再是 tab,历史入口
 * 改为 actions 槽 🕘 图标的下拉浮层 AiHistoryPopover,激活态收窄为
 * chatId | 'assistant' | 'empty'):
 *   ① 服务端 activeId ∈ openIds → 用之;
 *   ② localStorage 存值 === 'assistant' → 用之(存量残留 'chat'/'history' 视为无效);
 *   ③ openIds 非空 → openIds[0];
 *   ④ openIds 为空 → 'empty'(空态)。
 * setActiveTab(chatId) 不写 localStorage(由 conversationsOpenSet 持久化);
 * setActiveTab('assistant') 写 localStorage(键值收窄为该单值)。
 *
 * D12(2026-09-22):空会话不进历史——「空」= 从未发出消息(meta.title 为空且本
 * 挂载期内无任何「已发言」信号)。close() 前置分流:空会话直接丢弃(删元数据、
 * 不产生历史条目、无确认);closed 列表因此只含非空会话(存量残留的空历史条目
 * 亦被过滤,还原后关闭时同规则丢弃)。「已发言」信号取自既有上报链,零会话体
 * 改动:reportTitle(首条用户消息/懒加载回填)、touch(轮次完成)、
 * setRunning(true)(运行开始——被中断的半截轮次照常落盘,见 D10)。
 *
 * 会话 chatId 一次生成、永不换绑:未保存文档的 temp 键只在首次保存时经
 * conversationsRebind 迁移为真实路径(键迁移,chatId 不变)。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export interface AiConversationMeta {
  chatId: string
  /** First user message head (~14 chars); '' = not spoken yet (renders as untitled) */
  title: string
  createdAt: number
  lastActiveAt: number
}

/** 激活态唯一真源:会话 chatId ｜ 助手 ｜ 空态(关到零);历史是浮层不占激活态(D13) */
export type AiActiveTab = string | 'assistant' | 'empty'

/** 定位当前文档:真实文件传 filePath;未保存文档传 tempChatId;sheets 传 sessionId */
export interface AiConversationsScope {
  filePath: string | null
  tempChatId?: string
  sessionId?: string
}

export interface UseAiConversations {
  /** projectId(供会话体调 appendChat/loadChat) */
  projectId: string | null
  /** 当前打开的会话(tab 顺序 = openIds 顺序) */
  open: AiConversationMeta[]
  /** 历史列表(= 全量 - open,按最后活跃时间倒序) */
  closed: AiConversationMeta[]
  /** 激活 tab(含 'empty' 虚拟态),tab 行高亮与 body 渲染的唯一依据 */
  activeTab: AiActiveTab
  setActiveTab(tab: AiActiveTab): void
  /** 首次装载完成前为 false(避免把装载中的空集误判为空态) */
  ready: boolean
  /** 正在流式运行的会话 id 集合(驱动 tab 圆点) */
  runningIds: ReadonlySet<string>
  create(): void
  /** 关闭(进历史)。运行中的会话由调用方先 handle.stop()(计划 §4.3)再 close。
   *  D12:空会话(从未发言)不进历史——直接丢弃元数据,无确认 */
  close(id: string): void
  /** 历史还原成 tab 并激活 */
  restore(chatId: string): void
  removeClosed(chatId: string): void
  removeAllClosed(): void
  /** 实例上报:标题(首条用户消息,或懒加载回填)、每轮结束、运行态变化 */
  reportTitle(chatId: string, title: string): void
  touch(chatId: string): void
  setRunning(chatId: string, running: boolean): void
  /** 未保存 → 已保存(或文件重命名):索引键换绑(oldKey → 新路径);chatId 不变 */
  rebindIndex(oldKey: string, newPath: string): void
}

/** structural subset of ProjectApi the hook uses (keeps the hook Electron-free and testable) */
export interface ConversationsApi {
  conversationsList(args: AiConversationsScope): Promise<{
    projectId: string
    conversations: AiConversationMeta[]
    openIds: string[]
    activeId: string | null
  }>
  conversationCreate(args: AiConversationsScope): Promise<{ projectId: string; chatId: string }>
  conversationMeta(
    args: AiConversationsScope & { chatId: string; title?: string; lastActiveAt?: number },
  ): Promise<void>
  conversationsOpenSet(
    args: AiConversationsScope & { openIds: string[]; activeId: string | null },
  ): Promise<void>
  conversationDelete(args: AiConversationsScope & { chatId: string }): Promise<void>
  conversationsDeleteAll(args: AiConversationsScope & { openIds: string[] }): Promise<void>
  conversationsRebind(args: { oldPath: string; newPath: string }): Promise<void>
}

/** read window.projectApi without a hard type dependency on the host app */
function projectApi(): ConversationsApi | null {
  const api = (window as unknown as { projectApi?: ConversationsApi }).projectApi
  return api && typeof api.conversationsList === 'function' ? api : null
}

const nowMs = (): number => Date.now()

function newConvMeta(chatId: string): AiConversationMeta {
  const t = nowMs()
  return { chatId, title: '', createdAt: t, lastActiveAt: t }
}

const isChatTab = (tab: AiActiveTab): tab is string =>
  typeof tab === 'string' && tab !== 'assistant' && tab !== 'empty'

export function useAiConversations(
  scope: AiConversationsScope | null,
  opts: {
    /** localStorage key carrying the assistant/history memory (per app, e.g. 'aidocs.aiTab') */
    persistKey?: string
    /** change ⇒ full reload (document switch on panels that are not remounted per document, e.g. sheets) */
    reloadKey?: string | number | null
  } = {},
): UseAiConversations {
  const { persistKey, reloadKey } = opts
  // latest scope for API calls (updated every render; a null→real-path save
  // transition keeps state and only re-points subsequent writes)
  const scopeRef = useRef(scope)
  scopeRef.current = scope

  const [projectId, setProjectId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<AiConversationMeta[]>([])
  const [openIds, setOpenIds] = useState<string[]>([])
  const [activeTab, setActiveTabState] = useState<AiActiveTab>('empty')
  const [ready, setReady] = useState(false)
  const [runningIds, setRunningIds] = useState<ReadonlySet<string>>(() => new Set())

  /** D12: chatIds that provably hold transcript records this mount (first send /
      a completed turn / a run started / restored from history). A conversation
      with no such signal and an empty title is "empty" and never enters history. */
  const spokenRef = useRef<Set<string>>(new Set())

  /** the last chatId that was active while a fixed tab (assistant/history) was
      selected — kept so conversationsOpenSet doesn't clobber the stored chat */
  const lastChatIdRef = useRef<string | null>(null)

  /** latest openIds for async callbacks (create's IPC response lands after renders) */
  const openIdsRef = useRef(openIds)
  openIdsRef.current = openIds

  // ── loaders ───────────────────────────────────────────────

  const load = useCallback(() => {
    const api = projectApi()
    const s = scopeRef.current
    spokenRef.current = new Set()
    if (!api || !s) {
      // degraded in-memory mode: a fresh session opens one new conversation (D4)
      const seed = newConvMeta(`conv-${nowMs().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)
      setConversations([seed])
      setOpenIds([seed.chatId])
      lastChatIdRef.current = seed.chatId
      setActiveTabState(seed.chatId)
      setReady(true)
      return
    }
    void api
      .conversationsList(s)
      .then((state) => {
        setProjectId(state.projectId)
        setConversations(state.conversations)
        setOpenIds(state.openIds)
        setReady(true)
        // arbitration (plan §4.2, D13 收窄): ① server activeId ∈ openIds;
        // ② localStorage 'assistant' memory ('chat'/'history' 残留一律无效);
        // ③ openIds[0]; ④ 'empty'
        const known = new Set(state.openIds)
        let next: AiActiveTab
        if (state.activeId !== null && known.has(state.activeId)) {
          next = state.activeId
        } else {
          let saved: string | null = null
          try {
            saved = persistKey ? localStorage.getItem(persistKey) : null
          } catch {
            /* storage blocked */
          }
          next =
            saved === 'assistant'
              ? 'assistant'
              : (state.openIds[0] ?? 'empty')
        }
        lastChatIdRef.current = isChatTab(next) && known.has(next) ? next : (state.openIds[0] ?? null)
        setActiveTabState(next)
      })
      .catch(() => {
        setReady(true)
      })
  }, [persistKey])

  useEffect(() => {
    load()
    // reload only on document-session change (the mount itself reloads; a
    // null→real save transition must NOT reload — state continues)
  }, [reloadKey])

  // ── persistence ───────────────────────────────────────────

  const writeOpenSet = useCallback((nextOpen: string[], active: AiActiveTab) => {
    const api = projectApi()
    const s = scopeRef.current
    if (!api || !s) return
    // stored activeId must be a member of openIds (the server clamps otherwise)
    const preferred = isChatTab(active) ? active : lastChatIdRef.current
    void api
      .conversationsOpenSet({
        filePath: s.filePath,
        ...(s.tempChatId !== undefined ? { tempChatId: s.tempChatId } : {}),
        ...(s.sessionId !== undefined ? { sessionId: s.sessionId } : {}),
        openIds: nextOpen,
        activeId: preferred !== null && nextOpen.includes(preferred) ? preferred : null,
      })
      .catch(() => {
        /* silent: the tab model degrades to memory */
      })
  }, [])

  /** debounced 300ms writer for open-set changes driven by state (plan §4.2) */
  const openSetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleOpenSet = useCallback(
    (nextOpen: string[], active: AiActiveTab) => {
      if (openSetTimerRef.current) clearTimeout(openSetTimerRef.current)
      openSetTimerRef.current = setTimeout(() => {
        openSetTimerRef.current = null
        writeOpenSet(nextOpen, active)
      }, 300)
    },
    [writeOpenSet],
  )
  useEffect(
    () => () => {
      if (openSetTimerRef.current) clearTimeout(openSetTimerRef.current)
    },
    [],
  )

  // ── mutations ─────────────────────────────────────────────

  const setActiveTab = useCallback(
    (tab: AiActiveTab) => {
      setActiveTabState(tab)
      if (tab === 'assistant') {
        // D13: 键值收窄为 'assistant' 单值(历史不再是 tab)
        try {
          if (persistKey) localStorage.setItem(persistKey, tab)
        } catch {
          /* storage blocked: the pick lasts for the session */
        }
      } else if (isChatTab(tab)) {
        lastChatIdRef.current = tab
        scheduleOpenSet(openIds, tab)
      }
    },
    [persistKey, openIds, scheduleOpenSet],
  )

  const create = useCallback(() => {
    const api = projectApi()
    const s = scopeRef.current
    if (api && s) {
      void api
        .conversationCreate(s)
        .then((r) => {
          const next = [...openIdsRef.current, r.chatId]
          setProjectId(r.projectId)
          setConversations((prev) => [...prev, newConvMeta(r.chatId)])
          setOpenIds(next)
          scheduleOpenSet(next, r.chatId)
          lastChatIdRef.current = r.chatId
          setActiveTabState(r.chatId)
        })
        .catch(() => {
          /* keep the current state on failure */
        })
    } else {
      const chatId = `conv-${nowMs().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      setConversations((prev) => [...prev, newConvMeta(chatId)])
      setOpenIds((prev) => [...prev, chatId])
      lastChatIdRef.current = chatId
      setActiveTabState(chatId)
    }
  }, [scheduleOpenSet])

  const close = useCallback(
    (id: string) => {
      const idx = openIds.indexOf(id)
      if (idx < 0) return
      // D12 前置分流:空会话(从未发言)直接丢弃——删元数据、不产生历史条目、
      // 无确认(未发送的草稿随实例卸载一并丢弃);非空才进历史
      const meta = conversations.find((c) => c.chatId === id)
      const empty = (meta === undefined || meta.title === '') && !spokenRef.current.has(id)
      if (empty) {
        setConversations((prev) => prev.filter((c) => c.chatId !== id))
        const api = projectApi()
        const s = scopeRef.current
        if (api && s) void api.conversationDelete({ ...s, chatId: id }).catch(() => {})
      } else {
        // a history entry is provably non-empty from here on
        spokenRef.current.add(id)
      }
      const next = openIds.filter((x) => x !== id)
      setOpenIds(next)
      let nextActive = activeTab
      if (activeTab === id) {
        // closed the active tab: fall to a sibling, else the empty state
        const fallback = next[Math.min(idx, next.length - 1)]
        nextActive = fallback ?? 'empty'
        setActiveTabState(nextActive)
        lastChatIdRef.current = fallback ?? lastChatIdRef.current
      }
      scheduleOpenSet(next, nextActive)
    },
    [openIds, conversations, activeTab, scheduleOpenSet],
  )

  const restore = useCallback(
    (chatId: string) => {
      if (openIds.includes(chatId)) {
        setActiveTabState(chatId)
        return
      }
      // restored from history ⇒ provably non-empty (closed 只含非空会话,D12)
      spokenRef.current.add(chatId)
      const next = [...openIds, chatId]
      setOpenIds(next)
      lastChatIdRef.current = chatId
      setActiveTabState(chatId)
      scheduleOpenSet(next, chatId)
    },
    [openIds, scheduleOpenSet],
  )

  const removeClosed = useCallback((chatId: string) => {
    setConversations((prev) => prev.filter((c) => c.chatId !== chatId))
    const api = projectApi()
    const s = scopeRef.current
    if (api && s) void api.conversationDelete({ ...s, chatId }).catch(() => {})
  }, [])

  const removeAllClosed = useCallback(() => {
    const keep = new Set(openIds)
    setConversations((prev) => prev.filter((c) => keep.has(c.chatId)))
    const api = projectApi()
    const s = scopeRef.current
    if (api && s) void api.conversationsDeleteAll({ ...s, openIds }).catch(() => {})
  }, [openIds])

  const reportTitle = useCallback(
    (chatId: string, title: string) => {
      // a title report implies a user message exists ⇒ D12 "spoken" (即使清洗后为空串)
      spokenRef.current.add(chatId)
      // plan §4.7: first user message head, whitespace-collapsed, ~14 chars
      const clean = title.replace(/\s+/g, ' ').trim().slice(0, 14)
      if (!clean) return
      setConversations((prev) =>
        prev.map((c) => (c.chatId === chatId && !c.title ? { ...c, title: clean } : c)),
      )
      const api = projectApi()
      const s = scopeRef.current
      if (api && s) void api.conversationMeta({ ...s, chatId, title: clean }).catch(() => {})
    },
    [],
  )

  const touch = useCallback((chatId: string) => {
    spokenRef.current.add(chatId) // D12: a completed turn ⇒ transcript records exist
    const t = nowMs()
    setConversations((prev) =>
      prev.map((c) => (c.chatId === chatId ? { ...c, lastActiveAt: t } : c)),
    )
    const api = projectApi()
    const s = scopeRef.current
    if (api && s) void api.conversationMeta({ ...s, chatId, lastActiveAt: t }).catch(() => {})
  }, [])

  const setRunning = useCallback((chatId: string, running: boolean) => {
    if (running) spokenRef.current.add(chatId) // D12: a run started (D10 中断半截轮次照常落盘)
    setRunningIds((prev) => {
      // same identity when nothing changed: callers re-run their onRunningChange
      // effect on every parent render (inline arrow identities), so a fresh Set
      // here would loop render→effect→setState forever
      if (prev.has(chatId) === running) return prev
      const next = new Set(prev)
      if (running) next.add(chatId)
      else next.delete(chatId)
      return next
    })
  }, [])

  const rebindIndex = useCallback((oldKey: string, newPath: string) => {
    const api = projectApi()
    if (!api) return
    void api
      .conversationsRebind({ oldPath: oldKey, newPath })
      .catch(() => {})
      .finally(() => {
        // the key moved (possibly into another project): refresh projectId, keep state
        const s = scopeRef.current
        if (s) {
          void api
            .conversationsList(s)
            .then((state) => setProjectId(state.projectId))
            .catch(() => {})
        }
      })
  }, [])

  const open = useMemo(() => {
    const byId = new Map(conversations.map((c) => [c.chatId, c]))
    return openIds
      .map((id) => byId.get(id))
      .filter((c): c is AiConversationMeta => c !== undefined)
  }, [conversations, openIds])

  const closed = useMemo(() => {
    const openSet = new Set(openIds)
    return conversations
      // D12: history holds non-empty conversations only (从未发言的条目一律不可见)
      .filter(
        (c) => !openSet.has(c.chatId) && (c.title !== '' || spokenRef.current.has(c.chatId)),
      )
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  }, [conversations, openIds])

  return {
    projectId,
    open,
    closed,
    activeTab,
    setActiveTab,
    ready,
    runningIds,
    create,
    close,
    restore,
    removeClosed,
    removeAllClosed,
    reportTitle,
    touch,
    setRunning,
    rebindIndex,
  }
}
