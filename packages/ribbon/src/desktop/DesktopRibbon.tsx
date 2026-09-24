/**
 * DesktopRibbon: the schema-driven desktop renderer. Emits the exact chrome the
 * legacy hand-written ribbon used — `.ribbon` root, `.ribbon-tabs` strip with
 * the mac/win/in-tab variants, file-tab dropdown, plain appended contextual
 * tabs, `.ribbon-body` with `.ribbon-group` / `.ribbon-sep` layout — so the
 * existing per-app stylesheet styles it unchanged.
 *
 * Enablement: the optional `disabledWhen` prop is ANDed with each group's
 * `disabledWhen` and each command's `isEnabled` (see controls.tsx).
 *
 * Adaptation (M2, WPS 连续 spaceHint 模型): for schema-group tabs the body is
 * measured after every render (ResizeObserver + layout effect); on overflow
 * stage 1 hides label text of controls whose canHideText allows it, stage ≥2
 * collapses groups into their name buttons right-to-left (WPS 终态兜底) — the
 * name button reopens the original layout in a panel. renderBody-hosted tabs
 * manage their own layout and are excluded from the loop.
 */
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
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
import { planCollapse } from './adaptive'
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
  /**
   * Body-only mode (mobile 换装桥 / strangler hosting): render just the active
   * tab body — no strip, no collapse chrome. Tab selection stays with the host.
   */
  readonly bodyOnly?: boolean
  /** Controlled collapse (WPS 80/24 条形态); host owns the preference store. */
  readonly collapsed?: boolean
  readonly onToggleCollapsed?: () => void
  /** 'off' disables the measuring/degradation loop (default 'auto'). */
  readonly adaptation?: 'auto' | 'off'
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
    bodyOnly = false,
    collapsed = false,
    onToggleCollapsed,
    adaptation = 'auto',
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
      <div className={`ribbon${collapsed ? ' ribbon-collapsed' : ''}`}>
        {!bodyOnly && (
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
        )}
        {!bodyOnly && onToggleCollapsed && (
          <button
            type="button"
            className="ribbon-collapse-btn"
            aria-label={collapsed ? t('ribbonExpandTip') : t('ribbonCollapseTip')}
            data-tip={collapsed ? t('ribbonExpandTip') : t('ribbonCollapseTip')}
            onClick={onToggleCollapsed}
          >
            {icons.collapse ?? <CollapseChevron up={collapsed} />}
          </button>
        )}
        <div
          className="ribbon-body"
          style={collapsed && !bodyOnly ? { display: 'none' } : undefined}
        >
          {displayedTab && displayedTab.kind !== 'file' ? (
            <TabBody tab={displayedTab} adaptation={bodyOnly ? 'off' : adaptation} />
          ) : null}
        </div>
      </div>
    </RibbonEnvProvider>
  )
}

