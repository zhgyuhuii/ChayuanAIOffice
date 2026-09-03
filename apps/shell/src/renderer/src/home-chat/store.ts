import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  HomeChatMessage,
  HomeChatSession,
  HomeChatSessionScope,
} from '../../../shared/home-api'

export interface HomeChatStore {
  /** null while the persisted sessions are loading */
  sessions: HomeChatSession[] | null
  activeId: string | null
  active: HomeChatSession | null
  /** open a session (null = back to landing / fresh chat) */
  setActiveId(id: string | null): void
  /** create a fresh session and make it active; scope attaches it to a
   * project (a "task") or a file in the left tree */
  createSession(scope?: HomeChatSessionScope): HomeChatSession
  updateSession(id: string, mutate: (session: HomeChatSession) => HomeChatSession): void
  removeSession(id: string): void
  renameSession(id: string, title: string): void
}

const MAX_SESSIONS = 50
const SAVE_DEBOUNCE_MS = 400

export function deriveTitle(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  return cleaned.length > 40 ? `${cleaned.slice(0, 40)}…` : cleaned
}

/** persisted home-chat sessions (load once, debounced saves on every change) */
export function useHomeChatStore(
  bridge: Pick<typeof window.chatOffice, 'chatSessionsLoad' | 'chatSessionsSave'>,
): HomeChatStore {
  const [sessions, setSessions] = useState<HomeChatSession[] | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    let live = true
    void bridge.chatSessionsLoad().then((loaded) => {
      if (live) setSessions(loaded)
    })
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (sessions === null) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void bridge.chatSessionsSave(sessions.slice(0, MAX_SESSIONS))
    }, SAVE_DEBOUNCE_MS)
    return () => clearTimeout(saveTimer.current)
  }, [sessions])

  const createSession = useCallback((scope?: HomeChatSessionScope): HomeChatSession => {
    const session: HomeChatSession = {
      id: crypto.randomUUID(),
      title: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      ...(scope ? { scope } : {}),
    }
    setSessions((prev) => [session, ...(prev ?? [])])
    setActiveId(session.id)
    return session
  }, [])

  const updateSession = useCallback(
    (id: string, mutate: (session: HomeChatSession) => HomeChatSession) => {
      setSessions((prev) => {
        if (!prev) return prev
        return prev.map((s) => (s.id === id ? { ...mutate(s), updatedAt: Date.now() } : s))
      })
    },
    [],
  )

  const removeSession = useCallback((id: string) => {
    setSessions((prev) => (prev ? prev.filter((s) => s.id !== id) : prev))
    setActiveId((current) => (current === id ? null : current))
  }, [])

  const renameSession = useCallback((id: string, title: string) => {
    setSessions(
      (prev) =>
        prev?.map((s) => (s.id === id ? { ...s, title: title.trim() || s.title } : s)) ?? prev,
    )
  }, [])

  const active = sessions?.find((s) => s.id === activeId) ?? null

  return {
    sessions,
    activeId,
    active,
    setActiveId,
    createSession,
    updateSession,
    removeSession,
    renameSession,
  }
}

export function appendMessage(session: HomeChatSession, message: HomeChatMessage): HomeChatSession {
  return {
    ...session,
    title: session.title || (message.role === 'user' ? deriveTitle(message.text) : session.title),
    messages: [...session.messages, message],
  }
}

export function patchLastMessage(
  session: HomeChatSession,
  mutate: (message: HomeChatMessage) => HomeChatMessage,
): HomeChatSession {
  const messages = [...session.messages]
  const last = messages[messages.length - 1]
  if (!last) return session
  messages[messages.length - 1] = mutate(last)
  return { ...session, messages }
}
