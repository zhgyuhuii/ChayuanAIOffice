/**
 * TS ⇄ JSON serialization for ribbon schemas ("the ribbon file"). The JSON
 * form is a functional subset: TS-only values (when predicates, custom
 * render functions) serialize as `{ "predicate": true }` placeholders plus a
 * warning, and deserialize back to inert `() => true` stubs — a JSON patch
 * author needing real logic must ship a TS patch instead.
 *
 * Deserialization is strict: unknown keys are rejected with located errors so
 * typos in hand-authored ribbon files never degrade silently.
 */
import { isCommandId } from '../command/id'
import type { RibbonSchema } from './types'

const PLACEHOLDER_KEY = 'predicate'

export interface SchemaToJSONResult {
  readonly data: unknown
  readonly warnings: string[]
}

export function schemaToJSON(schema: RibbonSchema<never, never>): SchemaToJSONResult {
  const warnings: string[] = []
  const walk = (value: unknown, path: string): unknown => {
    if (typeof value === 'function') {
      warnings.push(`${path}: function replaced with a { predicate: true } placeholder`)
      return { [PLACEHOLDER_KEY]: true }
    }
    if (Array.isArray(value)) return value.map((item, i) => walk(item, `${path}[${i}]`))
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, child]) => [
          key,
          walk(child, `${path}.${key}`),
        ]),
      )
    }
    return value
  }
  return { data: walk(schema, 'schema'), warnings }
}

// Concrete key types (no Record index signature): strict hosts turn index
// access into `T | undefined`, which would poison every read below.
const ALLOWED_KEYS = {
  schema: ['id', 'version', 'tabs'],
  tab: [
    'id',
    'labelKey',
    'kind',
    'contextWhen',
    'autoActivate',
    'contextGroup',
    'menu',
    'groups',
    'when',
    'renderBody',
  ],
  contextGroup: ['id', 'labelKey', 'color', 'activateTab'],
  group: ['id', 'labelKey', 'when', 'disabledWhen', 'layout', 'className', 'controls'],
  control: [
    'id',
    'when',
    'className',
    'tipKey',
    'disabled',
    'disabledWhen',
    'args',
    'spaceHint',
    'canHideText',
  ],
  menuItem: [
    'kind',
    'id',
    'labelKey',
    'icon',
    'command',
    'args',
    'checkedPath',
    'shortcut',
    'disabledWhen',
    'children',
  ],
  galleryItem: ['id', 'labelKey', 'icon', 'value'],
} satisfies Record<string, readonly string[]>

const CONTROL_KEYS = {
  button: ['kind', 'command', 'icon', 'size', 'labelKey'],
  split: [
    'kind',
    'command',
    'icon',
    'labelKey',
    'size',
    'variant',
    'menuClassName',
    'menu',
    'renderMenu',
  ],
  dropdown: [
    'kind',
    'command',
    'icon',
    'labelKey',
    'size',
    'variant',
    'inlineCaret',
    'activeWhenOpen',
    'menuClassName',
    'menu',
    'renderMenu',
  ],
  combobox: ['kind', 'command', 'statePath', 'options', 'editable'],
  number: ['kind', 'command', 'statePath', 'min', 'max', 'step', 'unitKey'],
  toggle: ['kind', 'command', 'statePath', 'labelKey', 'icon', 'size'],
  colorpicker: ['kind', 'command', 'statePath', 'icon', 'labelKey', 'palette', 'allowNone'],
  gallery: ['kind', 'command', 'labelKey', 'columns', 'items'],
  separator: ['kind'],
  custom: ['kind', 'render'],
  row: ['kind', 'controls'],
  column: ['kind', 'controls'],
} satisfies Record<string, readonly string[]>

export interface SchemaFromJSONOptions {
  /** Called for each restored placeholder; defaults to console.warn. */
  readonly onPlaceholder?: (path: string) => void
}

