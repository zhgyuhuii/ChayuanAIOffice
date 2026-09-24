/**
 * Ribbon: tab bar + grouped buttons. Same mechanism as the apps/docs Ribbon
 * (local state switches tabs, .ribbon-body dispatches); content is trimmed to slide capabilities,
 * unimplemented items are grayed placeholders.
 */
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type {
  AnimEffectKind,
  GradientFillSpec,
  TransitionKind,
  TransitionSoundKey,
  TransitionSpec,
} from '../../shared/ipc'
import type { ChartStyleInfo } from '@chatoffice/pptx-render'
import {
  useDismissablePopover,
  useRibbonCollapse,
  Dropdown,
  RibbonCollapseButton,
  THEME_COLORS,
  THEME_COLOR_SHADES,
  STANDARD_COLORS,
} from '@chatoffice/ui'
import { getRecentColors, pushRecentColor } from '../recent-colors'
import { ICON_COLORS } from '../insert-presets'
import { THEME_PRESETS, type SlideThemePreset } from '../themes'
import { restoreEditSelection } from '../TextEditOverlay'
import { armColorInput, toPickerHex } from '../color-input'
import { TABLE_SHADING_COLORS } from './table-shading-colors'
import { TabStripArrows, useTabStripOverflow } from '@chatoffice/ribbon'
import { useI18n, type StringKey } from '../i18n/locale'
import {
  IconSlideMaster,
  IconBullets,
  IconArrangeAll,
  IconComment,
  IconCursor,
  IconCustomShow,
  IconEraser,
  IconHideSlide,
  IconNavPane,
  IconOutlineView,
  IconPageColor,
  IconApplyAll,
  IconPageSize,
  IconAnimBrush,
  IconPlayCurrent,
  IconPlayFromStart,
  IconPresenterView,
  IconPrintLayout,
  IconReadMode,
  IconRecord,
  IconPicture,
  IconRemoveBg,
  IconRedo,
  IconRehearse,
  IconCountdown,
  IconSave,
  IconSetupShow,
  IconSparkle,
  IconUndo,
  IconFitWindow,
  IconZoom100,
  IconZoomIn,
  IconZoomOut,
  IconSwitchRowCol,
  IconEditChartData,
  IconChangeChartType,
  AnimEffectIcon,
  IconTransNone,
  IconTransMorph,
  IconTransFade,
  IconTransPush,
  IconTransWipe,
  IconTransSplit,
  IconTransCircle,
  IconTransCover,
  IconTransPull,
  IconTransDissolve,
  IconTransZoom,
  IconTransRandom,
  IconTransBlinds,
  IconTransChecker,
  IconTransComb,
  IconTransCut,
  IconTransDiamond,
  IconTransNewsflash,
  IconTransPlus,
  IconTransRandomBar,
  IconTransStrips,
  IconTransWedge,
  IconTransWheel,
  IconTransRipple,
  IconTransGlitter,
  IconTransVortex,
  IconTransDoors,
  IconTransWindowK,
  IconTransHoneycomb,
  IconTransFlash,
  IconTransFerris,
  IconTransGallery,
  IconTransConveyor,
  IconAnimNone,
  IconPageBorders,
  IconNoneX,
  IconPathRight,
  IconPathDown,
  IconPathDiagonal,
  IconPathCircle,
  IconPathZigzag,
  IconShapes,
  IconShapeStyle,
  IconFillColor,
  IconEffectOptions,
  IconSound,
  IconReplacePicture,
  IconRotateRight,
  IconRotateLeft,
  IconObjFlipH,
  IconObjFlipV, } from './icons'
// brand-supplied Review AI icon art (44px = 22px @2x), color baked in
import iconSpelling from '../assets/icon-spelling.png'
import iconTranslate from '../assets/icon-translate.png'
import iconTransparency from '../assets/icon-transparency.png'
import texPaper from '../assets/textures/paper.png'
import texCanvas from '../assets/textures/canvas.png'
import texWood from '../assets/textures/wood.png'
import texMarble from '../assets/textures/marble.png'
import texGranite from '../assets/textures/granite.png'
import texDenim from '../assets/textures/denim.png'
import texCork from '../assets/textures/cork.png'
import texParchment from '../assets/textures/parchment.png'
import iconCrop from '../assets/icon-crop.png'
import { ChartTypeDialog } from './ChartTypeDialog'
import { AiPanelToggle } from '@chatoffice/ui'
import {
  BIG,
  Group,
  RbCaret,
  RIBBON_SHAPE_STYLES,
  closeSiblingPanels,
  type Props,
  type RibbonPanelKey,
  type RibbonTabCtx,
} from './ribbon-shared'
export type { FormatCmd, SlidesViewMode } from './ribbon-shared'
import type { FormatCmd } from './ribbon-shared'
import { RibbonHomeTab } from './RibbonHomeTab'
import { RibbonInsertTab } from './RibbonInsertTab'
import { ShapeGalleryContent } from './ShapeGalleryPopover'
import { autoContextTabForElement, contextTabForElement, type ContextTab } from './context-tabs'

const IS_MAC = navigator.platform.toLowerCase().includes('mac')
/** shell tab mode: the tab strip above owns traffic lights / caption buttons */
const IN_TAB = new URLSearchParams(window.location.search).get('mode') === 'tab'

type MainTab =
  | 'file'
  | 'home'
  | 'insert'
  | 'draw'
  | 'design'
  | 'transitions'
  | 'animations'
  | 'slideShow'
  | 'review'
  | 'view'

// Mac has no "File" tab (file operations go through the native menu), Windows does
const TABS: readonly MainTab[] = IS_MAC
  ? ['home', 'insert', 'draw', 'design', 'transitions', 'animations', 'slideShow', 'review', 'view']
  : [
      'file',
      'home',
      'insert',
      'draw',
      'design',
      'transitions',
      'animations',
      'slideShow',
      'review',
      'view',
    ]

const TAB_LABEL: Record<MainTab | ContextTab, StringKey> = {
  file: 'ribbonTabFile',
  home: 'ribbonTabHome',
  insert: 'ribbonTabInsert',
  draw: 'ribbonTabDraw',
  design: 'ribbonTabDesign',
  transitions: 'ribbonTabTransitions',
  animations: 'ribbonTabAnimations',
  slideShow: 'ribbonTabSlideShow',
  review: 'ribbonTabReview',
  view: 'ribbonTabView',
  tableDesign: 'ribbonTabTableDesign',
  chartDesign: 'ribbonTabChartDesign',
  pictureFormat: 'ribbonTabPictureFormat',
  shapeFormat: 'ribbonTabShapeFormat',
}

// display names only — tp.name stays as written into theme*.xml
const THEME_NAME: Record<string, StringKey> = {
  office: 'ribbonThemeOffice',
  ember: 'ribbonThemeEmber',
  indigo: 'ribbonThemeIndigo',
  forest: 'ribbonThemeForest',
  cream: 'ribbonThemeCream',
  rose: 'ribbonThemeRose',
  graphite: 'ribbonThemeGraphite',
  midnight: 'ribbonThemeMidnight',
}
const themeDisplayName = (tp: SlideThemePreset, t: (key: StringKey) => string): string =>
  THEME_NAME[tp.id] ? t(THEME_NAME[tp.id]) : tp.name

/** Translation target languages (for AI proofread/translate presets) */
const TRANSLATE_TARGETS: StringKey[] = [
  'ribbonLangEnglish',
  'ribbonLangSimplifiedChinese',
  'ribbonLangTraditionalChinese',
  'ribbonLangJapanese',
  'ribbonLangKorean',
  'ribbonLangFrench',
  'ribbonLangGerman',
  'ribbonLangSpanish',
]

/** One-time "AI rewrites the whole document" acknowledgement */
const AI_REWRITE_ACK_KEY = 'slides-ai-rewrite-ack'

// Draw tab palettes/pen widths (same as apps/docs DrawTab)
const INK_COLORS = [
  '000000',
  'C00000',
  'FF0000',
  'FFC000',
  'FFFF00',
  '92D050',
  '00B050',
  '00B0F0',
  '0070C0',
  '7030A0',
]
const PEN_WIDTHS = [1, 2, 3.5, 5]
const HIGHLIGHTER_WIDTHS = [6, 10, 16]

/** Draw-tab pen gallery presets (tray of ready pens) */
interface PenPreset {
  kind: 'pen' | 'highlighter'
  color: string
  width: number
}

const DEFAULT_PEN_PRESETS: PenPreset[] = [
  { kind: 'pen', color: '000000', width: 2 },
  { kind: 'pen', color: 'FF0000', width: 2 },
  { kind: 'pen', color: '0070C0', width: 2 },
  { kind: 'highlighter', color: 'FFFF00', width: 10 },
  { kind: 'highlighter', color: '00B050', width: 10 },
]

/** Pen thumbnail hanging tip-down in the tray */
function PenThumb({ kind, color }: { kind: PenPreset['kind']; color: string }) {
  const c = `#${color}`
  return kind === 'pen' ? (
    <svg width="24" height="56" viewBox="0 0 24 56" aria-hidden="true">
      <rect x="5" y="0" width="14" height="34" rx="2.5" fill={c} />
      <path d="M5 34h14l-3.5 8h-7Z" fill={c} opacity="0.85" />
      <rect x="8.6" y="41" width="6.8" height="3.4" rx="1.2" fill="#fff" opacity="0.9" />
      <path d="M8.5 44.5h7L12 55Z" fill={c} />
    </svg>
  ) : (
    <svg width="26" height="56" viewBox="0 0 26 56" aria-hidden="true">
      <rect x="3" y="0" width="20" height="36" rx="2.5" fill={c} />
      <path d="M6 36h14l-2.5 9h-8Z" fill={c} opacity="0.8" />
      <path d="M9 45h8l-1.5 8h-5Z" fill={c} />
    </svg>
  )
}

const TRANSITIONS: Array<{ kind: TransitionKind; label: StringKey; icon: React.ReactElement }> = [
  { kind: 'none', label: 'ribbonNone', icon: <IconTransNone size={BIG} /> },
  { kind: 'morph', label: 'ribbonTransMorph', icon: <IconTransMorph size={BIG} /> },
  { kind: 'fade', label: 'ribbonTransFade', icon: <IconTransFade size={BIG} /> },
  { kind: 'push', label: 'ribbonTransPush', icon: <IconTransPush size={BIG} /> },
  { kind: 'wipe', label: 'ribbonTransWipe', icon: <IconTransWipe size={BIG} /> },
  { kind: 'split', label: 'ribbonTransSplit', icon: <IconTransSplit size={BIG} /> },
  { kind: 'circle', label: 'ribbonTransCircle', icon: <IconTransCircle size={BIG} /> },
  { kind: 'cover', label: 'ribbonTransCover', icon: <IconTransCover size={BIG} /> },
  { kind: 'pull', label: 'ribbonTransPull', icon: <IconTransPull size={BIG} /> },
  { kind: 'dissolve', label: 'ribbonTransDissolve', icon: <IconTransDissolve size={BIG} /> },
  { kind: 'zoom', label: 'ribbonTransZoom', icon: <IconTransZoom size={BIG} /> },
  { kind: 'random', label: 'ribbonTransRandom', icon: <IconTransRandom size={BIG} /> },
  { kind: 'blinds', label: 'ribbonTransBlinds', icon: <IconTransBlinds size={BIG} /> },
  { kind: 'checker', label: 'ribbonTransChecker', icon: <IconTransChecker size={BIG} /> },
  { kind: 'comb', label: 'ribbonTransComb', icon: <IconTransComb size={BIG} /> },
  { kind: 'cut', label: 'ribbonTransCut', icon: <IconTransCut size={BIG} /> },
  { kind: 'diamond', label: 'ribbonTransDiamond', icon: <IconTransDiamond size={BIG} /> },
  { kind: 'newsflash', label: 'ribbonTransNewsflash', icon: <IconTransNewsflash size={BIG} /> },
  { kind: 'plus', label: 'ribbonTransPlus', icon: <IconTransPlus size={BIG} /> },
  { kind: 'randomBar', label: 'ribbonTransRandomBar', icon: <IconTransRandomBar size={BIG} /> },
  { kind: 'strips', label: 'ribbonTransStrips', icon: <IconTransStrips size={BIG} /> },
  { kind: 'wedge', label: 'ribbonTransWedge', icon: <IconTransWedge size={BIG} /> },
  { kind: 'wheel', label: 'ribbonTransWheel', icon: <IconTransWheel size={BIG} /> },
  { kind: 'ripple', label: 'ribbonTransRipple', icon: <IconTransRipple size={BIG} /> },
  { kind: 'glitter', label: 'ribbonTransGlitter', icon: <IconTransGlitter size={BIG} /> },
  { kind: 'vortex', label: 'ribbonTransVortex', icon: <IconTransVortex size={BIG} /> },
  { kind: 'doors', label: 'ribbonTransDoors', icon: <IconTransDoors size={BIG} /> },
  { kind: 'window', label: 'ribbonTransWindow', icon: <IconTransWindowK size={BIG} /> },
  { kind: 'honeycomb', label: 'ribbonTransHoneycomb', icon: <IconTransHoneycomb size={BIG} /> },
  { kind: 'flash', label: 'ribbonTransFlash', icon: <IconTransFlash size={BIG} /> },
  { kind: 'ferris', label: 'ribbonTransFerris', icon: <IconTransFerris size={BIG} /> },
  { kind: 'gallery', label: 'ribbonTransGallery', icon: <IconTransGallery size={BIG} /> },
  { kind: 'conveyor', label: 'ribbonTransConveyor', icon: <IconTransConveyor size={BIG} /> },
]

/** Animation effect gallery (entrance/emphasis/exit; icons drawn per effect, colored by class). */
const ANIM_EFFECTS: Array<{
  kind: AnimEffectKind
  label: StringKey
  cls: 'entr' | 'emph' | 'exit'
}> = [
  { kind: 'appear', label: 'ribbonAnimAppear', cls: 'entr' },
  { kind: 'fade', label: 'ribbonAnimFade', cls: 'entr' },
  { kind: 'flyIn', label: 'ribbonAnimFlyIn', cls: 'entr' },
  { kind: 'wipe', label: 'ribbonAnimWipe', cls: 'entr' },
  { kind: 'wipeDown', label: 'ribbonAnimWipeDown', cls: 'entr' },
  { kind: 'splitIn', label: 'ribbonAnimSplit', cls: 'entr' },
  { kind: 'bounce', label: 'ribbonAnimBounce', cls: 'entr' },
  { kind: 'flipIn', label: 'ribbonAnimFlip', cls: 'entr' },
  { kind: 'zoom', label: 'ribbonAnimZoom', cls: 'entr' },
  { kind: 'blinds', label: 'ribbonAnimBlinds', cls: 'entr' },
  { kind: 'box', label: 'ribbonAnimBox', cls: 'entr' },
  { kind: 'checkerboard', label: 'ribbonAnimCheckerboard', cls: 'entr' },
  { kind: 'circleIn', label: 'ribbonAnimCircle', cls: 'entr' },
  { kind: 'crawlIn', label: 'ribbonAnimCrawlIn', cls: 'entr' },
  { kind: 'diamond', label: 'ribbonAnimDiamond', cls: 'entr' },
  { kind: 'dissolveIn', label: 'ribbonAnimDissolveIn', cls: 'entr' },
  { kind: 'randomBars', label: 'ribbonAnimRandomBars', cls: 'entr' },
  { kind: 'stretch', label: 'ribbonAnimStretch', cls: 'entr' },
  { kind: 'strips', label: 'ribbonAnimStrips', cls: 'entr' },
  { kind: 'wedge', label: 'ribbonAnimWedge', cls: 'entr' },
  { kind: 'wheel', label: 'ribbonAnimWheel', cls: 'entr' },
  { kind: 'swivel', label: 'ribbonAnimSwivel', cls: 'entr' },
  { kind: 'peekIn', label: 'ribbonAnimPeekIn', cls: 'entr' },
  { kind: 'pulse', label: 'ribbonAnimPulse', cls: 'emph' },
  { kind: 'spin', label: 'ribbonAnimSpin', cls: 'emph' },
  { kind: 'grow', label: 'ribbonAnimGrowShrink', cls: 'emph' },
  { kind: 'teeter', label: 'ribbonAnimTeeter', cls: 'emph' },
  { kind: 'disappear', label: 'ribbonAnimDisappear', cls: 'exit' },
  { kind: 'fadeOut', label: 'ribbonAnimFadeOut', cls: 'exit' },
  { kind: 'flyOut', label: 'ribbonAnimFlyOut', cls: 'exit' },
  { kind: 'wipeOut', label: 'ribbonAnimWipeOut', cls: 'exit' },
  { kind: 'shrink', label: 'ribbonAnimShrinkTurn', cls: 'exit' },
  { kind: 'zoomOut', label: 'ribbonAnimZoomOut', cls: 'exit' },
  { kind: 'boxOut', label: 'ribbonAnimBoxOut', cls: 'exit' },
  { kind: 'checkerboardOut', label: 'ribbonAnimCheckerOut', cls: 'exit' },
  { kind: 'dissolveOut', label: 'ribbonAnimDissolveOut', cls: 'exit' },
  { kind: 'randomBarsOut', label: 'ribbonAnimRandomBarsOut', cls: 'exit' },
]

const ANIM_CLS_TITLE: Record<'entr' | 'emph' | 'exit', StringKey> = {
  entr: 'ribbonAnimEntrance',
  emph: 'ribbonAnimEmphasis',
  exit: 'ribbonAnimExit',
}

/** Motion path presets (path coordinates 0..1 relative to slide size, matching OOXML animMotion). */
const MOTION_PATHS: Array<{ label: StringKey; icon: React.ReactElement; path: string }> = [
  { label: 'ribbonPathLineRight', icon: <IconPathRight size={BIG} />, path: 'M 0 0 L 0.25 0' },
  { label: 'ribbonPathLineDown', icon: <IconPathDown size={BIG} />, path: 'M 0 0 L 0 0.25' },
  { label: 'ribbonPathDiagonal', icon: <IconPathDiagonal size={BIG} />, path: 'M 0 0 L 0.25 0.25' },
  {
    label: 'ribbonPathCircle',
    icon: <IconPathCircle size={BIG} />,
    path:
      'M 0 0 C 0.069 0 0.125 0.056 0.125 0.125 C 0.125 0.194 0.069 0.25 0 0.25 ' +
      'C -0.069 0.25 -0.125 0.194 -0.125 0.125 C -0.125 0.056 -0.069 0 0 0 Z',
  },
  {
    label: 'ribbonPathZigzag',
    icon: <IconPathZigzag size={BIG} />,
    path: 'M 0 0 L 0.12 -0.12 L 0.24 0.12 L 0.36 0',
  },
]

// ── Constants + helper components used by contextual tabs ─────────────────────

