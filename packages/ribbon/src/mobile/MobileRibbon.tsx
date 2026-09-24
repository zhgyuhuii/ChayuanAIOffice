/**
 * MobileRibbon: the schema-driven mobile renderer (P1). One compact bar —
 * file button, active-tab trigger, host trailing slot — plus a bottom sheet
 * holding the tab switcher and the displayed tab's groups as tappable rows,
 * Word-mobile style. Shares the schema/registry/env with DesktopRibbon, so a
 * tab migrated once renders on both form factors.
 *
 * Control coverage on mobile: button / toggle / split / dropdown / gallery /
 * separator / row / column render natively (split and dropdown with a command
 * render that command as the first sub-row — no dual-hit-target rows on
 * touch). combobox / number / colorpicker / custom need popups or inline
 * inputs that the sheet model does not carry yet: they render as disabled
 * rows with their label so nothing disappears silently.
 */
import { useMemo, useState, type ReactNode } from 'react'
import type { CommandRegistry } from '../command/registry'
import type {
  RibbonControl,
  RibbonDropdownApi,
  RibbonGroup,
  RibbonMenuItem,
  RibbonSchema,
  RibbonTab,
  RibbonTranslate,
} from '../schema/types'
import { evaluateWhen, type When } from '../schema/when'
import { IconCaret } from '../desktop/controls'
import { RibbonEnvProvider, useRibbonEnv, type RibbonEnv, type RibbonIconMap } from '../desktop/env'
import { useRibbonTabs } from '../desktop/use-ribbon-tabs'

export interface MobileRibbonProps<TState = unknown, TServices = unknown> {
  readonly schema: RibbonSchema<TState, TServices>
  readonly registry: CommandRegistry<TState, TServices>
  readonly state: TState
  readonly services: TServices
  readonly t: RibbonTranslate
  /** Icon registry; `caret` overrides the built-in chevron. */
  readonly icons?: RibbonIconMap
  /** Renderer-level disabled gate, ANDed with group/command gates. */
  readonly disabledWhen?: When<TState>
  /** Controlled mode; omit both for uncontrolled with `defaultTab`. */
  readonly activeTab?: string
  readonly defaultTab?: string
  readonly onTabChange?: (tabId: string) => void
  /** Slot on the bar's right edge (AI bubble toggle etc.). */
  readonly trailingActions?: React.ReactNode
}

type SheetState<TState, TServices> =
  | { readonly kind: 'file'; readonly tab: RibbonTab<TState, TServices> }
  | { readonly kind: 'tools' }
  | null