export function schemaFromJSON(
  data: unknown,
  options: SchemaFromJSONOptions = {},
): RibbonSchema<never, never> {
  const onPlaceholder =
    options.onPlaceholder ??
    ((path: string) => {
      console.warn(`[ribbon] ${path}: predicate placeholder restored as an inert stub`)
    })

  const fail = (path: string, message: string): never => {
    throw new Error(`Invalid ribbon JSON at ${path}: ${message}`)
  }

  const checkKeys = (node: Record<string, unknown>, allowed: readonly string[], path: string) => {
    for (const key of Object.keys(node)) {
      if (!allowed.includes(key)) fail(path, `unknown key "${key}"`)
    }
  }

  /** Restore placeholders; JSON has no functions, so the walk is data-only. */
  const restore = (value: unknown, path: string): unknown => {
    if (Array.isArray(value)) return value.map((item, i) => restore(item, `${path}[${i}]`))
    if (value !== null && typeof value === 'object') {
      const record = value as Record<string, unknown>
      if (record[PLACEHOLDER_KEY] === true && Object.keys(record).length === 1) {
        onPlaceholder(path)
        return () => true
      }
      return Object.fromEntries(
        Object.entries(record).map(([key, child]) => [key, restore(child, `${path}.${key}`)]),
      )
    }
    return value
  }

  const restored = restore(data, 'schema') as RibbonSchema<never, never>

  // Structural pass: required keys, allowed keys, command id format.
  if (typeof restored !== 'object' || restored === null) fail('schema', 'expected an object')
  checkKeys(restored as unknown as Record<string, unknown>, ALLOWED_KEYS.schema, 'schema')
  if (typeof restored.id !== 'string' || !restored.id) fail('schema.id', 'required string')
  if (typeof restored.version !== 'number') fail('schema.version', 'required number')
  if (!Array.isArray(restored.tabs)) fail('schema.tabs', 'required array')

  restored.tabs.forEach((tab, tabIndex) => {
    const path = `tabs[${tabIndex}]`
    checkKeys(tab as unknown as Record<string, unknown>, ALLOWED_KEYS.tab, path)
    if (typeof tab.id !== 'string' || !tab.id) fail(`${path}.id`, 'required string')
    if (!['regular', 'contextual', 'file'].includes(tab.kind))
      fail(`${path}.kind`, `unknown kind "${String(tab.kind)}"`)
    if (tab.contextGroup)
      checkKeys(
        tab.contextGroup as unknown as Record<string, unknown>,
        ALLOWED_KEYS.contextGroup,
        `${path}.contextGroup`,
      )
    tab.menu?.forEach((item, i) => checkMenuItem(item, `${path}.menu[${i}]`))
    tab.groups.forEach((group, groupIndex) => {
      const groupPath = `${path}.groups[${groupIndex}]`
      checkKeys(group as unknown as Record<string, unknown>, ALLOWED_KEYS.group, groupPath)
      group.controls.forEach((control, controlIndex) => {
        checkControl(control, `${groupPath}.controls[${controlIndex}]`)
      })
    })
  })

  function checkControl(control: unknown, controlPath: string) {
    const record = control as Record<string, unknown>
    const kind = record.kind as string
    const allowed =
      CONTROL_KEYS[kind as keyof typeof CONTROL_KEYS] ??
      fail(controlPath, `unknown control kind "${String(kind)}"`)
    checkKeys(record, [...ALLOWED_KEYS.control, ...allowed], controlPath)
    if ((kind === 'row' || kind === 'column') && Array.isArray(record.controls)) {
      record.controls.forEach((child, i) => checkControl(child, `${controlPath}.controls[${i}]`))
    }
    if ('command' in record && record.command !== undefined) {
      if (typeof record.command !== 'string' || !isCommandId(record.command)) {
        fail(`${controlPath}.command`, `invalid command id "${String(record.command)}"`)
      }
    }
    if ('menu' in record && Array.isArray(record.menu)) {
      record.menu.forEach((item, i) => checkMenuItem(item, `${controlPath}.menu[${i}]`))
    }
  }

  function checkMenuItem(item: unknown, path: string) {
    const record = item as Record<string, unknown>
    checkKeys(record, ALLOWED_KEYS.menuItem, path)
    if (typeof record.id !== 'string' || !record.id) fail(`${path}.id`, 'required string')
    if (
      record.command !== undefined &&
      (typeof record.command !== 'string' || !isCommandId(record.command))
    ) {
      fail(`${path}.command`, `invalid command id "${String(record.command)}"`)
    }
    if (Array.isArray(record.children))
      record.children.forEach((child, i) => checkMenuItem(child, `${path}.children[${i}]`))
  }

  return restored
}
