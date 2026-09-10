// M2 adaptive engine decision core: spaceHint/canHideText derivation (Q14 表),
// text-hide ordering, and the WPS 终态兜底 collapse planner math.
import { describe, expect, it } from 'vitest'
import {
  deriveCanHideText,
  deriveSpaceHint,
  planCollapse,
  textHideOrder,
} from '../src/desktop/adaptive'

describe('deriveSpaceHint (kind+size 默认推导)', () => {
  it('derives from kind and size; explicit spaceHint wins', () => {
    expect(deriveSpaceHint({ kind: 'button', size: 'big' })).toBe('suitable')
    expect(deriveSpaceHint({ kind: 'button', size: 'small' })).toBe('compact')
    expect(deriveSpaceHint({ kind: 'button', size: 'icon' })).toBe('autocompact')
    expect(deriveSpaceHint({ kind: 'toggle', size: 'big' })).toBe('suitable')
    expect(deriveSpaceHint({ kind: 'split', size: 'big' })).toBe('suitable')
    expect(deriveSpaceHint({ kind: 'dropdown' })).toBe('autocompact')
    expect(deriveSpaceHint({ kind: 'gallery' })).toBe('loose')
    expect(deriveSpaceHint({ kind: 'combobox' })).toBe('compact')
    expect(deriveSpaceHint({ kind: 'number' })).toBe('compact')
    expect(deriveSpaceHint({ kind: 'colorpicker' })).toBe('autocompact')
    expect(deriveSpaceHint({ kind: 'button', size: 'big', spaceHint: 'loose' })).toBe('loose')
  })
})

describe('deriveCanHideText', () => {
  it('labeled icon-carrying controls hide text; value controls and galleries do not', () => {
    expect(deriveCanHideText({ kind: 'button', size: 'big', icon: 'x', labelKey: 'x' })).toBe(true)
    expect(deriveCanHideText({ kind: 'button', size: 'big', labelKey: 'x' })).toBe(false)
    expect(deriveCanHideText({ kind: 'dropdown', icon: 'x', labelKey: 'x' })).toBe(true)
    expect(deriveCanHideText({ kind: 'combobox' })).toBe(false)
    expect(deriveCanHideText({ kind: 'number' })).toBe(false)
    expect(deriveCanHideText({ kind: 'gallery' })).toBe(false)
    // WPS canHideText="0" override (粘贴永不隐文字); explicit values always win
    expect(deriveCanHideText({ kind: 'split', icon: 'x', labelKey: 'x', canHideText: false })).toBe(
      false,
    )
    expect(deriveCanHideText({ kind: 'combobox', canHideText: true })).toBe(true)
  })
})

describe('textHideOrder', () => {
  it('orders looser hints first and skips non-hidable controls', () => {
    const order = textHideOrder([
      { kind: 'gallery', id: 'gallery' },
      { kind: 'button', size: 'big', icon: 'a', labelKey: 'a', id: 'big-a' },
      { kind: 'button', size: 'small', icon: 'b', labelKey: 'b', id: 'small-b' },
      { kind: 'button', size: 'icon', icon: 'c', labelKey: 'c', id: 'icon-c' },
      { kind: 'combobox', id: 'combo' },
    ])
    expect(order.map((c) => c.id)).toEqual(['big-a', 'small-b'])
  })
})

describe('planCollapse (WPS 终态兜底)', () => {
  const sep = 9
  it('needs no collapse when minimal widths already fit', () => {
    expect(planCollapse([200, 300], [150, 250], 400 + sep)).toEqual({ collapseFromRight: 0 })
  })
  it('collapses the rightmost group first', () => {
    // two groups, minimal widths overflow by a bit; collapsing one leaves
    // group A at its minimal width plus one name button
    expect(planCollapse([200, 300], [200, 300], 300 + 64 + sep)).toEqual({
      collapseFromRight: 1,
    })
  })
  it('keeps collapsing until it fits or everything is collapsed', () => {
    // nothing fits until everything is folded: the fallback keeps all collapsed
    expect(planCollapse([200, 300, 250], [200, 300, 250], 64 + sep)).toEqual({
      collapseFromRight: 3,
    })
    expect(planCollapse([200], [200], 10)).toEqual({ collapseFromRight: 1 })
  })
  it('handles the empty row', () => {
    expect(planCollapse([], [], 100)).toEqual({ collapseFromRight: 0 })
  })
})
