/**
 * Schema merge/override: the build-time injection channel for secondary
 * development (consensus #10). A SchemaPatch carries new commands, command
 * overrides, and structural edits (add/remove/patch tabs, groups, controls).
 * Patches apply in order onto immutable copies; the base schema is never
 * mutated, so rollback = not applying the patch. Every anchor lookup fails
 * loudly with the patch id, surfacing mistakes at build time.
 */
import type { CommandRegistry } from '../command/registry'
import type { AnyCommandDefinition } from '../command/types'
import type { RibbonControl, RibbonGroup, RibbonSchema, RibbonTab } from './types'

export interface SchemaPatch<TState = unknown, TServices = unknown> {
  /** Patch namespace, echoed in every error message (e.g. 'ee.branding'). */
  readonly id: string
  /** New commands; registering an existing id is an error (use overrideCommands). */
  readonly commands?: readonly AnyCommandDefinition<TState, TServices>[]
  /** Replace existing commands wholesale (behavior swap). */
  readonly overrideCommands?: readonly AnyCommandDefinition<TState, TServices>[]
  readonly addTabs?: readonly { tab: RibbonTab<TState, TServices>; after?: string }[]
  readonly removeTabs?: readonly string[]
  readonly addGroups?: readonly {
    tab: string
    group: RibbonGroup<TState, TServices>
    after?: string
  }[]
  readonly removeGroups?: readonly { tab: string; group: string }[]
  readonly addControls?: readonly {
    tab: string
    group: string
    controls: readonly RibbonControl<TState, TServices>[]
    after?: string
  }[]
  /** Control ids are global across the schema, so removal needs no tab path. */
  readonly removeControls?: readonly string[]
  readonly patchControls?: readonly {
    id: string
    patch: Partial<RibbonControl<TState, TServices>>
  }[]
}

