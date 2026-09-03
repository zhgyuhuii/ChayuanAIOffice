/**
 * EditorOverlay (P2): the DOM textarea proxy that brings up the virtual
 * keyboard with native IME composition for canvas editors (sheets cells,
 * slides text objects) — canvas-internal input cannot host an IME. The
 * textarea mirrors the target rect; Escape cancels; plain Enter commits for
 * single-line targets (Shift+Enter stays a newline), multiline targets
 * commit on blur/click-away like Word's cell edit. The commit-once guard
 * keeps blur-after-Enter from firing both callbacks.
 */
import {
  useRef,
  useState,
  type ReactElement,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import type { EditorOverlayProps } from './types'

export function EditorOverlay({
  rect,
  initialValue,
  multiline = false,
  onCommit,
  onCancel,
}: EditorOverlayProps): ReactElement {
  const [value, setValue] = useState(initialValue)
  const settledRef = useRef(false)
  const settle = (settled: (value: string) => void) => {
    if (settledRef.current) return
    settledRef.current = true
    settled(value)
  }

  return (
    <textarea
      className="mth-editor-overlay"
      style={{
        position: 'fixed',
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        resize: 'none',
      }}
      autoFocus
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          settle(onCancel)
          return
        }
        if (event.key === 'Enter' && !multiline && !event.shiftKey) {
          event.preventDefault()
          settle(onCommit)
        }
      }}
      onBlur={() => settle(onCommit)}
    />
  )
}
