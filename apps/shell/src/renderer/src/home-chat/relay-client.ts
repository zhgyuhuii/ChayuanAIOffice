import type { RelayCommand, RelayEvent, RelaySeedMessage } from '../../../shared/relay-protocol'
import type { HomeChatMessage } from '../../../shared/home-api'

/**
 * P2-3 首页中继客户端:RelayEvent → 会话消息的纯映射 + 会话↔dock 绑定的
 * 运行期登记。「所见即所驱」(已签):中栏对话始终中继给激活 dock 的文档
 * loop;事件回流镜像为该会话的 assistant 消息(带工具活动卡)。
 */

/** 运行期 dockTabId ⇄ sessionId 绑定(dock tab id 主进程动态分配,不持久化) */
export class RelaySessionLink {
  private readonly docksBySession = new Map<string, Set<string>>()
  private readonly sessionByDock = new Map<string, string>()
  /** 会话当前中继目标(激活 dock);dock tab 关闭时摘除 */
  private readonly activeDockBySession = new Map<string, string>()
  /** P2 追加排队:忙时入队的待投递消息(dock 级,先到先投) */
  private readonly queueByDock = new Map<string, string[]>()
  /** dock 级忙标记:busy 事件+trySend 乐观置位共同维护 */
  private readonly busyDocks = new Set<string>()

  /** DockPane onTabs:登记/对账当前会话的 dock 组;返回新绑定的 dock(需种子) */
  setSessionDocks(sessionId: string, dockTabIds: string[]): string[] {
    if (!this.docksBySession.has(sessionId)) this.docksBySession.set(sessionId, new Set())
    const known = this.docksBySession.get(sessionId)!
    for (const id of known) {
      if (!dockTabIds.includes(id)) {
        known.delete(id)
        if (this.sessionByDock.get(id) === sessionId) this.sessionByDock.delete(id)
        // 关掉的 dock:排队消息作废(主线镜像已含,重开走种子重放)
        this.queueByDock.delete(id)
        this.busyDocks.delete(id)
      }
    }
    const added: string[] = []
    for (const id of dockTabIds) {
      if (!this.sessionByDock.has(id)) {
        this.sessionByDock.set(id, sessionId)
        known.add(id)
        added.push(id)
      }
    }
    if (dockTabIds.length > 0 && !this.activeDockBySession.has(sessionId)) {
      this.activeDockBySession.set(sessionId, dockTabIds[dockTabIds.length - 1]!)
    }
    return added
  }

  /** dock 激活切换:更新该 dock 所属会话的中继目标;目标切换=清旧队列 */
  setActiveDock(dockTabId: string): void {
    const sessionId = this.sessionByDock.get(dockTabId)
    if (!sessionId) return
    const prev = this.activeDockBySession.get(sessionId)
    this.activeDockBySession.set(sessionId, dockTabId)
    if (prev && prev !== dockTabId) this.queueByDock.delete(prev)
  }

  activeDockOf(sessionId: string): string | undefined {
    return this.activeDockBySession.get(sessionId)
  }

  sessionOfDock(dockTabId: string): string | undefined {
    return this.sessionByDock.get(dockTabId)
  }

  /** 该 dock 的会话里,还有哪些别的 dock(激活态排除)——切换目标清队用 */
  siblingDocks(dockTabId: string): string[] {
    const sessionId = this.sessionByDock.get(dockTabId)
    if (!sessionId) return []
    return [...(this.docksBySession.get(sessionId) ?? [])].filter((id) => id !== dockTabId)
  }

  forgetSession(sessionId: string): void {
    for (const id of this.docksBySession.get(sessionId) ?? []) {
      if (this.sessionByDock.get(id) === sessionId) this.sessionByDock.delete(id)
      this.queueByDock.delete(id)
      this.busyDocks.delete(id)
    }
    this.docksBySession.delete(sessionId)
    this.activeDockBySession.delete(sessionId)
  }