export function applySchemaPatch<TState, TServices>(
  base: RibbonSchema<TState, TServices>,
  registry: CommandRegistry<TState, TServices>,
  patch: SchemaPatch<TState, TServices>,
): RibbonSchema<TState, TServices> {
  for (const command of patch.commands ?? []) registry.register(command)
  for (const command of patch.overrideCommands ?? []) registry.override(command)

  const fail = (message: string): never => {
    throw new Error(`Schema patch "${patch.id}": ${message}`)
  }

  type Control = RibbonControl<TState, TServices>
  const isContainer = (control: Control): control is Control & { controls: readonly Control[] } =>
    control.kind === 'row' || control.kind === 'column'

  const collectIds = (controls: readonly Control[], into = new Set<string>()): Set<string> => {
    for (const control of controls) {
      into.add(control.id)
      if (isContainer(control)) collectIds(control.controls, into)
    }
    return into
  }

  const filterDeep = (controls: readonly Control[], drop: Set<string>): Control[] =>
    controls
      .filter((control) => !drop.has(control.id))
      .map((control) =>
        isContainer(control)
          ? { ...control, controls: filterDeep(control.controls, drop) }
          : control,
      )

  const mapDeep = (controls: readonly Control[], fn: (control: Control) => Control): Control[] =>
    controls.map((control) =>
      isContainer(control) ? { ...control, controls: mapDeep(control.controls, fn) } : fn(control),
    )

  /** Insert after the anchor at whichever nesting level holds it. */
  const insertAfterDeep = (
    controls: readonly Control[],
    anchor: string,
    inserts: readonly Control[],
  ): Control[] | null => {
    const index = controls.findIndex((control) => control.id === anchor)
    if (index !== -1) {
      return [...controls.slice(0, index + 1), ...inserts, ...controls.slice(index + 1)]
    }
    let changed = false
    const next = controls.map((control) => {
      if (!isContainer(control)) return control
      const inner = insertAfterDeep(control.controls, anchor, inserts)
      if (inner === null) return control
      changed = true
      return { ...control, controls: inner }
    })
    return changed ? next : null
  }

  let tabs: readonly RibbonTab<TState, TServices>[] = [...base.tabs]

  if (patch.removeTabs?.length) {
    const removing = new Set(patch.removeTabs)
    const missing = [...removing].filter((id) => !tabs.some((tab) => tab.id === id))
    if (missing.length) fail(`removeTabs target(s) not found: ${missing.join(', ')}`)
    tabs = tabs.filter((tab) => !removing.has(tab.id))
  }

  for (const { tab, after } of patch.addTabs ?? []) {
    if (tabs.some((existing) => existing.id === tab.id))
      fail(`addTabs: tab "${tab.id}" already exists`)
    if (after === undefined) {
      tabs = [...tabs, tab]
      continue
    }
    const index = tabs.findIndex((existing) => existing.id === after)
    if (index === -1) fail(`addTabs anchor tab "${after}" not found`)
    tabs = [...tabs.slice(0, index + 1), tab, ...tabs.slice(index + 1)]
  }

  /** Replace one tab immutably; all group/control ops funnel through here. */
  const mapTab = (
    tabId: string,
    fn: (tab: RibbonTab<TState, TServices>) => RibbonTab<TState, TServices>,
  ) => {
    const index = tabs.findIndex((tab) => tab.id === tabId)
    // `?? fail` both guards the -1 index and gives a defined element type
    const target = tabs[index] ?? fail(`tab "${tabId}" not found`)
    tabs = [...tabs.slice(0, index), fn(target), ...tabs.slice(index + 1)]
  }

  for (const { tab, group, after } of patch.addGroups ?? []) {
    mapTab(tab, (target) => {
      if (target.groups.some((existing) => existing.id === group.id)) {
        fail(`addGroups: group "${group.id}" already exists in tab "${tab}"`)
      }
      const groups = [...target.groups]
      const index = after === undefined ? -1 : groups.findIndex((existing) => existing.id === after)
      if (after !== undefined && index === -1)
        fail(`addGroups anchor group "${after}" not found in tab "${tab}"`)
      groups.splice(index === -1 ? groups.length : index + 1, 0, group)
      return { ...target, groups }
    })
  }

  for (const { tab, group } of patch.removeGroups ?? []) {
    mapTab(tab, (target) => {
      if (!target.groups.some((existing) => existing.id === group)) {
        fail(`removeGroups: group "${group}" not found in tab "${tab}"`)
      }
      return { ...target, groups: target.groups.filter((existing) => existing.id !== group) }
    })
  }

  for (const { tab, group, controls, after } of patch.addControls ?? []) {
    mapTab(tab, (target) => {
      const groupIndex = target.groups.findIndex((existing) => existing.id === group)
      const targetGroup =
        target.groups[groupIndex] ??
        fail(`addControls: group "${group}" not found in tab "${tab}"`)
      let nextControls: Control[]
      if (after === undefined) {
        nextControls = [...targetGroup.controls, ...controls]
      } else {
        nextControls =
          insertAfterDeep(targetGroup.controls, after, controls) ??
          fail(`addControls anchor control "${after}" not found in ${tab}.${group}`)
      }
      const groups = [...target.groups]
      groups[groupIndex] = { ...targetGroup, controls: nextControls }
      return { ...target, groups }
    })
  }

  if (patch.removeControls?.length) {
    const removing = new Set(patch.removeControls)
    const present = collectIds(tabs.flatMap((tab) => tab.groups.flatMap((group) => group.controls)))
    const missing = [...removing].filter((id) => !present.has(id))
    if (missing.length) fail(`removeControls target(s) not found: ${missing.join(', ')}`)
    tabs = tabs.map((tab) => ({
      ...tab,
      groups: tab.groups.map((group) => ({
        ...group,
        controls: filterDeep(group.controls, removing),
      })),
    }))
  }

  for (const { id, patch: controlPatch } of patch.patchControls ?? []) {
    let found = false
    tabs = tabs.map((tab) => ({
      ...tab,
      groups: tab.groups.map((group) => ({
        ...group,
        controls: mapDeep(group.controls, (control) => {
          if (control.id !== id) return control
          found = true
          return { ...control, ...controlPatch } as Control
        }),
      })),
    }))
    if (!found) fail(`patchControls target "${id}" not found`)
  }

  return { ...base, tabs }
}

/** Apply patches in order; later patches see (and may override) earlier ones. */
export function mergeSchemas<TState, TServices>(
  base: RibbonSchema<TState, TServices>,
  registry: CommandRegistry<TState, TServices>,
  ...patches: readonly SchemaPatch<TState, TServices>[]
): RibbonSchema<TState, TServices> {
  return patches.reduce((schema, patch) => applySchemaPatch(schema, registry, patch), base)
}
