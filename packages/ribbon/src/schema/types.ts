/**
 * Declarative ribbon schema: the single source of truth every renderer
 * (DesktopRibbon, MobileToolbar) consumes. A schema is pure data — tabs →
 * groups → controls referencing command ids — serializable to JSON except for
 * the explicitly marked TS-only escape hatches (predicate `when`, `custom`
 * render, gallery item functions), which serialize as `{ predicate: true }`
 * placeholders with warnings.
 *
 * The package is editor-agnostic: labels are i18n keys resolved by the host's
 * injected `t()`, icons are string keys resolved by the host's `iconMap`.
 */
import type { ReactNode } from 'react'
import type { CommandId } from '../command/types'
import type { When, WhenExpr } from './when'

/** Host-injected translator; matches the apps' useI18n().t signature. */
export type RibbonTranslate = (key: string) => string

/** Renderer-owned dropdown handle handed to custom controls and menu renderers. */
export interface RibbonDropdownApi {
  readonly openId: string | null
  readonly isOpen: (id: string) => boolean
  readonly toggle: (id: string) => void
  /** Open a specific panel (legacy adapters map absolute setDropdown calls). */
  readonly open: (id: string) => void
  readonly close: () => void
}

/** TS-only escape hatch for bespoke popup content; never serializes. */
export type RibbonMenuRenderer<TState = unknown, TServices = unknown> = (ctx: {
  state: TState
  services: TServices
  t: RibbonTranslate
  close: () => void
}) => ReactNode

/** Render context passed to custom controls. */
export interface CustomRenderContext<TState = unknown, TServices = unknown> {
  readonly state: TState
  readonly services: TServices
  readonly t: RibbonTranslate
  readonly dropdown: RibbonDropdownApi
}

export interface RibbonSchema<TState = unknown, TServices = unknown> {
  readonly id: string
  readonly version: number
  readonly tabs: readonly RibbonTab<TState, TServices>[]
}

/** Colored wrapper a group of contextual tabs shares on the tab row (Word's "Table Tools"). */
export interface RibbonContextGroup {
  readonly id: string
  readonly labelKey: string
  /** Theme token or hex for the group's color strip, chosen by the host. */
  readonly color?: string
  /**
   * Tab activated when the context appears (default: the first member tab with
   * autoActivate enabled). Word enters tables on Table Layout, not Table Design.
   */
  readonly activateTab?: string
}

export interface RibbonTab<TState = unknown, TServices = unknown> {
  readonly id: string
  readonly labelKey: string
  readonly kind: 'regular' | 'contextual' | 'file'
  /** contextual tabs only: when the tab exists (e.g. `{ eq: ['selectionKind', 'table'] }`). */
  readonly contextWhen?: When<TState>
  /** contextual tabs only: auto-switch into the tab when contextWhen turns true (default true). */
  readonly autoActivate?: boolean
  /** contextual tabs sharing one colored wrapper on the tab row. */
  readonly contextGroup?: RibbonContextGroup
  /** file tabs only: click opens this menu instead of switching the body. */
  readonly menu?: readonly RibbonMenuItem[]
  readonly groups: readonly RibbonGroup<TState, TServices>[]
  /** regular tabs may also be conditionally hidden. */
  readonly when?: When<TState>
  /**
   * Whole-body escape hatch (strangler hosting of a legacy tab component while
   * sibling tabs are schema-driven). Takes precedence over groups. Never serializes.
   */
  readonly renderBody?: (ctx: CustomRenderContext<TState, TServices>) => ReactNode
}

export interface RibbonGroup<TState = unknown, TServices = unknown> {
  readonly id: string
  readonly labelKey: string
  readonly when?: When<TState>
  /** ANDed with the renderer's global disabled gate and each command's isEnabled. */
  readonly disabledWhen?: When<TState>
  /** 'column' = stacked small buttons (the B/I/U column next to a big button). */
  readonly layout?: 'row' | 'column'
  /** Extra class on the items container (host-specific widths, e.g. docs' rb-font-group). */
  readonly className?: string
  readonly controls: readonly RibbonControl<TState, TServices>[]
}

interface ControlBase<TState> {
  readonly id: string
  readonly when?: When<TState>
  /** Extra class appended to the control's root (maps host-specific widths etc.). */
  readonly className?: string
  readonly tipKey?: string
  /** Statically disabled (placeholder buttons for not-yet-supported features). */
  readonly disabled?: boolean
  /** Dynamic per-control disabled gate, ANDed with group/global gates. */
  readonly disabledWhen?: When<TState>
  /** Static args passed to the command on execution (per-value buttons). */
  readonly args?: unknown
  /**
   * WPS-style space hint (loose/suitable/topsuitable/compact/autocompact) for
   * the adaptive engine (M2). Optional: the renderer derives a default from
   * kind+size when omitted; explicit values are the per-control override.
   */
  readonly spaceHint?: 'loose' | 'suitable' | 'topsuitable' | 'compact' | 'autocompact'
  /** Narrow layouts may drop the label and keep the icon only (WPS canHideText). */
  readonly canHideText?: boolean
}

export interface ButtonControl<TState = unknown> extends ControlBase<TState> {
  readonly kind: 'button'
  /** Omit for a permanently inert placeholder (e.g. a not-yet-supported action). */
  readonly command?: CommandId
  readonly icon?: string
  /** big = icon over label; small = compact icon button; icon = dense icon-only. */
  readonly size: 'big' | 'small' | 'icon'
  readonly labelKey: string
}

