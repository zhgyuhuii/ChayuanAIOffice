/**
 * Control views. Every view emits the exact class strings the legacy
 * hand-written ribbon used (including its template-literal whitespace quirks),
 * because per-app stylesheets and DOM-snapshot equivalence tests key off them.
 *
 * Enablement composition, in AND order: control.disabled literal →
 * control.disabledWhen → group.disabledWhen → renderer global gate → command
 * isEnabled. A command-less button/dropdown relies on the schema gates alone.
 */
import type { CSSProperties, ReactNode } from 'react'
import type { CommandId } from '../command/types'
import type {
  ButtonControl,
  DropdownControl,
  RibbonControl,
  RibbonMenuItem,
  RowControl,
  ColumnControl,
  SplitControl,
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
  if (control.size === 'big') {
    return (
      <button
        className={withClass('rb-big', control.className)}
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
  className?: string
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
  const mainContent =
    control.size === 'big' ? (
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
    control.size === 'big'
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
  if (control.size === 'big') {
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
      // combobox/number/toggle/colorpicker/gallery land with the tab migrations
      // that need them (C3-C7); hosts ship them as `custom` until then.
      return null
  }
}
