/**
 * Virtual-keyboard avoidance (P0: type-level stubs, implemented in P1).
 * Driven by the visualViewport API: when the keyboard opens, the bottom
 * toolbar floats above it and the canvas compresses instead of being covered.
 */

export interface KeyboardInset {
  /** Pixels the keyboard occupies at the bottom edge (0 when hidden). */
  readonly insetBottom: number
  readonly visible: boolean
}

export function useKeyboardInset(): KeyboardInset {
  throw new Error('@chatoffice/mobile-touch: useKeyboardInset is not implemented in P0')
}

/** Layout spacer that grows by the keyboard inset (toolbars, docks). */
export function KeyboardSpacer(): null {
  throw new Error('@chatoffice/mobile-touch: KeyboardSpacer is not implemented in P0')
}
