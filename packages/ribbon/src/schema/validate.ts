/**
 * Schema validation, run at build/boot time so mistakes never reach renderers.
 * Errors are hard failures (assertValidSchema throws); warnings flag smells
 * that are legal but suspicious (e.g. a when path missing on the sample
 * state, which usually means a typo'd path that silently never matches).
 */
import type { CommandRegistry } from '../command/registry'
import type { RibbonControl, RibbonMenuItem, RibbonSchema } from './types'
import { isWhenExpr, resolvePath, validateWhenExpr, type When, type WhenExpr } from './when'

export interface SchemaIssue {
  readonly severity: 'error' | 'warning'
  readonly path: string
  readonly message: string
}

export interface ValidateOptions<TState = unknown, TServices = unknown> {
  readonly registry?: CommandRegistry<TState, TServices>
  /** Sample state used to warn about when/state paths that resolve to nothing. */
  readonly stateSample?: TState
}

export function validateSchema<TState, TServices>(
  schema: RibbonSchema<TState, TServices>,
  options: ValidateOptions<TState, TServices> = {},
): SchemaIssue[] {
  const issues: SchemaIssue[] = []
  const error = (path: string, message: string) => issues.push({ severity: 'error', path, message })
  const warn = (path: string, message: string) =>
    issues.push({ severity: 'warning', path, message })

  const checkWhen = (when: When<TState> | undefined, path: string) => {
    if (when === undefined) return
    if (!isWhenExpr(when)) return // predicates: anything goes
    for (const message of validateWhenExpr(when, path)) error(path, message)
    if (options.stateSample !== undefined) {
      for (const p of exprPaths(when)) {
        if (resolvePath(options.stateSample, p) === undefined) {
          warn(path, `path "${p}" does not resolve on the sample state (typo or dynamic field?)`)
        }
      }
    }
  }

  const seenTabIds = new Set<string>()
  const seenControlIds = new Set<string>()

  schema.tabs.forEach((tab, tabIndex) => {
    const tabPath = `tabs[${tabIndex}](${tab.id})`
    if (seenTabIds.has(tab.id)) error(tabPath, `duplicate tab id "${tab.id}"`)
    seenTabIds.add(tab.id)

    if (tab.kind === 'contextual' && !tab.contextWhen) {
      error(tabPath, `contextual tab requires contextWhen`)
    }
    if (tab.kind !== 'contextual' && tab.contextWhen) {
      warn(tabPath, `contextWhen on a ${tab.kind} tab has no effect`)
    }
    if (tab.kind === 'file' && !tab.menu?.length) {
      error(tabPath, `file tab requires a non-empty menu`)
    }
    checkWhen(tab.when, `${tabPath}.when`)
    checkWhen(tab.contextWhen, `${tabPath}.contextWhen`)

    const seenGroupIds = new Set<string>()
    tab.groups.forEach((group, groupIndex) => {
      const groupPath = `${tabPath}.groups[${groupIndex}](${group.id})`
      if (seenGroupIds.has(group.id)) error(groupPath, `duplicate group id "${group.id}" in tab`)
      seenGroupIds.add(group.id)
      checkWhen(group.when, `${groupPath}.when`)
      checkWhen(group.disabledWhen, `${groupPath}.disabledWhen`)
      walkControls(group.controls, `${groupPath}.controls`)
    })
    if (tab.menu) checkMenu(tab.menu, tabPath)
  })

  return issues

  function walkControls(controls: readonly RibbonControl<TState, TServices>[], path: string) {
    controls.forEach((control, controlIndex) => {
      const controlPath = `${path}[${controlIndex}](${control.id})`
      if (seenControlIds.has(control.id)) error(controlPath, `duplicate control id "${control.id}"`)
      seenControlIds.add(control.id)
      checkWhen(control.when, `${controlPath}.when`)
      checkWhen(control.disabledWhen, `${controlPath}.disabledWhen`)
      if (control.kind === 'row' || control.kind === 'column') {
        walkControls(control.controls, `${controlPath}.controls`)
        return
      }
      checkCommandRef(control, controlPath)
      if ('menu' in control && control.menu) checkMenu(control.menu, controlPath)
      if (
        control.kind === 'combobox' ||
        control.kind === 'number' ||
        control.kind === 'toggle' ||
        control.kind === 'colorpicker'
      ) {
        checkStatePath(control.statePath, `${controlPath}.statePath`)
      }
    })
  }

  function checkCommandRef(control: RibbonControl<TState, TServices>, path: string) {
    if (!('command' in control) || !control.command) return
    if (options.registry && !options.registry.has(control.command)) {
      error(path, `references unregistered command "${control.command}"`)
    }
  }

  function checkStatePath(statePath: string, path: string) {
    if (
      options.stateSample !== undefined &&
      resolvePath(options.stateSample, statePath) === undefined
    ) {
      warn(path, `statePath "${statePath}" does not resolve on the sample state`)
    }
  }

  function checkMenu(items: readonly RibbonMenuItem[], path: string) {
    const seen = new Set<string>()
    items.forEach((item, index) => {
      const itemPath = `${path}.menu[${index}](${item.id})`
      if (seen.has(item.id)) error(itemPath, `duplicate menu item id "${item.id}"`)
      seen.add(item.id)
      if (item.kind === 'separator') return
      if (item.disabledWhen) {
        for (const message of validateWhenExpr(item.disabledWhen, `${itemPath}.disabledWhen`)) {
          error(itemPath, message)
        }
      }
      if (options.registry && item.command && !options.registry.has(item.command)) {
        error(itemPath, `references unregistered command "${item.command}"`)
      }
      if (item.children) checkMenu(item.children, itemPath)
    })
  }
}

/** Collect every dot path an expression tree references (for sample-state checks). */
function exprPaths(expr: WhenExpr, out: string[] = []): string[] {
  if ('eq' in expr) out.push(expr.eq[0])
  else if ('notEq' in expr) out.push(expr.notEq[0])
  else if ('truthy' in expr) out.push(expr.truthy)
  else if ('falsy' in expr) out.push(expr.falsy)
  else if ('in' in expr) out.push(expr.in[0])
  else if ('and' in expr) expr.and.forEach((child) => exprPaths(child, out))
  else if ('or' in expr) expr.or.forEach((child) => exprPaths(child, out))
  else if ('not' in expr) exprPaths(expr.not, out)
  return out
}

/** Throw on the first error; warnings are returned for logging. */
export function assertValidSchema<TState, TServices>(
  schema: RibbonSchema<TState, TServices>,
  options: ValidateOptions<TState, TServices> = {},
): SchemaIssue[] {
  const issues = validateSchema(schema, options)
  const errors = issues.filter((issue) => issue.severity === 'error')
  if (errors.length > 0) {
    const summary = errors.map((issue) => `  ${issue.path}: ${issue.message}`).join('\n')
    throw new Error(`Invalid ribbon schema "${schema.id}" (${errors.length} error(s)):\n${summary}`)
  }
  return issues
}
