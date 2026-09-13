// T2 中栏对话栏自动收纳状态机：docs 激活→收起；手动展开→本次停靠不再
// 自动收起；docs 切走/关闭→恢复且钉住复位（下一份停靠文档再自动收）。
import { describe, expect, it } from 'vitest'
import {
  CHAT_PANE_VISIBLE_DEFAULT,
  isChatPaneHidden,
  nextChatPaneVisibility,
  type ChatPaneVisibilityState,
} from '../src/renderer/src/chat-pane-visibility'

const docsActive = (active: boolean) => ({ type: 'docs-active', active }) as const
const userExpand = { type: 'user-expand' } as const

function walk(
  start: ChatPaneVisibilityState,
  ...actions: Array<ReturnType<typeof docsActive> | typeof userExpand>
): ChatPaneVisibilityState {
  return actions.reduce(nextChatPaneVisibility, start)
}

describe('chat pane visibility against the dock', () => {
  it('defaults to shown with no docked docs', () => {
    expect(isChatPaneHidden(CHAT_PANE_VISIBLE_DEFAULT)).toBe(false)
  })

  it('hides when a docs editor becomes the active dock tab', () => {
    const state = walk(CHAT_PANE_VISIBLE_DEFAULT, docsActive(true))
    expect(isChatPaneHidden(state)).toBe(true)
  })

  it('non-docs dock tabs never hide the pane', () => {
    // sheets/slides tabs arrive with active=true but kind!=='docs' — Home
    // already folds that into docs-active:false
    const state = walk(CHAT_PANE_VISIBLE_DEFAULT, docsActive(false))
    expect(isChatPaneHidden(state)).toBe(false)
  })

  it('manual expand shows the pane and blocks auto-hide for this docs stint', () => {
    const state = walk(CHAT_PANE_VISIBLE_DEFAULT, docsActive(true), userExpand)
    expect(isChatPaneHidden(state)).toBe(false)
  })

  it('docs stepping away restores the pane and resets the pin', () => {
    const state = walk(CHAT_PANE_VISIBLE_DEFAULT, docsActive(true), userExpand, docsActive(false))
    expect(isChatPaneHidden(state)).toBe(false)
    expect(state.userPinnedOpen).toBe(false)
  })

  it('after the pin reset the next docked document auto-hides again', () => {
    const state = walk(
      CHAT_PANE_VISIBLE_DEFAULT,
      docsActive(true),
      userExpand,
      docsActive(false),
      docsActive(true),
    )
    expect(isChatPaneHidden(state)).toBe(true)
  })

  it('switching between two docs tabs keeps the manual pin', () => {
    const state = walk(CHAT_PANE_VISIBLE_DEFAULT, docsActive(true), userExpand, docsActive(true))
    expect(isChatPaneHidden(state)).toBe(false)
    expect(state.userPinnedOpen).toBe(true)
  })

  it('expanding with no docs dock is a no-op', () => {
    const state = walk(CHAT_PANE_VISIBLE_DEFAULT, userExpand)
    expect(state).toEqual(CHAT_PANE_VISIBLE_DEFAULT)
  })

  it('redundant docs-active transitions keep state identity (no re-render loops)', () => {
    const once = walk(CHAT_PANE_VISIBLE_DEFAULT, docsActive(true))
    const twice = nextChatPaneVisibility(once, docsActive(true))
    expect(twice).toBe(once)
  })
})
