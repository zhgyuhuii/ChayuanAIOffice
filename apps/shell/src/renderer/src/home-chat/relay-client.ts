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

  /** DockPane onTabs:登记/对账当前会话的 dock 组;返回新绑定的 dock(需种子) */
  setSessionDocks(sessionId: string, dockTabIds: string[]): string[] {
    if (!this.docksBySession.has(sessionId)) this.docksBySession.set(sessionId, new Set())
    const known = this.docksBySession.get(sessionId)!
    for (const id of known) {
      if (!dockTabIds.includes(id)) {
        known.delete(id)
        if (this.sessionByDock.get(id) === sessionId) this.sessionByDock.delete(id)
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

  /** dock 激活切换:更新该 dock 所属会话的中继目标 */
  setActiveDock(dockTabId: string): void {
    const sessionId = this.sessionByDock.get(dockTabId)
    if (sessionId) this.activeDockBySession.set(sessionId, dockTabId)
  }

  activeDockOf(sessionId: string): string | undefined {
    return this.activeDockBySession.get(sessionId)
  }

  sessionOfDock(dockTabId: string): string | undefined {
    return this.sessionByDock.get(dockTabId)
  }

  forgetSession(sessionId: string): void {
    for (const id of this.docksBySession.get(sessionId) ?? []) {
      if (this.sessionByDock.get(id) === sessionId) this.sessionByDock.delete(id)
    }
    this.docksBySession.delete(sessionId)
    this.activeDockBySession.delete(sessionId)
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
 * 事件 → 消息数组纯映射。返回新数组(不可变更新,store 兼容);
 * 无处可落的事件(如 turn-started 后消息已被并发修补)原样返回。
 */
export function applyRelayEvent(
  messages: HomeChatMessage[],
  event: RelayEvent,
  now: number,
): HomeChatMessage[] {
  switch (event.type) {
    case 'turn-started': {
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
      const a = event.activity
      return patchByTurn(messages, event.turnId, (m) => {
        const tools = [...(m.relayTools ?? [])]
        const idx = tools.findIndex((t) => t.callId === a.callId)
        if (idx >= 0) {
          tools[idx] = {
            ...tools[idx]!,
            running: a.phase === 'start',
            ok: a.ok ?? tools[idx]!.ok,
            outputPreview: a.outputPreview ?? tools[idx]!.outputPreview,
          }
        } else {
          tools.push({
            callId: a.callId,
            name: a.name,
            summary: a.summary,
            running: a.phase === 'start',
            ok: a.ok,
            outputPreview: a.outputPreview,
          })
        }
        return { ...m, relayTools: tools }
      })
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
    case 'confirm-request':
    case 'snapshot':
    case 'turn-finished':
      return messages
  }
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
