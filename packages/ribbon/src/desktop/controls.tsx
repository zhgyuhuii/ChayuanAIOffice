/**
 * Control views. Every view emits the exact class strings the legacy
 * hand-written ribbon used (including its template-literal whitespace quirks),
 * because per-app stylesheets and DOM-snapshot equivalence tests key off them.
 *
 * Enablement composition, in AND order: control.disabled literal →
 * control.disabledWhen → group.disabledWhen → renderer global gate → command
 * isEnabled. A command-less button/dropdown relies on the schema gates alone.
 */
import { useState, type CSSProperties, type ReactNode } from 'react'
import type { CommandId } from '../command/types'
import type {
  ButtonControl,
  ColorControl,
  ColumnControl,
  ComboControl,
  DropdownControl,
  GalleryControl,
  NumberControl,
  RibbonControl,
  RibbonMenuItem,
  RowControl,
  SplitControl,
  ToggleControl,
} from '../schema/types'
import { evaluateWhen, resolvePath, type When } from '../schema/when'
import { useRibbonEnv, type RibbonEnv, type RibbonIconMap } from './env'

/** Matches the legacy IconCaret svg exactly (host-overridable via icons.caret). */
export function IconCaret() {
  return (
    <svg
      className="rb-caret-svg"
      width={10}
      height={10}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5.5 9.25 12 15.75l6.5-6.5" />
    </svg>
  )
}

interface GateResult {
  readonly visible: boolean
  readonly disabled: boolean
  readonly active: boolean
  readonly visualValue: unknown
}

function useControlGate<TState, TServices>(
  env: RibbonEnv<TState, TServices>,
  control: {
    readonly when?: When<TState>
    readonly disabled?: boolean
    readonly disabledWhen?: When<TState>
    readonly command?: CommandId
  },
  groupDisabled: boolean,
): GateResult {
  const { registry, ctx, globalDisabled } = env
  const command = control.command
  const visible =
    evaluateWhen(control.when, ctx.state) && (command ? registry.isVisible(command, ctx) : true)
  const disabled =
    control.disabled === true ||
    globalDisabled ||
    groupDisabled ||
    (control.disabledWhen !== undefined && evaluateWhen(control.disabledWhen, ctx.state)) ||
    (command ? !registry.isEnabled(command, ctx) : false)
  const active = command ? registry.isActive(command, ctx) : false
  const visualValue = command ? registry.get(command)?.getVisualState?.(ctx)?.value : undefined
  return { visible, disabled, active, visualValue }
}

function iconOf(icons: RibbonIconMap, key: string | undefined): ReactNode {
  if (!key) return null
  return icons[key] ?? null
}

function tipProps(tip: string | undefined, withAria: boolean) {
  return {
    ...(tip ? { 'data-tip': tip } : {}),
    ...(withAria && tip ? { 'aria-label': tip } : {}),
  }
}

function withClass(base: string, className: string | undefined): string {
  return className ? `${base} ${className}` : base
}

function ButtonView<TState, TServices>({
  control,
  groupDisabled,
}: {
  control: ButtonControl<TState>
  groupDisabled: boolean
}) {
  const env = useRibbonEnv<TState, TServices>()
  const gate = useControlGate(env, control, groupDisabled)
  if (!gate.visible) return null
  const tip = control.tipKey ? env.t(control.tipKey) : undefined
  const run = () => {
    if (control.command) env.registry.execute(control.command, env.ctx, control.args)
  }
  // Adaptive degradation (M2): drop label text, keep the icon (rb-icon form).
  if (env.hideText && control.icon) {
    return (
      <button
        className={`${withClass('rb-icon', control.className)} ${gate.active ? 'active' : ''}`}
        disabled={gate.disabled}
        {...tipProps(tip ?? env.t(control.labelKey), true)}
        onClick={run}
      >
        {iconOf(env.icons, control.icon)}
      </button>
    )
  }
  if (control.size === 'big') {
    return (
      <button
        // Word's big view-style buttons carry the pressed look from the
        // command's isActive (Web Layout active while in web view, …)
        className={`${withClass('rb-big', control.className)} ${gate.active ? 'active' : ''}`}
        disabled={gate.disabled}
        {...tipProps(tip, false)}
        onClick={run}
      >
        <span className="rb-big-icon">{iconOf(env.icons, control.icon)}</span>
        <span>{env.t(control.labelKey)}</span>
      </button>
    )
  }
  const base = control.size === 'small' ? 'rb-small' : 'rb-icon'
  return (
    <button
      className={`${withClass(base, control.className)} ${gate.active ? 'active' : ''}`}
      disabled={gate.disabled}
      {...tipProps(tip, true)}
      onClick={run}
    >
      {iconOf(env.icons, control.icon) ?? env.t(control.labelKey)}
    </button>
  )
}

