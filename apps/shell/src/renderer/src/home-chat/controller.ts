import type { AgentMessage } from '@chatoffice/agent-core'
import type { AiModelSelection, KbCitation } from '@chatoffice/ai-provider'
import type {
  HomeChatAttachment,
  HomeChatCard,
  HomeChatMessage,
  HomeChatSession,
} from '../../../shared/home-api'
import { HomeAgent, PLAN_MODE_SUFFIX, type HomeAgentBridge, type HomeAgentTexts } from './agent'
import { settleRunningTools, upsertToolActivity } from './relay-client'

export interface HomeChatControllerTexts extends HomeAgentTexts {
  /** closing card line: document opened in a new tab */
  docOpenedInTab(title: string): string
}

/** per-send composer state the send path must honor */
export interface HomeChatSendOptions {
  /** session-scoped model picked in the composer (undefined = global current) */
  model?: AiModelSelection | undefined
  /** plan mode: advice-only turn (plan suffix appended to the system prompt) */
  mode?: 'default' | 'plan' | undefined
  /** assistant persona riding THIS message (one-shot, Q: 点击发送后助手即消失):
   *  the persona is appended to the system prompt for the run this send starts
   *  and dropped when it finishes; {{input}} = the user's text */
  assistant?: { template?: string } | undefined
  /** KB 检索增强:发送前检索得到的编号上下文块与引用(选库后每轮注入) */
  kb?: { block: string; citations: KbCitation[] } | undefined
}

interface RunWatch {
  /** the in-flight turn created a document: the body message freezes with a card */
  pendingDocType: 'docx' | 'md' | null
  pendingDocTitle: string | null
}

/**
 * Owns one HomeAgent per chat session so runs survive session switches and
 * landing/conversation view changes. All session mutation goes through the
 * `updateSession` callback supplied by the store hook.
 */
export class HomeChatController {
  private readonly agents = new Map<string, HomeAgent>()
  /** per-session model override, read by the agent's transport at run start */
  private readonly sessionModels = new Map<string, () => AiModelSelection>()
  /** per-session composer mode; the plan suffix is appended while 'plan' */
  private readonly sessionModes = new Map<string, 'default' | 'plan'>()
  /** per-session assistant persona (assistant picker); appended to the
   *  system prompt on every run while set — survives session switches */
  private readonly sessionPersonas = new Map<string, string>()
  /** one-shot personas: send with `assistant` options clears the persona when
   *  the run it started finishes (the chip already vanished at send time) */
  private readonly oneShotPersonas = new Set<string>()

  constructor(
    private readonly bridge: HomeAgentBridge,
    private readonly texts: HomeChatControllerTexts,
    private readonly updateSession: (
      id: string,
      mutate: (session: HomeChatSession) => HomeChatSession,
    ) => void,
    private readonly systemSuffix?: () => string,
    /** busy flips of a session's in-flight turn (drives the composer's stop state) */
    private readonly onBusyChange?: (sessionId: string, busy: boolean) => void,
  ) {}

