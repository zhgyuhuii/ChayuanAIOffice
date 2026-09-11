/**
 * 统一的「菜单式功能钮」组件（用户 2026-09-11 裁定：所有下拉菜单式按钮
 * 统一规范成一个组件统一引用）：
 *
 * - 定位引擎 placeDrop：锚点矩形 + 视口翻转（右缘右对齐/下缘上翻），
 *   子菜单按同一规则贴行右侧展开、装不下翻左侧、纵向钳制——右键菜单式，
 *   彻底替代 CSS anchor 定位的偏移与 flip-inline 单一策略。
 * - 面板 portal 到 body、fixed 定位：任何一层的子菜单都不再被
 *   父面板的 max-height/overflow 滚动裁剪，可无限级向下展开。
 * - 行结构/类名与 MenuRows 同款（menu-opt-icon/menu-opt-text/submenu-host），
 *   样式与既有菜单完全一致。
 * - useCompactWhenOverflow：WPS 式宽度自适应——内容放不下整行大钮时降级
 *   紧凑形态（图标变小、一列两钮），窗口变宽到能容纳大钮再回退。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useDismissablePopover } from '@chatoffice/ui/popover-dismiss'
import { CaretIcon, RIBBON_GLYPH_ICONS } from './ribbon-icons'

export interface MenuOption {
  readonly value: string
  readonly label: string
  readonly icon?: ReactNode
  readonly disabled?: boolean
  readonly tip?: string
  readonly children?: readonly MenuOption[]
  readonly sep?: boolean
}

interface Rect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** 与 ExcelShell 的 ToolSymbol 同款（glyph 表来自共享 ribbon-icons）。 */
function ToolSymbol({ symbol }: { readonly symbol: string }): React.JSX.Element {
  return (
    <span className="tool-symbol" aria-hidden="true">
      {RIBBON_GLYPH_ICONS[symbol] ?? symbol}
    </span>
  )
}

/** 与 ExcelShell 的同名 hook 同款（Escape 收起）。 */
function useEscapeClose(open: boolean, close: () => void): void {
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
}

interface Placement {
  readonly left: number
  readonly top: number
  readonly maxHeight: number | null
}

const MARGIN = 8

/// 右键菜单式放置：优先锚点下方左对齐；右缘出界改右对齐锚点；
/// 下缘出界翻到锚点上方；仍放不下则钳到视口内并给出内部滚动上限。
export function placeDrop(
  anchor: Rect,
  size: { w: number; h: number },
  vw: number,
  vh: number,
  gap = 4,
): Placement {
  let left = anchor.x
  if (left + size.w > vw - MARGIN) left = anchor.x + anchor.w - size.w
  if (left + size.w > vw - MARGIN) left = vw - MARGIN - size.w
  if (left < MARGIN) left = MARGIN
  let top = anchor.y + anchor.h + gap
  let maxHeight: number | null = null
  if (top + size.h > vh - MARGIN) {
    top = anchor.y - size.h - gap
    if (top < MARGIN) {
      top = MARGIN
      maxHeight = Math.max(vh - MARGIN * 2, 120)
    }
  }
  return { left: Math.round(left), top: Math.round(top), maxHeight }
}

/// 子菜单放置：优先宿主行右侧外 2px、顶对齐；右缘出界翻到行左侧；
/// 纵向钳制在视口内（行本身可能贴近视口顶/底）。
export function placeSubmenu(
  row: Rect,
  size: { w: number; h: number },
  vw: number,
  vh: number,
): Placement {
  let left = row.x + row.w + 2
  if (left + size.w > vw - MARGIN) left = row.x - size.w - 2
  if (left < MARGIN) left = MARGIN
  let top = row.y - 5
  let maxHeight: number | null = null
  if (top + size.h > vh - MARGIN) top = vh - MARGIN - size.h
  if (top < MARGIN) {
    top = MARGIN
    maxHeight = Math.max(vh - MARGIN * 2, 120)
  }
  return { left: Math.round(left), top: Math.round(top), maxHeight }
}

interface Placed {
  readonly left: number
  readonly top: number
  readonly maxHeight: number | null
  readonly placed: boolean
}

