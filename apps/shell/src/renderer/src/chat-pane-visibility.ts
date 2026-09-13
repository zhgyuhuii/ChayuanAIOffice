/**
 * Middle chat-pane auto-hide against the dock (T2): while a docs editor is
 * the ACTIVE dock tab the conversation pane collapses so the document takes
 * the full width; a floating handle restores it.
 *
 * Session-scoped, never persisted:
 * - docs tab becomes active  → hidden (unless the user pinned it open)
 * - user clicks the handle   → shown + pinned; no more auto-hide while this
 *                              docs tab stays active
 * - docs stops being the
 *   active dock tab          → shown + pin reset, so the NEXT docked document
 *                              auto-hides the pane again
 */

export interface ChatPaneVisibilityState {
  /** a docs editor fills the dock pane right now */
  docsDockActive: boolean
  /** the user re-opened the pane during the current docs dock stint */
  userPinnedOpen: boolean
}

export type ChatPaneVisibilityAction =
  { type: 'docs-active'; active: boolean } | { type: 'user-expand' }

export const CHAT_PANE_VISIBLE_DEFAULT: ChatPaneVisibilityState = {
  docsDockActive: false,
  userPinnedOpen: false,
}

/** the pane is hidden only while a docs editor is active and unpinned */
export function isChatPaneHidden(state: ChatPaneVisibilityState): boolean {
  return state.docsDockActive && !state.userPinnedOpen
}

export function nextChatPaneVisibility(
  prev: ChatPaneVisibilityState,
  action: ChatPaneVisibilityAction,
): ChatPaneVisibilityState {
  switch (action.type) {
    case 'docs-active':
      if (prev.docsDockActive === action.active) return prev
      // docs stepping away restores the pane AND ends the pin — the next
      // docked document starts a fresh auto-hide cycle
      return action.active
        ? { docsDockActive: true, userPinnedOpen: false }
        : { docsDockActive: false, userPinnedOpen: false }
    case 'user-expand':
      // expanding without a docs dock is a no-op (the pane is already shown)
      if (!prev.docsDockActive || prev.userPinnedOpen) return prev
      return { ...prev, userPinnedOpen: true }
  }
}
