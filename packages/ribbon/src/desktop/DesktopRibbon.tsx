/**
 * DesktopRibbon: the schema-driven desktop renderer. Emits the exact chrome the
 * legacy hand-written ribbon used — `.ribbon` root, `.ribbon-tabs` strip with
 * the mac/win/in-tab variants, file-tab dropdown, plain appended contextual
 * tabs, `.ribbon-body` with `.ribbon-group` / `.ribbon-sep` layout — so the
 * existing per-app stylesheet styles it unchanged.
 *
 * Enablement: the optional `disabledWhen` prop is ANDed with each group's
 * `disabledWhen` and each command's `isEnabled` (see controls.tsx).
 */
import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { useDismissablePopover } from '@chatoffice/ui/popover-dismiss'
import type { CommandRegistry } from '../command/registry'
import type {
  RibbonDropdownApi,
  RibbonGroup,
  RibbonSchema,
  RibbonTab,
  RibbonTranslate,
} from '../schema/types'
import { evaluateWhen, type When } from '../schema/when'
import { RibbonEnvProvider, useRibbonEnv, type RibbonEnv, type RibbonIconMap } from './env'
import { ControlView } from './controls'
import { useRibbonTabs } from './use-ribbon-tabs'

export interface DesktopRibbonProps<TState = unknown, TServices = unknown> {
  readonly schema: RibbonSchema<TState, TServices>
  readonly registry: CommandRegistry<TState, TServices>
  readonly state: TState
  readonly services: TServices
  readonly t: RibbonTranslate
  /** Icon registry; `caret` overrides the built-in chevron. */
  readonly icons?: RibbonIconMap
  /** Tab-strip chrome variant (default 'win'). */
  readonly platform?: 'win' | 'mac'
  /** Inside a tabbed shell: skip the platform window-drag classes. */
  readonly inTab?: boolean
  /** Renderer-level disabled gate, ANDed with group/command gates. */
  readonly disabledWhen?: When<TState>
  /** Controlled mode; omit both for uncontrolled with `defaultTab`. */
  readonly activeTab?: string
  readonly defaultTab?: string
  readonly onTabChange?: (tabId: string) => void
  /** Slot between the file tab and the regular tabs (quick-access toolbar). */
  readonly quickActions?: ReactNode
  /** Slot after the spacer (window controls etc.). */
  readonly trailingActions?: ReactNode
}

export function DesktopRibbon<TState, TServices>(props: DesktopRibbonProps<TState, TServices>) {
  const {
    schema,
    registry,
    state,
    services,
    t,
    icons = {},
    platform = 'win',
    inTab = false,
    disabledWhen,
    quickActions,
    trailingActions,
  } = props

  const ctx = useMemo(() => ({ state, services }), [state, services])
  const [openId, setOpenId] = useState<string | null>(null)
  const dropdown = useMemo<RibbonDropdownApi>(
    () => ({
      openId,
      isOpen: (id) => openId === id,
      toggle: (id) => setOpenId((current) => (current === id ? null : id)),
      open: (id) => setOpenId(id),
      close: () => setOpenId(null),
    }),
    [openId],
  )
  // Unified dismissal: outside press / window blur / shell chrome press close
  // the open panel. The panel's own wrap counts as inside, so the trigger's
  // toggle (not the outside-press guard) handles re-clicks.
  useDismissablePopover(openId != null, dropdown.close, {
    inside: () =>
      Array.from(document.querySelectorAll('[data-rb-panel]')).flatMap((panel) => [
        panel,
        panel.parentElement,
      ]),
  })

  const machine = useRibbonTabs(schema, state, {
    activeTab: props.activeTab,
    defaultTab: props.defaultTab,
    onTabChange: props.onTabChange,
  })

  const env: RibbonEnv<TState, TServices> = {
    registry,
    ctx,
    t,
    icons,
    globalDisabled: disabledWhen !== undefined && evaluateWhen(disabledWhen, state),
    dropdown,
  }

  const regularTabs = schema.tabs.filter(
    (tab) => tab.kind === 'regular' && evaluateWhen(tab.when, state),
  )
  const contextualTabs = schema.tabs.filter(
    (tab) => tab.kind === 'contextual' && evaluateWhen(tab.contextWhen, state),
  )
  const fileTabs = schema.tabs.filter((tab) => tab.kind === 'file')
  const displayedTab = schema.tabs.find((tab) => tab.id === machine.displayed)

  const tabButton = (tab: RibbonTab<TState, TServices>) => (
    <button
      key={tab.id}
      className={`ribbon-tab ${machine.displayed === tab.id ? 'active' : ''}`}
      onClick={() => {
        machine.select(tab.id)
        dropdown.close()
      }}
    >
      {t(tab.labelKey)}
    </button>
  )

  return (
    <RibbonEnvProvider value={env}>
      <div className="ribbon">
        <div
          className={`ribbon-tabs ${inTab ? '' : platform === 'mac' ? 'ribbon-tabs-mac' : 'ribbon-tabs-win'}`}
        >
          {platform !== 'mac' && fileTabs.map((tab) => <FileTabView key={tab.id} tab={tab} />)}
          {quickActions}
          {regularTabs.map(tabButton)}
          {contextualTabs.map(tabButton)}
          <span className="ribbon-tabs-spacer" />
          {trailingActions}
        </div>
        <div className="ribbon-body">
          {displayedTab && displayedTab.kind !== 'file' ? <TabBody tab={displayedTab} /> : null}
        </div>
      </div>
    </RibbonEnvProvider>
  )
}

