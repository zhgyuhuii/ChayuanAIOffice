import { describe, expect, it } from 'vitest'
import * as mobileTouch from '../src/index'

describe('@chatoffice/mobile-touch P0 skeleton', () => {
  it('exposes the four-piece API surface as importable stubs', () => {
    expect(typeof mobileTouch.usePinchZoom).toBe('function')
    expect(typeof mobileTouch.usePan).toBe('function')
    expect(typeof mobileTouch.useDoubleTap).toBe('function')
    expect(typeof mobileTouch.useLongPress).toBe('function')
    expect(typeof mobileTouch.SelectionHandles).toBe('function')
    expect(typeof mobileTouch.FloatingToolbar).toBe('function')
    expect(typeof mobileTouch.EditorOverlay).toBe('function')
    expect(typeof mobileTouch.useKeyboardInset).toBe('function')
    expect(typeof mobileTouch.KeyboardSpacer).toBe('function')
  })

  it('stubs throw a clear not-implemented error', () => {
    expect(() => mobileTouch.useKeyboardInset()).toThrow(/not implemented in P0/)
  })
})