/** Mini table thumbnail of a preset style (colors match the engine-side TABLE_STYLE_PRESETS literals) */
function TableMiniPreview({
  header,
  band,
  rowLine,
  gridLine,
  outline,
}: {
  /** Header row background color */
  header?: string
  /** Banded stripe color (rows 2/4) */
  band?: string
  /** Horizontal line color between rows */
  rowLine?: string
  /** All-gridlines color (horizontal + vertical) */
  gridLine?: string
  /** Outer border color */
  outline?: string
}) {
  const W = 44
  const H = 26
  const rows = 4
  const cols = 3
  const rh = H / rows
  const cw = W / cols
  const hLines = [1, 2, 3].map((i) => i * rh)
  const line = gridLine ?? rowLine
  return (
    <svg width={W} height={H} shapeRendering="crispEdges" aria-hidden>
      <rect x={0} y={0} width={W} height={H} fill="#fff" />
      {band &&
        [1, 3].map((r) => <rect key={r} x={0} y={r * rh} width={W} height={rh} fill={band} />)}
      {header && <rect x={0} y={0} width={W} height={rh} fill={header} />}
      {line &&
        hLines.map((y) => (
          <line key={y} x1={0} y1={y} x2={W} y2={y} stroke={line} strokeWidth={1} />
        ))}
      {gridLine &&
        [1, 2].map((c) => (
          <line key={c} x1={c * cw} y1={0} x2={c * cw} y2={H} stroke={gridLine} strokeWidth={1} />
        ))}
      <rect
        x={0.5}
        y={0.5}
        width={W - 1}
        height={H - 1}
        fill="none"
        stroke={outline ?? '#E3E3E3'}
        strokeWidth={1}
      />
    </svg>
  )
}

/** UI descriptions of the 8 table preset styles */
const TABLE_STYLE_PRESETS_UI: Array<{
  key: string
  label: StringKey
  preview: { header?: string; band?: string; rowLine?: string; gridLine?: string; outline?: string }
}> = [
  { key: 'none', label: 'ribbonTableStyleNone', preview: {} },
  {
    key: 'lightGrid',
    label: 'ribbonTableStyleLightGrid',
    preview: { gridLine: '#BFBFBF', outline: '#BFBFBF' },
  },
  {
    key: 'zebraBlue',
    label: 'ribbonTableStyleZebraBlue',
    preview: { header: '#4472C4', band: '#D6E4F0', outline: '#C9D8EA' },
  },
  {
    key: 'zebraGray',
    label: 'ribbonTableStyleZebraGray',
    preview: { header: '#595959', band: '#EDEDED', outline: '#D0D0D0' },
  },
  {
    key: 'headerDarkBlue',
    label: 'ribbonTableStyleHeaderDarkBlue',
    preview: { header: '#1F3864', rowLine: '#D9D9D9', outline: '#D0D0D0' },
  },
  {
    key: 'headerOrange',
    label: 'ribbonTableStyleHeaderOrange',
    preview: { header: '#ED7D31', rowLine: '#D9D9D9', outline: '#D0D0D0' },
  },
  { key: 'noBorder', label: 'ribbonTableStyleNoBorder', preview: { band: '#F2F2F2' } },
  {
    key: 'fullBorder',
    label: 'ribbonTableStyleFullBorder',
    preview: { gridLine: '#595959', outline: '#595959' },
  },
]

/** Chart style presets (legend/gridlines/data labels/bar width combinations, applied to the same-named EditChartOp fields) */
interface ChartStylePreset {
  key: string
  label: StringKey
  style: {
    legendPos: 'b' | 't' | 'r' | 'l' | 'none'
    dataLabels: boolean
    gridlines: boolean
    gapWidthPct: number
  }
}
const CHART_STYLE_PRESETS: ChartStylePreset[] = [
  {
    key: 'classic',
    label: 'ribbonChartStyleClassic',
    style: { legendPos: 'b', dataLabels: false, gridlines: false, gapWidthPct: 150 },
  },
  {
    key: 'grid',
    label: 'ribbonChartStyleGrid',
    style: { legendPos: 'b', dataLabels: false, gridlines: true, gapWidthPct: 150 },
  },
  {
    key: 'labeled',
    label: 'ribbonDataLabels',
    style: { legendPos: 'b', dataLabels: true, gridlines: false, gapWidthPct: 150 },
  },
  {
    key: 'detail',
    label: 'ribbonChartStyleDetail',
    style: { legendPos: 'b', dataLabels: true, gridlines: true, gapWidthPct: 150 },
  },
  {
    key: 'minimal',
    label: 'ribbonChartStyleMinimal',
    style: { legendPos: 'none', dataLabels: false, gridlines: false, gapWidthPct: 150 },
  },
  {
    key: 'minimal-labeled',
    label: 'ribbonChartStyleMinimalLabeled',
    style: { legendPos: 'none', dataLabels: true, gridlines: false, gapWidthPct: 150 },
  },
  {
    key: 'bold',
    label: 'ribbonChartStyleBold',
    style: { legendPos: 'b', dataLabels: false, gridlines: true, gapWidthPct: 50 },
  },
  {
    key: 'slim',
    label: 'ribbonChartStyleSlim',
    style: { legendPos: 'b', dataLabels: false, gridlines: true, gapWidthPct: 300 },
  },
  {
    key: 'legend-top',
    label: 'ribbonChartStyleLegendTop',
    style: { legendPos: 't', dataLabels: false, gridlines: true, gapWidthPct: 150 },
  },
  {
    key: 'legend-right',
    label: 'ribbonChartStyleLegendRight',
    style: { legendPos: 'r', dataLabels: false, gridlines: true, gapWidthPct: 150 },
  },
]

/** Whether the current chart style matches a preset (bar width compared only for bar-family charts). */
function chartPresetActive(info: ChartStyleInfo | null | undefined, p: ChartStylePreset): boolean {
  if (!info) return false
  const s = p.style
  const barKind =
    info.kind === 'bar' ||
    info.kind === 'bar3D' ||
    info.kind === 'barStacked' ||
    info.kind === 'comboBarLine'
  return (
    info.legendPos === s.legendPos &&
    info.dataLabels === s.dataLabels &&
    info.gridlines === s.gridlines &&
    (!barKind || (info.gapWidthPct ?? 150) === s.gapWidthPct)
  )
}

/** Style preset thumbnail (draws a bar/line/pie sample per the current chart type). */
function ChartStyleThumb({
  kind,
  style,
}: {
  kind?: ChartStyleInfo['kind']
  style: ChartStylePreset['style']
}) {
  const W = 64
  const H = 40
  const C1 = '#4472C4'
  const C2 = '#ED7D31'
  const plot = { x: 5, y: 4, w: W - 10, h: H - 9 }
  if (style.legendPos === 'b') plot.h -= 6
  else if (style.legendPos === 't') {
    plot.y += 7
    plot.h -= 7
  } else if (style.legendPos === 'r') plot.w -= 13
  else if (style.legendPos === 'l') {
    plot.x += 13
    plot.w -= 13
  }
  const els: ReactNode[] = []
  const family =
    kind === 'line' || kind === 'area' || kind === 'scatter' || kind === 'radar'
      ? 'line'
      : kind === 'pie' || kind === 'pie3D' || kind === 'doughnut'
        ? 'pie'
        : 'bar'
  if (style.gridlines && family !== 'pie') {
    for (let i = 1; i <= 3; i++) {
      const y = plot.y + (plot.h * i) / 4
      els.push(
        <line
          key={`g${i}`}
          x1={plot.x}
          y1={y}
          x2={plot.x + plot.w}
          y2={y}
          stroke="#DADADA"
          strokeWidth={0.8}
        />,
      )
    }
  }
  if (family === 'bar') {
    const vals: Array<[number, number]> = [
      [0.55, 0.35],
      [0.8, 0.5],
      [0.65, 0.9],
    ]
    const slot = plot.w / 3
    const barW = Math.min(slot / (2 + style.gapWidthPct / 100), slot * 0.45)
    vals.forEach(([a, b], i) => {
      const gx = plot.x + i * slot + (slot - barW * 2) / 2
      const draw = (v: number, off: number, color: string, key: string) => {
        const h = plot.h * v
        els.push(
          <rect
            key={key}
            x={gx + off}
            y={plot.y + plot.h - h}
            width={barW}
            height={h}
            fill={color}
          />,
        )
        if (style.dataLabels)
          els.push(
            <circle
              key={`${key}d`}
              cx={gx + off + barW / 2}
              cy={plot.y + plot.h - h - 2.5}
              r={1.1}
              fill="#777"
            />,
          )
      }
      draw(a, 0, C1, `b${i}a`)
      draw(b, barW, C2, `b${i}b`)
    })
  } else if (family === 'line') {
    const mk = (vals: number[], color: string, key: string) => {
      const pts = vals.map(
        (v, i) => [plot.x + (plot.w * (i + 0.5)) / vals.length, plot.y + plot.h * (1 - v)] as const,
      )
      els.push(
        <polyline
          key={key}
          points={pts.map((p) => p.join(',')).join(' ')}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
        />,
      )
      if (style.dataLabels)
        pts.forEach((p, i) =>
          els.push(<circle key={`${key}d${i}`} cx={p[0]} cy={p[1] - 2.5} r={1.1} fill="#777" />),
        )
    }
    mk([0.3, 0.55, 0.45, 0.8], C1, 'l1')
    mk([0.15, 0.35, 0.6, 0.5], C2, 'l2')
  } else {
    const cx = plot.x + plot.w / 2
    const cy = plot.y + plot.h / 2
    const r = Math.min(plot.w, plot.h) / 2 - 1
    // Main circle + 120° sector (clockwise from 12 o'clock)
    els.push(<circle key="p1" cx={cx} cy={cy} r={r} fill={C1} />)
    const a = ((-90 + 120) * Math.PI) / 180
    els.push(
      <path
        key="p2"
        d={`M ${cx} ${cy} L ${cx} ${cy - r} A ${r} ${r} 0 0 1 ${cx + Math.cos(a) * r} ${cy + Math.sin(a) * r} Z`}
        fill={C2}
      />,
    )
    if (kind === 'doughnut')
      els.push(<circle key="ph" cx={cx} cy={cy} r={r * 0.45} fill="var(--surface, #fff)" />)
    if (style.dataLabels) {
      els.push(<circle key="pd1" cx={cx - r * 0.45} cy={cy + r * 0.2} r={1.1} fill="#fff" />)
      els.push(<circle key="pd2" cx={cx + r * 0.5} cy={cy - r * 0.3} r={1.1} fill="#fff" />)
    }
  }
  // Legend dots
  if (style.legendPos !== 'none') {
    const horiz = style.legendPos === 'b' || style.legendPos === 't'
    const ly = style.legendPos === 'b' ? H - 4 : style.legendPos === 't' ? 4 : H / 2 - 3
    const lx = style.legendPos === 'r' ? W - 9 : style.legendPos === 'l' ? 4 : W / 2 - 7
    els.push(<rect key="lg1" x={lx} y={ly - 1.5} width={5} height={3} fill={C1} />)
    els.push(
      <rect
        key="lg2"
        x={horiz ? lx + 9 : lx}
        y={horiz ? ly - 1.5 : ly + 4.5}
        width={5}
        height={3}
        fill={C2}
      />,
    )
  }
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
      {els}
    </svg>
  )
}

/** Chart color schemes */
const CHART_COLOR_SCHEME_UI: Array<{ key: string; label: StringKey; colors: string[] }> = [
  { key: 'default', label: 'ribbonSchemeDefault', colors: [] },
  { key: 'blue', label: 'ribbonSchemeBlue', colors: ['#2E75B6', '#4472C4', '#5B9BD5', '#70AD47'] },
  { key: 'warm', label: 'ribbonSchemeWarm', colors: ['#ED7D31', '#FFC000', '#FF0000', '#C55A11'] },
  { key: 'cool', label: 'ribbonSchemeCool', colors: ['#0070C0', '#00B0F0', '#00B0A0', '#7030A0'] },
  { key: 'mono', label: 'ribbonSchemeMono', colors: ['#404040', '#666666', '#888888', '#AAAAAA'] },
]

/** Table option toggle button (state can't be displayed, click only toggles). */
function TableToggleBtn({
  label,
  on,
  disabled,
  onClick,
  offClick,
}: {
  label: string
  on: boolean
  disabled?: boolean
  onClick: () => void
  offClick: () => void
}) {
  const { t } = useI18n()
  return (
    <button
      className={`rb-icon ${on ? 'active' : ''}`}
      disabled={disabled}
      data-tip={t(on ? 'ribbonToggleOffTip' : 'ribbonToggleOnTip', { name: label })}
      onClick={() => (on ? offClick() : onClick())}
    >
      {label}
    </button>
  )
}

function DisabledBig({ icon, label }: { icon: ReactNode; label: string }) {
  const { t } = useI18n()
  return (
    <button className="rb-big" disabled data-tip={t('ribbonNotSupported', { name: label })}>
      <span className="rb-big-icon">{icon}</span>
      <span>{label}</span>
    </button>
  )
}

/** per-tab priority for responsive collapse: when the ribbon
 * body overflows, these groups (in order) fold into a single dropdown button.
 * The effect galleries (.rb-gallery) are fixed ~2-row WPS-style grids that
 * stay expanded at ordinary widths, so only genuinely narrow windows fold. */
const COLLAPSE_ORDER: Record<string, string[]> = {
  animations: ['motionPaths'],
}

