import type { AgentMessage } from '@chatoffice/agent-core'
import type {
  HomeChatAttachment,
  HomeChatCard,
  HomeChatMessage,
  HomeChatSession,
} from '../../../shared/home-api'
import { HomeAgent, type HomeAgentBridge, type HomeAgentTexts } from './agent'

export interface HomeChatControllerTexts extends HomeAgentTexts {
  /** closing card line: document opened in a new tab */
  docOpenedInTab(title: string): string
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
      this.bridge,
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
        onBusy: (busy) => this.onBusyChange?.(sessionId, busy),
        onDone: ({ createdDoc, openedDoc }) => {
          this.updateSession(sessionId, (s) => {
            const messages = [...s.messages]
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
            const handedOff = createdDoc
              ? { docTitle: createdDoc.title }
              : openedDoc
                ? { docTitle: openedDoc.title, filePath: openedDoc.filePath }
                : s.handedOff
            return { ...s, messages, handedOff }
          })
          watch.pendingDocType = null
          watch.pendingDocTitle = null
        },
        onError: (error) => {
          this.updateSession(sessionId, (s) => {
            const messages = [...s.messages]
            const last = messages[messages.length - 1]
            if (!last || last.role !== 'assistant') return s
            messages[messages.length - 1] = { ...last, text: last.text || error, error: true }
            return { ...s, messages }
          })
        },
      },
      this.texts,
      this.systemSuffix,
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

  isBusy(sessionId: string): boolean {
    return this.agents.get(sessionId)?.busy ?? false
  }

  /** send a user message; when no model is configured, reply with the setup card instead */
  send(
    sessionId: string,
    history: HomeChatMessage[],
    text: string,
    attachments: HomeChatAttachment[],
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
      ts: Date.now(),
    }
    this.updateSession(sessionId, (s) => ({
      ...s,
      title: s.title || deriveTitle(text),
      messages: [...s.messages, userMessage, placeholder],
    }))
    let model: ReturnType<HomeAgentBridge['getCurrentModel']>
    try {
      model = this.bridge.getCurrentModel()
    } catch {
      model = null as never
    }
    if (!model) {
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
    void this.agentFor(sessionId, history).send(text, attachments)
  }

  stop(sessionId: string): void {
    this.agents.get(sessionId)?.stop()
  }
}

function deriveTitle(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  return cleaned.length > 40 ? `${cleaned.slice(0, 40)}…` : cleaned
}
