/**
 * FontStepper: the A+/A- (and ⌘] / ⌘[) size stepping state machine, lifted
 * verbatim out of Ribbon.tsx so both the legacy closures and the
 * docs.format.fontSize.* commands drive the same coalesce/guard logic (plan
 * risk #1: commands stay stateless wrappers over this stateful service).
 */
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'

// Word's preset size list (also drives the grow/shrink font step buttons)
export const FONT_SIZES = [
  5, 5.5, 6.5, 7.5, 8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72,
]

// A+/A- clicks closer together than this coalesce into one trailing apply;
// must sit above burst-click spacing (~100-200ms) yet stay short enough that
// the deferred re-layout still feels attached to the click.
export const FONT_STEP_COALESCE_MS = 300

export interface FontStepTarget {
  /** active editor (textbox sub-editor when focused) */
  ed: Editor
  /** fs.fontSizePt — may lag the last apply inside the coalesce window */
  currentSize: number
  canEdit: boolean
}

export class FontStepper {
  private pending: number | null = null
  private applied: number | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  // editor snapshot the deferred apply validates against (stale-apply guard)
  private anchor = -1
  private head = -1
  private doc: PMNode | null = null

  applyStep(step: (base: number) => number, target: FontStepTarget): void {
    // Every applied size change re-paginates the whole document synchronously —
    // ~700ms per click on table-heavy documents — so clicking A+/A- in a burst
    // froze the UI for seconds. Apply the first click immediately (a single
    // click keeps instant feedback); clicks landing inside the coalesce window
    // only advance the pending size, and one trailing apply lays out the final
    // size. `pending` also covers fs.fontSizePt lagging the last apply within
    // the window.
    const next = step(this.pending ?? target.currentSize)
    this.pending = next
    if (this.timer === null) {
      this.applied = next
      target.ed
        .chain()
        .focus()
        .setMark('docTextStyle', { sizeHalfPoints: Math.round(next * 2) })
        .run()
    } else {
      clearTimeout(this.timer)
    }
    // Snapshot after the (possible) leading apply: the deferred apply is only
    // valid while nothing else has touched the editor. A selection move, an
    // undo, or a size set another way each shows up as a selection or document
    // change and must invalidate the pending step instead of being overwritten.
    const ed = target.ed
    this.anchor = ed.state.selection.anchor
    this.head = ed.state.selection.head
    this.doc = ed.state.doc
    this.timer = setTimeout(() => {
      this.timer = null
      const pending = this.pending
      this.pending = null
      if (pending === null || pending === this.applied || !target.canEdit) return
      if (
        ed.state.selection.anchor !== this.anchor ||
        ed.state.selection.head !== this.head ||
        ed.state.doc !== this.doc
      )
        return
      this.applied = pending
      // deliberately no focus(): a deferred apply must never pull focus back
      ed.chain()
        .setMark('docTextStyle', { sizeHalfPoints: Math.round(pending * 2) })
        .run()
    }, FONT_STEP_COALESCE_MS)
  }

  /** A+/A- and ⇧⌘. / ⇧⌘,: walk Word's preset size list */
  step(dir: 1 | -1, target: FontStepTarget): void {
    this.applyStep((base) => {
      const idx = FONT_SIZES.findIndex((s) => s >= base)
      if (dir === 1)
        return FONT_SIZES[
          Math.min(
            idx === -1 ? FONT_SIZES.length : idx + (FONT_SIZES[idx] === base ? 1 : 0),
            FONT_SIZES.length - 1,
          )
        ]
      return FONT_SIZES[Math.max(idx === -1 ? FONT_SIZES.length - 1 : idx - 1, 0)]
    }, target)
  }

  /** Word's ⌘] / ⌘[: exactly one point, within Word's 1–1638pt range */
  nudge(dir: 1 | -1, target: FontStepTarget): void {
    this.applyStep((base) => Math.min(Math.max(Math.round(base) + dir, 1), 1638), target)
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    this.pending = null
  }
}
