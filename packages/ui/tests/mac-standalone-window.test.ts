// @vitest-environment jsdom
/**
 * isMacStandaloneWindow 门控单测：红绿灯让位（.mac-standalone → 84px 左内距）
 * 只允许出现在「mac 独立窗口」——win/linux 的关闭按钮与菜单位于右侧、左侧
 * 不得留白，tab 模式的灯归 shell tab 条。改坏这个开关就会让 win/linux 左侧
 * 凭空多出 84px 空白。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { isMacStandaloneWindow } from '../src/DockShell'

const setPlatform = (value: string): void => {
  Object.defineProperty(window.navigator, 'platform', { value, configurable: true })
}

afterEach(() => {
  setPlatform('MacIntel')
  window.history.replaceState(null, '', '/')
})

describe('isMacStandaloneWindow', () => {
  it('true only on a mac standalone window', () => {
    setPlatform('MacIntel')
    expect(isMacStandaloneWindow()).toBe(true)
  })

  it('never on windows/linux — their controls sit on the right, no left inset', () => {
    setPlatform('Win32')
    expect(isMacStandaloneWindow()).toBe(false)
    setPlatform('Linux x86_64')
    expect(isMacStandaloneWindow()).toBe(false)
  })

  it('never in tab mode — the shell tab strip owns the traffic lights there', () => {
    setPlatform('MacIntel')
    window.history.replaceState(null, '', '/?mode=tab')
    expect(isMacStandaloneWindow()).toBe(false)
  })
})
