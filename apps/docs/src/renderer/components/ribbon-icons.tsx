/**
 * Icon registry for the schema-driven ribbon renderers: maps the schema's
 * string icon names onto the docs icon set. Sized for the big-button grid
 * the legacy ViewTab used (28px).
 */
import type { ReactNode } from 'react'
import type { RibbonIconMap } from '@chatoffice/ribbon'
import {
  IconAiPanel,
  IconCaret,
  IconCheckbox,
  IconCrop,
  IconDoc,
  IconEraser,
  IconEye,
  IconGridlines,
  IconKey,
  IconLock,
  IconMoon,
  IconNavPane,
  IconNewWindow,
  IconOutlineView,
  IconPageWidth,
  IconPicture,
  IconPrintLayout,
  IconReadMode,
  IconRowDelete,
  IconRuler,
  IconSpellcheck,
  IconSparkle,
  IconSplit,
  IconTable,
  IconTableProperties,
  IconWand,
  IconWebLayout,
  IconWholePage,
  IconWordCount,
  IconZoom100,
  IconZoomIn,
  IconZoomOut,
} from './icons'

const big = (Icon: (props: { size?: number }) => ReactNode): ReactNode => <Icon size={28} />

export const RIBBON_ICONS: RibbonIconMap = {
  caret: <IconCaret />,
  printLayout: big(IconPrintLayout),
  webLayout: big(IconWebLayout),
  outlineView: big(IconOutlineView),
  readMode: big(IconReadMode),
  wholePage: big(IconWholePage),
  zoomOut: big(IconZoomOut),
  zoomIn: big(IconZoomIn),
  zoom100: big(IconZoom100),
  pageWidth: big(IconPageWidth),
  aiPanel: big(IconAiPanel),
  moon: big(IconMoon),
  ruler: big(IconRuler),
  gridlines: big(IconGridlines),
  navPane: big(IconNavPane),
  newWindow: big(IconNewWindow),
  split: big(IconSplit),
  // 察元 AI tab (harvested chayuan-wps surface)
  spellCheck: big(IconSpellcheck),
  doc: big(IconDoc),
  wand: big(IconWand),
  picture: big(IconPicture),
  sparkle: big(IconSparkle),
  eye: big(IconEye),
  lock: big(IconLock),
  key: big(IconKey),
  eraser: big(IconEraser),
  wordCount: big(IconWordCount),
  rowDelete: big(IconRowDelete),
  table: big(IconTable),
  crop: big(IconCrop),
  checkbox: big(IconCheckbox),
  tableProperties: big(IconTableProperties),
}