/// 渲染后实测面板尺寸→放置（首帧 visibility:hidden 防闪位）。
/// 触发元素或内容尺寸变化、窗口 resize 时重算；resize 直接收起（WPS 同款）。
function usePlacement(
  open: boolean,
  getAnchor: () => Rect | null | undefined,
  mode: 'below' | 'right',
): [React.RefCallback<HTMLElement>, Placed] {
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [placed, setPlaced] = useState<Placed>({ left: 0, top: 0, maxHeight: null, placed: false })
  const reflow = useCallback(() => {
    if (!el || !open) return
    const anchor = getAnchor()
    if (!anchor) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const p =
      mode === 'below'
        ? placeDrop(anchor, { w, h }, window.innerWidth, window.innerHeight)
        : placeSubmenu(anchor, { w, h }, window.innerWidth, window.innerHeight)
    setPlaced({ ...p, placed: true })
  }, [el, open, getAnchor, mode])
  useLayoutEffect(() => {
    reflow()
  }, [reflow])
  useEffect(() => {
    if (!open || !el) return
    const onResize = () => reflow()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [open, el, reflow])
  const ref = useCallback((node: HTMLElement | null) => setEl(node), [])
  return [ref, placed]
}

const rectOf = (el: HTMLElement | null | undefined): Rect | null => {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width, h: r.height }
}

/** 行渲染：与 MenuRows 同款 DOM/类名；子菜单 fixed 放置、无限级。 */
function MenuDropRows({
  options,
  value,
  onPick,
  onClose,
}: {
  readonly options: readonly MenuOption[]
  readonly value: string
  readonly onPick: (value: string) => void
  readonly onClose: () => void
}): React.JSX.Element {
  const [openSub, setOpenSub] = useState<string | null>(null)
  const [subAnchor, setSubAnchor] = useState<HTMLElement | null>(null)
  const getSubAnchor = useCallback(() => rectOf(subAnchor), [subAnchor])
  const [subRef, subPlaced] = usePlacement(openSub !== null, getSubAnchor, 'right')
  const subOptions =
    openSub !== null ? options.find((o) => o.value === openSub)?.children : undefined
  return (
    <>
      {options.map((option) =>
        option.children ? (
          <div
            key={option.value}
            ref={(node) => {
              if (node && openSub === option.value) setSubAnchor(node)
            }}
            className={`submenu-host${openSub === option.value ? ' submenu-open' : ''}`}
            onMouseEnter={(event) => {
              setOpenSub(option.value)
              setSubAnchor(event.currentTarget)
            }}
            onMouseLeave={() =>
              setOpenSub((current) => (current === option.value ? null : current))
            }
          >
            <button type="button" role="option" aria-haspopup="true" className="has-submenu">
              {option.icon != null && (
                <span className="menu-opt-icon" aria-hidden="true">
                  {option.icon}
                </span>
              )}
              <span className="menu-opt-text">{option.label}</span>
              <span className="submenu-arrow" aria-hidden="true">
                ›
              </span>
            </button>
            {openSub === option.value && subOptions && (
              <div
                ref={subRef}
                role="menu"
                aria-label={option.label}
                className="submenu-drop is-fixed"
                style={
                  subPlaced.placed
                    ? {
                        position: 'fixed',
                        left: subPlaced.left,
                        top: subPlaced.top,
                        maxHeight: subPlaced.maxHeight ?? undefined,
                        visibility: 'visible',
                      }
                    : { position: 'fixed', visibility: 'hidden' }
                }
              >
                <MenuDropRows
                  options={subOptions}
                  value={value}
                  onPick={onPick}
                  onClose={onClose}
                />
              </div>
            )}
          </div>
        ) : (
          <button
            type="button"
            key={option.value}
            role="option"
            aria-selected={value !== '' && option.value === value}
            aria-disabled={option.disabled || undefined}
            className={`${value !== '' && option.value === value ? 'on' : ''}${
              option.sep ? ' sep-above' : ''
            }`}
            title={option.tip}
            disabled={option.disabled}
            onClick={() => {
              onClose()
              onPick(option.value)
            }}
          >
            {option.icon != null && (
              <span className="menu-opt-icon" aria-hidden="true">
                {option.icon}
              </span>
            )}
            <span className="menu-opt-text">{option.label}</span>
          </button>
        ),
      )}
    </>
  )
}

