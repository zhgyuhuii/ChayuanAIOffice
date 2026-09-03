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
  IconGridlines,
  IconMoon,
  IconNavPane,
  IconNewWindow,
  IconOutlineView,
  IconPageWidth,
  IconPrintLayout,
  IconReadMode,
  IconRuler,
  IconSplit,
  IconWholePage,
  IconWebLayout,
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
}
