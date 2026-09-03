import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { HomeChatController } from './controller'
import type { HomeChatControllerTexts } from './controller'
import { useHomeChatStore } from './store'
import type { HomeChatStore } from './store'
import { createHomeChatBridge, refreshHomeModelCache } from './bridge'
import type { HomeChatSession } from '../../../shared/home-api'
import { useI18n } from '../locale'

/** everything the chat surfaces need from the shared home-chat state */
export interface HomeChatContextValue {
  store: HomeChatStore
  controller: HomeChatController
  busy: boolean
  /** open the settings modal (the setup-required card lives here) */
  openSettings: () => void
  /** start a fresh session, bound to a project when given */
  newSession: (projectId: string | null) => void
  /**
   * bind the in-flight turn's AI-created docx/md to a project (first-save
   * hook); the binding auto-clears when the turn settles
   */
  bindPendingProject: (projectId: string) => void
}

const HomeChatContext = createContext<HomeChatContextValue | null>(null)

export function useHomeChat(): HomeChatContextValue {
  const value = useContext(HomeChatContext)
  if (!value) throw new Error('useHomeChat outside HomeChatProvider')
  return value
}

/**
 * Owns the home-chat store + controller once for the whole three-pane frame:
 * the sidebar's conversation list, the chat stage, and the top strip all
 * consume the same active session.
 */
export function HomeChatProvider({
  onOpenSettings,
  children,
}: {
  onOpenSettings: () => void
  children: ReactNode
}): React.JSX.Element {
  const { t } = useI18n()
  const storeRef = useRef<HomeChatStore | null>(null)
  const store = useHomeChatStore(
    useMemo(
      () => ({
        chatSessionsLoad: async () => (await window.chatOffice.chatSessionsLoad?.()) ?? [],
        chatSessionsSave: async (sessions: HomeChatSession[]) => {
          await window.chatOffice.chatSessionsSave?.(sessions)
        },
      }),
      [],
    ),
  )
  storeRef.current = store

  const activeIdRef = useRef<string | null>(null)
  activeIdRef.current = store.activeId
  const [busy, setBusy] = useState(false)
  /** the ACTIVE CONVERSATION's project feeds the agent's file search — it
   * follows session switches, not sidebar selection */
  const projectIdRef = useRef<string | null>(null)
  projectIdRef.current = store.active?.projectId ?? null
  /** the project the in-flight turn's created docx should land in (cleared on settle) */
  const pendingProjectRef = useRef<string | null>(null)

  // texts read at send time, so a language switch applies without recreating agents
  const textsRef = useRef<HomeChatControllerTexts | null>(null)
  textsRef.current = {
    docBodyMissing: t('chatToolDocBodyMissing'),
    createFailed: (error) => t('chatToolCreateFailed', { e: error }),
    openFailed: (error) => t('chatToolOpenFailed', { e: error }),
    unsupportedHandoff: t('chatToolUnsupportedHandoff'),
    fileNotFound: t('chatToolFileNotFound'),
    unknownError: t('chatUnknownError'),
    docOpenedInTab: (title) => t('chatDocOpenedInTab', { title }),
  }

  const controller = useMemo(
    () =>
      new HomeChatController(
        createHomeChatBridge(() => projectIdRef.current),
        {
          get docBodyMissing() {
            return textsRef.current!.docBodyMissing
          },
          createFailed: (error) => textsRef.current!.createFailed(error),
          openFailed: (error) => textsRef.current!.openFailed(error),
          get unsupportedHandoff() {
            return textsRef.current!.unsupportedHandoff
          },
          get fileNotFound() {
            return textsRef.current!.fileNotFound
          },
          get unknownError() {
            return textsRef.current!.unknownError
          },
          docOpenedInTab: (title) => textsRef.current!.docOpenedInTab(title),
        },
        (id, mutate) => storeRef.current!.updateSession(id, mutate),
        undefined,
        (id, isBusy) => {
          if (id === activeIdRef.current) setBusy(isBusy)
          // the turn settled: drop a leftover project binding so a later plain
          // 新建文档 doesn't get mis-bound to this project
          if (!isBusy && pendingProjectRef.current) {
            for (const kind of ['doc', 'markdown'] as const) {
              void window.chatOffice.setPendingNewFileProject?.(kind, null)
            }
            pendingProjectRef.current = null
          }
        },
      ),
    [],
  )

  // refresh the current-model cache: mount, window focus (the settings modal
  // close path lives in Home)
  useEffect(() => {
    void refreshHomeModelCache()
    const onFocus = () => void refreshHomeModelCache()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const openSettings = useCallback(() => onOpenSettings(), [onOpenSettings])

  const newSession = useCallback((projectId: string | null) => {
    const active = storeRef.current?.active
    if (active && active.messages.length === 0) {
      if (projectId) {
        storeRef.current?.updateSession(active.id, (s) => ({
          ...s,
          projectId: projectId || undefined,
        }))
      }
      return
    }
    setBusy(false)
    const session = storeRef.current?.createSession()
    if (session && projectId) {
      storeRef.current?.updateSession(session.id, (s) => ({ ...s, projectId }))
    }
  }, [])

  const bindPendingProject = useCallback((projectId: string) => {
    pendingProjectRef.current = projectId
    for (const kind of ['doc', 'markdown'] as const) {
      void window.chatOffice.setPendingNewFileProject?.(kind, projectId)
    }
  }, [])

  const value = useMemo<HomeChatContextValue>(
    () => ({ store, controller, busy, openSettings, newSession, bindPendingProject }),
    [store, controller, busy, openSettings, newSession, bindPendingProject],
  )

  return <HomeChatContext.Provider value={value}>{children}</HomeChatContext.Provider>
}