  // ── 忙跟踪 + 追加排队(Q7 四通道之一) ──

  isBusy(dockTabId: string): boolean {
    return this.busyDocks.has(dockTabId)
  }

  /** busy 事件落账;忙→闲的翻转取出队头一条(先到先投,逐轮放行) */
  markBusy(dockTabId: string, busy: boolean): string | undefined {
    if (busy) {
      this.busyDocks.add(dockTabId)
      return undefined
    }
    this.busyDocks.delete(dockTabId)
    const queue = this.queueByDock.get(dockTabId)
    const next = queue?.shift()
    if (queue && queue.length === 0) this.queueByDock.delete(dockTabId)
    return next
  }

  /** 忙时排队;返回 true=已排队(消息照常镜像进主线,投递延迟到闲) */
  enqueue(dockTabId: string, text: string): boolean {
    if (!this.isBusy(dockTabId)) return false
    const queue = this.queueByDock.get(dockTabId) ?? []
    queue.push(text)
    this.queueByDock.set(dockTabId, queue)
    return true
  }

  clearQueue(dockTabId: string): void {
    this.queueByDock.delete(dockTabId)
  }
}

export function relaySendCommand(text: string): RelayCommand {
  return { type: 'send', text }
}

export function relayStopCommand(): RelayCommand {
  return { type: 'stop' }
}

/** Q4'' 铁律入口:主线转录 → 种子命令 */
export function relaySeedCommand(messages: HomeChatMessage[]): RelayCommand {
  const seeds: RelaySeedMessage[] = messages
    .filter((m) => m.text.trim() && !m.error)
    .map((m) => ({ role: m.role, text: m.text }))
  return { type: 'seed', messages: seeds }
}

/**
 * 把一条工具活动 upsert 进最后一条 assistant 消息（按 callId 合并，start
 * →running 脉动，end→落成败）。中继镜像与首页本地 agent 共用同一时间线 UI。
 */
export function upsertToolActivity(
  messages: HomeChatMessage[],
  activity: {
    callId: string
    name: string
    summary?: string
    phase: 'start' | 'end'
    ok?: boolean
    outputPreview?: string
    files?: Array<{ name: string; path: string }>
    image?: string
  },
): HomeChatMessage[] {
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'assistant') return messages
  const tools = [...(last.relayTools ?? [])]
  const idx = tools.findIndex((t) => t.callId === activity.callId)
  if (idx >= 0) {
    tools[idx] = {
      ...tools[idx]!,
      running: activity.phase === 'start',
      ok: activity.ok ?? tools[idx]!.ok,
      outputPreview: activity.outputPreview ?? tools[idx]!.outputPreview,
      files: activity.files ?? tools[idx]!.files,
      image: activity.image ?? tools[idx]!.image,
    }
  } else {
    tools.push({
      callId: activity.callId,
      name: activity.name,
      summary: activity.summary,
      running: activity.phase === 'start',
      ok: activity.ok,
      outputPreview: activity.outputPreview,
      ...(activity.files ? { files: activity.files } : {}),
      ...(activity.image ? { image: activity.image } : {}),
    })
  }
  const next = [...messages]
  next[messages.length - 1] = { ...last, relayTools: tools }
  return next
}

/** 运行收尾：still-running 的 chip 落定（stop/重置打断时 onToolExecuted 不会来）。
 *  始终返回外层数组副本——调用方会继续原地改最后一条消息。 */
export function settleRunningTools(messages: HomeChatMessage[]): HomeChatMessage[] {
  const last = messages[messages.length - 1]
  const next = [...messages]
  if (last?.role === 'assistant' && last.relayTools?.some((t) => t.running)) {
    next[next.length - 1] = {
      ...last,
      relayTools: last.relayTools.map((t) => (t.running ? { ...t, running: false } : t)),
    }
  }
  return next
}

