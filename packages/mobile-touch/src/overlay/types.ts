/**
 * Overlay primitives (P0: type-level stubs, implemented in P1/P2):
 * - FloatingToolbar — the contextual toolbar that follows a selection
 *   (consensus #4), shared by every editor.
 * - EditorOverlay — the DOM textarea proxy that brings up the virtual
 *   keyboard with native IME composition for canvas editors (sheets cells,
 *   slides text objects), where canvas-internal input cannot work.
 */
import type { ReactNode } from 'react'
import type { TouchPoint } from '../gestures/types'

export interface FloatingToolbarProps {
  /** Anchor point in viewport coordinates; null hides the toolbar. */
  readonly anchor: TouchPoint | null
  readonly placement?: 'above' | 'below'
  readonly children?: ReactNode
}

export function FloatingToolbar(_props: FloatingToolbarProps): null {
  throw new Error('@chatoffice/mobile-touch: FloatingToolbar is not implemented in P0')
}

export interface EditorOverlayProps {
  /** Screen rect the overlay mirrors (the cell / text box being edited). */
  readonly rect: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
  readonly initialValue: string
  readonly multiline?: boolean
  readonly onCommit: (value: string) => void
  readonly onCancel: () => void
}

export function EditorOverlay(_props: EditorOverlayProps): null {
  throw new Error('@chatoffice/mobile-touch: EditorOverlay is not implemented in P0')
}