function FileTabView<TState, TServices>({ tab }: { tab: RibbonTab<TState, TServices> }) {
  const env = useRibbonEnv<TState, TServices>()
  const openId = `file:${tab.id}`
  const open = env.dropdown.isOpen(openId)
  return (
    <div className="file-tab-wrap">
      <button
        className={`ribbon-tab ribbon-tab-file ${open ? 'open' : ''}`}
        onClick={() => env.dropdown.toggle(openId)}
      >
        {env.t(tab.labelKey)}
      </button>
      {open && (
        <div data-rb-panel="" className="file-menu">
          {(tab.menu ?? []).map((item) => {
            if (item.kind === 'separator') return null
            const disabled =
              env.globalDisabled ||
              (item.disabledWhen !== undefined && evaluateWhen(item.disabledWhen, env.ctx.state)) ||
              (item.command ? !env.registry.isEnabled(item.command, env.ctx) : false)
            return (
              <button
                key={item.id}
                disabled={disabled}
                onClick={() => {
                  env.dropdown.close()
                  if (item.command) env.registry.execute(item.command, env.ctx, item.args)
                }}
              >
                {env.t(item.labelKey)}
                {item.shortcut ? <span className="file-menu-key">{item.shortcut}</span> : null}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function TabBody<TState, TServices>({ tab }: { tab: RibbonTab<TState, TServices> }) {
  const env = useRibbonEnv<TState, TServices>()
  if (tab.renderBody) {
    return (
      <>
        {tab.renderBody({
          state: env.ctx.state,
          services: env.ctx.services,
          t: env.t,
          dropdown: env.dropdown,
        })}
      </>
    )
  }
  const groups = tab.groups.filter((group) => evaluateWhen(group.when, env.ctx.state))
  return (
    <>
      {groups.map((group, index) => (
        <Fragment key={group.id}>
          {index > 0 ? <div className="ribbon-sep" /> : null}
          <GroupView group={group} />
        </Fragment>
      ))}
    </>
  )
}

function GroupView<TState, TServices>({ group }: { group: RibbonGroup<TState, TServices> }) {
  const env = useRibbonEnv<TState, TServices>()
  const groupDisabled =
    group.disabledWhen !== undefined && evaluateWhen(group.disabledWhen, env.ctx.state)
  return (
    <div className="ribbon-group">
      <div
        className={group.className ? `ribbon-group-items ${group.className}` : 'ribbon-group-items'}
        style={group.layout === 'column' ? { flexDirection: 'column' } : undefined}
      >
        {group.controls.map((control) => (
          <ControlView key={control.id} control={control} groupDisabled={groupDisabled} />
        ))}
      </div>
      <div className="ribbon-group-label">{env.t(group.labelKey)}</div>
    </div>
  )
}
