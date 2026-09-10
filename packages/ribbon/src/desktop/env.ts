/**
 * Render-environment context: everything a control view needs that the schema
 * itself does not carry (registry access, command context, translator, icons,
 * the global disabled gate, and the renderer-owned dropdown handle).
 */
import { createContext, useContext, type ReactNode } from 'react'
import type { CommandRegistry } from '../command/registry'
import type { CommandContext } from '../command/types'
import type { RibbonDropdownApi, RibbonTranslate } from '../schema/types'

/** Icon registry keyed by the schema's string icon names. `caret` is the built-in chevron. */
export type RibbonIconMap = Readonly<Record<string, ReactNode>>

export interface RibbonEnv<TState = unknown, TServices = unknown> {
  readonly registry: CommandRegistry<TState, TServices>
  readonly ctx: CommandContext<TState, TServices>
  readonly t: RibbonTranslate
  readonly icons: RibbonIconMap
  /** Renderer-level disabled gate (the `disabledWhen` prop, already evaluated). */
  readonly globalDisabled: boolean
  readonly dropdown: RibbonDropdownApi
  /**
   * Adaptive degradation (M2): when the row overflows, hidable label text is
   * dropped (WPS canHideText). GroupView nests a scoped provider with this
   * flipped on; controls render their icon-only form.
   */
  readonly hideText?: boolean
}

const RibbonEnvContext = createContext<RibbonEnv<any, any> | null>(null)

export const RibbonEnvProvider = RibbonEnvContext.Provider

export function useRibbonEnv<TState = unknown, TServices = unknown>(): RibbonEnv<
  TState,
  TServices
> {
  const env = useContext(RibbonEnvContext)
  if (!env) throw new Error('ribbon controls must render inside a <DesktopRibbon>')
  return env as RibbonEnv<TState, TServices>
}
