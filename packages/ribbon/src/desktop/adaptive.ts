/**
 * M2 adaptive engine, decision core. WPS model (CT_*.kuip 事实,见
 * docs/ribbon-wps-parity-gap.md §1): every control declares a spaceHint —
 * loose/suitable/topsuitable/compact/autocompact — and canHideText; narrowing
 * first hides allowed label text, then merges groups onto one row, and as the
 * last resort collapses whole groups into their name buttons (which reopen the
 * original layout in a panel).
 *
 * This module holds the pure decisions (derivation + the collapse planner) so
 * they are testable without layout. The measuring loop lives in DesktopRibbon
 * (ResizeObserver on the tab body, re-measure after every degradation step).
 */
import type { RibbonControl, RibbonGroup } from '../schema/types'

export type SpaceHint = 'loose' | 'suitable' | 'topsuitable' | 'compact' | 'autocompact'

/**
 * Degrade order across a group: looser hints give up their text first
 * (suitable is the canonical "big labeled button"), autocompact controls are
 * already icon-only and never degrade. loose (galleries) never shrinks.
 */
export const SPACE_HINT_RANK: Record<SpaceHint, number> = {
  suitable: 0,
  topsuitable: 1,
  compact: 2,
  autocompact: 3,
  loose: 4,
}

type AdaptShape = {
  readonly kind: RibbonControl['kind']
  readonly size?: string
  readonly icon?: string
  readonly labelKey?: string
  readonly spaceHint?: SpaceHint
  readonly canHideText?: boolean
}

/** Schema hint when declared; otherwise derived from kind+size (Q14 推导表). */
export function deriveSpaceHint(control: AdaptShape): SpaceHint {
  if (control.spaceHint) return control.spaceHint
  switch (control.kind) {
    case 'gallery':
      return 'loose'
    case 'combobox':
    case 'number':
      return 'compact'
    case 'button':
    case 'toggle':
      if (control.size === 'big') return 'suitable'
      return control.size === 'small' ? 'compact' : 'autocompact'
    case 'split':
    case 'dropdown':
      return control.size === 'big' ? 'suitable' : 'autocompact'
    default:
      // colorpicker/separator/custom: icon-shaped or non-visual
      return 'autocompact'
  }
}

/** Whether the label text may be dropped (icon kept) when space runs out. */
export function deriveCanHideText(control: AdaptShape): boolean {
  if (control.canHideText !== undefined) return control.canHideText
  switch (control.kind) {
    case 'button':
    case 'toggle':
    case 'split':
    case 'dropdown':
      return Boolean(control.icon) && control.size !== 'icon' && Boolean(control.labelKey)
    default:
      // combobox/number keep their value text; galleries/colors have no label
      return false
  }
}

/** Controls of a group in the order their text should be hidden. */
export function textHideOrder<T extends AdaptShape>(controls: readonly T[]): T[] {
  return controls
    .map((control, index) => ({ control, index, hint: deriveSpaceHint(control) }))
    .filter(({ control }) => deriveCanHideText(control))
    .sort((a, b) => SPACE_HINT_RANK[a.hint] - SPACE_HINT_RANK[b.hint] || a.index - b.index)
    .map(({ control }) => control)
}

/**
 * Collapse planner: with every group already at its minimal (text-hidden)
 * width, decide how many groups — starting from the rightmost, WPS 终态兜底 —
 * must fold into name buttons for the row to fit. `natural`/`minimal` are the
 * measured row widths per visible group (same order); collapsed groups are
 * removed from the row and replaced by one name button each.
 */
export function planCollapse(
  natural: readonly number[],
  minimal: readonly number[],
  available: number,
  collapsedWidth = 64,
): { collapseFromRight: number } {
  const fit = (widths: readonly number[], collapsedCount: number) => {
    const kept = widths.slice(0, widths.length - collapsedCount)
    const total =
      kept.reduce((sum, w) => sum + w, 0) +
      collapsedCount * collapsedWidth +
      // group separators stay for kept groups
      Math.max(0, widths.length - collapsedCount - 1) * 9
    return total <= available
  }
  if (natural.length === 0 || fit(minimal, 0)) return { collapseFromRight: 0 }
  for (let count = 1; count < natural.length; count++) {
    if (fit(minimal, count)) return { collapseFromRight: count }
  }
  // everything collapsed and still overflowing: keep all collapsed (the strip
  // itself scrolls via the tab-strip mechanism)
  return { collapseFromRight: natural.length }
}

/** Group-level adaptive intent (schema `group.adapt`, WPS SingleRowMerge 语义预留). */
export type GroupAdapt = 'merge-row'

export interface AdaptiveGroupDef extends Pick<RibbonGroup, 'id' | 'labelKey'> {
  readonly adapt?: GroupAdapt
  readonly controls: readonly RibbonControl[]
}
