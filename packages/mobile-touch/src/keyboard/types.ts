/**
 * Virtual-keyboard avoidance types (consensus #7). The inset is driven by the
 * visualViewport API: when the keyboard opens, the bottom toolbar floats above
 * it and the canvas compresses instead of being covered. Implementation lives
 * in inset.tsx (P1); this module stays type-only.
 */

export interface KeyboardInset {
  /** Pixels the keyboard occupies at the bottom edge (0 when hidden). */
  readonly insetBottom: number
  readonly visible: boolean
}