function ColorBar({ value }: { value: unknown }) {
  const style: CSSProperties =
    typeof value === 'string' && value ? { background: value } : { background: 'transparent' }
  return <span className="rb-color-bar" style={style} />
}

function SplitPanel<TState, TServices>({
  control,
}: {
  control: SplitControl<TState, TServices> | DropdownControl<TState, TServices>
}) {
  const env = useRibbonEnv<TState, TServices>()
  if (control.renderMenu) {
    return (
      <>
        {control.renderMenu({
          state: env.ctx.state,
          services: env.ctx.services,
          t: env.t,
          close: env.dropdown.close,
        })}
      </>
    )
  }
  if (!control.menu) return null
  return <MenuPanel items={control.menu} className={control.menuClassName} />
}

export function MenuPanel<TState = unknown, TServices = unknown>({
  items,
  className,
}: {
  items: readonly RibbonMenuItem[]
  className?: string | undefined
}) {
  const env = useRibbonEnv<TState, TServices>()
  return (
    <div data-rb-panel="" className={withClass('spacing-menu', className)}>
      {items.map((item) => {
        if (item.kind === 'separator') return <div key={item.id} className="rb-menu-sep" />
        const checked = item.checkedPath
          ? Boolean(resolvePath(env.ctx.state, item.checkedPath))
          : item.command
            ? env.registry.isActive(item.command, env.ctx)
            : false
        const disabled =
          env.globalDisabled ||
          (item.disabledWhen !== undefined && evaluateWhen(item.disabledWhen, env.ctx.state)) ||
          (item.command ? !env.registry.isEnabled(item.command, env.ctx) : false)
        return (
          <button
            key={item.id}
            className={checked ? 'active' : ''}
            disabled={disabled}
            onClick={() => {
              if (item.command) env.registry.execute(item.command, env.ctx, item.args)
              env.dropdown.close()
            }}
          >
            {env.t(item.labelKey)}
            {item.shortcut ? <span className="file-menu-key">{item.shortcut}</span> : null}
            {item.children?.length ? (
              <span className="rb-menu-children">
                <MenuPanel items={item.children} />
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

function SplitView<TState, TServices>({
  control,
  groupDisabled,
}: {
  control: SplitControl<TState, TServices>
  groupDisabled: boolean
}) {
  const env = useRibbonEnv<TState, TServices>()
  const gate = useControlGate(env, control, groupDisabled)
  if (!gate.visible) return null
  const open = env.dropdown.isOpen(control.id)
  const tip = control.tipKey ? env.t(control.tipKey) : undefined
  const color = control.variant === 'color'
  const caretClass = color
    ? `rb-caret rb-color-caret${open ? ' active' : ''}`
    : `rb-caret${open ? ' active' : ''}`
  const iconOnly = control.size !== 'big' || (env.hideText === true && Boolean(control.icon))
  const mainContent =
    !iconOnly && control.size === 'big' ? (
      <>
        <span className="rb-big-icon">
          {iconOf(env.icons, control.icon)}
          {color ? <ColorBar value={gate.visualValue} /> : null}
        </span>
        <span>{env.t(control.labelKey)}</span>
      </>
    ) : color ? (
      <span className="rb-color-glyph rb-color-glyph-svg">
        {iconOf(env.icons, control.icon)}
        <ColorBar value={gate.visualValue} />
      </span>
    ) : (
      (iconOf(env.icons, control.icon) ?? env.t(control.labelKey))
    )
  const mainClass =
    !iconOnly && control.size === 'big'
      ? withClass('rb-big', undefined)
      : withClass(`rb-icon${color ? ' rb-color-btn' : ''}`, undefined)
  return (
    <div className={withClass('rb-split-wrap', control.className)}>
      <button
        className={
          control.size === 'big' ? mainClass : `${mainClass} ${gate.active ? 'active' : ''}`
        }
        disabled={gate.disabled}
        {...tipProps(tip, control.size !== 'big')}
        onClick={() => env.registry.execute(control.command, env.ctx, control.args)}
      >
        {mainContent}
      </button>
      <button
        className={caretClass}
        disabled={gate.disabled}
        {...tipProps(tip, true)}
        onClick={() => env.dropdown.toggle(control.id)}
      >
        {env.icons.caret ?? <IconCaret />}
      </button>
      {open ? <SplitPanel control={control} /> : null}
    </div>
  )
}

function DropdownView<TState, TServices>({
  control,
  groupDisabled,
}: {
  control: DropdownControl<TState, TServices>
  groupDisabled: boolean
}) {
  const env = useRibbonEnv<TState, TServices>()
  const gate = useControlGate(env, control, groupDisabled)
  if (!gate.visible) return null
  const open = env.dropdown.isOpen(control.id)
  const tip = control.tipKey ? env.t(control.tipKey) : undefined
  const color = control.variant === 'color'
  const lit = gate.active || (control.activeWhenOpen === true && open)
  const onClick = () => {
    if (control.command) env.registry.execute(control.command, env.ctx, control.args)
    env.dropdown.toggle(control.id)
  }
  const bigForm = control.size === 'big' && !(env.hideText === true && Boolean(control.icon))
  if (bigForm) {
    return (
      <div className={withClass('rb-split-wrap', control.className)}>
        <button
          className={withClass('rb-big', undefined)}
          disabled={gate.disabled}
          {...tipProps(tip, false)}
          onClick={onClick}
        >
          <span className="rb-big-icon">
            {iconOf(env.icons, control.icon)}
            {color ? <ColorBar value={gate.visualValue} /> : null}
          </span>
          <span>{env.t(control.labelKey)}</span>
        </button>
        {open ? <SplitPanel control={control} /> : null}
      </div>
    )
  }
  return (
    <div className={withClass('rb-split-wrap', control.className)}>
      <button
        className={`${color ? 'rb-icon rb-color-btn' : 'rb-icon'} ${lit ? 'active' : ''}`}
        disabled={gate.disabled}
        {...tipProps(tip, true)}
        onClick={onClick}
      >
        {color ? (
          <span className="rb-color-glyph rb-color-glyph-svg">
            {iconOf(env.icons, control.icon)}
            <ColorBar value={gate.visualValue} />
          </span>
        ) : (
          (iconOf(env.icons, control.icon) ?? env.t(control.labelKey))
        )}
        {control.inlineCaret ? (
          <span className="rb-caret-inline">{env.icons.caret ?? <IconCaret />}</span>
        ) : null}
      </button>
      {open ? <SplitPanel control={control} /> : null}
    </div>
  )
}

/**
 * ToggleView: pressed state comes from the schema's boolean statePath (not the
 * command's isActive — toggles must reflect document state even when the
 * command carries no active rule). Renders the same chrome as ButtonView.
 */
function ToggleView<TState, TServices>({
  control,
  groupDisabled,
}: {
  control: ToggleControl<TState>
  groupDisabled: boolean
}) {
  const env = useRibbonEnv<TState, TServices>()
  const gate = useControlGate(env, control, groupDisabled)
  const pressed = Boolean(resolvePath(env.ctx.state, control.statePath))
  if (!gate.visible) return null
  const tip = control.tipKey ? env.t(control.tipKey) : undefined
  const run = () => env.registry.execute(control.command, env.ctx, control.args)
  if (env.hideText && control.icon) {
    return (
      <button
        className={`${withClass('rb-icon', control.className)} ${pressed ? 'active' : ''}`}
        disabled={gate.disabled}
        {...tipProps(tip ?? env.t(control.labelKey), true)}
        onClick={run}
      >
        {iconOf(env.icons, control.icon)}
      </button>
    )
  }
  if (control.size === 'big') {
    return (
      <button
        className={`${withClass('rb-big', control.className)} ${pressed ? 'active' : ''}`}
        disabled={gate.disabled}
        {...tipProps(tip, false)}
        onClick={run}
      >
        <span className="rb-big-icon">{iconOf(env.icons, control.icon)}</span>
        <span>{env.t(control.labelKey)}</span>
      </button>
    )
  }
  const base = control.size === 'small' || !control.icon ? 'rb-small' : 'rb-icon'
  return (
    <button
      className={`${withClass(base, control.className)} ${pressed ? 'active' : ''}`}
      disabled={gate.disabled}
      {...tipProps(tip, true)}
      onClick={run}
    >
      {iconOf(env.icons, control.icon) ?? env.t(control.labelKey)}
    </button>
  )
}

/**
 * NumberView: spinbox (WPS row-height/column-width pattern) — editable input
 * with up/down steppers. Commit semantics: execute(command, ctx, number) with
 * the parsed value clamped to min/max; steppers step from the current value.
 */
function NumberView<TState, TServices>({
  control,
  groupDisabled,
}: {
  control: NumberControl<TState>
  groupDisabled: boolean
}) {
  const env = useRibbonEnv<TState, TServices>()
  const gate = useControlGate(env, control, groupDisabled)
  const [draft, setDraft] = useState<string | null>(null)
  if (!gate.visible) return null
  const tip = control.tipKey ? env.t(control.tipKey) : undefined
  const raw = resolvePath(env.ctx.state, control.statePath)
  const current = typeof raw === 'number' ? raw : Number(raw)
  const clamp = (n: number) =>
    Math.min(
      control.max ?? Number.MAX_SAFE_INTEGER,
      Math.max(control.min ?? -Number.MAX_SAFE_INTEGER, n),
    )
  const commit = (text: string) => {
    const parsed = Number.parseFloat(text)
    if (Number.isFinite(parsed)) {
      env.registry.execute(control.command, env.ctx, clamp(parsed))
    }
    setDraft(null)
  }
  const step = (direction: 1 | -1) => {
    const base = Number.isFinite(current) ? current : 0
    env.registry.execute(control.command, env.ctx, clamp(base + direction * (control.step ?? 1)))
  }
  return (
    <span className={withClass('rb-spin', control.className)}>
      <input
        className="rb-spin-input"
        type="text"
        inputMode="decimal"
        disabled={gate.disabled}
        value={draft ?? (Number.isFinite(current) ? String(current) : '')}
        {...tipProps(tip, true)}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => {
          setDraft(Number.isFinite(current) ? String(current) : '')
          e.target.select()
        }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit(e.currentTarget.value)
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            setDraft(null)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            step(1)
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            step(-1)
          }
        }}
      />
      {control.unitKey ? <span className="rb-spin-unit">{env.t(control.unitKey)}</span> : null}
      <span className="rb-spin-steps">
        <button
          className="rb-spin-step rb-spin-up"
          disabled={gate.disabled}
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => step(1)}
        >
          {env.icons.caret ?? <IconCaret />}
        </button>
        <button
          className="rb-spin-step rb-spin-down"
          disabled={gate.disabled}
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => step(-1)}
        >
          {env.icons.caret ?? <IconCaret />}
        </button>
      </span>
    </span>
  )
}

/**
 * ComboView: value chooser fed by statePath + options. Non-editable renders a
 * trigger button opening an option panel; editable (font name/size pattern)
 * renders an input whose Enter commits the typed text. Both execute
 * execute(command, ctx, value) — option.value for picks, the typed string for
 * editable commits.
 */
function ComboView<TState, TServices>({
  control,
  groupDisabled,
}: {
  control: ComboControl<TState>
  groupDisabled: boolean
}) {
  const env = useRibbonEnv<TState, TServices>()
  const gate = useControlGate(env, control, groupDisabled)
  const [draft, setDraft] = useState<string | null>(null)
  const open = env.dropdown.isOpen(control.id)
  if (!gate.visible) return null
  const tip = control.tipKey ? env.t(control.tipKey) : undefined
  const raw = resolvePath(env.ctx.state, control.statePath)
  const current = raw === undefined || raw === null ? '' : String(raw)
  const currentOption = control.options?.find((option) => option.value === current)
  const commit = (text: string) => {
    env.registry.execute(control.command, env.ctx, text)
    setDraft(null)
    env.dropdown.close()
  }
  const pick = (value: string) => {
    env.registry.execute(control.command, env.ctx, value)
    env.dropdown.close()
  }
  if (control.editable) {
    return (
      <span className={withClass('rb-combo rb-combo-editable', control.className)}>
        <input
          className="rb-combo-input"
          type="text"
          disabled={gate.disabled}
          value={draft ?? current}
          {...tipProps(tip, true)}
          onChange={(e) => {
            setDraft(e.target.value)
            env.dropdown.open(control.id)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit(e.currentTarget.value)
              e.currentTarget.blur()
            } else if (e.key === 'Escape') {
              setDraft(null)
              env.dropdown.close()
            }
          }}
        />
        {open && control.options?.length ? <ComboPanel control={control} onPick={pick} /> : null}
      </span>
    )
  }
  return (
    <span className={withClass('rb-combo', control.className)}>
      <button
        className={`rb-combo-trigger ${open ? 'active' : ''}`}
        disabled={gate.disabled}
        {...tipProps(tip, true)}
        onClick={() => env.dropdown.toggle(control.id)}
      >
        <span className="rb-combo-value">
          {currentOption ? env.t(currentOption.labelKey ?? currentOption.value) : current}
        </span>
        <span className="rb-combo-caret">{env.icons.caret ?? <IconCaret />}</span>
      </button>
      {open && control.options?.length ? <ComboPanel control={control} onPick={pick} /> : null}
    </span>
  )
}

function ComboPanel<TState, TServices>({
  control,
  onPick,
}: {
  control: ComboControl<TState>
  onPick: (value: string) => void
}) {
  const env = useRibbonEnv<TState, TServices>()
  const current = String(resolvePath(env.ctx.state, control.statePath) ?? '')
  return (
    <div data-rb-panel="" className="rb-combo-panel">
      {control.options!.map((option) => (
        <button
          key={option.value}
          className={option.value === current ? 'active' : ''}
          onClick={() => onPick(option.value)}
        >
          {env.t(option.labelKey ?? option.value)}
        </button>
      ))}
    </div>
  )
}

/** Package-default palettes (host CSS may restyle; host commands may remap). */
const COLOR_BASES = [
  '#C00000',
  '#FF0000',
  '#FFC000',
  '#FFFF00',
  '#92D050',
  '#00B050',
  '#00B0F0',
  '#0070C0',
  '#002060',
  '#7030A0',
]

const HIGHLIGHT_COLORS = [
  'yellow',
  'green',
  'cyan',
  'magenta',
  'blue',
  'red',
  'darkBlue',
  'darkCyan',
  'darkGreen',
  'darkMagenta',
  'darkRed',
  'darkYellow',
  'darkGray',
  'lightGray',
  'black',
]

/** Blend a #RRGGBB color toward black (factor<0) or white (factor>0); factor in [-1,1]. */
function shade(hex: string, factor: number): string {
  const value = hex.replace('#', '')
  const channels = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16))
  const target = factor < 0 ? 0 : 255
  const mixed = channels.map((c) => Math.round(c + (target - c) * Math.abs(factor)))
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

function paletteColors(palette: ColorControl['palette']): string[] {
  if (palette === 'highlight') return HIGHLIGHT_COLORS
  if (palette === 'standard') return COLOR_BASES
  // theme: Office pattern — shade rows per base color, darkest at the top.
  return COLOR_BASES.flatMap((base) => [
    shade(base, -0.5),
    shade(base, -0.25),
    base,
    shade(base, 0.6),
    shade(base, 0.8),
  ])
}

/**
 * ColorView: palette dropdown fed by statePath (current color shown as the
 * trigger's color bar). Pick executes execute(command, ctx, cssColor); the
 * none row passes null.
 */
function ColorView<TState, TServices>({
  control,
  groupDisabled,
}: {
  control: ColorControl<TState>
  groupDisabled: boolean
}) {
  const env = useRibbonEnv<TState, TServices>()
  const gate = useControlGate(env, control, groupDisabled)
  const open = env.dropdown.isOpen(control.id)
  if (!gate.visible) return null
  const tip = control.tipKey ? env.t(control.tipKey) : undefined
  const current = resolvePath(env.ctx.state, control.statePath)
  const pick = (value: string | null) => {
    env.registry.execute(control.command, env.ctx, value)
    env.dropdown.close()
  }
  return (
    <div className={withClass('rb-split-wrap', control.className)}>
      <button
        className={`rb-icon rb-color-btn ${open ? 'active' : ''}`}
        disabled={gate.disabled}
        {...tipProps(tip, true)}
        onClick={() => env.dropdown.toggle(control.id)}
      >
        <span className="rb-color-glyph rb-color-glyph-svg">
          {iconOf(env.icons, control.icon)}
          <ColorBar value={typeof current === 'string' ? current : undefined} />
        </span>
        <span className="rb-caret-inline">{env.icons.caret ?? <IconCaret />}</span>
      </button>
      {open ? (
        <div data-rb-panel="" className="rb-palette">
          {control.allowNone ? (
            <button className="rb-palette-none" onClick={() => pick(null)}>
              {env.t(control.allowNone.labelKey)}
            </button>
          ) : null}
          <div className="rb-palette-grid">
            {paletteColors(control.palette).map((color) => (
              <button
                key={color}
                className="rb-palette-swatch"
                style={{ background: color }}
                data-tip={color}
                aria-label={color}
                onClick={() => pick(color)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * GalleryView: fixed-grid preview picker (WPS style-gallery pattern). Items
 * render icon-only with tooltip labels; picking executes
 * execute(command, ctx, item.value).
 */
function GalleryView<TState, TServices>({
  control,
  groupDisabled,
}: {
  control: GalleryControl<TState>
  groupDisabled: boolean
}) {
  const env = useRibbonEnv<TState, TServices>()
  const gate = useControlGate(env, control, groupDisabled)
  if (!gate.visible) return null
  return (
    <div
      className={withClass('rb-gallery', control.className)}
      style={{ gridTemplateColumns: `repeat(${control.columns}, minmax(0, 1fr))` }}
    >
      {control.items.map((item) => (
        <button
          key={item.id}
          className="rb-gallery-item"
          disabled={gate.disabled}
          {...tipProps(item.labelKey ? env.t(item.labelKey) : undefined, true)}
          onClick={() => env.registry.execute(control.command, env.ctx, item.value)}
        >
          <span className="rb-gallery-icon">{iconOf(env.icons, item.icon)}</span>
        </button>
      ))}
    </div>
  )
}

function ContainerView<TState, TServices>({
  control,
  groupDisabled,
}: {
  control: RowControl<TState, TServices> | ColumnControl<TState, TServices>
  groupDisabled: boolean
}) {
  const env = useRibbonEnv<TState, TServices>()
  if (!evaluateWhen(control.when, env.ctx.state)) return null
  return (
    <div className={withClass(control.kind === 'row' ? 'rb-row' : 'rb-col', control.className)}>
      {control.controls.map((child) => (
        <ControlView key={child.id} control={child} groupDisabled={groupDisabled} />
      ))}
    </div>
  )
}

export function ControlView<TState, TServices>({
  control,
  groupDisabled,
}: {
  control: RibbonControl<TState, TServices>
  groupDisabled: boolean
}) {
  const env = useRibbonEnv<TState, TServices>()
  switch (control.kind) {
    case 'button':
      return <ButtonView control={control} groupDisabled={groupDisabled} />
    case 'split':
      return <SplitView control={control} groupDisabled={groupDisabled} />
    case 'dropdown':
      return <DropdownView control={control} groupDisabled={groupDisabled} />
    case 'toggle':
      return <ToggleView control={control} groupDisabled={groupDisabled} />
    case 'number':
      return <NumberView control={control} groupDisabled={groupDisabled} />
    case 'combobox':
      return <ComboView control={control} groupDisabled={groupDisabled} />
    case 'colorpicker':
      return <ColorView control={control} groupDisabled={groupDisabled} />
    case 'gallery':
      return <GalleryView control={control} groupDisabled={groupDisabled} />
    case 'row':
    case 'column':
      return <ContainerView control={control} groupDisabled={groupDisabled} />
    case 'separator':
      return evaluateWhen(control.when, env.ctx.state) ? (
        <span className={withClass('rb-mini-sep', control.className)} />
      ) : null
    case 'custom':
      return evaluateWhen(control.when, env.ctx.state) ? (
        <>
          {control.render({
            state: env.ctx.state,
            services: env.ctx.services,
            t: env.t,
            dropdown: env.dropdown,
          })}
        </>
      ) : null
    default:
      // 'custom' is handled above; the union is fully covered.
      return null
  }
}
