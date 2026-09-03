import { describe, expect, it } from 'vitest'
import * as mobileTouch from '../src/index'

describe('@chatoffice/mobile-touch API surface', () => {
  it('exposes the implemented P1 pieces and the remaining stubs', () => {
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
  })

  it('not-yet-implemented pieces stay loud failures (P2)', () => {
    expect(() => mobileTouch.usePinchZoom({ current: null }, { onPinchZoom: () => {} })).toThrow(
      /not implemented/,
    )
    expect(() => mobileTouch.usePan({ current: null }, { onPanMove: () => {} })).toThrow(
      /not implemented/,
    )
  })
})
