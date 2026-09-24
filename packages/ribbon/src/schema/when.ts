/**
 * When-conditions gate visibility and enablement from the host's state
 * snapshot. Two forms:
 *
 * - WhenExpr — pure data, JSON-serializable, the only form allowed in JSON
 *   patches and menu items. Paths are dot-separated lookups into state.
 * - WhenPredicate — a TS function, full expressive power, never serializes.
 *
 * Path resolution is total: a missing intermediate resolves to `undefined`,
 * which fails `eq` (unless the value literally is undefined) and `truthy`.
 */

export type WhenExpr =
  | { readonly eq: readonly [path: string, value: unknown] }
  | { readonly notEq: readonly [path: string, value: unknown] }
  | { readonly truthy: string }
  | { readonly falsy: string }
  | { readonly in: readonly [path: string, values: readonly unknown[]] }
  | { readonly and: readonly WhenExpr[] }
  | { readonly or: readonly WhenExpr[] }
  | { readonly not: WhenExpr }

export type WhenPredicate<TState = unknown> = (state: TState) => boolean

export type When<TState = unknown> = WhenExpr | WhenPredicate<TState>

export function isWhenExpr(when: unknown): when is WhenExpr {
  return typeof when === 'object' && when !== null
}

/** Dot-path lookup ('a.b.c') tolerant of null/undefined intermediates. */
export function resolvePath(state: unknown, path: string): unknown {
  let current: unknown = state
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

export function evaluateWhen<TState>(when: When<TState> | undefined, state: TState): boolean {
  if (when === undefined) return true
  if (typeof when === 'function') return when(state)
  return evaluateExpr(when, state)
}

function evaluateExpr(expr: WhenExpr, state: unknown): boolean {
  if ('eq' in expr) return Object.is(resolvePath(state, expr.eq[0]), expr.eq[1])
  if ('notEq' in expr) return !Object.is(resolvePath(state, expr.notEq[0]), expr.notEq[1])
  if ('truthy' in expr) return Boolean(resolvePath(state, expr.truthy))
  if ('falsy' in expr) return !resolvePath(state, expr.falsy)
  if ('in' in expr)
    return expr.in[1].some((value) => Object.is(value, resolvePath(state, expr.in[0])))
  if ('and' in expr) return expr.and.every((child) => evaluateExpr(child, state))
  if ('or' in expr) return expr.or.some((child) => evaluateExpr(child, state))
  if ('not' in expr) return !evaluateExpr(expr.not, state)
  return false
}

/** Structural validation; returns human-readable errors (empty = valid). */
export function validateWhenExpr(expr: unknown, path = 'when'): string[] {
  if (typeof expr !== 'object' || expr === null || Array.isArray(expr)) {
    return [`${path}: expected a when-expression object`]
  }
  const keys = Object.keys(expr)
  if (keys.length !== 1) return [`${path}: exactly one operator required, got ${keys.length}`]
  const [op] = keys as [string]
  const value = (expr as any)[op]
  switch (op) {
    case 'eq':
    case 'notEq':
      return Array.isArray(value) && value.length === 2 && typeof value[0] === 'string'
        ? []
        : [`${path}.${op}: expected [path, value]`]
    case 'in':
      return Array.isArray(value) &&
        value.length === 2 &&
        typeof value[0] === 'string' &&
        Array.isArray(value[1])
        ? []
        : [`${path}.in: expected [path, values[]]`]
    case 'truthy':
    case 'falsy':
      return typeof value === 'string' ? [] : [`${path}.${op}: expected a path string`]
    case 'and':
    case 'or':
      if (!Array.isArray(value) || value.length === 0)
        return [`${path}.${op}: expected a non-empty array`]
      return value.flatMap((child, i) => validateWhenExpr(child, `${path}.${op}[${i}]`))
    case 'not':
      return validateWhenExpr(value, `${path}.not`)
    default:
      return [`${path}: unknown operator "${op}"`]
  }
}
