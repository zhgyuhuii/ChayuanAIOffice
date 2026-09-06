/**
 * Desktop tab state machine. Mirrors the Word/legacy behavior exactly:
 *
 * - regular tabs are clickable; the last one the user picked is remembered
 * - a contextual group rising (its contextWhen turns true) auto-activates the
 *   group's `activateTab` (or its first member with autoActivate enabled)
 * - the context disappearing while one of its tabs is active falls back to the
 *   remembered regular tab
 * - several contexts rising in the same commit activate the LAST group in
 *   schema order (legacy ran one effect per context, in order)
 *
 * Controlled (activeTab + onTabChange) or uncontrolled (defaultTab).
 */
import { useEffect, useRef, useState } from 'react'
import type { RibbonSchema, RibbonTab } from '../schema/types'
import { evaluateWhen } from '../schema/when'

export interface RibbonTabMachineOptions {
  readonly activeTab?: string | undefined
  readonly defaultTab?: string | undefined
  readonly onTabChange?: ((tabId: string) => void) | undefined
}

export interface RibbonTabMachine {
  /** Raw active tab id (may point at a contextual tab whose context just ended). */
  readonly active: string
  /** Active tab with the contextual fallback applied — render this one's body. */
  readonly displayed: string
  /** User-click semantics: remembers regular picks as the contextual fallback. */
  readonly select: (tabId: string) => void
}

interface ContextGroupInfo<TState, TServices> {
  readonly key: string
  readonly tabs: readonly RibbonTab<TState, TServices>[]
  readonly activateTab?: string | undefined
  readonly visible: boolean
}

type MutableGroup<TState, TServices> = {
  -readonly [K in keyof ContextGroupInfo<TState, TServices>]: ContextGroupInfo<TState, TServices>[K]
} & { tabs: RibbonTab<TState, TServices>[] }

export function contextualGroups<TState, TServices>(
  schema: RibbonSchema<TState, TServices>,
  state: TState,
): ContextGroupInfo<TState, TServices>[] {
  const groups: MutableGroup<TState, TServices>[] = []
  const byKey = new Map<string, MutableGroup<TState, TServices>>()
  for (const tab of schema.tabs) {
    if (tab.kind !== 'contextual') continue
    const key = tab.contextGroup?.id ?? tab.id
    let group = byKey.get(key)
    if (!group) {
      group = { key, tabs: [], activateTab: tab.contextGroup?.activateTab, visible: false }
      byKey.set(key, group)
      groups.push(group)
    }
    group.tabs.push(tab)
    if (evaluateWhen(tab.contextWhen, state)) group.visible = true
  }
  return groups
}

export function isContextVisible<TState, TServices>(
  tab: RibbonTab<TState, TServices>,
  state: TState,
): boolean {
  return evaluateWhen(tab.contextWhen, state)
}

export function useRibbonTabs<TState, TServices>(
  schema: RibbonSchema<TState, TServices>,
  state: TState,
  options: RibbonTabMachineOptions = {},
): RibbonTabMachine {
  const firstRegularId =
    schema.tabs.find((tab) => tab.kind === 'regular' && evaluateWhen(tab.when, state))?.id ??
    schema.tabs[0]?.id ??
    ''

  const controlled = options.activeTab !== undefined
  const [internal, setInternal] = useState(() => options.defaultTab ?? firstRegularId)
  const active = controlled ? (options.activeTab as string) : internal
  const lastRegularRef = useRef(firstRegularId)
  const prevVisibleRef = useRef(new Map<string, boolean>())

  const setActive = (tabId: string) => {
    if (!controlled) setInternal(tabId)
    options.onTabChange?.(tabId)
  }

  // The remembered regular tab follows the active tab whenever it is regular
  // (covers user clicks, controlled prop changes, and tabRequest-style drives).
  const activeDef = schema.tabs.find((tab) => tab.id === active)
  useEffect(() => {
    if (activeDef?.kind === 'regular') lastRegularRef.current = activeDef.id
  }, [activeDef])

  // Contextual edge detection. Runs every render; only edges act. Group order
  // follows schema order so simultaneous risings resolve like legacy (last wins).
  const groups = contextualGroups(schema, state)
  useEffect(() => {
    for (const group of groups) {
      const was = prevVisibleRef.current.get(group.key) ?? false
      if (group.visible === was) continue
      prevVisibleRef.current.set(group.key, group.visible)
      if (group.visible) {
        const targetId =
          group.activateTab ?? group.tabs.find((tab) => tab.autoActivate !== false)?.id
        const target = group.tabs.find((tab) => tab.id === targetId)
        if (target && target.autoActivate !== false) setActive(target.id)
      } else if (group.tabs.some((tab) => tab.id === active)) {
        setActive(lastRegularRef.current)
      }
    }
  })

  // A contextual tab whose context just ended displays the remembered regular
  // tab's body until the edge effect settles the state (and in controlled mode,
  // where the host may keep the stale id for a render).
  const displayed =
    activeDef?.kind === 'contextual' && !isContextVisible(activeDef, state)
      ? lastRegularRef.current
      : active

  return { active, displayed, select: setActive }
}