/**
 * 事件 → 消息数组纯映射。返回新数组(不可变更新,store 兼容)；
 * 无处可落的事件(如 turn-started 后消息已被并发修补)原样返回。
 */
export function applyRelayEvent(
  messages: HomeChatMessage[],
  event: RelayEvent,
  now: number,
): HomeChatMessage[] {
  switch (event.type) {
    case 'turn-started': {
      const last = messages[messages.length - 1]
      if (last?.role === 'assistant' && !last.text && !last.relayTurnId) {
        return [
          ...messages.slice(0, -1),
          { ...last, id: `relay-${event.turnId}`, relayTurnId: event.turnId },
        ]
      }
      const placeholder: HomeChatMessage = {
        id: `relay-${event.turnId}`,
        role: 'assistant',
        text: '',
        ts: now,
        relayTurnId: event.turnId,
      }
      return [...messages, placeholder]
    }
    case 'text': {
      return patchByTurn(messages, event.turnId, (m) => ({ ...m, text: event.text }))
    }
    case 'tool': {
      return patchByTurn(
        messages,
        event.turnId,
        (m) => upsertToolActivity([m], event.activity)[0] ?? m,
      )
    }
    case 'confirm-request': {
      // P2-7 确认门:确认卡挂在流式中的镜像消息上(该 turn 的占位已存在)
      const r = event.request
      return patchByTurn(messages, event.turnId, (m) => ({
        ...m,
        relayConfirm: {
          confirmId: r.confirmId,
          kind: r.kind,
          payload: r.payload,
          state: 'pending',
        },
      }))
    }
    case 'turn-finished': {
      // 轮次收尾:仍未决议的确认卡过期(停靠 tab 关闭/停止/重种子等场景)
      return patchByTurn(messages, event.turnId, (m) =>
        m.relayConfirm?.state === 'pending'
          ? { ...m, relayConfirm: { ...m.relayConfirm, state: 'expired' } }
          : m,
      )
    }
    case 'error': {
      return patchLastByTurn(messages, event.turnId, (m) => ({
        ...m,
        text: m.text || event.message,
        error: true,
      }))
    }
    case 'busy':
    case 'context':
    case 'switch-request':
    case 'snapshot':
      return messages
  }
}

/** 用户点了批准/驳回:确认卡原地留痕(反馈一并入档) */
export function resolveRelayConfirm(
  messages: HomeChatMessage[],
  confirmId: string,
  approved: boolean,
  feedback?: string,
): HomeChatMessage[] {
  return messages.map((m) =>
    m.relayConfirm?.confirmId === confirmId && m.relayConfirm.state === 'pending'
      ? {
          ...m,
          relayConfirm: {
            ...m.relayConfirm,
            state: approved ? 'approved' : 'rejected',
            feedback: feedback || undefined,
          },
        }
      : m,
  )
}

/** 会话里所有 dock 都不在了:未决议的确认卡一并过期 */
export function expirePendingConfirms(messages: HomeChatMessage[]): HomeChatMessage[] {
  return messages.some((m) => m.relayConfirm?.state === 'pending')
    ? messages.map((m) =>
        m.relayConfirm?.state === 'pending'
          ? { ...m, relayConfirm: { ...m.relayConfirm, state: 'expired' } }
          : m,
      )
    : messages
}

function patchByTurn(
  messages: HomeChatMessage[],
  turnId: string,
  mutate: (m: HomeChatMessage) => HomeChatMessage,
): HomeChatMessage[] {
  let idx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.relayTurnId === turnId) {
      idx = i
      break
    }
  }
  if (idx < 0) return messages
  const next = [...messages]
  next[idx] = mutate(next[idx]!)
  return next
}

function patchLastByTurn(
  messages: HomeChatMessage[],
  turnId: string | null,
  mutate: (m: HomeChatMessage) => HomeChatMessage,
): HomeChatMessage[] {
  if (turnId === null) return messages
  return patchByTurn(messages, turnId, mutate)
}
