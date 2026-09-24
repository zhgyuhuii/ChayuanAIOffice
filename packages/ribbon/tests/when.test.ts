import { describe, expect, it } from 'vitest'
import { evaluateWhen, resolvePath, validateWhenExpr, type WhenExpr } from '../src/schema/when'

const state = {
  canEdit: true,
  view: { viewMode: 'print', zoom: 1 },
  selectionKind: 'table',
  count: 0,
  empty: '',
  nothing: null,
  list: ['a'],
}

describe('resolvePath', () => {
  it('walks dot paths and tolerates missing intermediates', () => {
    expect(resolvePath(state, 'view.viewMode')).toBe('print')
    expect(resolvePath(state, 'count')).toBe(0)
    expect(resolvePath(state, 'view.missing.deep')).toBeUndefined()
    expect(resolvePath(state, 'nothing.deeper')).toBeUndefined()
    expect(resolvePath(state, 'count.x')).toBeUndefined()
    expect(resolvePath(null, 'a')).toBeUndefined()
  })
})

describe('evaluateWhen', () => {
  it('undefined when is always true', () => {
    expect(evaluateWhen(undefined, state)).toBe(true)
  })

  it('predicates are called through', () => {
    expect(evaluateWhen((s: typeof state) => s.canEdit, state)).toBe(true)
    expect(evaluateWhen((s: typeof state) => s.count > 2, state)).toBe(false)
  })

  it('eq / notEq with Object.is semantics', () => {
    expect(evaluateWhen({ eq: ['view.viewMode', 'print'] }, state)).toBe(true)
    expect(evaluateWhen({ eq: ['view.viewMode', 'web'] }, state)).toBe(false)
    expect(evaluateWhen({ eq: ['count', 0] }, state)).toBe(true)
    expect(evaluateWhen({ notEq: ['canEdit', false] }, state)).toBe(true)
    // missing path resolves to undefined: eq fails unless the value literally is undefined
    expect(evaluateWhen({ eq: ['missing', undefined] }, state)).toBe(true)
    expect(evaluateWhen({ eq: ['missing', 'x'] }, state)).toBe(false)
    expect(evaluateWhen({ notEq: ['missing', 'x'] }, state)).toBe(true)
  })

  it('truthy / falsy', () => {
    expect(evaluateWhen({ truthy: 'canEdit' }, state)).toBe(true)
    expect(evaluateWhen({ truthy: 'count' }, state)).toBe(false)
    expect(evaluateWhen({ truthy: 'empty' }, state)).toBe(false)
    expect(evaluateWhen({ falsy: 'empty' }, state)).toBe(true)
    expect(evaluateWhen({ falsy: 'missing' }, state)).toBe(true)
  })

  it('in', () => {
    expect(evaluateWhen({ in: ['selectionKind', ['table', 'shape']] }, state)).toBe(true)
    expect(evaluateWhen({ in: ['selectionKind', ['image']] }, state)).toBe(false)
  })

  it('and / or / not compose recursively', () => {
    const pageViewAndTable: WhenExpr = {
      and: [{ eq: ['view.viewMode', 'print'] }, { eq: ['selectionKind', 'table'] }],
    }
    expect(evaluateWhen(pageViewAndTable, state)).toBe(true)
    expect(
      evaluateWhen({ or: [{ eq: ['selectionKind', 'image'] }, pageViewAndTable] }, state),
    ).toBe(true)
    expect(evaluateWhen({ not: pageViewAndTable }, { ...state, selectionKind: 'text' })).toBe(true)
    expect(evaluateWhen({ not: { not: { truthy: 'canEdit' } } }, state)).toBe(true)
  })
})

describe('validateWhenExpr', () => {
  it('accepts every operator in valid form', () => {
    const valid: WhenExpr[] = [
      { eq: ['a', 1] },
      { notEq: ['a', null] },
      { truthy: 'a' },
      { falsy: 'a' },
      { in: ['a', [1, 2]] },
      { and: [{ truthy: 'a' }] },
      { or: [{ truthy: 'a' }, { falsy: 'b' }] },
      { not: { truthy: 'a' } },
    ]
    for (const expr of valid) expect(validateWhenExpr(expr), JSON.stringify(expr)).toEqual([])
  })

  it('rejects malformed expressions with located messages', () => {
    expect(validateWhenExpr(null)).toEqual(['when: expected a when-expression object'])
    expect(validateWhenExpr({})).toEqual(['when: exactly one operator required, got 0'])
    expect(validateWhenExpr({ eq: ['a'], notEq: ['b', 1] })[0]).toMatch(/exactly one operator/)
    expect(validateWhenExpr({ eq: 'a' })[0]).toMatch(/when\.eq: expected \[path, value\]/)
    expect(validateWhenExpr({ in: ['a', 'b'] })[0]).toMatch(/when\.in/)
    expect(validateWhenExpr({ truthy: 42 })[0]).toMatch(/when\.truthy: expected a path string/)
    expect(validateWhenExpr({ and: [] })[0]).toMatch(/non-empty array/)
    expect(validateWhenExpr({ nope: 1 })[0]).toMatch(/unknown operator "nope"/)
    // nested errors carry the full path
    expect(validateWhenExpr({ and: [{ truthy: 'a' }, { eq: 'x' }] })[0]).toMatch(
      /when\.and\[1\]\.eq/,
    )
  })
})
