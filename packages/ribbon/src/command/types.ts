/**
 * Command layer core types. The ribbon package is editor-agnostic: each host
 * app defines its own state snapshot (drives enablement/active/when) and
 * services object (every side-effect entry), then registers CommandDefinitions
 * against those types. State goes into `state`, actions into `services`.
 */

/** Branded so plain strings cannot be passed where a validated id is required. */
export type CommandId = string & { readonly __brand: 'CommandId' }

export interface CommandContext<TState = unknown, TServices = unknown> {
  /** Shallow-stable state snapshot (e.g. docs = RibbonFormatState + app state). */
  readonly state: TState
  /** Host service object: every side effect a command may perform. */
  readonly services: TServices
}

/** Presentation state declared by the command; renderers read but never compute it. */
export interface CommandVisualState {
  /** Highlighted (e.g. Bold while the selection is bold). */
  readonly active?: boolean
  /** Current value for combobox/number/colorpicker controls. */
  readonly value?: unknown
  /** Dynamic label key (e.g. an AutoFit control showing its current mode). */
  readonly labelKey?: string
}

export interface CommandDefinition<TState = unknown, TServices = unknown, TArgs = void> {
  readonly id: CommandId
  /** Command-level enablement, ANDed with the renderer's global disabledWhen gate. */
  readonly isEnabled?: (ctx: CommandContext<TState, TServices>) => boolean
  readonly isActive?: (ctx: CommandContext<TState, TServices>) => boolean
  readonly isVisible?: (ctx: CommandContext<TState, TServices>) => boolean
  readonly getVisualState?: (ctx: CommandContext<TState, TServices>) => CommandVisualState
  readonly run: (ctx: CommandContext<TState, TServices>, args: TArgs) => void
}

/** Heterogeneous store form: args are checked at the call site, not in the registry. */
export type AnyCommandDefinition<TState = unknown, TServices = unknown> = CommandDefinition<
  TState,
  TServices,
  any
>