export interface SplitControl<TState = unknown, TServices = unknown> extends ControlBase<TState> {
  readonly kind: 'split'
  readonly command: CommandId
  readonly icon?: string
  readonly labelKey: string
  /** Main button form: 'icon' (default) or 'big' (icon over label). */
  readonly size?: 'big' | 'icon'
  /** 'color': main button carries a color bar fed by the command's visual value. */
  readonly variant?: 'color'
  /** Extra class on the dropdown panel (host menu variants). */
  readonly menuClassName?: string
  readonly menu?: readonly RibbonMenuItem[]
  /** Bespoke popup content; takes precedence over `menu`. Never serializes. */
  readonly renderMenu?: RibbonMenuRenderer<TState, TServices>
}

export interface DropdownControl<
  TState = unknown,
  TServices = unknown,
> extends ControlBase<TState> {
  readonly kind: 'dropdown'
  /** When set, clicking the trigger also executes the command. */
  readonly command?: CommandId
  readonly icon?: string
  readonly labelKey: string
  /** Trigger form: 'icon' (default) or 'big' (icon over label). */
  readonly size?: 'big' | 'icon'
  /** 'color': trigger carries a color bar fed by the command's visual value. */
  readonly variant?: 'color'
  /** Render the caret inline inside the trigger button. */
  readonly inlineCaret?: boolean
  /** Highlight the trigger while its panel is open. */
  readonly activeWhenOpen?: boolean
  /** Extra class on the dropdown panel (host menu variants). */
  readonly menuClassName?: string
  readonly menu?: readonly RibbonMenuItem[]
  /** Bespoke popup content; takes precedence over `menu`. Never serializes. */
  readonly renderMenu?: RibbonMenuRenderer<TState, TServices>
}

export interface ComboControl<TState = unknown> extends ControlBase<TState> {
  readonly kind: 'combobox'
  readonly command: CommandId
  /** Dot path into state holding the current value (e.g. 'format.fontSizePt'). */
  readonly statePath: string
  readonly options?: readonly { readonly value: string; readonly labelKey?: string }[]
  /** Editable combo (font name/size): typing + Enter commits through the command. */
  readonly editable?: boolean
}

export interface NumberControl<TState = unknown> extends ControlBase<TState> {
  readonly kind: 'number'
  readonly command: CommandId
  readonly statePath: string
  readonly min?: number
  readonly max?: number
  readonly step?: number
  readonly unitKey?: string
}

export interface ToggleControl<TState = unknown> extends ControlBase<TState> {
  readonly kind: 'toggle'
  readonly command: CommandId
  /** Boolean state path driving the pressed appearance. */
  readonly statePath: string
  readonly labelKey: string
  readonly icon?: string
  /** Omitted: 'icon' when an icon is set, 'small' (label text) otherwise. */
  readonly size?: 'big' | 'small' | 'icon'
}

export interface ColorControl<TState = unknown> extends ControlBase<TState> {
  readonly kind: 'colorpicker'
  readonly command: CommandId
  /** State path holding the current color hex (null = none). */
  readonly statePath: string
  readonly icon?: string
  readonly labelKey: string
  readonly palette: 'theme' | 'standard' | 'highlight'
  readonly allowNone?: { readonly labelKey: string }
}

export interface GalleryItem {
  readonly id: string
  readonly labelKey?: string
  readonly icon?: string
  /** Passed as args to the command when the item is picked. */
  readonly value?: unknown
}

export interface GalleryControl<TState = unknown> extends ControlBase<TState> {
  readonly kind: 'gallery'
  readonly command: CommandId
  readonly labelKey?: string
  readonly columns: number
  readonly items: readonly GalleryItem[]
}

export interface SeparatorControl<TState = unknown> extends ControlBase<TState> {
  readonly kind: 'separator'
}

/** Escape hatch carrying not-yet-migrated or host-unique UI. Never serializes. */
export interface CustomControl<TState = unknown, TServices = unknown> extends ControlBase<TState> {
  readonly kind: 'custom'
  readonly render: (ctx: CustomRenderContext<TState, TServices>) => ReactNode
}

/** Horizontal stack of controls (desktop `.rb-row`); nests inside a group. */
export interface RowControl<TState = unknown, TServices = unknown> extends ControlBase<TState> {
  readonly kind: 'row'
  readonly controls: readonly RibbonControl<TState, TServices>[]
}

/** Vertical stack of controls (desktop `.rb-col`); nests inside a group. */
export interface ColumnControl<TState = unknown, TServices = unknown> extends ControlBase<TState> {
  readonly kind: 'column'
  readonly controls: readonly RibbonControl<TState, TServices>[]
}

export type RibbonControl<TState = unknown, TServices = unknown> =
  | ButtonControl<TState>
  | SplitControl<TState, TServices>
  | DropdownControl<TState, TServices>
  | ComboControl<TState>
  | NumberControl<TState>
  | ToggleControl<TState>
  | ColorControl<TState>
  | GalleryControl<TState>
  | SeparatorControl<TState>
  | CustomControl<TState, TServices>
  | RowControl<TState, TServices>
  | ColumnControl<TState, TServices>

export type RibbonMenuItem =
  | {
      readonly kind?: 'item'
      readonly id: string
      readonly labelKey: string
      readonly icon?: string
      readonly command?: CommandId
      /** Static args passed to the command (per-value menu items). */
      readonly args?: unknown
      /** Boolean state path rendering a check mark. */
      readonly checkedPath?: string
      /** Accelerator hint rendered right-aligned (file-style menus). */
      readonly shortcut?: string
      /** Menu items may only use the JSON-serializable when form. */
      readonly disabledWhen?: WhenExpr
      readonly children?: readonly RibbonMenuItem[]
    }
  | { readonly kind: 'separator'; readonly id: string }