/** Checkbox row for toggle commands (View tab's Show group) */
function RbCheck({
  label,
  on,
  disabled,
  title,
  onClick,
}: {
  label: string
  on: boolean
  disabled?: boolean
  title?: string
  onClick: () => void
}) {
  return (
    <button
      className={`rb-check${on ? ' on' : ''}`}
      disabled={disabled}
      data-tip={title}
      onClick={onClick}
    >
      <span className="rb-check-box">
        {on && (
          <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M5 12.4 10 17.4l9-10.8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      <span>{label}</span>
    </button>
  )
}

// ── Animations tab: 效果选项 (variant picker; mirrors the engine's ANIM_VARIANTS) ──

/** Which variants an effect offers + the entry shown when none is set (kernel default). */
const ANIM_EFFECT_VARIANTS: Partial<
  Record<AnimEffectKind, ReadonlyArray<{ value: string; labelKey: StringKey }>>
> = {
  blinds: [
    { value: 'horizontal', labelKey: 'ribbonAnimVarHorizontal' },
    { value: 'vertical', labelKey: 'ribbonAnimVarVertical' },
  ],
  randomBars: [
    { value: 'horizontal', labelKey: 'ribbonAnimVarHorizontal' },
    { value: 'vertical', labelKey: 'ribbonAnimVarVertical' },
  ],
  randomBarsOut: [
    { value: 'horizontal', labelKey: 'ribbonAnimVarHorizontal' },
    { value: 'vertical', labelKey: 'ribbonAnimVarVertical' },
  ],
  strips: [
    { value: 'downRight', labelKey: 'ribbonTransDirFromBottomRight' },
    { value: 'downLeft', labelKey: 'ribbonTransDirFromBottomLeft' },
    { value: 'upRight', labelKey: 'ribbonTransDirFromTopRight' },
    { value: 'upLeft', labelKey: 'ribbonTransDirFromTopLeft' },
  ],
  wheel: [
    { value: '1', labelKey: 'ribbonAnimVarSpokes' },
    { value: '2', labelKey: 'ribbonAnimVarSpokes' },
    { value: '3', labelKey: 'ribbonAnimVarSpokes' },
    { value: '4', labelKey: 'ribbonAnimVarSpokes' },
    { value: '8', labelKey: 'ribbonAnimVarSpokes' },
  ],
  box: [
    { value: 'in', labelKey: 'ribbonAnimVarInward' },
    { value: 'out', labelKey: 'ribbonAnimVarOutward' },
  ],
  boxOut: [
    { value: 'in', labelKey: 'ribbonAnimVarInward' },
    { value: 'out', labelKey: 'ribbonAnimVarOutward' },
  ],
  circleIn: [
    { value: 'out', labelKey: 'ribbonAnimVarOutward' },
    { value: 'in', labelKey: 'ribbonAnimVarInward' },
  ],
  crawlIn: [
    { value: 'left', labelKey: 'ribbonTransDirFromLeft' },
    { value: 'right', labelKey: 'ribbonTransDirFromRight' },
    { value: 'top', labelKey: 'ribbonTransDirFromTop' },
    { value: 'bottom', labelKey: 'ribbonTransDirFromBottom' },
  ],
}

/** Kernel default variant (first engine table entry / the base filter's arg). */
const ANIM_VARIANT_DEFAULT: Partial<Record<AnimEffectKind, string>> = {
  blinds: 'horizontal',
  randomBars: 'horizontal',
  randomBarsOut: 'horizontal',
  strips: 'downRight',
  wheel: '1',
  box: 'in',
  boxOut: 'out',
  circleIn: 'out',
  crawlIn: 'left',
}

// ── Transitions tab: 效果选项 / 声音 (WPS 切换 tab 同款下拉) ─────────────

type TransOptionPick = Parameters<NonNullable<Props['onTransitionOption']>>[0]

/** 效果选项 entries per kind (value encodes the option field to rewrite). */
const TRANS_EFFECT_OPTIONS: Partial<
  Record<TransitionKind, ReadonlyArray<{ value: string; labelKey: StringKey }>>
> = {
  push: [
    { value: 'dir:u', labelKey: 'ribbonTransDirFromBottom' },
    { value: 'dir:d', labelKey: 'ribbonTransDirFromTop' },
    { value: 'dir:l', labelKey: 'ribbonTransDirFromLeft' },
    { value: 'dir:r', labelKey: 'ribbonTransDirFromRight' },
  ],
  wipe: [
    { value: 'dir:u', labelKey: 'ribbonTransDirFromBottom' },
    { value: 'dir:d', labelKey: 'ribbonTransDirFromTop' },
    { value: 'dir:l', labelKey: 'ribbonTransDirFromLeft' },
    { value: 'dir:r', labelKey: 'ribbonTransDirFromRight' },
  ],
  cover: [
    { value: 'dir:l', labelKey: 'ribbonTransDirFromLeft' },
    { value: 'dir:r', labelKey: 'ribbonTransDirFromRight' },
    { value: 'dir:u', labelKey: 'ribbonTransDirFromBottom' },
    { value: 'dir:d', labelKey: 'ribbonTransDirFromTop' },
    { value: 'dir:lu', labelKey: 'ribbonTransDirFromTopLeft' },
    { value: 'dir:ld', labelKey: 'ribbonTransDirFromBottomLeft' },
    { value: 'dir:ru', labelKey: 'ribbonTransDirFromTopRight' },
    { value: 'dir:rd', labelKey: 'ribbonTransDirFromBottomRight' },
  ],
  pull: [
    { value: 'dir:l', labelKey: 'ribbonTransDirFromLeft' },
    { value: 'dir:r', labelKey: 'ribbonTransDirFromRight' },
    { value: 'dir:u', labelKey: 'ribbonTransDirFromBottom' },
    { value: 'dir:d', labelKey: 'ribbonTransDirFromTop' },
    { value: 'dir:lu', labelKey: 'ribbonTransDirFromTopLeft' },
    { value: 'dir:ld', labelKey: 'ribbonTransDirFromBottomLeft' },
    { value: 'dir:ru', labelKey: 'ribbonTransDirFromTopRight' },
    { value: 'dir:rd', labelKey: 'ribbonTransDirFromBottomRight' },
  ],
  split: [
    { value: 'split:horzOut', labelKey: 'ribbonTransSplitHorzOut' },
    { value: 'split:horzIn', labelKey: 'ribbonTransSplitHorzIn' },
    { value: 'split:vertOut', labelKey: 'ribbonTransSplitVertOut' },
    { value: 'split:vertIn', labelKey: 'ribbonTransSplitVertIn' },
  ],
  zoom: [
    { value: 'zoom:in', labelKey: 'ribbonTransZoomIn' },
    { value: 'zoom:out', labelKey: 'ribbonTransZoomOut' },
  ],
  fade: [
    { value: 'fade:plain', labelKey: 'ribbonTransFadeSmooth' },
    { value: 'fade:black', labelKey: 'ribbonTransFadeBlack' },
  ],
}

/** Kernel defaults (must mirror TRANSITION_INNER in the engine) for the ✓ echo. */
function transOptionValueOf(kind: TransitionKind, spec: TransitionSpec | null): string {
  if (spec) {
    if (spec.dir) return `dir:${spec.dir}`
    if (spec.split) return `split:${spec.split}`
    if (spec.zoom) return `zoom:${spec.zoom}`
    if (kind === 'fade') return spec.fadeBlack ? 'fade:black' : 'fade:plain'
  }
  switch (kind) {
    case 'push':
      return 'dir:u'
    case 'wipe':
      return 'dir:l'
    case 'cover':
    case 'pull':
      return 'dir:l'
    case 'split':
      return 'split:horzOut'
    case 'zoom':
      return 'zoom:in'
    case 'fade':
      return 'fade:plain'
    default:
      return ''
  }
}

function parseTransOption(value: string): TransOptionPick {
  const [field, v] = value.split(':')
  if (field === 'dir') return { dir: v as TransOptionPick['dir'] }
  if (field === 'split') return { split: v as TransOptionPick['split'] }
  if (field === 'zoom') return { zoom: v as 'in' | 'out' }
  return { fadeBlack: v === 'black' }
}

/** 动画 tab 效果选项: variant menu for the selected effect (WPS 效果选项). */
function AnimVariantPicker({
  effect,
  currentVariant,
  disabled,
  onPick,
  onHover,
  onHoverEnd,
}: {
  effect: AnimEffectKind | null
  currentVariant: string | undefined
  disabled: boolean
  onPick: (variant: string) => void
  onHover: (variant: string) => void
  onHoverEnd: () => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  useDismissablePopover(open, () => setOpen(false), { inside: () => [wrapRef.current] })
  const entries = effect ? ANIM_EFFECT_VARIANTS[effect] : undefined
  if (!entries) {
    return (
      <button className="rb-big" disabled data-tip={t('ribbonTransEffectOptionsNoneTip')}>
        <span className="rb-big-icon">
          <IconEffectOptions size={BIG} />
        </span>
        <span>{t('ribbonTransEffectOptions')}</span>
      </button>
    )
  }
  const current = currentVariant ?? (effect != null ? ANIM_VARIANT_DEFAULT[effect] : undefined)
  return (
    <div className="rb-drop-wrap" ref={wrapRef}>
      <button
        className={`rb-big ${open ? 'active' : ''}`}
        disabled={disabled}
        data-tip={t('ribbonAnimEffectOptionsTip')}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="rb-big-icon">
          <IconEffectOptions size={BIG} />
          <RbCaret />
        </span>
        <span>{t('ribbonTransEffectOptions')}</span>
      </button>
      {open && (
        <div className="rb-drop rb-menu" onMouseDown={(e) => e.stopPropagation()}>
          {entries.map((o) => (
            <button
              key={o.value}
              className={o.value === current ? 'on' : ''}
              onMouseEnter={() => onHover(o.value)}
              onMouseLeave={onHoverEnd}
              onClick={() => {
                setOpen(false)
                onPick(o.value)
              }}
            >
              <span className="rb-menu-check" aria-hidden="true">
                {o.value === current ? '✓' : ''}
              </span>
              {o.labelKey === 'ribbonAnimVarSpokes'
                ? t('ribbonAnimVarSpokes', { n: o.value })
                : t(o.labelKey)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** WPS 效果选项: per-effect direction/variant menu; a plain disabled button when the effect has none. */
function TransEffectOptions({
  kind,
  spec,
  disabled,
  onPick,
}: {
  kind: TransitionKind
  spec: TransitionSpec | null
  disabled: boolean
  onPick: (opt: TransOptionPick) => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  useDismissablePopover(open, () => setOpen(false), { inside: () => [wrapRef.current] })
  const entries = TRANS_EFFECT_OPTIONS[kind]
  if (!entries) {
    return (
      <button className="rb-big" disabled data-tip={t('ribbonTransEffectOptionsNoneTip')}>
        <span className="rb-big-icon">
          <IconEffectOptions size={BIG} />
        </span>
        <span>{t('ribbonTransEffectOptions')}</span>
      </button>
    )
  }
  const current = transOptionValueOf(kind, spec)
  return (
    <div className="rb-drop-wrap" ref={wrapRef}>
      <button
        className={`rb-big ${open ? 'active' : ''}`}
        disabled={disabled}
        data-tip={t('ribbonTransEffectOptionsTip')}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="rb-big-icon">
          <IconEffectOptions size={BIG} />
          <RbCaret />
        </span>
        <span>{t('ribbonTransEffectOptions')}</span>
      </button>
      {open && (
        <div className="rb-drop rb-menu" onMouseDown={(e) => e.stopPropagation()}>
          {entries.map((o) => (
            <button
              key={o.value}
              className={o.value === current ? 'on' : ''}
              onClick={() => {
                setOpen(false)
                onPick(parseTransOption(o.value))
              }}
            >
              <span className="rb-menu-check" aria-hidden="true">
                {o.value === current ? '✓' : ''}
              </span>
              {t(o.labelKey)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** 声音 preset labels (must mirror the engine's TRANSITION_SOUND_KEYS order). */
const TRANS_SOUND_PRESETS: ReadonlyArray<{ key: TransitionSoundKey; labelKey: StringKey }> = [
  { key: 'explosion', labelKey: 'ribbonTransSoundExplosion' },
  { key: 'typewriter', labelKey: 'ribbonTransSoundTypewriter' },
  { key: 'chime', labelKey: 'ribbonTransSoundChime' },
  { key: 'applause', labelKey: 'ribbonTransSoundApplause' },
  { key: 'brake', labelKey: 'ribbonTransSoundBrake' },
  { key: 'whoosh', labelKey: 'ribbonTransSoundWhoosh' },
  { key: 'coffee', labelKey: 'ribbonTransSoundCoffee' },
  { key: 'push', labelKey: 'ribbonTransSoundPush' },
  { key: 'hammer', labelKey: 'ribbonTransSoundHammer' },
  { key: 'voltage', labelKey: 'ribbonTransSoundVoltage' },
  { key: 'laser', labelKey: 'ribbonTransSoundLaser' },
  { key: 'click', labelKey: 'ribbonTransSoundClick' },
  { key: 'drive', labelKey: 'ribbonTransSoundDrive' },
  { key: 'wind', labelKey: 'ribbonTransSoundWind' },
  { key: 'arrow', labelKey: 'ribbonTransSoundArrow' },
  { key: 'camera', labelKey: 'ribbonTransSoundCamera' },
]

/** Playback volume (WPS 音量): editor-local playback gain — OOXML has no
 * transition-sound volume attribute, so this is NOT written to the pptx. */
export const SOUND_VOLUME_KEY = 'slideshow-sound-volume'
export function readSoundVolume(): number {
  try {
    const v = Number(localStorage.getItem(SOUND_VOLUME_KEY))
    if (Number.isFinite(v) && v >= 0 && v <= 1) return v
  } catch {
    /* degraded */
  }
  return 1
}

/** WPS 声音: 无声音 + preset rows (✓ echo) + 其他声音… import + 循环播放 toggle. */
function TransSoundSelect({
  value,
  disabled,
  onPick,
  onPickCustom,
  onToggleLoop,
}: {
  value: { name: string; loop: boolean } | null
  disabled: boolean
  onPick: (name: TransitionSoundKey | null) => void
  /** 其他声音…: import a user-picked audio file as the transition sound */
  onPickCustom: (file: { name: string; bytes: Uint8Array; ext: string }) => void
  onToggleLoop: () => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [, forceVolumeRender] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  useDismissablePopover(open, () => setOpen(false), { inside: () => [wrapRef.current] })
  const currentPreset = TRANS_SOUND_PRESETS.find((p) => p.key === value?.name)
  const currentLabel =
    value && !currentPreset
      ? value.name
      : currentPreset
        ? t(currentPreset.labelKey)
        : t('ribbonTransSoundNone')
  return (
    <div className="rb-drop-wrap rb-sound-select" ref={wrapRef}>
      <button
        type="button"
        className="rb-combo"
        disabled={disabled}
        data-tip={t('ribbonTransSoundTip')}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="rb-combo-icon" aria-hidden="true">
          <IconSound size={14} />
        </span>
        <span className="rb-combo-value">{currentLabel}</span>
        <RbCaret />
      </button>
      {open && (
        <div className="rb-drop rb-menu" onMouseDown={(e) => e.stopPropagation()}>
          <button
            className={!value ? 'on' : ''}
            onClick={() => {
              setOpen(false)
              onPick(null)
            }}
          >
            <span className="rb-menu-check" aria-hidden="true">
              {!value ? '✓' : ''}
            </span>
            {t('ribbonTransSoundNone')}
          </button>
          {TRANS_SOUND_PRESETS.map((p) => (
            <button
              key={p.key}
              className={value?.name === p.key ? 'on' : ''}
              onClick={() => {
                setOpen(false)
                onPick(p.key)
              }}
            >
              <span className="rb-menu-check" aria-hidden="true">
                {value?.name === p.key ? '✓' : ''}
              </span>
              {t(p.labelKey)}
            </button>
          ))}
          <button
            onClick={() => {
              setOpen(false)
              fileRef.current?.click()
            }}
          >
            <span className="rb-menu-check" aria-hidden="true" />
            {t('ribbonTransSoundOther')}
          </button>
          <div className="rb-menu-sep" />
          <button
            className={`rb-check ${value?.loop ? 'on' : ''}`}
            disabled={!value}
            onClick={onToggleLoop}
          >
            <span className="rb-check-box" aria-hidden="true">
              {value?.loop && (
                <svg width="12" height="12" viewBox="0 0 24 24">
                  <path
                    d="M5 12.4 10 17.4l9-10.8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>
            {t('ribbonTransSoundLoop')}
          </button>
          <div className="rb-menu-sep" />
          <div className="rb-sound-volume" role="group" aria-label={t('ribbonTransVolLabel')}>
            <span className="rb-sound-volume-label">{t('ribbonTransVolLabel')}</span>
            {(
              [
                [0, 'ribbonTransVolMute'],
                [0.4, 'ribbonTransVolLow'],
                [0.7, 'ribbonTransVolMedium'],
                [1, 'ribbonTransVolHigh'],
              ] as const
            ).map(([gain, key]) => (
              <button
                key={key}
                className={Math.abs(readSoundVolume() - gain) < 0.01 ? 'on' : ''}
                onClick={() => {
                  try {
                    localStorage.setItem(SOUND_VOLUME_KEY, String(gain))
                  } catch {
                    /* degraded */
                  }
                  forceVolumeRender((v) => v + 1)
                }}
              >
                {t(key)}
              </button>
            ))}
          </div>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          void file.arrayBuffer().then((buf) => {
            const ext = (file.name.split('.').pop() ?? 'mp3').toLowerCase()
            onPickCustom({ name: file.name, bytes: new Uint8Array(buf), ext })
          })
        }}
      />
    </div>
  )
}

/** Bundled seamless texture-fill presets (tiled at natural size when applied). */
const FILL_TEXTURES: Array<{ url: string; tipKey: StringKey }> = [
  { url: texPaper, tipKey: 'ribbonTexturePaper' },
  { url: texCanvas, tipKey: 'ribbonTextureCanvas' },
  { url: texWood, tipKey: 'ribbonTextureWood' },
  { url: texMarble, tipKey: 'ribbonTextureMarble' },
  { url: texGranite, tipKey: 'ribbonTextureGranite' },
  { url: texDenim, tipKey: 'ribbonTextureDenim' },
  { url: texCork, tipKey: 'ribbonTextureCork' },
  { url: texParchment, tipKey: 'ribbonTextureParchment' },
]

/** Bundled asset → raw base64 (for shipping texture bytes over IPC). */
async function urlToBase64(url: string): Promise<string> {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** Right-pointing chevron on the gradient/texture submenu rows. */
/** Table border weight picker (the old <select> was uncontrolled; the picked value lives here). */
function BorderWeightDropdown({
  tip,
  onPick,
}: {
  readonly tip?: string
  readonly onPick: (pt: number) => void
}) {
  const [val, setVal] = useState('1')
  return (
    <Dropdown
      className="rb-border-weight-dd"
      value={val}
      tip={tip}
      options={['0.5', '1', '1.5', '2.25', '3'].map((v) => ({ value: v, label: `${v}pt` }))}
      onPick={(v) => {
        setVal(v)
        onPick(Number(v))
      }}
    />
  )
}

function RbSubCaret() {
  return (
    <svg
      className="rbf-sub-caret"
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M9.25 5.5 15.75 12l-6.5 6.5"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** #RRGGBB blended toward `to` by t (0..1); gradient preset variants. */
function mixHex(from: string, to: string, t: number): string {
  const pf = parseInt(from.slice(1), 16)
  const pt = parseInt(to.slice(1), 16)
  const ch = (shift: number) => {
    const a = (pf >> shift) & 255
    const b = (pt >> shift) & 255
    return Math.round(a + (b - a) * t)
  }
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0').toUpperCase()}`
}

/**
 * PowerPoint-style shape fill popup: no-fill, theme colors + shades, standard
 * colors, recent colors, more-colors native picker, then picture / gradient
 * variants / texture. Color sections reuse the shared picker's gcp-* styling
 * (the popup root carries .gcp-palette); previews/values are document colors,
 * set inline.
 */
function ShapeFillMenu({
  currentFill,
  onPickFill,
  onPickImage,
  onMoreGradient,
  onClose,
}: {
  /** Selected shape's solid fill #RRGGBB, 'none' when the shape has no fill (null = non-solid) */
  currentFill: string | null | undefined
  onPickFill: (fill: string | GradientFillSpec) => void
  onPickImage:
    ((mode: 'stretch' | 'tile', source?: { base64: string; ext: string }) => void) | undefined
  /** "More Gradients…": opens the format pane's gradient editor */
  onMoreGradient: (() => void) | undefined
  onClose: () => void
}) {
  const { t } = useI18n()
  const recent = getRecentColors()
  const isNoFill = currentFill === 'none'
  const current = !currentFill || isNoFill ? null : currentFill.toUpperCase()
  // Gradient/texture preset flyout: opens beside its row on hover, survives the
  // pointer crossing the gap via a short close delay
  const [flyout, setFlyout] = useState<{
    kind: 'gradient' | 'texture'
    x: number
    y: number
  } | null>(null)
  const flyoutTimer = useRef<number | null>(null)
  const cancelFlyoutClose = () => {
    if (flyoutTimer.current) window.clearTimeout(flyoutTimer.current)
    flyoutTimer.current = null
  }
  const scheduleFlyoutClose = () => {
    cancelFlyoutClose()
    flyoutTimer.current = window.setTimeout(() => setFlyout(null), 150)
  }
  const openFlyout = (kind: 'gradient' | 'texture', e: React.MouseEvent<HTMLElement>) => {
    cancelFlyoutClose()
    const r = e.currentTarget.getBoundingClientRect()
    setFlyout({
      kind,
      x: Math.min(r.right + 4, window.innerWidth - 270),
      y: Math.min(r.top - 8, window.innerHeight - (kind === 'texture' ? 160 : 190)),
    })
  }
  useEffect(() => cancelFlyoutClose, [])
  const pickHex = (hex: string) => {
    onClose()
    pushRecentColor(hex)
    onPickFill(hex)
  }
  const swatch = (bare: string, title: string, key?: string) => (
    <button
      key={key ?? bare}
      type="button"
      className={`gcp-swatch ${current === `#${bare.toUpperCase()}` ? 'selected' : ''}`}
      title={title}
      style={{ background: `#${bare}` }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => pickHex(`#${bare}`)}
    />
  )
  // Gradient variants: light/dark rows built from the shape's color (fallback: last used, then Office blue)
  const base = current ?? recent[0] ?? '#4472C4'
  const variants = [
    { from: mixHex(base, '#FFFFFF', 0.7), to: base, tip: t('ribbonGradientLight') },
    { from: base, to: mixHex(base, '#000000', 0.5), tip: t('ribbonGradientDark') },
  ]
  // OOXML angle (0°=left→right, 90°=top→bottom) with its CSS preview equivalent
  const dirs: Array<{ angleDeg?: number; radial?: boolean; css: string; tip: string }> = [
    { angleDeg: 90, css: 'linear-gradient(180deg', tip: t('ribbonGradientDirDown') },
    { angleDeg: 0, css: 'linear-gradient(90deg', tip: t('ribbonGradientDirRight') },
    { angleDeg: 45, css: 'linear-gradient(135deg', tip: t('ribbonGradientDirDiag') },
    { radial: true, css: 'radial-gradient(circle', tip: t('ribbonGradientDirRadial') },
  ]
  return (
    <div className="rb-drop gcp-palette rb-fill-menu" onMouseDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        className={`gcp-auto ${isNoFill ? 'selected' : ''}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          onClose()
          onPickFill('none')
        }}
      >
        {t('paneFormatNoFill')}
      </button>
      <div className="gcp-section-title">{t('ribbonThemeColorsSection')}</div>
      <div className="gcp-theme-base">{THEME_COLORS.map((c) => swatch(c.hex, c.name))}</div>
      <div className="gcp-theme-shades">
        {THEME_COLOR_SHADES.flatMap((row, r) =>
          row.map((hex, c) => swatch(hex, `#${hex}`, `${r}-${c}-${hex}`)),
        )}
      </div>
      <div className="gcp-section-title">{t('ribbonStandardColors')}</div>
      <div className="gcp-standard-row">{STANDARD_COLORS.map((c) => swatch(c.hex, c.name))}</div>
      {recent.length > 0 && (
        <>
          <div className="gcp-section-title">{t('ribbonRecentColors')}</div>
          <div className="gcp-standard-row">
            {recent.map((hex, i) => swatch(hex.slice(1), hex, `recent-${i}-${hex}`))}
          </div>
        </>
      )}
      <div className="rbf-actions">
        <label className="rbf-row">
          {t('ribbonMoreFillColors')}
          <input
            type="color"
            defaultValue={(current ?? '#ffffff').toLowerCase()}
            onPointerDown={(e) => armColorInput(e.currentTarget)}
            onChange={(e) => {
              pushRecentColor(e.target.value)
              onPickFill(e.target.value)
            }}
          />
        </label>
        {onPickImage && (
          <button
            type="button"
            className="rbf-row"
            onClick={() => {
              onClose()
              onPickImage('stretch')
            }}
          >
            {t('ribbonFillPicture')}
          </button>
        )}
        <button
          type="button"
          className="rbf-row rbf-row-sub"
          onMouseEnter={(e) => openFlyout('gradient', e)}
          onMouseLeave={scheduleFlyoutClose}
          onClick={(e) => openFlyout('gradient', e)}
        >
          {t('paneFormatGradient')}
          <RbSubCaret />
        </button>
        {onPickImage && (
          <button
            type="button"
            className="rbf-row rbf-row-sub"
            onMouseEnter={(e) => openFlyout('texture', e)}
            onMouseLeave={scheduleFlyoutClose}
            onClick={(e) => openFlyout('texture', e)}
          >
            {t('ribbonFillTexture')}
            <RbSubCaret />
          </button>
        )}
      </div>
      {flyout && (
        <div
          className="rbf-flyout"
          style={{ left: flyout.x, top: flyout.y }}
          onMouseEnter={cancelFlyoutClose}
          onMouseLeave={scheduleFlyoutClose}
        >
          {flyout.kind === 'gradient' ? (
            <>
              <div className="rbf-actions rbf-actions-top">
                <button
                  type="button"
                  className="rbf-row"
                  onClick={() => {
                    onClose()
                    onPickFill(base)
                  }}
                >
                  {t('ribbonNoGradient')}
                </button>
              </div>
              {variants.map((v, vi) => (
                <React.Fragment key={vi}>
                  <div className="gcp-section-title">{v.tip}</div>
                  <div className="rbf-gradients">
                    {dirs.map((d, di) => (
                      <button
                        key={`${vi}-${di}`}
                        type="button"
                        className="rbf-gradient-tile"
                        title={d.tip}
                        style={{ background: `${d.css}, ${v.from}, ${v.to})` }}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          onClose()
                          onPickFill({
                            gradient: {
                              from: v.from,
                              to: v.to,
                              ...(d.radial ? { radial: true } : { angleDeg: d.angleDeg! }),
                            },
                          })
                        }}
                      />
                    ))}
                  </div>
                </React.Fragment>
              ))}
              {onMoreGradient && (
                <div className="rbf-actions">
                  <button
                    type="button"
                    className="rbf-row"
                    onClick={() => {
                      onClose()
                      onMoreGradient()
                    }}
                  >
                    {t('ribbonGradientMore')}
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="rbf-textures">
                {FILL_TEXTURES.map((tex) => (
                  <button
                    key={tex.tipKey}
                    type="button"
                    className="rbf-texture-tile"
                    title={t(tex.tipKey)}
                    style={{ backgroundImage: `url(${tex.url})`, backgroundSize: '64px 64px' }}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onClose()
                      void urlToBase64(tex.url).then((base64) =>
                        onPickImage?.('tile', { base64, ext: 'png' }),
                      )
                    }}
                  />
                ))}
              </div>
              <div className="rbf-actions">
                <button
                  type="button"
                  className="rbf-row"
                  onClick={() => {
                    onClose()
                    onPickImage?.('tile')
                  }}
                >
                  {t('ribbonTextureMore')}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export function Ribbon({
  hasDoc,
  deckEmpty,
  canUndo,
  canRedo,
  dirty,
  editing,
  autoSave,
  onAutoSaveChange,
  onOpen,
  onOpenRecent,
  onSave,
  onUndo,
  onRedo,
  onSaveAs,
  onExportPdf,
  onPrint,
  onExportImages,
  onFormat,
  zoom,
  onZoom,
  showThumbs,
  onToggleThumbs,
  aiPanelAvailable,
  aiPanelOpen,
  onToggleAiPanel,  onAiPreset,
  onInsert,
  onPickShape,
  onInsertImage,
  onFormatBackground,
  onApplyTheme,
  onAddSlide,
  onAddSlideWithLayout,
  onAddSection,
  layouts,
  layoutSize,
  formatOpen,
  onToggleFormat,
  hasSelection,
  onAskSelection: _onAskSelection,
  hasTextSelection,
  canPaste,
  onCopy,
  onCut,
  onPaste,
  hasBrushFormat,
  brushMode,
  onFormatBrushClick,
  onFormatBrushDoubleClick,
  onTextColor,
  curBulletChar,
  curAlign,
  curRtl,
  curFontFamily,
  curFontSizePt,
  curFontSizeMixed,
  onFontFamily,
  onFontSize,
  onAlign,
  onDirection,
  onStrike,
  onTextToggle,
  onElementTextColor,
  onFindReplace,
  animByParagraph,
  onToggleAnimByParagraph,
  onSetLayout,
  onResetLayout,
  onSlideSize,
  slideSizeKey,
  onParagraphFormat,
  onInsertTable,
  transition,
  onTransition,
  transSpec,
  onTransitionDuration,
  onTransitionOption,
  onTransitionSound,
  advanceMs,
  onAdvanceTime,
  selectedAnimEffect,
  timingAnim,
  onApplyAnimation,
  onAnimVariant,
  onAnimHoverPreview,
  onAnimHoverEnd,
  onAddAnimation,
  onApplyMotionPath,
  onAnimTiming,
  animPaneOpen,
  onToggleAnimPane,
  animCount,
  animBrush,
  onToggleAnimBrush,
  showLoop,
  onSetShowLoop,
  slideShowFromStart,
  slideShowOpen,
  setSlideShowFromStart,
  setSlideShowOpen,
  onAnimPreview,
  onSlideShow,
  onPresenterView,
  onCustomShow,
  onRehearse,
  onCountdownShow,
  showDisplays,
  showDisplayId,
  onShowDisplay,
  showWithPresenter,
  onToggleShowWithPresenter,
  onClearRehearse,
  currentHidden,
  onToggleHidden,
  inkTool,
  onInkTool,
  inkPen,
  onInkPen,
  inkHighlighter,
  onInkHighlighter,
  inkCount,
  onInkClearAll,
  viewMode,
  onViewMode,
  onSlideMaster,
  onZoomFit,
  showRuler,
  onToggleRuler,
  showGrid,
  onToggleGrid,
  showGuides,
  onToggleGuides,
  showNotes,
  onToggleNotes,
  commentsOpen,
  onToggleComments,
  onNewComment,
  commentCount,
  onInsertIcon,
  onInsertChart,
  onOpenChartDesigner,
  onOpenEchart,
  onInsertSmartArt,
  onInsertWordArt,
  onInsertField,
  onOpenLink,
  onInsertZoom,
  slideCount,
  currentSlide,
  onOpenHeaderFooter,
  onOpenEquation,
  onInsertMedia,
  onInsertModel3d,
  recording,
  onToggleScreenRecord,
  contextElementType,
  contextElementId: _contextElementId,
  contextSlideIndex: _contextSlideIndex,
  contextChartStyle,
  chartColorSchemes,
  contextPictureCanCutout,
  contextPictureLum,
  contextPictureStroke,
  onPictureStroke,
  onChangeShape,
  onShapeStyle,
  onShapeFill,
  onShapeFillImage,
  contextShapeFill,
  onPictureCrop,
  cropActive,
  onPictureOpacity,
  onPictureLum,
  onPictureChange,
  onPictureCompress,
  onPictureCutout,
  onPictureReplace,
  onPictureRotate,
  onEditTableStyle,
  tableStyleFlags,
  tableActiveCell,
  onEditChart,
  onOpenChartDataDialog,
  onArrange,
  onFlip,
  canDistribute,
}: Props) {
  const { t } = useI18n()
  // tab row clips instead of wrapping when narrow; wheel + edge arrows page it
  const tabStrip = useTabStripOverflow()
  // Shapes get their own format tab; text-bearing shapes do not auto-activate it
  // (users are usually after Home's text controls when selecting them).
  const contextTab = contextTabForElement(contextElementType ?? null)
  const autoContextTab = autoContextTabForElement(contextElementType ?? null)

  const [tab, setTab] = useState<MainTab | ContextTab>('home')
  const [fileOpen, setFileOpen] = useState(false)
  // WPS 双击标签折叠/展开功能区; 右下角图标同; 状态本地持久化
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('slides-ribbon-collapsed') === '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('slides-ribbon-collapsed', collapsed ? '1' : '0')
    } catch {
      /* degraded */
    }
  }, [collapsed])
  // 最近文件: 拉取于菜单打开时(避免每次渲染请求)
  const [recents, setRecents] = useState<string[]>([])
  useEffect(() => {
    if (!fileOpen) return
    void window.slidesApi.getRecentFiles().then((list) => {
      if (Array.isArray(list)) setRecents(list.slice(0, 6))
    })
  }, [fileOpen])
  const [colorOpen, setColorOpen] = useState(false)
  const [fontOpen, setFontOpen] = useState(false)
  const [sizeOpen, setSizeOpen] = useState(false)
  const [lineSpacingOpen, setLineSpacingOpen] = useState(false)
  const [paraOpen, setParaOpen] = useState(false)
  const [layoutPickOpen, setLayoutPickOpen] = useState(false)
  const [slideSizeOpen, setSlideSizeOpen] = useState(false)
  const [transparencyOpen, setTransparencyOpen] = useState(false)
  const [compressOpen, setCompressOpen] = useState(false)
  const [pictureBorderOpen, setPictureBorderOpen] = useState(false)
  const [changeShapeOpen, setChangeShapeOpen] = useState(false)
  const [shapeStyleOpen, setShapeStyleOpen] = useState(false)
  const [shapeFillOpen, setShapeFillOpen] = useState(false)
  // Debounced picture-border commit: color drags fire repeatedly, and a pending
  // color commit must not clobber a width click landing meanwhile
  const pictureBorderTimer = useRef<number | null>(null)
  const pictureBorderDraft = useRef<{ color: string; widthPt: number } | null>(null)
  const commitPictureBorder = (
    patch: Partial<{ color: string; widthPt: number }>,
    immediate = false,
  ) => {
    if (pictureBorderTimer.current) window.clearTimeout(pictureBorderTimer.current)
    const base = pictureBorderDraft.current ?? {
      color: toPickerHex(contextPictureStroke?.color) ?? '#000000',
      widthPt: contextPictureStroke?.widthPt ?? 1,
    }
    const draft = { ...base, ...patch }
    pictureBorderDraft.current = draft
    const fire = () => {
      pictureBorderTimer.current = null
      onPictureStroke?.({
        ...draft,
        ...(contextPictureStroke?.dashPreset ? { dash: contextPictureStroke.dashPreset } : {}),
      })
    }
    if (immediate) fire()
    else pictureBorderTimer.current = window.setTimeout(fire, 200)
  }
  const [lastColor, setLastColor] = useState('#C43E1C')
  // Bullet color "more colors" native picker echo
  const [lastBulletColor, setLastBulletColor] = useState('#C43E1C')
  // Font-size combobox draft: non-null while the input is focused (typed but not yet applied)
  const [sizeDraft, setSizeDraft] = useState<string | null>(null)
  // Font-family combobox draft: free-typed names cover weight variants absent from the list
  const [fontDraft, setFontDraft] = useState<string | null>(null)
  const [tableOpen, setTableOpen] = useState(false)
  const [tableHover, setTableHover] = useState({ r: 0, c: 0 })
  const [tableDialogOpen, setTableDialogOpen] = useState(false)
  const [layoutOpen, setLayoutOpen] = useState(false)
  // responsive-collapse state (see the collapse effect below)
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([])
  const [collapseOpen, setCollapseOpen] = useState<string | null>(null)
  const [translateOpen, setTranslateOpen] = useState(false)
  const [arrangeOpen, setArrangeOpen] = useState(false)
  // Insert tab dropdown galleries (at most one open at a time)
  const [insertDrop, setInsertDrop] = useState<
    'shapes' | 'icons' | 'chart' | 'smartart' | 'wordart' | 'zoom' | 'addanim' | 'rehearse' | null
  >(null)
  // 放映设置⌄ dropdown (show tab)
  const [showSettingsOpen, setShowSettingsOpen] = useState(false)
  // Chart design: dropdown panels (add chart element / change colors, at most one open at a time)
  const [chartDrop, setChartDrop] = useState<'elements' | 'colors' | null>(null)
  // Draw tab pen gallery: per-preset customisations live for the session;
  // clicking the already-selected pen opens its color/width flyout
  const [penPresets, setPenPresets] = useState<PenPreset[]>(DEFAULT_PEN_PRESETS)
  const [selectedPen, setSelectedPen] = useState(0)
  const [penFlyout, setPenFlyout] = useState<{ index: number; x: number; y: number } | null>(null)
  const [chartTypeDlgOpen, setChartTypeDlgOpen] = useState(false)
  const chartTitleRef = useRef<HTMLInputElement>(null)
  const catAxisRef = useRef<HTMLInputElement>(null)
  const valAxisRef = useRef<HTMLInputElement>(null)
  const [iconColor, setIconColor] = useState(ICON_COLORS[0]!)

  // One ribbon popup at a time: every dropdown trigger closes its siblings on
  // mousedown (via closeSiblingPanels) before its own click-toggle runs, so
  // popups never stack. `keep` names the popups that must survive the sweep —
  // the trigger's own (its toggle decides) and, for nested triggers, the panel
  // anchoring them.
  const closePanels = useCallback((keep: RibbonPanelKey[] = []) => {
    if (!keep.includes('file')) setFileOpen(false)
    if (!keep.includes('color')) setColorOpen(false)
    if (!keep.includes('font')) setFontOpen(false)
    if (!keep.includes('size')) setSizeOpen(false)
    if (!keep.includes('lineSpacing')) setLineSpacingOpen(false)
    if (!keep.includes('para')) setParaOpen(false)
    if (!keep.includes('layoutPick')) setLayoutPickOpen(false)
    if (!keep.includes('slideSize')) setSlideSizeOpen(false)
    if (!keep.includes('transparency')) setTransparencyOpen(false)
    if (!keep.includes('pictureBorder')) setPictureBorderOpen(false)
    if (!keep.includes('changeShape')) setChangeShapeOpen(false)
    if (!keep.includes('shapeStyle')) setShapeStyleOpen(false)
    if (!keep.includes('shapeFill')) setShapeFillOpen(false)
    if (!keep.includes('table')) setTableOpen(false)
    if (!keep.includes('layout')) setLayoutOpen(false)
    if (!keep.includes('translate')) setTranslateOpen(false)
    if (!keep.includes('arrange')) setArrangeOpen(false)
    if (!keep.includes('insert')) setInsertDrop(null)
    if (!keep.includes('chart')) setChartDrop(null)
    if (!keep.includes('collapse')) setCollapseOpen(null)
    if (!keep.includes('pen')) setPenFlyout(null)
    if (!keep.includes('slideShow')) setSlideShowOpen(false)
  }, [])

  // Any ribbon popup open? Drives outside-press dismissal AND suspends the
  // ribbon-tabs window drag region (drag regions swallow mousedown, so a
  // press there could never dismiss otherwise)
  const anyPanelOpen =
    tableOpen ||
    colorOpen ||
    translateOpen ||
    insertDrop != null ||
    fontOpen ||
    sizeOpen ||
    layoutOpen ||
    chartDrop != null ||
    arrangeOpen ||
    slideShowOpen ||
    paraOpen ||
    pictureBorderOpen ||
    changeShapeOpen ||
    shapeStyleOpen ||
    shapeFillOpen ||
    layoutPickOpen ||
    slideSizeOpen ||
    transparencyOpen ||
    lineSpacingOpen ||
    collapseOpen != null

  // Clicking elsewhere collapses every popup (the font color palette uses
  // onMouseDown without stealing focus, collapsing naturally when the edit
  // commits). The shared installer covers outside mousedown, window blur and
  // the shell app:chrome-pressed relay; panels survive via stopPropagation.
  useDismissablePopover(anyPanelOpen, closePanels)

  // ── Responsive collapse (PowerPoint model): the collapsed set is a pure
  // function of the current width, never of resize history — pick the fewest
  // COLLAPSE_ORDER groups whose folding lets the full inline layout fit.
  // Expanded/collapsed widths are cached per group so the required width is
  // computable in every state (before the first fold the collapsed width is
  // an estimate, corrected by measurement as soon as the group first folds).
  const collapse = useRibbonCollapse('ai-slides-ribbon-collapsed')
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const inlineWidthsRef = useRef(new Map<string, number>())
  const collapsedWidthsRef = useRef(new Map<string, number>())
  useLayoutEffect(() => {
    setCollapsedGroups([])
    setCollapseOpen(null)
  }, [tab])
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const order = COLLAPSE_ORDER[tab] ?? []
    if (!order.length) return
    const evaluate = () => {
      // hidden (collapsed ribbon): offsets read 0 and would poison the width caches
      if (!el.clientWidth) return
      const kids = Array.from(el.children) as HTMLElement[]
      if (!kids.length) return
      const first = kids[0]!
      const last = kids[kids.length - 1]!
      let fullWidth = last.offsetLeft + last.offsetWidth - first.offsetLeft
      // refresh width caches and normalize the measured extent to "all expanded"
      const saving = (g: string) =>
        Math.max(
          0,
          (inlineWidthsRef.current.get(g) ?? 240) - (collapsedWidthsRef.current.get(g) ?? 68),
        )
      for (const g of order) {
        const groupEl = el.querySelector<HTMLElement>(`[data-rbgroup="${g}"]`)
        if (!groupEl) continue
        if (collapsedGroups.includes(g)) {
          collapsedWidthsRef.current.set(g, groupEl.offsetWidth)
          fullWidth += saving(g)
        } else {
          inlineWidthsRef.current.set(g, groupEl.offsetWidth)
        }
      }
      // fewest folded groups whose savings make the layout fit `avail`
      const fitCount = (avail: number) => {
        let need = fullWidth
        let k = 0
        while (k < order.length && need > avail) {
          need -= saving(order[k]!)
          k++
        }
        return k
      }
      const mustCollapse = fitCount(el.clientWidth)
      // integer offset* measurements make the normalized width jitter by a
      // couple of px — demand a little real slack before unfolding so a
      // borderline width can't oscillate
      const next =
        mustCollapse >= collapsedGroups.length
          ? mustCollapse
          : Math.min(Math.max(fitCount(el.clientWidth - 8), mustCollapse), collapsedGroups.length)
      if (next !== collapsedGroups.length) setCollapsedGroups(order.slice(0, next))
    }
    evaluate()
    const ro = new ResizeObserver(evaluate)
    ro.observe(el)
    // group contents can change width without the body resizing (font loads,
    // locale, contextual controls) — watch every group as well
    el.querySelectorAll<HTMLElement>('.ribbon-group').forEach((g) => ro.observe(g))
    return () => ro.disconnect()
  }, [tab, collapsedGroups])

  // Contextual tab auto-switch: pictures/tables/charts jump to their format
  // tab; shapes only reveal Shape Format (PowerPoint parity, so Home stays put for
  // text formatting). Leaving a tab that is no longer offered falls back to Home.
  const prevContextTab = useRef<ContextTab | null>(null)
  useEffect(() => {
    const previousContextTab = prevContextTab.current
    if (contextTab !== previousContextTab) {
      if (autoContextTab) {
        setTab(autoContextTab)
      } else if (previousContextTab) {
        setTab((cur) => (cur === previousContextTab ? 'home' : cur))
      }
    }
    prevContextTab.current = contextTab
  }, [contextTab, autoContextTab])

  /** Insert tab dropdown big button (click toggles, content stopPropagation) */
  const dropBig = (
    key: NonNullable<typeof insertDrop>,
    icon: ReactNode,
    label: string,
    title: string,
    content: ReactNode,
    disabled = !hasDoc,
  ) => (
    <div className="rb-drop-wrap">
      <button
        className={`rb-big ${insertDrop === key ? 'active' : ''}`}
        disabled={disabled}
        data-tip={title}
        onMouseDown={(e) => {
          e.stopPropagation()
          closeSiblingPanels(e, closePanels, 'insert')
        }}
        onClick={() => setInsertDrop((v) => (v === key ? null : key))}
      >
        <span className="rb-big-icon">
          {icon}
          <RbCaret />
        </span>
        <span>{label}</span>
      </button>
      {insertDrop === key && (
        <div className="rb-drop" onMouseDown={(e) => e.stopPropagation()}>
          {content}
        </div>
      )}
    </div>
  )
  // Apply a typed font size: any positive value, 0.5pt steps, clamped to 1-999.
  // While text-editing, restore the selection saved when the input took focus so the size applies
  // to the selection instead of element-level
  const commitSizeDraft = () => {
    const v = parseFloat((sizeDraft ?? '').replace(',', '.'))
    if (!Number.isFinite(v) || v <= 0) return
    const pt = Math.min(999, Math.max(1, Math.round(v * 2) / 2))
    if (editing) restoreEditSelection()
    onFontSize(pt)
  }

  // Apply a free-typed font name, same selection dance as commitSizeDraft
  const commitFontDraft = () => {
    const v = (fontDraft ?? '').trim()
    if (!v) return
    if (editing) restoreEditSelection()
    onFontFamily(v)
  }

  // Custom font color via the native picker: debounced (the picker fires onChange
  // continuously while dragging). The picker steals focus, so while editing the
  // saved selection is restored before each apply
  const customColorTimer = useRef<number | null>(null)
  const onCustomTextColor = (value: string) => {
    const hex = value.toUpperCase()
    setLastColor(hex)
    if (customColorTimer.current) window.clearTimeout(customColorTimer.current)
    customColorTimer.current = window.setTimeout(() => {
      if (editing) {
        restoreEditSelection()
        onTextColor(hex)
      } else onElementTextColor(hex)
    }, 200)
  }

  // Hover preview for animation effects: fire after a short dwell so
  // sweeping across the gallery doesn't spam previews; leaving cancels/stops.
  const animHoverTimer = useRef<number | null>(null)
  const animHoverStart = (effect: AnimEffectKind, motionPath?: string) => {
    if (animHoverTimer.current) window.clearTimeout(animHoverTimer.current)
    animHoverTimer.current = window.setTimeout(() => {
      animHoverTimer.current = null
      onAnimHoverPreview(effect, motionPath)
    }, 350)
  }
  const animHoverStop = () => {
    if (animHoverTimer.current) window.clearTimeout(animHoverTimer.current)
    animHoverTimer.current = null
    onAnimHoverEnd()
  }

  // Custom bullet color via the native picker: same debounce as font color
  const bulletColorTimer = useRef<number | null>(null)
  const onCustomBulletColor = (value: string) => {
    const hex = value.toUpperCase()
    setLastBulletColor(hex)
    if (bulletColorTimer.current) window.clearTimeout(bulletColorTimer.current)
    bulletColorTimer.current = window.setTimeout(() => onParagraphFormat({ bulletColor: hex }), 200)
  }

  // One-time acknowledgement before whole-document AI rewrites:
  // Spelling / Translate send the full deck to the agent, consume credits and may
  // rewrite every slide — say so once before the first run.
  const confirmAiRewrite = () => {
    if (localStorage.getItem(AI_REWRITE_ACK_KEY) === '1') return true
    if (!window.confirm(t('ribbonAiRewriteConfirm'))) return false
    localStorage.setItem(AI_REWRITE_ACK_KEY, '1')
    return true
  }

  // Format buttons use onMouseDown+preventDefault, avoiding stealing contentEditable focus and triggering a commit
  const fmtBtn = (cmd: FormatCmd, label: ReactNode, title: string, className?: string) => (
    <button
      className={`rb-icon${className ? ` ${className}` : ''}`}
      disabled={!editing}
      data-tip={editing ? title : t('ribbonEditableHint', { title })}
      aria-label={title}
      onMouseDown={(e) => {
        e.preventDefault()
        if (editing) onFormat(cmd)
      }}
    >
      {label}
    </button>
  )

  const tabCtx: RibbonTabCtx = {
    slideShowFromStart,
    slideShowOpen,
    setSlideShowFromStart,
    setSlideShowOpen,
    brushMode,
    canDistribute,
    canPaste,
    closePanels,
    curBulletChar,
    curAlign,
    curRtl,
    curFontFamily,
    curFontSizeMixed,
    curFontSizePt,
    currentSlide,
    deckEmpty,
    editing,
    formatOpen,
    hasBrushFormat,
    hasDoc,
    hasSelection,
    hasTextSelection,
    layouts,
    layoutSize,
    onAddSection,
    onAddSlide,
    onAddSlideWithLayout,
    onAiPreset,
    onAlign,
    onDirection,
    onArrange,
    onFlip,
    onCopy,
    onCut,
    onElementTextColor,
    onFindReplace,
    onFontFamily,
    onFontSize,
    onFormat,
    onFormatBrushClick,
    onFormatBrushDoubleClick,
    onInsert,
    onPickShape,
    onInsertChart,
    onOpenChartDesigner,
    onOpenEchart,
    onInsertField,
    onInsertIcon,
    onInsertImage,
    onInsertMedia,
    onInsertModel3d,
    onInsertSmartArt,
    onInsertTable,
    onInsertWordArt,
    onInsertZoom,
    onNewComment,
    onOpenEquation,
    onOpenHeaderFooter,
    onOpenLink,
    onParagraphFormat,
    onPaste,
    onResetLayout,
    onSetLayout,
    onSlideShow,
    onStrike,
    onTextColor,
    onTextToggle,
    onToggleFormat,
    onToggleScreenRecord,
    recording,
    slideCount,
    zoom,
    arrangeOpen,
    collapseOpen,
    collapsedGroups,
    colorOpen,
    commitFontDraft,
    commitSizeDraft,
    dropBig,
    fontDraft,
    setFontDraft,
    fmtBtn,
    fontOpen,
    iconColor,
    lastBulletColor,
    lastColor,
    layoutOpen,
    layoutPickOpen,
    lineSpacingOpen,
    onCustomBulletColor,
    onCustomTextColor,
    paraOpen,
    setArrangeOpen,
    setCollapseOpen,
    setColorOpen,
    setFontOpen,
    setIconColor,
    setInsertDrop,
    setLastColor,
    setLayoutOpen,
    setLayoutPickOpen,
    setLineSpacingOpen,
    setParaOpen,
    setSizeDraft,
    setSizeOpen,
    setTableDialogOpen,
    setTableHover,
    setTableOpen,
    sizeDraft,
    sizeOpen,
    t,
    tableDialogOpen,
    tableHover,
    tableOpen,
  }

  return (
    <div className={`ribbon${collapsed ? ' ribbon-collapsed' : ''}`}>
      <div
        className={`ribbon-tabs ${IN_TAB ? '' : IS_MAC ? 'ribbon-tabs-mac' : 'ribbon-tabs-win'}${
          anyPanelOpen ? ' ribbon-tabs-nodrag' : ''
        }`}
        onDoubleClick={collapse.onTabsDoubleClick}
      >
        {/* WPS macOS 同样有常驻「文件」按钮（☰ 文件），三端统一 */}
        {
          <div className="file-tab-wrap">
            <button
              className={`ribbon-tab ribbon-tab-file ${fileOpen ? 'open' : ''}`}
              onMouseDown={(e) => {
                e.stopPropagation()
                closeSiblingPanels(e, closePanels, 'file')
              }}
              onClick={() => setFileOpen((v) => !v)}
            >
              {t('ribbonTabFile')}
            </button>
            {fileOpen && (
              <div className="file-menu">
                <button
                  onClick={() => {
                    setFileOpen(false)
                    onOpen()
                  }}
                >
                  {t('ribbonFileOpen')}{' '}
                  <span className="file-menu-key">{IS_MAC ? '⌘O' : 'Ctrl+O'}</span>
                </button>
                {onOpenRecent && recents.length > 0 && (
                  <>
                    <div className="file-menu-sec">{t('ribbonFileRecent')}</div>
                    {recents.map((p) => (
                      <button
                        key={p}
                        title={p}
                        onClick={() => {
                          setFileOpen(false)
                          onOpenRecent(p)
                        }}
                      >
                        <span className="file-menu-recent">{p.split(/[\\/]/).pop()}</span>
                      </button>
                    ))}
                  </>
                )}
                <button
                  disabled={!hasDoc}
                  onClick={() => {
                    setFileOpen(false)
                    onSave()
                  }}
                >
                  {t('ribbonFileSave')}{' '}
                  <span className="file-menu-key">{IS_MAC ? '⌘S' : 'Ctrl+S'}</span>
                </button>
                <button
                  disabled={!hasDoc}
                  onClick={() => {
                    setFileOpen(false)
                    onSaveAs()
                  }}
                >
                  {t('ribbonFileSaveAs')}{' '}
                  <span className="file-menu-key">{IS_MAC ? '⇧⌘S' : 'Ctrl+Shift+S'}</span>
                </button>
                <button
                  disabled={!hasDoc}
                  onClick={() => {
                    setFileOpen(false)
                    onExportPdf()
                  }}
                >
                  {t('ribbonFileExportPdf')}
                </button>
                <button
                  disabled={!hasDoc}
                  onClick={() => {
                    setFileOpen(false)
                    onPrint()
                  }}
                >
                  {t('ribbonFilePrint')}{' '}
                  <span className="file-menu-key">{IS_MAC ? '⌘P' : 'Ctrl+P'}</span>
                </button>
                <button
                  disabled={!hasDoc}
                  onClick={() => {
                    setFileOpen(false)
                    onExportImages()
                  }}
                >
                  {t('ribbonFileExportImages')}
                </button>
              </div>
            )}
          </div>
        }
        <button
          className="qa-btn"
          data-tip={t('ribbonSaveTip')}
          aria-label={t('ribbonSaveTip')}
          disabled={!dirty}
          onClick={onSave}
        >
          <IconSave size={16} />
        </button>
        {/* onMouseDown+preventDefault like the format buttons: keep contentEditable focus so undo/redo reaches
            the active text edit. onClick with detail===0 covers keyboard activation (Enter/Space emit only click). */}
        <button
          className="qa-btn"
          data-tip={t('ribbonUndo')}
          aria-label={t('ribbonUndo')}
          disabled={!hasDoc || (!canUndo && !editing)}
          onMouseDown={(e) => {
            e.preventDefault()
            onUndo()
          }}
          onClick={(e) => {
            if (e.detail === 0) onUndo()
          }}
        >
          <IconUndo size={16} />
        </button>
        <button
          className="qa-btn"
          data-tip={t('ribbonRedo')}
          aria-label={t('ribbonRedo')}
          disabled={!hasDoc || (!canRedo && !editing)}
          onMouseDown={(e) => {
            e.preventDefault()
            onRedo()
          }}
          onClick={(e) => {
            if (e.detail === 0) onRedo()
          }}
        >
          <IconRedo size={16} />
        </button>
        <label
          className={`autosave-toggle ${autoSave ? 'on' : ''}`}
          data-tip={t('ribbonAutoSaveTip')}
        >
          <span className="autosave-knob" />
          <span className="autosave-text">{t('ribbonAutoSave')}</span>
          <input
            type="checkbox"
            checked={autoSave}
            onChange={(e) => onAutoSaveChange(e.target.checked)}
          />
        </label>
        <span className="qa-sep" aria-hidden="true" />
        <div className="ribbon-tabs-scroll" ref={tabStrip.viewportRef}>
          <div className="ribbon-tabs-track" ref={tabStrip.trackRef}>
            {TABS.filter((tb) => tb !== 'file').map((tb) => (
              <button
                key={tb}
                className={`ribbon-tab ${tab === tb ? 'active' : ''}`}
                onClick={() => {
                  setTab(tb)
                  setFileOpen(false)
                }}
                onDoubleClick={() => setCollapsed((v) => !v)}
              >
                {t(TAB_LABEL[tb])}
              </button>
            ))}
            {contextTab && (
              <button
                key={contextTab}
                className={`ribbon-tab ribbon-tab-context ${tab === contextTab ? 'active' : ''}`}
                onClick={() => setTab(contextTab)}
                data-tip={t(TAB_LABEL[contextTab])}
              >
                {t(TAB_LABEL[contextTab])}
              </button>
            )}
          </div>
          <TabStripArrows
            overflow={tabStrip}
            leadLabel={t('ribbonTabScrollLeft')}
            tailLabel={t('ribbonTabScrollRight')}
          />
        </div>
        {aiPanelAvailable && (
          <AiPanelToggle
            open={aiPanelOpen}
            onToggle={onToggleAiPanel}
            label={t('aiOpenAssistant')}
          />
        )}
      </div>

      {/* WPS 功能区右下角展开/折叠图标 */}
      <button
        type="button"
        className="ribbon-collapse-btn"
        aria-label={collapsed ? t('ribbonExpandTip') : t('ribbonCollapseTip')}
        data-tip={collapsed ? t('ribbonExpandTip') : t('ribbonCollapseTip')}
        onClick={() => setCollapsed((v) => !v)}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d={collapsed ? 'M5.5 14.75 12 8.25l6.5 6.5' : 'M5.5 9.25 12 15.75l6.5-6.5'}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <div
        className="ribbon-body"
        ref={bodyRef}
        style={collapsed ? { display: 'none' } : undefined}
      >
        {tab === 'home' ? (
          <RibbonHomeTab rb={tabCtx} />
        ) : tab === 'insert' ? (
          <RibbonInsertTab rb={tabCtx} />
        ) : tab === 'draw' ? (
          (() => {
            // Draw tab: tool buttons, then a tray of ready pens.
            // Clicking a pen picks it up; clicking the held pen opens its
            // color/width flyout; customisations stick to that pen preset.
            const applyPenPreset = (preset: PenPreset) => {
              // onInkTool toggles back to 'select' when the active tool is re-picked;
              // only switch when it actually differs so editing color/width (or swapping
              // to another pen of the same kind) never drops the pen
              if (inkTool !== preset.kind) onInkTool(preset.kind)
              if (preset.kind === 'pen')
                onInkPen({ ...inkPen, color: preset.color, width: preset.width })
              else onInkHighlighter({ ...inkHighlighter, color: preset.color, width: preset.width })
            }
            const updatePenPreset = (
              index: number,
              patch: Partial<Pick<PenPreset, 'color' | 'width'>>,
            ) => {
              const next = penPresets.map((p, i) => (i === index ? { ...p, ...patch } : p))
              setPenPresets(next)
              applyPenPreset(next[index])
            }
            // Color swatches + width dots editing one pen preset (same controls as
            // apps/docs DrawTab); shown inline for the selected pen and reused by the
            // held-pen flyout
            const renderInkSettings = (index: number) => {
              const preset = penPresets[index]!
              const widths = preset.kind === 'highlighter' ? HIGHLIGHTER_WIDTHS : PEN_WIDTHS
              return (
                <div className="ink-settings">
                  <div className="ink-swatches">
                    {INK_COLORS.map((hex) => (
                      <button
                        key={hex}
                        className={`ink-swatch ${preset.color === hex ? 'active' : ''}`}
                        style={{ background: `#${hex}` }}
                        data-tip={`#${hex}`}
                        aria-label={`#${hex}`}
                        disabled={!hasDoc}
                        onClick={() => updatePenPreset(index, { color: hex })}
                      />
                    ))}
                  </div>
                  <div className="ink-widths">
                    {widths.map((w) => (
                      <button
                        key={w}
                        className={`ink-width ${preset.width === w ? 'active' : ''}`}
                        data-tip={t('ribbonInkWidthTip', { w })}
                        aria-label={t('ribbonInkWidthTip', { w })}
                        disabled={!hasDoc}
                        onClick={() => updatePenPreset(index, { width: w })}
                      >
                        <span
                          className="ink-width-dot"
                          style={{
                            width: Math.min(16, w * 2 + 2),
                            height: Math.min(16, w * 2 + 2),
                            background: `#${preset.color}`,
                          }}
                        />
                      </button>
                    ))}
                  </div>
                </div>
              )
            }
            return (
              <>
                <Group label={t('ribbonGroupDrawTools')}>
                  <button
                    className={`rb-big ${inkTool === 'select' ? 'active' : ''}`}
                    disabled={!hasDoc}
                    data-tip={t('ribbonSelectTip')}
                    onClick={() => {
                      setPenFlyout(null)
                      onInkTool('select')
                    }}
                  >
                    <span className="rb-big-icon">
                      <IconCursor size={BIG} />
                    </span>
                    <span>{t('ribbonGroupSelect')}</span>
                  </button>
                  <button
                    className={`rb-big ${inkTool === 'eraser' ? 'active' : ''}`}
                    disabled={!hasDoc}
                    data-tip={t('ribbonEraserTip')}
                    onClick={() => {
                      setPenFlyout(null)
                      onInkTool('eraser')
                    }}
                  >
                    <span className="rb-big-icon">
                      <IconEraser size={BIG} />
                    </span>
                    <span>{t('ribbonEraser')}</span>
                  </button>
                </Group>
                <div className="ribbon-sep" />
                <Group label={t('ribbonGroupPenStyle')}>
                  <div className="pen-tray">
                    {penPresets.map((preset, i) => {
                      const held = selectedPen === i && inkTool === preset.kind
                      return (
                        <button
                          key={i}
                          className={`pen-btn ${held ? 'down' : ''}`}
                          disabled={!hasDoc}
                          data-tip={
                            preset.kind === 'pen' ? t('ribbonPenTip') : t('ribbonHighlighterTip')
                          }
                          aria-label={
                            preset.kind === 'pen' ? t('ribbonPenTip') : t('ribbonHighlighterTip')
                          }
                          onClick={(event) => {
                            if (held) {
                              const rect = event.currentTarget.getBoundingClientRect()
                              setPenFlyout(
                                penFlyout?.index === i
                                  ? null
                                  : {
                                      index: i,
                                      x: Math.round(rect.left),
                                      y: Math.round(rect.bottom + 6),
                                    },
                              )
                            } else {
                              setSelectedPen(i)
                              setPenFlyout(null)
                              applyPenPreset(preset)
                            }
                          }}
                        >
                          <PenThumb kind={preset.kind} color={preset.color} />
                        </button>
                      )
                    })}
                  </div>
                  {renderInkSettings(selectedPen)}
                </Group>
                <div className="ribbon-sep" />
                <Group label={t('ribbonGroupClear')}>
                  <button
                    className="rb-big"
                    disabled={!hasDoc || inkCount === 0}
                    data-tip={t('ribbonEraseAllTip')}
                    onClick={onInkClearAll}
                  >
                    <span className="rb-big-icon">
                      <IconEraser size={BIG} />
                    </span>
                    <span>{t('ribbonEraseAll')}</span>
                  </button>
                </Group>
                {penFlyout && (
                  <>
                    <div className="pen-flyout-backdrop" onClick={() => setPenFlyout(null)} />
                    <div className="pen-flyout" style={{ left: penFlyout.x, top: penFlyout.y }}>
                      {renderInkSettings(penFlyout.index)}
                    </div>
                  </>
                )}
              </>
            )
          })()
        ) : tab === 'design' ? (
          <>
            <Group label={t('ribbonGroupThemes')}>
              <div className="theme-gallery">
                {THEME_PRESETS.map((tp) => (
                  <button
                    key={tp.id}
                    className="theme-card"
                    disabled={!hasDoc}
                    data-tip={t('ribbonApplyThemeTip', { name: themeDisplayName(tp, t) })}
                    onClick={() => onApplyTheme(tp)}
                    style={{ background: `#${tp.colors.lt1}`, color: `#${tp.colors.dk1}` }}
                  >
                    <span className="theme-card-aa" style={{ fontFamily: tp.majorFont }}>
                      Aa
                    </span>
                    <span className="theme-card-dots">
                      {['accent1', 'accent2', 'accent3', 'accent4'].map((k) => (
                        <span
                          key={k}
                          className="theme-card-dot"
                          style={{ background: `#${tp.colors[k]}` }}
                        />
                      ))}
                    </span>
                    <span className="theme-card-name">{themeDisplayName(tp, t)}</span>
                  </button>
                ))}
              </div>
            </Group>
            <div className="ribbon-sep" />
            <Group label={t('ribbonGroupBackground')}>
              <button
                className="rb-big"
                disabled={!hasDoc}
                onClick={onFormatBackground}
                data-tip={t('ribbonFormatBackgroundTip')}
              >
                <span className="rb-big-icon">
                  <IconPageColor size={BIG} />
                </span>
                <span>{t('ribbonFormatBackground')}</span>
              </button>
            </Group>
            <div className="ribbon-sep" />
            <Group label={t('ribbonGroupCustomize')}>
              <div className="rb-drop-wrap">
                <button
                  className={`rb-big ${slideSizeOpen ? 'active' : ''}`}
                  disabled={!hasDoc}
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    closeSiblingPanels(e, closePanels, 'slideSize')
                  }}
                  onClick={() => setSlideSizeOpen((v) => !v)}
                  data-tip={t('ribbonSlideSizeTip')}
                >
                  <span className="rb-big-icon">
                    <IconPageSize size={BIG} />
                    <RbCaret />
                  </span>
                  <span>{t('ribbonSlideSize')}</span>
                </button>
                {slideSizeOpen && (
                  <div className="rb-drop rb-menu" onMouseDown={(e) => e.stopPropagation()}>
                    {(
                      [
                        ['16:9', t('ribbonSlideSize169'), 12192000, 6858000],
                        ['4:3', t('ribbonSlideSize43'), 9144000, 6858000],
                      ] as const
                    ).map(([key, label, cx, cy]) => (
                      <button
                        key={key}
                        className={slideSizeKey === key ? 'on' : ''}
                        onClick={() => {
                          setSlideSizeOpen(false)
                          onSlideSize(cx, cy)
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Group>
          </>
        ) : tab === 'transitions' ? (
          <>
            <Group label={t('ribbonGroupTransitionToThis')}>
              {/* WPS 对齐：效果固定两行缩略画廊，常驻展开（12 项恰好 2×6） */}
              <div className="rb-gallery">
                {TRANSITIONS.map((tr) => (
                  <button
                    key={tr.kind}
                    className={`rb-gal-cell ${transition === tr.kind ? 'active' : ''}`}
                    disabled={!hasDoc}
                    onClick={() => onTransition(tr.kind, false)}
                    data-tip={
                      tr.kind === 'none'
                        ? t('ribbonTransNoneTip')
                        : t('ribbonTransApplyTip', { name: t(tr.label) })
                    }
                  >
                    <span className="rb-big-icon rb-trans-glyph">{tr.icon}</span>
                    <span>{t(tr.label)}</span>
                  </button>
                ))}
              </div>
              {/* WPS 效果选项：当前效果的方向/变体菜单（无选项的效果禁用） */}
              <TransEffectOptions
                kind={transition}
                spec={transSpec}
                disabled={!hasDoc || transition === 'none'}
                onPick={onTransitionOption}
              />
            </Group>
            <div className="ribbon-sep" />
            <Group label={t('ribbonGroupTiming')}>
              {/* 计时栅格与动画 tab 同款（标签｜控件｜单位 三列） */}
              <div className="rb-timing-grid">
                <span className="rb-timing-label">{t('ribbonTransDuration')}</span>
                <input
                  key={`trdur-${transSpec?.durationMs ?? ''}`}
                  type="number"
                  min={0.05}
                  max={20}
                  step={0.05}
                  disabled={!hasDoc}
                  defaultValue={
                    transSpec?.durationMs != null
                      ? (transSpec.durationMs / 1000).toFixed(2)
                      : '0.50'
                  }
                  aria-label={t('ribbonTransDuration')}
                  title={t('ribbonTransDurationTip')}
                  onBlur={(e) => {
                    const v = parseFloat(e.target.value)
                    if (Number.isFinite(v) && v >= 0.05 && v <= 20) {
                      const ms = Math.round(v * 1000)
                      if (ms !== transSpec?.durationMs) onTransitionDuration(ms)
                    } else {
                      e.target.value = ((transSpec?.durationMs ?? 500) / 1000).toFixed(2)
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  }}
                />
                <span>
                  <span className="rb-timing-unit">{t('ribbonSecondsUnit')}</span>
                </span>
                <span className="rb-timing-label">{t('ribbonTransSound')}</span>
                <TransSoundSelect
                  value={transSpec?.sound ?? null}
                  disabled={!hasDoc}
                  onPick={(name) => onTransitionSound({ name })}
                  onPickCustom={(file) =>
                    onTransitionSound({
                      name: 'custom',
                      fileName: file.name,
                      bytes: file.bytes.buffer.slice(
                        file.bytes.byteOffset,
                        file.bytes.byteOffset + file.bytes.byteLength,
                      ) as ArrayBuffer,
                      ext: file.ext,
                    })
                  }
                  onToggleLoop={() =>
                    onTransitionSound({
                      name: (transSpec?.sound?.name as TransitionSoundKey) ?? null,
                      loop: !(transSpec?.sound?.loop === true),
                    })
                  }
                />
                <span className="rb-timing-unit" aria-hidden="true" />
                <RbCheck
                  label={t('ribbonAdvanceOnClick')}
                  on
                  disabled
                  title={t('ribbonAdvanceOnClickTip')}
                  onClick={() => {}}
                />
                <span className="rb-timing-unit" aria-hidden="true" />
                <span className="rb-timing-unit" aria-hidden="true" />
                <RbCheck
                  label={t('ribbonAutoAdvance')}
                  on={advanceMs !== null}
                  disabled={!hasDoc}
                  title={t('ribbonAutoAdvanceTip')}
                  onClick={() => onAdvanceTime(advanceMs === null ? 5000 : null)}
                />
                <input
                  key={`adv-${advanceMs ?? ''}`}
                  type="number"
                  min={0}
                  step={0.1}
                  disabled={!hasDoc || advanceMs === null}
                  defaultValue={advanceMs !== null ? (advanceMs / 1000).toFixed(2) : ''}
                  aria-label={t('ribbonAutoAdvance')}
                  onBlur={(e) => {
                    if (advanceMs === null) return
                    const v = parseFloat(e.target.value)
                    const ms = Number.isFinite(v) && v > 0 ? Math.round(v * 1000) : null
                    if (ms !== advanceMs) onAdvanceTime(ms)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  }}
                />
                <span>
                  <span className="rb-timing-unit">{t('ribbonSecondsUnit')}</span>
                </span>
              </div>
              <button
                className="rb-big"
                disabled={!hasDoc}
                onClick={() => onTransition(transition, true)}
                data-tip={t('ribbonTransApplyAllTip')}
              >
                <span className="rb-big-icon">
                  <IconApplyAll size={BIG} />
                </span>
                <span>{t('ribbonApplyToAll')}</span>
              </button>
            </Group>
          </>
        ) : tab === 'animations' ? (
          <>
            {/* 动画刷 (WPS 动画 #1)：单击复制当前选中对象的动画，再选中目标后单击应用 */}
            <Group label={t('ribbonAnimBrushGroup')}>
              <button
                className={`rb-big ${animBrush != null ? 'active' : ''}`}
                disabled={!hasDoc || !hasSelection}
                data-tip={
                  animBrush != null ? t('ribbonAnimBrushApplyTip') : t('ribbonAnimBrushCopyTip')
                }
                onClick={onToggleAnimBrush}
              >
                <span className="rb-big-icon">
                  <IconAnimBrush size={BIG} />
                </span>
                <span>{t('ribbonAnimBrush')}</span>
              </button>
            </Group>
            <div className="ribbon-sep" />
            <Group label={t('ribbonPreview')}>
              <button
                className="rb-big"
                disabled={!hasDoc || animCount === 0}
                onClick={onAnimPreview}
                data-tip={t('ribbonAnimPreviewTip')}
              >
                <span className="rb-big-icon">
                  <IconPlayCurrent size={BIG} />
                </span>
                <span>{t('ribbonPreview')}</span>
              </button>
            </Group>
            <div className="ribbon-sep" />
            {/* WPS 对齐：动画效果画廊常驻展开（无 + 19 效果，两行可见、画廊内滚动），
                不再整组折叠成一个下拉按钮 */}
            <Group label={t('ribbonGroupAnimation')}>
              <div className="rb-gallery">
                <button
                  className="rb-gal-cell"
                  disabled={!hasDoc || !hasSelection}
                  onClick={() => onApplyAnimation('none')}
                  data-tip={t('ribbonAnimNoneTip')}
                >
                  <span className="rb-big-icon rb-anim-glyph">
                    <IconAnimNone size={BIG} />
                  </span>
                  <span>{t('ribbonNone')}</span>
                </button>
                {ANIM_EFFECTS.map((a) => (
                  <button
                    key={a.kind}
                    className={`rb-gal-cell ${selectedAnimEffect === a.kind ? 'active' : ''}`}
                    disabled={!hasDoc || !hasSelection}
                    onClick={() => onApplyAnimation(a.kind)}
                    onMouseEnter={() => {
                      if (hasDoc && hasSelection) animHoverStart(a.kind)
                    }}
                    onMouseLeave={animHoverStop}
                    data-tip={t('ribbonAnimApplyTip', {
                      cls: t(ANIM_CLS_TITLE[a.cls]),
                      name: t(a.label),
                    })}
                  >
                    <span className={`rb-big-icon rb-anim-glyph rb-anim-${a.cls}`}>
                      <AnimEffectIcon kind={a.kind} size={BIG} />
                    </span>
                    <span>{t(a.label)}</span>
                  </button>
                ))}
              </div>
            </Group>
            <div className="ribbon-sep" />
            <Group
              label={t('ribbonGroupMotionPaths')}
              groupId="motionPaths"
              collapse={{
                collapsed: collapsedGroups.includes('motionPaths'),
                open: collapseOpen === 'motionPaths',
                onToggle: () => {
                  closePanels(['collapse'])
                  setCollapseOpen((v) => (v === 'motionPaths' ? null : 'motionPaths'))
                },
                icon: (
                  <span className="rb-anim-glyph rb-anim-path">
                    <IconPathDiagonal size={20} />
                  </span>
                ),
              }}
            >
              {/* 画廊形态与切换/动画效果一致（5 项单行） */}
              <div className="rb-gallery">
                {MOTION_PATHS.map((mp) => (
                  <button
                    key={mp.label}
                    className="rb-gal-cell"
                    disabled={!hasDoc || !hasSelection}
                    onClick={() => onApplyMotionPath(mp.path)}
                    onMouseEnter={() => {
                      if (hasDoc && hasSelection) animHoverStart('motionPath', mp.path)
                    }}
                    onMouseLeave={animHoverStop}
                    data-tip={t('ribbonMotionPathTip', { name: t(mp.label) })}
                  >
                    <span className="rb-big-icon rb-anim-glyph rb-anim-path">{mp.icon}</span>
                    <span>{t(mp.label)}</span>
                  </button>
                ))}
              </div>
            </Group>
            <div className="ribbon-sep" />
            <Group label={t('ribbonGroupAdvancedAnim')}>
              <AnimVariantPicker
                effect={selectedAnimEffect}
                currentVariant={timingAnim?.variant}
                disabled={!hasDoc || !hasSelection}
                onPick={onAnimVariant}
                onHover={(v) => {
                  if (hasDoc && hasSelection && selectedAnimEffect)
                    onAnimHoverPreview(selectedAnimEffect, undefined, v)
                }}
                onHoverEnd={onAnimHoverEnd}
              />
              {dropBig(
                'addanim',
                <IconSparkle size={BIG} />,
                t('ribbonAddAnimation'),
                t('ribbonAddAnimationTip'),
                <div className="rb-menu rb-anim-menu">
                  {(['entr', 'emph', 'exit'] as const).map((cls) => (
                    <React.Fragment key={cls}>
                      <div className="rb-drop-title">{t(ANIM_CLS_TITLE[cls])}</div>
                      {ANIM_EFFECTS.filter((a) => a.cls === cls).map((a) => (
                        <button
                          key={a.kind}
                          onClick={() => {
                            onAddAnimation(a.kind)
                            setInsertDrop(null)
                          }}
                          onMouseEnter={() => {
                            if (hasDoc && hasSelection) animHoverStart(a.kind)
                          }}
                          onMouseLeave={animHoverStop}
                        >
                          <span className={`rb-anim-glyph rb-anim-${a.cls}`}>
                            <AnimEffectIcon kind={a.kind} size={15} />
                          </span>{' '}
                          {t(a.label)}
                        </button>
                      ))}
                    </React.Fragment>
                  ))}
                </div>,
                !hasDoc || !hasSelection,
              )}
              <button
                className={`rb-big ${animPaneOpen ? 'active' : ''}`}
                disabled={!hasDoc}
                onClick={onToggleAnimPane}
                data-tip={t('ribbonAnimPaneTip')}
              >
                <span className="rb-big-icon">
                  <IconNavPane size={BIG} />
                </span>
                <span>{t('ribbonAnimPane')}</span>
              </button>
              <button
                className={`rb-big ${animByParagraph ? 'active' : ''}`}
                disabled={!hasDoc}
                onClick={onToggleAnimByParagraph}
                data-tip={t('ribbonAnimByParaTip')}
              >
                <span className="rb-big-icon">
                  <IconBullets size={BIG} />
                </span>
                <span>{t('ribbonAnimByPara')}</span>
              </button>
            </Group>
            <div className="ribbon-sep" />
            <Group label={t('ribbonGroupTiming')}>
              {/* 计时栅格与切换 tab 同款（标签｜控件｜单位 三列） */}
              <div className="rb-timing-grid">
                <span className="rb-timing-label">{t('ribbonAnimStart')}</span>
                <Dropdown
                  disabled={!timingAnim}
                  value={timingAnim?.trigger ?? 'onClick'}
                  tip={t('ribbonAnimTriggerTip')}
                  options={(
                    [
                      ['onClick', t('ribbonAnimOnClick')],
                      ['withPrev', t('ribbonAnimWithPrev')],
                      ['afterPrev', t('ribbonAnimAfterPrev')],
                    ] as const
                  ).map(([k, label]) => ({ value: k, label }))}
                  onPick={(trigger) => onAnimTiming({ trigger })}
                />
                <span className="rb-timing-unit" aria-hidden="true" />
                <span className="rb-timing-label">{t('ribbonAnimDuration')}</span>
                <input
                  key={`dur-${timingAnim?.sourceId ?? ''}-${timingAnim?.durationMs ?? ''}`}
                  type="number"
                  min={0}
                  step={0.1}
                  disabled={!timingAnim}
                  defaultValue={timingAnim ? (timingAnim.durationMs / 1000).toFixed(2) : ''}
                  onBlur={(e) => {
                    const v = parseFloat(e.target.value)
                    if (
                      timingAnim &&
                      Number.isFinite(v) &&
                      Math.round(v * 1000) !== timingAnim.durationMs
                    )
                      onAnimTiming({ durationMs: Math.max(0, Math.round(v * 1000)) })
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  }}
                  title={t('ribbonAnimDurationTip')}
                />
                <span className="rb-timing-unit">{t('ribbonSecondsUnit')}</span>
                <span className="rb-timing-label">{t('ribbonAnimDelay')}</span>
                <input
                  key={`delay-${timingAnim?.sourceId ?? ''}-${timingAnim?.delayMs ?? ''}`}
                  type="number"
                  min={0}
                  step={0.1}
                  disabled={!timingAnim}
                  defaultValue={timingAnim ? (timingAnim.delayMs / 1000).toFixed(2) : ''}
                  onBlur={(e) => {
                    const v = parseFloat(e.target.value)
                    if (
                      timingAnim &&
                      Number.isFinite(v) &&
                      Math.round(v * 1000) !== timingAnim.delayMs
                    )
                      onAnimTiming({ delayMs: Math.max(0, Math.round(v * 1000)) })
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  }}
                  title={t('ribbonAnimDelayTip')}
                />
                <span className="rb-timing-unit">{t('ribbonSecondsUnit')}</span>
              </div>
            </Group>
          </>
        ) : tab === 'slideShow' ? (
          <>
            <Group label={t('ribbonGroupStartShow')}>
              <button
                className="rb-big"
                disabled={!hasDoc}
                onClick={() => onSlideShow(true)}
                data-tip={t('ribbonFromBeginningTip')}
              >
                <span className="rb-big-icon">
                  <IconPlayFromStart size={BIG} />
                </span>
                <span>{t('ribbonFromBeginning')}</span>
              </button>
              <button
                className="rb-big"
                disabled={!hasDoc}
                onClick={() => onSlideShow(false)}
                data-tip={t('ribbonFromCurrentTip')}
              >
                <span className="rb-big-icon">
                  <IconPlayCurrent size={BIG} />
                </span>
                <span>{t('ribbonFromCurrent')}</span>
              </button>
              <button
                className="rb-big"
                disabled={!hasDoc}
                onClick={() => onPresenterView(true)}
                data-tip={t('ribbonPresenterViewTip')}
              >
                <span className="rb-big-icon">
                  <IconPresenterView size={BIG} />
                </span>
                <span>{t('ribbonPresenterView')}</span>
              </button>
              <button
                className="rb-big"
                disabled={!hasDoc}
                onClick={onCustomShow}
                data-tip={t('ribbonCustomShowTip')}
              >
                <span className="rb-big-icon">
                  <IconCustomShow size={BIG} />
                </span>
                <span>{t('ribbonCustomShow')}</span>
              </button>
            </Group>
            <div className="ribbon-sep" />
            <Group label={t('ribbonGroupSetUp')}>
              {/* 放映设置⌄ (WPS 放映 #5): 循环放映真实写盘（presProps p:showPr） */}
              <div className="rb-drop-wrap">
                <button
                  className={`rb-big ${showSettingsOpen ? 'active' : ''}`}
                  disabled={!hasDoc}
                  data-tip={t('ribbonShowSettingsTip')}
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    closeSiblingPanels(e, closePanels, 'slideShow')
                  }}
                  onClick={() => setShowSettingsOpen((v) => !v)}
                >
                  <span className="rb-big-icon">
                    <IconSetupShow size={BIG} />
                    <RbCaret />
                  </span>
                  <span>{t('ribbonShowSettings')}</span>
                </button>
                {showSettingsOpen && (
                  <div className="rb-drop rb-menu" onMouseDown={(e) => e.stopPropagation()}>
                    <button
                      className={showLoop ? 'active' : ''}
                      onClick={() => {
                        onSetShowLoop(!showLoop)
                        setShowSettingsOpen(false)
                      }}
                    >
                      {showLoop ? '✓ ' : ''}
                      {t('ribbonShowLoop')}
                    </button>
                  </div>
                )}
              </div>
              <button
                className={`rb-big ${currentHidden ? 'active' : ''}`}
                disabled={!hasDoc}
                onClick={onToggleHidden}
                data-tip={currentHidden ? t('ribbonUnhideSlideTip') : t('ribbonHideSlideTip')}
              >
                <span className="rb-big-icon">
                  <IconHideSlide size={BIG} />
                </span>
                <span>{t('ribbonHideSlide')}</span>
              </button>
              {/* WPS 排练计时⌄: 开始排练 / 清除排练计时 */}
              {dropBig(
                'rehearse',
                <IconRehearse size={BIG} />,
                t('ribbonRehearse'),
                t('ribbonRehearseTip'),
                <div className="rb-menu">
                  <button
                    onClick={() => {
                      setInsertDrop(null)
                      onRehearse()
                    }}
                  >
                    {t('ribbonRehearseStart')}
                  </button>
                  <button
                    onClick={() => {
                      setInsertDrop(null)
                      onClearRehearse()
                    }}
                  >
                    {t('ribbonClearRehearse')}
                  </button>
                </div>,
              )}
              <DisabledBig icon={<IconRecord size={BIG} />} label={t('ribbonRecord')} />
              <button
                className="rb-big"
                disabled={!hasDoc}
                data-tip={t('ribbonCountdownTip')}
                onClick={onCountdownShow}
              >
                <span className="rb-big-icon">
                  <IconCountdown size={BIG} />
                </span>
                <span>{t('ribbonCountdown')}</span>
              </button>
            </Group>
            <div className="ribbon-sep" />
            {/* WPS 放映组: 放映到[显示器]⌄ + ☑显示演讲者视图 */}
            <Group label={t('ribbonGroupShowOn')}>
              <Dropdown
                className="rb-show-display-dd"
                value={String(showDisplayId ?? '')}
                disabled={!hasDoc || showDisplays.length === 0}
                tip={t('ribbonShowOnDisplayTip')}
                options={[
                  { value: '', label: t('ribbonShowOnCurrent') },
                  ...showDisplays.map((d) => ({
                    value: String(d.id),
                    label: d.primary
                      ? t('ribbonShowOnPrimary')
                      : t('ribbonShowOnDisplayN', { n: d.index + 1 }),
                  })),
                ]}
                onPick={(v) => onShowDisplay(v === '' ? null : Number(v))}
              />
              <RbCheck
                label={t('ribbonShowPresenterCheck')}
                on={showWithPresenter}
                title={t('ribbonShowPresenterCheckTip')}
                onClick={onToggleShowWithPresenter}
              />
            </Group>
          </>
        ) : tab === 'review' ? (
          <>
            <Group label={t('ribbonGroupProofing')}>
              <button
                className="rb-big"
                disabled={!hasDoc}
                data-tip={`${t('ribbonSpellCheckTip')} — ${t('ribbonAiCreditNote')}`}
                onClick={() => {
                  if (confirmAiRewrite()) onAiPreset(t('ribbonSpellCheckPrompt'))
                }}
              >
                <span className="rb-big-icon">
                  <span className="ai-feature-icon" aria-hidden="true">
                    <img src={iconSpelling} width={22} height={22} alt="" />
                  </span>
                </span>
                <span>{t('ribbonSpellCheck')}</span>
              </button>
              <div className="rb-drop-wrap">
                <button
                  className={`rb-big ${translateOpen ? 'active' : ''}`}
                  disabled={!hasDoc}
                  data-tip={`${t('ribbonTranslateTip')} — ${t('ribbonAiCreditNote')}`}
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    closeSiblingPanels(e, closePanels, 'translate')
                  }}
                  onClick={() => setTranslateOpen((v) => !v)}
                >
                  <span className="rb-big-icon">
                    <span className="ai-feature-icon" aria-hidden="true">
                      <img src={iconTranslate} width={22} height={22} alt="" />
                    </span>
                    <RbCaret />
                  </span>
                  <span>{t('ribbonTranslate')}</span>
                </button>
                {translateOpen && (
                  <div className="rb-drop rb-menu" onMouseDown={(e) => e.stopPropagation()}>
                    {TRANSLATE_TARGETS.map((lang) => (
                      <button
                        key={lang}
                        onClick={() => {
                          setTranslateOpen(false)
                          if (confirmAiRewrite()) {
                            onAiPreset(t('ribbonTranslatePrompt', { lang: t(lang) }))
                          }
                        }}
                      >
                        {t(lang)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Group>
            <div className="ribbon-sep" />
            <Group label={t('ribbonGroupComments')}>
              <button
                className="rb-big"
                disabled={!hasDoc}
                onClick={onNewComment}
                data-tip={t('ribbonNewCommentTip')}
              >
                <span className="rb-big-icon">
                  <IconComment size={BIG} />
                </span>
                <span>{t('ribbonNewComment')}</span>
              </button>
              <button
                className={`rb-big ${commentsOpen ? 'active' : ''}`}
                disabled={!hasDoc}
                onClick={onToggleComments}
                data-tip={t('ribbonCommentsPaneTip')}
              >
                <span className="rb-big-icon">
                  <IconNavPane size={BIG} />
                </span>
                <span>
                  {t('ribbonCommentsPane')}
                  {commentCount > 0 ? t('ribbonCountSuffix', { n: commentCount }) : ''}
                </span>
              </button>
            </Group>
          </>
        ) : tab === 'view' ? (
          <>
            <Group label={t('ribbonGroupPresentationViews')}>
              {(
                [
                  [
                    'normal',
                    <IconPrintLayout key="n" size={BIG} />,
                    t('ribbonViewNormal'),
                    t('ribbonViewNormalTip'),
                  ],
                  [
                    'outline',
                    <IconOutlineView key="o" size={BIG} />,
                    t('ribbonViewOutline'),
                    t('ribbonViewOutlineTip'),
                  ],
                  [
                    'sorter',
                    <IconArrangeAll key="s" size={BIG} />,
                    t('ribbonViewSorter'),
                    t('ribbonViewSorterTip'),
                  ],
                  [
                    'reading',
                    <IconReadMode key="r" size={BIG} />,
                    t('ribbonViewReading'),
                    t('ribbonViewReadingTip'),
                  ],
                ] as const
              ).map(([mode, icon, label, title]) => (
                <button
                  key={mode}
                  className={`rb-big ${viewMode === mode ? 'active' : ''}`}
                  disabled={!hasDoc}
                  onClick={() => onViewMode(mode)}
                  data-tip={title}
                >
                  <span className="rb-big-icon">{icon}</span>
                  <span>{label}</span>
                </button>
              ))}
              <button
                className="rb-big"
                disabled={!hasDoc}
                onClick={onSlideMaster}
                data-tip={t('ribbonViewMasterTip')}
              >
                <span className="rb-big-icon">
                  <IconSlideMaster size={BIG} />
                </span>
                <span>{t('ribbonViewMaster')}</span>
              </button>
            </Group>
            <div className="ribbon-sep" />
            <Group label={t('ribbonGroupShow')}>
              <div className="rb-check-grid">
                <RbCheck
                  label={t('ribbonRuler')}
                  on={showRuler}
                  disabled={!hasDoc}
                  title={t('ribbonRulerTip')}
                  onClick={onToggleRuler}
                />
                <RbCheck
                  label={t('ribbonGridlines')}
                  on={showGrid}
                  disabled={!hasDoc}
                  title={t('ribbonGridlinesTip')}
                  onClick={onToggleGrid}
                />
                <RbCheck
                  label={t('ribbonGuides')}
                  on={showGuides}
                  disabled={!hasDoc}
                  title={t('ribbonGuidesTip')}
                  onClick={onToggleGuides}
                />
                <RbCheck
                  label={t('ribbonNotes')}
                  on={showNotes}
                  disabled={!hasDoc}
                  title={t('ribbonNotesTip')}
                  onClick={onToggleNotes}
                />
                <RbCheck
                  label={t('ribbonThumbnailPane')}
                  on={showThumbs}
                  title={t('ribbonThumbnailPaneTip')}
                  onClick={onToggleThumbs}
                />
              </div>
            </Group>
            <div className="ribbon-sep" />
            <Group label={t('ribbonGroupZoom')}>
              <div className="rb-col">
                <button
                  className="rb-small"
                  disabled={!hasDoc}
                  onClick={() => onZoom((z) => Math.min(z * 1.15, 3))}
                >
                  <IconZoomIn size={18} />
                  <span>{t('ribbonZoomIn')}</span>
                </button>
                <button
                  className="rb-small"
                  disabled={!hasDoc}
                  onClick={() => onZoom((z) => Math.max(z / 1.15, 0.25))}
                >
                  <IconZoomOut size={18} />
                  <span>{t('ribbonZoomOut')}</span>
                </button>
                <button className="rb-small" disabled={!hasDoc} onClick={() => onZoom(1)}>
                  <IconZoom100 size={18} />
                  <span>100%</span>
                </button>
              </div>
              <button
                className="rb-big"
                disabled={!hasDoc}
                onClick={onZoomFit}
                data-tip={t('ribbonFitWindowTip')}
              >
                <span className="rb-big-icon">
                  <IconFitWindow size={BIG} />
                </span>
                <span>{t('ribbonFitWindow')}</span>
              </button>
            </Group>
          </>
        ) : tab === 'tableDesign' ? (
          <>
            <Group label={t('ribbonGroupTableStyles')}>
              {TABLE_STYLE_PRESETS_UI.map((p) => (
                <button
                  key={p.key}
                  className="rb-table-style-card"
                  data-tip={t(p.label)}
                  disabled={!onEditTableStyle}
                  onClick={() => onEditTableStyle?.({ styleName: p.key })}
                >
                  <span className="rb-table-style-preview">
                    <TableMiniPreview {...p.preview} />
                  </span>
                  <span className="rb-table-style-label">{t(p.label)}</span>
                </button>
              ))}
            </Group>
            <div className="ribbon-sep" />
            <Group label={t('ribbonGroupTableOptions')}>
              <TableToggleBtn
                label={t('ribbonHeaderRow')}
                on={tableStyleFlags?.firstRow ?? false}
                disabled={!onEditTableStyle}
                onClick={() => onEditTableStyle?.({ firstRow: true })}
                offClick={() => onEditTableStyle?.({ firstRow: false })}
              />
              <TableToggleBtn
                label={t('ribbonBandedRows')}
                on={tableStyleFlags?.bandRow ?? false}
                disabled={!onEditTableStyle}
                onClick={() => onEditTableStyle?.({ bandRow: true })}
                offClick={() => onEditTableStyle?.({ bandRow: false })}
              />
              <TableToggleBtn
                label={t('ribbonTableRtl')}
                on={tableStyleFlags?.rtl ?? false}
                disabled={!onEditTableStyle}
                onClick={() => onEditTableStyle?.({ rtl: true })}
                offClick={() => onEditTableStyle?.({ rtl: false })}
              />
            </Group>
            <div className="ribbon-sep" />
            <Group label={tableActiveCell ? t('ribbonGroupShadingCell') : t('ribbonGroupShading')}>
              <div className="rb-table-shading">
                {TABLE_SHADING_COLORS.map((c) => (
                  <button
                    key={c}
                    className="rb-color-swatch"
                    style={{ background: c }}
                    data-tip={c}
                    aria-label={c}
                    disabled={!onEditTableStyle}
                    // preventDefault keeps a cell text-edit session alive so shading targets that cell
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() =>
                      onEditTableStyle?.({
                        shadingColor: c,
                        ...(tableActiveCell ? { cells: [tableActiveCell] } : {}),
                      })
                    }
                  />
                ))}
                <button
                  className="rb-color-swatch rb-color-none"
                  data-tip={t('ribbonNoShading')}
                  aria-label={t('ribbonNoShading')}
                  disabled={!onEditTableStyle}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() =>
                    onEditTableStyle?.({
                      shadingColor: 'none',
                      ...(tableActiveCell ? { cells: [tableActiveCell] } : {}),
                    })
                  }
                >
                  <IconNoneX size={12} />
                </button>
              </div>
            </Group>
            <div className="ribbon-sep" />
            <Group label={t('ribbonGroupBorders')}>
              <div className="rb-table-border-row">
                <button
                  className="rb-icon"
                  data-tip={t('ribbonAllBordersTip')}
                  aria-label={t('ribbonAllBordersTip')}
                  disabled={!onEditTableStyle}
                  onClick={() =>
                    onEditTableStyle?.({
                      borderPreset: 'all',
                      borderColor: '#000000',
                      borderWidthPt: 1,
                    })
                  }
                >
                  ⊞
                </button>
                <button
                  className="rb-icon"
                  data-tip={t('ribbonClearBordersTip')}
                  aria-label={t('ribbonClearBordersTip')}
                  disabled={!onEditTableStyle}
                  onClick={() => onEditTableStyle?.({ borderPreset: 'none' })}
                >
                  ⊟
                </button>
              </div>
              <div className="rb-table-border-row">
                <span className="rb-label">{t('ribbonBorderColorLabel')}</span>
                <input
                  type="color"
                  defaultValue="#000000"
                  className="rb-color-input"
                  data-tip={t('ribbonBorderColorTip')}
                  onPointerDown={(e) => armColorInput(e.currentTarget)}
                  onChange={(e) => onEditTableStyle?.({ borderColor: e.target.value })}
                />
                <span className="rb-label">{t('ribbonBorderWeightLabel')}</span>
                <BorderWeightDropdown
                  tip={t('ribbonBorderWeightTip')}
                  onPick={(pt) => onEditTableStyle?.({ borderWidthPt: pt })}
                />
              </div>
            </Group>
          </>
        ) : tab === 'chartDesign' ? (
          <>
            {/* Chart Design group order: chart layout | chart styles | data | type */}
            <Group label={t('ribbonGroupChartLayouts')}>
              <div className="rb-drop-wrap">
                <button
                  className={`rb-big ${chartDrop === 'elements' ? 'active' : ''}`}
                  disabled={!onEditChart}
                  data-tip={t('ribbonAddChartElementTip')}
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    closeSiblingPanels(e, closePanels, 'chart')
                  }}
                  onClick={() => setChartDrop((v) => (v === 'elements' ? null : 'elements'))}
                >
                  <span className="rb-big-icon" style={{ fontSize: 20 }}>
                    ➕<RbCaret />
                  </span>
                  <span>{t('ribbonAddChartElement')}</span>
                </button>
                {chartDrop === 'elements' && (
                  <div
                    className="rb-drop rb-chart-elem-drop"
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <div className="rb-drop-title">{t('ribbonChartTitle')}</div>
                    <div className="rb-row">
                      <input
                        ref={chartTitleRef}
                        className="rb-input-sm"
                        defaultValue={contextChartStyle?.title ?? ''}
                        placeholder={t('ribbonEmptyHidden')}
                      />
                      <button
                        className="rb-icon"
                        onClick={() =>
                          onEditChart?.({ title: chartTitleRef.current?.value.trim() ?? '' })
                        }
                      >
                        {t('ribbonApply')}
                      </button>
                    </div>
                    <div className="rb-drop-title">{t('ribbonAxisTitles')}</div>
                    <label className="rb-row">
                      <span className="rb-label">{t('ribbonCatAxis')}</span>
                      <input
                        ref={catAxisRef}
                        className="rb-input-sm"
                        defaultValue={contextChartStyle?.catAxisTitle ?? ''}
                        placeholder={t('ribbonEmptyHidden')}
                      />
                    </label>
                    <label className="rb-row">
                      <span className="rb-label">{t('ribbonValAxis')}</span>
                      <input
                        ref={valAxisRef}
                        className="rb-input-sm"
                        defaultValue={contextChartStyle?.valAxisTitle ?? ''}
                        placeholder={t('ribbonEmptyHidden')}
                      />
                    </label>
                    <div className="rb-row">
                      <button
                        className="rb-icon"
                        onClick={() =>
                          onEditChart?.({
                            catAxisTitle: catAxisRef.current?.value.trim() ?? '',
                            valAxisTitle: valAxisRef.current?.value.trim() ?? '',
                          })
                        }
                      >
                        {t('ribbonApply')}
                      </button>
                    </div>
                    <div className="rb-drop-title">{t('ribbonLegend')}</div>
                    <div className="rb-row">
                      {(
                        [
                          ['none', t('ribbonNone')],
                          ['b', t('ribbonLegendBottom')],
                          ['t', t('ribbonLegendTop')],
                          ['r', t('ribbonLegendRight')],
                          ['l', t('ribbonLegendLeft')],
                        ] as const
                      ).map(([pos, label]) => (
                        <button
                          key={pos}
                          className={`rb-icon ${(contextChartStyle?.legendPos ?? 'b') === pos ? 'active' : ''}`}
                          onClick={() => onEditChart?.({ legendPos: pos })}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="rb-drop-title">{t('ribbonElementToggles')}</div>
                    <div className="rb-row">
                      <button
                        className={`rb-icon ${contextChartStyle?.dataLabels ? 'active' : ''}`}
                        onClick={() =>
                          onEditChart?.({ dataLabels: !contextChartStyle?.dataLabels })
                        }
                      >
                        {t('ribbonDataLabels')}
                      </button>
                      <button
                        className={`rb-icon ${contextChartStyle?.gridlines ? 'active' : ''}`}
                        onClick={() => onEditChart?.({ gridlines: !contextChartStyle?.gridlines })}
                      >
                        {t('ribbonGridlines')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </Group>
            <div className="ribbon-sep" />
            <Group label={t('ribbonGroupChartStyles')}>
              <div className="rb-drop-wrap">
                <button
                  className={`rb-big ${chartDrop === 'colors' ? 'active' : ''}`}
                  disabled={!onEditChart}
                  data-tip={t('ribbonChangeColorsTip')}
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    closeSiblingPanels(e, closePanels, 'chart')
                  }}
                  onClick={() => setChartDrop((v) => (v === 'colors' ? null : 'colors'))}
                >
                  <span className="rb-big-icon" style={{ fontSize: 20 }}>
                    🎨
                    <RbCaret />
                  </span>
                  <span>{t('ribbonChangeColors')}</span>
                </button>
                {chartDrop === 'colors' && (
                  <div
                    className="rb-drop rb-chart-colors-drop"
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    {(
                      chartColorSchemes ??
                      CHART_COLOR_SCHEME_UI.map((s) => ({ ...s, label: t(s.label) }))
                    ).map((s) => (
                      <button
                        key={s.key}
                        className="rb-chart-scheme-card"
                        data-tip={s.label}
                        onClick={() => {
                          setChartDrop(null)
                          onEditChart?.({ colorScheme: s.key })
                        }}
                      >
                        <span className="rb-chart-scheme-swatches">
                          {s.colors.slice(0, 4).map((c) => (
                            <span
                              key={c}
                              className="rb-chart-scheme-dot"
                              style={{ background: c }}
                            />
                          ))}
                        </span>
                        <span className="rb-chart-scheme-label">{s.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="rb-chart-style-row">
                {CHART_STYLE_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    className={`rb-chart-style-card ${chartPresetActive(contextChartStyle, p) ? 'active' : ''}`}
                    data-tip={t(p.label)}
                    disabled={!onEditChart}
                    onClick={() => onEditChart?.({ ...p.style })}
                  >
                    <ChartStyleThumb kind={contextChartStyle?.kind} style={p.style} />
                    <span className="rb-chart-scheme-label">{t(p.label)}</span>
                  </button>
                ))}
              </div>
            </Group>
            <div className="ribbon-sep" />
            <Group label={t('ribbonGroupData')}>
              <button
                className="rb-big"
                data-tip={t('ribbonSwitchRowColTip')}
                disabled={!onEditChart}
                onClick={() => onEditChart?.({ switchRowCol: true })}
              >
                <span className="rb-big-icon">
                  <IconSwitchRowCol size={BIG} />
                </span>
                <span>{t('ribbonSwitchRowCol')}</span>
              </button>
              <button
                className="rb-big"
                data-tip={t('ribbonEditDataTip')}
                disabled={!onOpenChartDataDialog}
                onClick={onOpenChartDataDialog}
              >
                <span className="rb-big-icon">
                  <IconEditChartData size={BIG} />
                </span>
                <span>{t('ribbonEditData')}</span>
              </button>
            </Group>
            <div className="ribbon-sep" />
            <Group label={t('ribbonGroupType')}>
              <button
                className="rb-big"
                disabled={!onEditChart}
                data-tip={t('ribbonChangeChartType')}
                onClick={() => setChartTypeDlgOpen(true)}
              >
                <span className="rb-big-icon">
                  <IconChangeChartType size={BIG} />
                </span>
                <span>{t('ribbonChangeChartType')}</span>
              </button>
            </Group>
            {chartTypeDlgOpen && (
              <ChartTypeDialog
                current={
                  contextChartStyle && contextChartStyle.kind !== 'unknown'
                    ? contextChartStyle.kind
                    : undefined
                }
                onClose={() => setChartTypeDlgOpen(false)}
                onConfirm={(kind) => {
                  setChartTypeDlgOpen(false)
                  onEditChart?.({ kind })
                }}
              />
            )}
          </>
        ) : tab === 'pictureFormat' ? (
          <>
            <Group label={t('ribbonGroupAdjust')}>
              <button
                className="rb-big"
                data-tip={
                  contextPictureCanCutout ? t('ribbonRemoveBgTip') : t('ribbonRemoveBgDisabledTip')
                }
                disabled={!onPictureCutout || !contextPictureCanCutout}
                onClick={onPictureCutout}
              >
                <span className="rb-big-icon">
                  {/* BIG, not BIG+2: the shared 28px glyph size keeps this button's
                      icon-row height (and label line) identical to its neighbors */}
                  <IconRemoveBg size={BIG} />
                </span>
                <span>{t('ribbonRemoveBg')}</span>
              </button>
              <button
                className="rb-big"
                data-tip={t('ribbonReplacePicture')}
                disabled={!onPictureReplace || contextElementType !== 'picture'}
                onClick={onPictureReplace}
              >
                <span className="rb-big-icon">
                  <IconReplacePicture size={BIG} />
                </span>
                <span>{t('ribbonReplacePicture')}</span>
              </button>
              <div className="rb-drop-wrap">
                <button
                  className={`rb-big ${transparencyOpen ? 'active' : ''}`}
                  disabled={!onPictureOpacity || contextElementType !== 'picture'}
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    closeSiblingPanels(e, closePanels, 'transparency')
                  }}
                  onClick={() => setTransparencyOpen((v) => !v)}
                  data-tip={t('ribbonTransparency')}
                >
                  <span className="rb-big-icon">
                    {/* 28px box around the 22px art so the icon row matches the SVG glyphs' height */}
                    <span className="ai-feature-icon" aria-hidden="true">
                      <img src={iconTransparency} width={22} height={22} alt="" />
                    </span>
                    <RbCaret />
                  </span>
                  <span>{t('ribbonTransparency')}</span>
                </button>
                {transparencyOpen && (
                  <div className="rb-drop rb-menu" onMouseDown={(e) => e.stopPropagation()}>
                    {[0, 15, 30, 50, 65, 80, 95].map((pct) => (
                      <button
                        key={pct}
                        onClick={() => {
                          setTransparencyOpen(false)
                          onPictureOpacity?.(1 - pct / 100)
                        }}
                      >
                        {pct}%
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {contextElementType === 'picture' && onPictureLum && (
                <div className="rb-lum-col">
                  {(['bright', 'contrast'] as const).map((field) => {
                    const value = contextPictureLum?.[field] ?? 0
                    const label =
                      field === 'bright' ? t('ribbonPicBrightness') : t('ribbonPicContrast')
                    return (
                      <div className="rb-lum-row" key={field}>
                        <span className="rb-lum-label">{label}</span>
                        <button
                          className="rb-lum-btn"
                          data-tip={t('ribbonPicDecrease')}
                          aria-label={t('ribbonPicDecrease')}
                          onClick={() =>
                            onPictureLum?.({
                              ...(contextPictureLum ?? { bright: 0, contrast: 0 }),
                              [field]: Math.max(-1, Math.min(1, value - 0.1)),
                            })
                          }
                        >
                          −
                        </button>
                        <span className="rb-lum-value">{Math.round(value * 100)}%</span>
                        <button
                          className="rb-lum-btn"
                          data-tip={t('ribbonPicIncrease')}
                          aria-label={t('ribbonPicIncrease')}
                          onClick={() =>
                            onPictureLum?.({
                              ...(contextPictureLum ?? { bright: 0, contrast: 0 }),
                              [field]: Math.max(-1, Math.min(1, value + 0.1)),
                            })
                          }
                        >
                          +
                        </button>
                      </div>
                    )
                  })}
                  <button
                    className="rb-lum-reset"
                    disabled={!contextPictureLum?.bright && !contextPictureLum?.contrast}
                    data-tip={t('ribbonPicResetAdjustTip')}
                    onClick={() => onPictureLum?.(null)}
                  >
                    {t('ribbonPicReset')}
                  </button>
                </div>
              )}
              {contextElementType === 'picture' && onPictureChange && (
                <button
                  className="rb-big"
                  data-tip={t('ribbonPicChange')}
                  onClick={onPictureChange}
                >
                  <span className="rb-big-icon">
                    <IconPicture size={BIG} />
                  </span>
                  <span>{t('ribbonPicChange')}</span>
                </button>
              )}
              {contextElementType === 'picture' && onPictureCompress && (
                <div className="rb-drop-wrap">
                  <button
                    className={`rb-big ${compressOpen ? 'active' : ''}`}
                    onMouseDown={(e) => {
                      e.stopPropagation()
                      closeSiblingPanels(e, closePanels, 'compress')
                    }}
                    onClick={() => setCompressOpen((v) => !v)}
                    data-tip={t('ribbonCompressPicture')}
                  >
                    <span className="rb-big-icon">
                      <IconPicture size={BIG} />
                    </span>
                    <span>{t('ribbonCompressPicture')}</span>
                    <RbCaret />
                  </button>
                  {compressOpen && (
                    <div className="rb-drop rb-menu" onMouseDown={(e) => e.stopPropagation()}>
                      {[
                        ['220', t('ribbonCompressPrint')],
                        ['150', t('ribbonCompressWeb')],
                        ['96', t('ribbonCompressEmail')],
                      ].map(([value, label]) => (
                        <button
                          key={value}
                          onClick={() => {
                            setCompressOpen(false)
                            onPictureCompress(Number(value))
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Group>
            <div className="ribbon-sep" />
            <Group label={t('paneFormatOutline')}>
              <div className="rb-drop-wrap">
                <button
                  className={`rb-big ${pictureBorderOpen ? 'active' : ''}`}
                  disabled={!onPictureStroke}
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    closeSiblingPanels(e, closePanels, 'pictureBorder')
                  }}
                  onClick={() => {
                    pictureBorderDraft.current = null
                    setPictureBorderOpen((v) => !v)
                  }}
                  data-tip={t('paneFormatOutline')}
                >
                  <span className="rb-big-icon">
                    <IconPageBorders size={BIG} />
                    <RbCaret />
                  </span>
                  <span>{t('paneFormatOutline')}</span>
                </button>
                {pictureBorderOpen && (
                  <div className="rb-drop rb-menu" onMouseDown={(e) => e.stopPropagation()}>
                    <label className="rb-menu-input">
                      {t('paneFormatOutlineColor')}
                      <input
                        type="color"
                        defaultValue={toPickerHex(contextPictureStroke?.color) ?? '#000000'}
                        onPointerDown={(e) => armColorInput(e.currentTarget)}
                        onChange={(e) => commitPictureBorder({ color: e.target.value })}
                      />
                    </label>
                    <div className="rb-menu-sep" />
                    {[0.5, 1, 1.5, 2.25, 3, 4.5, 6].map((pt) => (
                      <button
                        key={pt}
                        className={contextPictureStroke?.widthPt === pt ? 'active' : ''}
                        onClick={() => {
                          setPictureBorderOpen(false)
                          commitPictureBorder({ widthPt: pt }, true)
                        }}
                      >
                        {pt} pt
                      </button>
                    ))}
                    <div className="rb-menu-sep" />
                    <button
                      className={!contextPictureStroke ? 'active' : ''}
                      onClick={() => {
                        setPictureBorderOpen(false)
                        // A pending debounced color commit still holds the prior draft
                        // in its closure and would re-apply the border after the clear
                        if (pictureBorderTimer.current) {
                          window.clearTimeout(pictureBorderTimer.current)
                          pictureBorderTimer.current = null
                        }
                        pictureBorderDraft.current = null
                        onPictureStroke?.(null)
                      }}
                    >
                      {t('paneFormatNoOutline')}
                    </button>
                  </div>
                )}
              </div>
            </Group>
            <div className="ribbon-sep" />
            <Group label={t('ribbonGroupSize')}>
              <button
                className={`rb-big ${cropActive ? 'active' : ''}`}
                data-tip={t('ribbonCropTip')}
                disabled={!onPictureCrop || contextElementType !== 'picture'}
                onClick={onPictureCrop}
              >
                <span className="rb-big-icon">
                  <span className="ai-feature-icon" aria-hidden="true">
                    <img src={iconCrop} width={22} height={22} alt="" />
                  </span>
                </span>
                <span>{t('ribbonCrop')}</span>
              </button>
            </Group>
            <div className="ribbon-sep" />
            <Group label={t('ribbonGroupArrange')}>
              <div className="rb-col">
                {(
                  [
                    [90, 'ribbonRotateRight', IconRotateRight],
                    [-90, 'ribbonRotateLeft', IconRotateLeft],
                  ] as const
                ).map(([delta, key, Icon]) => (
                  <button
                    key={key}
                    className="rb-small"
                    disabled={!onPictureRotate || contextElementType !== 'picture'}
                    onClick={() => onPictureRotate?.(delta)}
                  >
                    <Icon size={18} />
                    <span>{t(key)}</span>
                  </button>
                ))}
              </div>
              <div className="rb-col">
                {(
                  [
                    ['h', 'ribbonFlipH', IconObjFlipH],
                    ['v', 'ribbonFlipV', IconObjFlipV],
                  ] as const
                ).map(([axis, key, Icon]) => (
                  <button
                    key={key}
                    className="rb-small"
                    disabled={!onFlip || contextElementType !== 'picture'}
                    onClick={() => onFlip?.(axis)}
                  >
                    <Icon size={18} />
                    <span>{t(key)}</span>
                  </button>
                ))}
              </div>
            </Group>
          </>
        ) : tab === 'shapeFormat' ? (
          <>
            <Group label={t('ribbonShapes')}>
              <div className="rb-drop-wrap">
                <button
                  className={`rb-big ${changeShapeOpen ? 'active' : ''}`}
                  disabled={!onChangeShape}
                  data-tip={t('ribbonChangeShape')}
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    closeSiblingPanels(e, closePanels, 'changeShape')
                  }}
                  onClick={() => setChangeShapeOpen((v) => !v)}
                >
                  <span className="rb-big-icon">
                    <IconShapes size={BIG} />
                    <RbCaret />
                  </span>
                  <span>{t('ribbonChangeShape')}</span>
                </button>
                {changeShapeOpen && (
                  <div className="rb-drop" onMouseDown={(e) => e.stopPropagation()}>
                    <ShapeGalleryContent
                      onPick={(prst) => {
                        setChangeShapeOpen(false)
                        onChangeShape?.(prst)
                      }}
                    />
                  </div>
                )}
              </div>
            </Group>
            <div className="ribbon-sep" />
            <Group label={t('ribbonGroupShapeStyle')}>
              <div className="rb-drop-wrap">
                <button
                  className={`rb-big ${shapeStyleOpen ? 'active' : ''}`}
                  disabled={!onShapeStyle}
                  data-tip={t('ribbonShapeStyleTip')}
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    closeSiblingPanels(e, closePanels, 'shapeStyle')
                  }}
                  onClick={() => setShapeStyleOpen((v) => !v)}
                >
                  <span className="rb-big-icon">
                    <IconShapeStyle size={BIG} />
                    <RbCaret />
                  </span>
                  <span>{t('ribbonGroupShapeStyle')}</span>
                </button>
                {shapeStyleOpen && (
                  <div
                    className="rb-drop rb-menu ctx-style-grid"
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    {RIBBON_SHAPE_STYLES.map((s, si) => (
                      <button
                        key={si}
                        className="ctx-style-cell"
                        style={{
                          background: s.fill,
                          borderColor: s.stroke,
                          borderStyle: s.dash ? 'dashed' : 'solid',
                        }}
                        aria-label={`${s.fill} / ${s.stroke}${s.dash ? ` (${s.dash})` : ''}`}
                        onClick={() => {
                          setShapeStyleOpen(false)
                          onShapeStyle?.(s)
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </Group>
            <div className="ribbon-sep" />
            <Group label={t('paneFormatFill')}>
              <div className="rb-drop-wrap">
                <button
                  className={`rb-big ${shapeFillOpen ? 'active' : ''}`}
                  disabled={!onShapeFill}
                  data-tip={t('paneFormatFill')}
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    closeSiblingPanels(e, closePanels, 'shapeFill')
                  }}
                  onClick={() => setShapeFillOpen((v) => !v)}
                >
                  <span className="rb-big-icon">
                    <IconFillColor size={BIG} />
                    <RbCaret />
                  </span>
                  <span>{t('paneFormatFill')}</span>
                </button>
                {shapeFillOpen && (
                  <ShapeFillMenu
                    currentFill={contextShapeFill ?? null}
                    onPickFill={(fill) => onShapeFill?.(fill)}
                    onPickImage={onShapeFillImage}
                    onMoreGradient={() => {
                      if (!formatOpen) onToggleFormat()
                    }}
                    onClose={() => setShapeFillOpen(false)}
                  />
                )}
              </div>
            </Group>
            <div className="ribbon-sep" />
            <Group label={t('paneFormatOutline')}>
              <div className="rb-drop-wrap">
                <button
                  className={`rb-big ${pictureBorderOpen ? 'active' : ''}`}
                  disabled={!onPictureStroke}
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    closeSiblingPanels(e, closePanels, 'pictureBorder')
                  }}
                  onClick={() => {
                    pictureBorderDraft.current = null
                    setPictureBorderOpen((v) => !v)
                  }}
                  data-tip={t('paneFormatOutline')}
                >
                  <span className="rb-big-icon">
                    <IconPageBorders size={BIG} />
                    <RbCaret />
                  </span>
                  <span>{t('paneFormatOutline')}</span>
                </button>
                {pictureBorderOpen && (
                  <div className="rb-drop rb-menu" onMouseDown={(e) => e.stopPropagation()}>
                    <label className="rb-menu-input">
                      {t('paneFormatOutlineColor')}
                      <input
                        type="color"
                        defaultValue={toPickerHex(contextPictureStroke?.color) ?? '#000000'}
                        onPointerDown={(e) => armColorInput(e.currentTarget)}
                        onChange={(e) => commitPictureBorder({ color: e.target.value })}
                      />
                    </label>
                    <div className="rb-menu-sep" />
                    {[0.5, 1, 1.5, 2.25, 3, 4.5, 6].map((pt) => (
                      <button
                        key={pt}
                        className={contextPictureStroke?.widthPt === pt ? 'active' : ''}
                        onClick={() => {
                          setPictureBorderOpen(false)
                          commitPictureBorder({ widthPt: pt }, true)
                        }}
                      >
                        {pt} pt
                      </button>
                    ))}
                    <div className="rb-menu-sep" />
                    {(
                      [
                        ['solid', t('ribbonLineSolid')],
                        ['dash', t('ribbonLineDash')],
                        ['sysDot', t('ribbonLineDot')],
                        ['dashDot', t('ribbonLineDashDot')],
                      ] as const
                    ).map(([dash, label]) => (
                      <button
                        key={dash}
                        className={
                          contextPictureStroke &&
                          (dash === 'solid'
                            ? !contextPictureStroke.dashPreset
                            : contextPictureStroke.dashPreset === dash)
                            ? 'active'
                            : ''
                        }
                        onClick={() => {
                          setPictureBorderOpen(false)
                          onPictureStroke?.({
                            color: toPickerHex(contextPictureStroke?.color) ?? '#000000',
                            widthPt: contextPictureStroke?.widthPt ?? 1,
                            dash,
                          })
                        }}
                      >
                        {label}
                      </button>
                    ))}
                    <div className="rb-menu-sep" />
                    <button
                      className={!contextPictureStroke ? 'active' : ''}
                      onClick={() => {
                        setPictureBorderOpen(false)
                        // A pending debounced color commit still holds the prior draft
                        // in its closure and would re-apply the border after the clear
                        if (pictureBorderTimer.current) {
                          window.clearTimeout(pictureBorderTimer.current)
                          pictureBorderTimer.current = null
                        }
                        pictureBorderDraft.current = null
                        onPictureStroke?.(null)
                      }}
                    >
                      {t('paneFormatNoOutline')}
                    </button>
                  </div>
                )}
              </div>
            </Group>
          </>
        ) : null}
      </div>
      <RibbonCollapseButton
        state={collapse}
        labels={{ collapse: t('ribbonCollapse'), pin: t('ribbonPin') }}
      />
    </div>
  )
}