/**
 * 统一菜单钮：variant='big' 竖排大钮（图标上/文字下/caret），'compact'
 * 横排紧凑钮（图标左/文字右/caret，图标自动变小）。面板 portal 到 body
 * 走 placeDrop 定位；子菜单 placeSubmenu 同规则无限级级联。
 */
export function RibbonMenuButton({
  label,
  tip,
  symbol,
  options,
  onPick,
  variant = 'big',
}: {
  readonly label: string
  readonly tip: string
  readonly symbol: string
  readonly options: readonly MenuOption[]
  readonly onPick: (value: string) => void
  readonly variant?: 'big' | 'compact' | 'name'
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const portalRef = useRef<HTMLDivElement>(null)
  const getAnchor = useCallback(() => rectOf(wrapRef.current), [])
  const [panelRef, placed] = usePlacement(open, getAnchor, 'below')
  useDismissablePopover(open, () => setOpen(false), {
    inside: () => [wrapRef.current, portalRef.current],
  })
  useEscapeClose(open, () => setOpen(false))
  useEffect(() => {
    if (!open) return
    const onResize = () => setOpen(false)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [open])
  const pick = (value: string): void => {
    setOpen(false)
    onPick(value)
  }
  return (
    <div
      ref={wrapRef}
      className={`ribbon-tool large as-button${
        variant === 'compact' ? ' menu-btn-compact' : ''
      }${variant === 'name' ? ' menu-btn-name' : ''}`}
      data-tip={tip}
    >
      {variant !== 'name' && (
        <span className="tool-icon-row">
          <ToolSymbol symbol={symbol} />
          {variant === 'big' && <CaretIcon />}
        </span>
      )}
      <span>
        <strong>{label}</strong>
      </span>
      {variant !== 'big' && <CaretIcon />}
      {open &&
        createPortal(
          <div ref={portalRef}>
            <div
              ref={panelRef}
              role="listbox"
              aria-label={label}
              className="menu-select-drop is-portal"
              style={
                placed.placed
                  ? {
                      left: placed.left,
                      top: placed.top,
                      maxHeight: placed.maxHeight ?? undefined,
                      visibility: 'visible',
                    }
                  : { visibility: 'hidden' }
              }
            >
              <MenuDropRows
                options={options}
                value=""
                onPick={pick}
                onClose={() => setOpen(false)}
              />
            </div>
          </div>,
          document.body,
        )}
      <button
        type="button"
        className="cover-select"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      />
    </div>
  )
}

/// WPS 式多级宽度降级（用户 2026-09-11 裁定的完整阶梯）：
/// 0=平铺大钮 → 1=一列两行 → 2=一列三行 → 3=分组名钮平铺 → 4=单个分组钮。
/// 测量驱动迭代循环（与 packages/ribbon DesktopRibbon 引擎同款）：每轮渲染
/// 实测滚动容器横向溢出，仍溢出升一级、富余 >28px 降一级（滞回防振荡），
/// 直到收敛。stage 由调用方映射为形态。
export function useRibbonDegradeStage(
  ref: React.RefObject<HTMLElement | null>,
  maxStage = 4,
): number {
  const [stage, setStage] = useState(0)
  const stageRef = useRef(stage)
  stageRef.current = stage
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const scroller = el.closest('.ribbon')
    const group = el.closest('.ribbon-group')
    const measure = () => {
      if (!scroller) return
      // 本组的可用宽 = 功能区带内宽 −（兄弟组 + 分隔线 + 内边距）。
      // 别的组还没接入降级时它们的溢出不应把本组推到最深层。
      let avail = scroller.clientWidth - 24
      if (group && scroller !== group) {
        for (const child of scroller.children) {
          if (child === group) continue
          avail -= child.getBoundingClientRect().width + 9
        }
      }
      avail = Math.max(avail, 80)
      const natural = el.scrollWidth
      if (natural > avail + 1) {
        if (stageRef.current < maxStage) setStage(stageRef.current + 1)
      } else if (stageRef.current > 0 && avail - natural > 28) {
        setStage(stageRef.current - 1)
      }
    }
    const ro = new ResizeObserver(measure)
    if (scroller) ro.observe(scroller)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  })
  return stage
}