function CollapseChevron({ up }: { up: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d={up ? 'M5.5 14.75 12 8.25l6.5 6.5' : 'M5.5 9.25 12 15.75l6.5-6.5'}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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

/** Adaptation stage per tab body: 0 full → 1 text hidden → ≥2 collapse k = stage-1 groups. */
function TabBody<TState, TServices>({
  tab,
  adaptation,
}: {
  tab: RibbonTab<TState, TServices>
  adaptation: 'auto' | 'off'
}) {
  const env = useRibbonEnv<TState, TServices>()
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [stage, setStage] = useState(0)
  const stageRef = useRef(stage)
  stageRef.current = stage
  // 实测档宽记忆：回退只在「上一档实测宽度放得下」时发生——相邻档宽度差
  // 可远大于任何固定滞回，固定阈值回退会在窗口宽度落在「本档溢出、
  // 上一档大富余」的区间时无限振荡（React 更新循环白屏）。
  const stageWidths = useRef<number[]>([])

  const groups = tab.renderBody
    ? []
    : tab.groups.filter((group) => evaluateWhen(group.when, env.ctx.state))
  const applicable = adaptation === 'auto' && !tab.renderBody && groups.length > 0

  const measure = () => {
    const el = bodyRef.current
    if (!el) return
    if (!applicable) {
      if (stageRef.current !== 0) setStage(0)
      return
    }
    const overflow = el.scrollWidth > el.clientWidth + 1
    if (overflow) {
      if (stageRef.current === 0) {
        setStage(1)
        return
      }
      const widths = [...el.querySelectorAll<HTMLElement>('.ribbon-group')].map(
        (node) => node.offsetWidth,
      )
      if (widths.length === 0) return
      const { collapseFromRight } = planCollapse(widths, widths, el.clientWidth)
      const target = 1 + collapseFromRight
      if (target !== stageRef.current) setStage(target)
    } else {
      stageWidths.current[stageRef.current] = el.scrollWidth
      const prev = stageRef.current - 1
      const prevW = stageWidths.current[prev]
      if (prev >= 0 && prevW !== undefined && prevW <= el.clientWidth) {
        setStage(prev)
      }
    }
  }

  useLayoutEffect(measure)
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => measure())
    if (bodyRef.current) ro.observe(bodyRef.current)
    return () => ro.disconnect()
    // measure closes over the current stage via stageRef
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicable])

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
  const hideText = stage >= 1
  const collapseCount = Math.max(0, stage - 1)
  return (
    <div className="ribbon-body-row" ref={bodyRef}>
      {groups.map((group, index) => {
        const collapsed = index >= groups.length - collapseCount
        return (
          <Fragment key={group.id}>
            {index > 0 ? <div className="ribbon-sep" /> : null}
            {collapsed ? (
              <CollapsedGroup group={group} />
            ) : (
              <GroupView group={group} hideText={hideText} />
            )}
          </Fragment>
        )
      })}
    </div>
  )
}

/** Group items at their declared form, inside a scoped hideText env. */
function GroupItems<TState, TServices>({
  group,
  hideText,
}: {
  group: RibbonGroup<TState, TServices>
  hideText: boolean
}) {
  const env = useRibbonEnv<TState, TServices>()
  const groupDisabled =
    group.disabledWhen !== undefined && evaluateWhen(group.disabledWhen, env.ctx.state)
  const scopedEnv = useMemo<RibbonEnv<TState, TServices>>(
    () => ({ ...env, hideText }),
    // env identity changes with dropdown/state churn; hideText is the semantic input
    [env, hideText],
  )
  return (
    <RibbonEnvProvider value={scopedEnv}>
      <div
        className={group.className ? `ribbon-group-items ${group.className}` : 'ribbon-group-items'}
        style={group.layout === 'column' ? { flexDirection: 'column' } : undefined}
      >
        {group.controls.map((control) => (
          <ControlView key={control.id} control={control} groupDisabled={groupDisabled} />
        ))}
      </div>
    </RibbonEnvProvider>
  )
}

function GroupView<TState, TServices>({
  group,
  hideText,
}: {
  group: RibbonGroup<TState, TServices>
  hideText: boolean
}) {
  const env = useRibbonEnv<TState, TServices>()
  return (
    <div className="ribbon-group">
      <GroupItems group={group} hideText={hideText} />
      <div className="ribbon-group-label">{env.t(group.labelKey)}</div>
    </div>
  )
}

/** WPS 终态兜底: the group folds into its name button; clicking reopens the
 * original layout in a panel. */
function CollapsedGroup<TState, TServices>({ group }: { group: RibbonGroup<TState, TServices> }) {
  const env = useRibbonEnv<TState, TServices>()
  const openId = `group:${group.id}`
  const open = env.dropdown.isOpen(openId)
  return (
    <div className="ribbon-group ribbon-group-collapsed">
      <button
        className={`ribbon-group-name ${open ? 'active' : ''}`}
        onClick={() => env.dropdown.toggle(openId)}
      >
        {env.t(group.labelKey)}
      </button>
      {open ? (
        <div data-rb-panel="" className="ribbon-group-panel">
          <GroupItems group={group} hideText={false} />
        </div>
      ) : null}
    </div>
  )
}
