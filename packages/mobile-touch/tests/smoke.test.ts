import { describe, expect, it } from 'vitest'
import * as mobileTouch from '../src/index'

describe('@chatoffice/mobile-touch API surface', () => {
  it('exposes the complete kit (P1+P2, no stubs)', () => {
    expect(typeof mobileTouch.useKeyboardInset).toBe('function')
    expect(typeof mobileTouch.KeyboardSpacer).toBe('function')
    expect(typeof mobileTouch.computeKeyboardInset).toBe('function')
    expect(typeof mobileTouch.useLongPress).toBe('function')
    expect(typeof mobileTouch.useDoubleTap).toBe('function')
    expect(typeof mobileTouch.usePinchZoom).toBe('function')
    expect(typeof mobileTouch.usePan).toBe('function')
    expect(typeof mobileTouch.SelectionHandles).toBe('function')
    expect(typeof mobileTouch.FloatingToolbar).toBe('function')
    expect(typeof mobileTouch.EditorOverlay).toBe('function')
    expect(mobileTouch.LONG_PRESS_DELAY_MS).toBe(500)
    expect(mobileTouch.DOUBLE_TAP_WINDOW_MS).toBe(300)
  })
})