  private agentFor(sessionId: string, history: HomeChatMessage[]): HomeAgent {
    const existing = this.agents.get(sessionId)
    if (existing) return existing
    const watch: RunWatch = { pendingDocType: null, pendingDocTitle: null }
    const agent = new HomeAgent(
      {
        ...this.bridge,
        // the session's picked model wins over the global current selection
        getCurrentModel: () =>
          this.sessionModels.get(sessionId)?.() ?? this.bridge.getCurrentModel(),
      },
      {
        onText: (text) => {
          this.updateSession(sessionId, (s) => {
            const messages = [...s.messages]
            const last = messages[messages.length - 1]
            if (!last || last.role !== 'assistant') return s
            messages[messages.length - 1] = { ...last, text }
            return { ...s, messages }
          })
        },
        onToolActivity: (activity) => {
          this.updateSession(sessionId, (s) => {
            // 任务清单不进时间线:全量快照直接挂消息(右上角折叠框 UI)
            if (activity.name === 'update_task_list' && activity.tasks) {
              const messages = [...s.messages]
              const last = messages[messages.length - 1]
              if (last?.role === 'assistant') {
                messages[messages.length - 1] = { ...last, tasks: activity.tasks }
                return { ...s, messages }
              }
              return s
            }
            return { ...s, messages: upsertToolActivity(s.messages, activity) }
          })
        },
        onBusy: (busy) => this.onBusyChange?.(sessionId, busy),
        onDone: ({ createdDoc, openedDoc }) => {
          this.finishOneShotPersona(sessionId)
          this.updateSession(sessionId, (s) => {
            const messages = settleRunningTools(s.messages)
            const last = messages[messages.length - 1]
            if (last?.role === 'assistant') {
              let card: HomeChatCard | undefined
              if (createdDoc) {
                card = { kind: 'doc-created', title: createdDoc.title, docType: createdDoc.docType }
              } else if (openedDoc) {
                card = { kind: 'doc-opened', title: openedDoc.title, filePath: openedDoc.filePath }
              }
              if (card) messages[messages.length - 1] = { ...last, card }
            }
            // P1 停靠契约: documents dock beside the conversation — it does
            // NOT move into an editor tab's panel, so handedOff stays as-is
            // (legacy sessions that really moved keep their read-only mark)
            return { ...s, messages }
          })
          watch.pendingDocType = null
          watch.pendingDocTitle = null
        },
        onError: (error) => {
          this.finishOneShotPersona(sessionId)
          this.updateSession(sessionId, (s) => {
            const messages = settleRunningTools(s.messages)
            const last = messages[messages.length - 1]
            if (last?.role === 'assistant') {
              messages[messages.length - 1] = { ...last, text: last.text || error, error: true }
            }
            return { ...s, messages }
          })
        },
      },
      this.texts,
      // evaluated per run by AgentLoop, so a mid-session mode/persona switch
      // applies to the very next turn without recreating the agent
      () => {
        const parts = [this.systemSuffix?.() ?? '']
        const persona = this.sessionPersonas.get(sessionId)
        if (persona) {
          parts.push(
            '## Active assistant persona\n' +
              'The user attached an assistant persona to this request. Stay in this role for this reply, ' +
              'while keeping all your tools and document capabilities available.\n\n' +
              persona,
          )
        }
        if (this.sessionModes.get(sessionId) === 'plan') parts.push(PLAN_MODE_SUFFIX)
        return parts.filter(Boolean).join('\n')
      },
    )
    // model context continuity for sessions restored from disk
    agent.restore(
      history
        .filter((m) => m.text.trim())
        .map((m) => ({ role: m.role, text: m.text }) as AgentMessage),
    )
    this.agents.set(sessionId, agent)
    return agent
  }

  /** assistant persona for the session's system prompt (null = cleared) */
  setAssistantPersona(sessionId: string, persona: string | null): void {
    if (persona === null) this.sessionPersonas.delete(sessionId)
    else this.sessionPersonas.set(sessionId, persona)
  }

  /** one-shot persona lifecycle: dropped when the run it rode on finishes */
  private finishOneShotPersona(sessionId: string): void {
    if (!this.oneShotPersonas.delete(sessionId)) return
    this.sessionPersonas.delete(sessionId)
  }

  isBusy(sessionId: string): boolean {
    return this.agents.get(sessionId)?.busy ?? false
  }

  /** send a user message; when no model is configured, reply with the setup card instead */
  send(
    sessionId: string,
    history: HomeChatMessage[],
    text: string,
    attachments: HomeChatAttachment[],
    options?: HomeChatSendOptions,
  ): void {
    const userMessage: HomeChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text,
      ...(attachments.length ? { attachments } : {}),
      ts: Date.now(),
    }
    const placeholder: HomeChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      text: '',
      ...(options?.kb ? { kbCitations: options.kb.citations } : {}),
      ts: Date.now(),
    }
    this.updateSession(sessionId, (s) => ({
      ...s,
      title: s.title || deriveTitle(text),
      messages: [...s.messages, userMessage, placeholder],
    }))
    if (options?.model) this.sessionModels.set(sessionId, () => options.model!)
    if (options?.mode) this.sessionModes.set(sessionId, options.mode)
    // one-shot assistant: the persona rides this send only — the task template
    // frames the user's text ({{input}} = what they typed) and the persona is
    // dropped when the run finishes (finishOneShotPersona)
    if (options?.assistant) this.oneShotPersonas.add(sessionId)
    let instruction = text
    if (options?.assistant?.template) {
      const template = options.assistant.template
      instruction = template.includes('{{input}}')
        ? template.replaceAll('{{input}}', text)
        : `${template}\n\n${text}`
    }
    let model: ReturnType<HomeAgentBridge['getCurrentModel']>
    try {
      model = options?.model ?? this.bridge.getCurrentModel()
    } catch {
      model = null as never
    }
    if (!model) {
      this.finishOneShotPersona(sessionId)
      this.updateSession(sessionId, (s) => {
        const messages = [...s.messages]
        const last = messages[messages.length - 1]
        if (last?.role === 'assistant') {
          messages[messages.length - 1] = { ...last, card: { kind: 'setup-required' } }
        }
        return { ...s, messages }
      })
      return
    }
    this.onBusyChange?.(sessionId, true)
    void this.agentFor(sessionId, history).send(instruction, attachments, options?.kb?.block)
  }

  stop(sessionId: string): void {
    this.agents.get(sessionId)?.stop()
  }
}

function deriveTitle(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  return cleaned.length > 40 ? `${cleaned.slice(0, 40)}…` : cleaned
}