export function MobileRibbon<TState, TServices>(props: MobileRibbonProps<TState, TServices>) {
  const { schema, registry, state, services, t, icons = {}, disabledWhen, trailingActions } = props

  const ctx = useMemo(() => ({ state, services }), [state, services])
  const [openId, setOpenId] = useState<string | null>(null)
  const dropdown = useMemo<RibbonDropdownApi>(
    () => ({
      openId,
      isOpen: (id: string) => openId === id,
      toggle: (id: string) => setOpenId((current) => (current === id ? null : id)),
      open: (id: string) => setOpenId(id),
      close: () => setOpenId(null),
    }),
    [openId],
  )

  const env: RibbonEnv<TState, TServices> = {
    registry,
    ctx,
    t,
    icons,
    globalDisabled: disabledWhen !== undefined && evaluateWhen(disabledWhen, state),
    dropdown,
  }

  const machine = useRibbonTabs(schema, state, {
    activeTab: props.activeTab,
    defaultTab: props.defaultTab,
    onTabChange: props.onTabChange,
  })

  const [sheet, setSheet] = useState<SheetState<TState, TServices>>(null)
  const closeSheet = () => setSheet(null)

  const fileTabs = schema.tabs.filter((tab) => tab.kind === 'file')
  const switchableTabs = schema.tabs.filter(
    (tab) =>
      (tab.kind === 'regular' && evaluateWhen(tab.when, state)) ||
      (tab.kind === 'contextual' && evaluateWhen(tab.contextWhen, state)),
  )
  const displayedTab = schema.tabs.find((tab) => tab.id === machine.displayed)
  const caret = icons.caret ?? <IconCaret />

  return (
    <RibbonEnvProvider value={env}>
      <div className="mrib">
        <div className="mrib-bar">
          {fileTabs.map((tab) => (
            <button
              key={tab.id}
              className="mrib-file"
              onClick={() => setSheet({ kind: 'file', tab })}
            >
              {t(tab.labelKey)}
            </button>
          ))}
          <button
            className="mrib-tab-trigger"
            aria-haspopup="dialog"
            onClick={() => setSheet({ kind: 'tools' })}
          >
            {displayedTab ? t(displayedTab.labelKey) : ''}
            {caret}
          </button>
          <span className="mrib-bar-spacer" />
          {trailingActions}
        </div>
        {sheet && (
          <div className="mrib-overlay" onClick={closeSheet}>
            <div className="mrib-sheet" role="dialog" onClick={(event) => event.stopPropagation()}>
              {sheet.kind === 'file' ? (
                <FileSheet tab={sheet.tab} onExecuted={closeSheet} />
              ) : (
                <ToolsSheet
                  tabs={switchableTabs}
                  displayedTab={displayedTab}
                  onSelect={(tabId) => machine.select(tabId)}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </RibbonEnvProvider>
  )
}

function FileSheet<TState, TServices>({
  tab,
  onExecuted,
}: {
  tab: RibbonTab<TState, TServices>
  onExecuted: () => void
}) {
  const env = useRibbonEnv<TState, TServices>()
  return (
    <>
      <div className="mrib-sheet-title">{env.t(tab.labelKey)}</div>
      <MenuRows items={tab.menu ?? []} onExecuted={onExecuted} />
    </>
  )
}

function ToolsSheet<TState, TServices>({
  tabs,
  displayedTab,
  onSelect,
}: {
  tabs: readonly RibbonTab<TState, TServices>[]
  displayedTab: RibbonTab<TState, TServices> | undefined
  onSelect: (tabId: string) => void
}) {
  const env = useRibbonEnv<TState, TServices>()
  return (
    <>
      <div className="mrib-tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={tab.id === displayedTab?.id}
            className={`mrib-tab-chip ${tab.id === displayedTab?.id ? 'active' : ''}`}
            onClick={() => onSelect(tab.id)}
          >
            {env.t(tab.labelKey)}
          </button>
        ))}
      </div>
      {displayedTab
        ? displayedTab.renderBody
          ? displayedTab.renderBody({
              state: env.ctx.state,
              services: env.ctx.services,
              t: env.t,
              dropdown: env.dropdown,
            })
          : displayedTab.groups
              .filter((group) => evaluateWhen(group.when, env.ctx.state))
              .map((group) => <GroupSection key={group.id} group={group} />)
        : null}
    </>
  )
}

function GroupSection<TState, TServices>({ group }: { group: RibbonGroup<TState, TServices> }) {
  const env = useRibbonEnv<TState, TServices>()
  const groupDisabled =
    group.disabledWhen !== undefined && evaluateWhen(group.disabledWhen, env.ctx.state)
  return (
    <section className="mrib-group">
      <div className="mrib-group-label">{env.t(group.labelKey)}</div>
      {group.controls.map((control) => (
        <ControlRow key={control.id} control={control} groupDisabled={groupDisabled} />
      ))}
    </section>
  )
}

function MenuRows<TState, TServices>({
  items,
  onExecuted,
}: {
  items: readonly RibbonMenuItem[]
  onExecuted: () => void
}) {
  const env = useRibbonEnv<TState, TServices>()
  return (
    <>
      {items.map((item) => {
        if (item.kind === 'separator') return <hr key={item.id} className="mrib-sep" />
        const disabled =
          env.globalDisabled ||
          (item.disabledWhen !== undefined && evaluateWhen(item.disabledWhen, env.ctx.state)) ||
          (item.command ? !env.registry.isEnabled(item.command, env.ctx) : false)
        return (
          <button
            key={item.id}
            className="mrib-row"
            disabled={disabled}
            onClick={() => {
              onExecuted()
              if (item.command) env.registry.execute(item.command, env.ctx, item.args)
            }}
          >
            {renderIcon(env, item.icon)}
            <span className="mrib-row-label">{env.t(item.labelKey)}</span>
            {item.shortcut ? <span className="file-menu-key">{item.shortcut}</span> : null}
          </button>
        )
      })}
    </>
  )
}

/** The command-less row header of a dropdown/split disclosure. */
function DisclosureRow({
  label,
  icon,
  disabled,
  open,
  onToggle,
}: {
  label: string
  icon: string | undefined
  disabled: boolean
  open: boolean
  onToggle: () => void
}) {
  const env = useRibbonEnv()
  return (
    <button
      className="mrib-row mrib-disclosure"
      aria-expanded={open}
      disabled={disabled}
      onClick={onToggle}
    >
      {renderIcon(env, icon)}
      <span className="mrib-row-label">{env.t(label)}</span>
      {env.icons.caret ?? <IconCaret />}
    </button>
  )
}

function ControlRow<TState, TServices>({
  control,
  groupDisabled,
}: {
  control: RibbonControl<TState, TServices>
  groupDisabled: boolean
}) {
  const env = useRibbonEnv<TState, TServices>()
  const [expanded, setExpanded] = useState(false)
  const command = 'command' in control ? control.command : undefined
  const disabled =
    env.globalDisabled ||
    groupDisabled ||
    (control.disabled ?? false) ||
    (control.disabledWhen !== undefined && evaluateWhen(control.disabledWhen, env.ctx.state)) ||
    (command !== undefined && !env.registry.isEnabled(command, env.ctx))

  switch (control.kind) {
    case 'row':
    case 'column':
      return (
        <>
          {control.controls.map((child) => (
            <ControlRow key={child.id} control={child} groupDisabled={groupDisabled} />
          ))}
        </>
      )
    case 'separator':
      return <hr className="mrib-sep" />
    case 'button':
      return (
        <button
          className="mrib-row"
          disabled={disabled}
          onClick={() => command && env.registry.execute(command, env.ctx, control.args)}
        >
          {renderIcon(env, control.icon)}
          <span className="mrib-row-label">{env.t(control.labelKey)}</span>
        </button>
      )
    case 'toggle': {
      const active = command ? env.registry.isActive(command, env.ctx) : false
      return (
        <button
          className={`mrib-row ${active ? 'active' : ''}`}
          aria-pressed={active}
          disabled={disabled}
          onClick={() => command && env.registry.execute(command, env.ctx, control.args)}
        >
          {renderIcon(env, control.icon)}
          <span className="mrib-row-label">{env.t(control.labelKey)}</span>
        </button>
      )
    }
    case 'split':
    case 'dropdown': {
      const subRows = (
        <>
          {command ? (
            <button
              className="mrib-row mrib-sub"
              disabled={disabled}
              onClick={() => env.registry.execute(command, env.ctx, control.args)}
            >
              {renderIcon(env, control.icon)}
              <span className="mrib-row-label">{env.t(control.labelKey)}</span>
            </button>
          ) : null}
          {control.renderMenu
            ? control.renderMenu({
                state: env.ctx.state,
                services: env.ctx.services,
                t: env.t,
                close: () => setExpanded(false),
              })
            : null}
          {control.menu ? (
            <MenuRows items={control.menu} onExecuted={() => setExpanded(false)} />
          ) : null}
        </>
      )
      // split and dropdown render identically on mobile: the disclosure header
      // opens the panel; a main command appears as its first sub-row (the
      // desktop dual-hit-target trigger does not translate to touch).
      return (
        <div className={`mrib-nest ${expanded ? 'open' : ''}`}>
          <DisclosureRow
            label={control.labelKey}
            icon={control.icon}
            disabled={disabled}
            open={expanded}
            onToggle={() => setExpanded((v) => !v)}
          />
          {expanded ? subRows : null}
        </div>
      )
    }
    case 'gallery':
      return (
        <div className="mrib-gallery">
          {control.items.map((item) => (
            <button
              key={item.id}
              className="mrib-gallery-item"
              disabled={disabled}
              onClick={() => command && env.registry.execute(command, env.ctx, item.value)}
            >
              {renderIcon(env, item.icon)}
              {item.labelKey ? (
                <span className="mrib-row-label">{env.t(item.labelKey)}</span>
              ) : null}
            </button>
          ))}
        </div>
      )
    default:
      // combobox / number / colorpicker / custom: no mobile presentation yet —
      // keep the slot visible but inert rather than dropping it silently.
      return (
        <button className="mrib-row" disabled>
          <span className="mrib-row-label" data-mrib-unsupported={control.kind}>
            {'labelKey' in control ? env.t(control.labelKey) : control.id}
          </span>
        </button>
      )
  }
}

function renderIcon<TState, TServices>(
  env: RibbonEnv<TState, TServices>,
  name: string | undefined,
): ReactNode {
  if (!name) return null
  return env.icons[name] ?? null
}
