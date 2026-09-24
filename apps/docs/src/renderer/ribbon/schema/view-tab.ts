/**
 * Docs ribbon schema (schema migration beachhead 1/N): the View tab is the
 * first tab fully expressed as declarative schema — every control maps to a
 * docs.view.* / docs.ai.* command, and the pressed looks come from command
 * isActive, exactly like the legacy ViewTab's conditional `active` classes.
 *
 * Migration order after this: file menu, home groups, then the per-tab
 * components (insert/draw/design/layout/references/review) — unmigrated tabs
 * stay on the legacy Ribbon until their slice lands. The ViewTab's
 * Switch-Tags control (async window list) is the one deliberate omission; it
 * moves in as a custom control when this schema hosts in the live app.
 */
import { commandId, type RibbonSchema, type RibbonTab } from '@chatoffice/ribbon'
import type { DocsCommandState } from '../command-state'
import type { DocsCommandServices } from '../host-services'
import { FILE_TAB, HOSTED_TABS } from './host-tabs'
import { CHAYUAN_TAB } from './chayuan-tab'

type S = DocsCommandState
type Sv = DocsCommandServices

const viewButton = (
  id: string,
  command: string,
  icon: string,
  labelKey: string,
  tipKey: string,
) => ({
  kind: 'button' as const,
  id,
  command: commandId(command),
  icon,
  size: 'big' as const,
  labelKey,
  tipKey,
})

export const VIEW_TAB: RibbonTab<S, Sv> = {
  id: 'view',
  kind: 'regular',
  labelKey: 'ribbonTabView',
  groups: [
    {
      id: 'view.views',
      labelKey: 'ribbonGroupViews',
      controls: [
        viewButton(
          'view.printLayout',
          'docs.view.printLayout',
          'printLayout',
          'ribbonPrintLayout',
          'ribbonPrintLayoutTip',
        ),
        viewButton(
          'view.webLayout',
          'docs.view.webLayout',
          'webLayout',
          'ribbonWebLayout',
          'ribbonWebLayoutTip',
        ),
        viewButton(
          'view.outline',
          'docs.view.outlineLayout',
          'outlineView',
          'ribbonOutlineView',
          'ribbonOutlineViewTip',
        ),
        viewButton(
          'view.readMode',
          'docs.view.readMode',
          'readMode',
          'ribbonReadMode',
          'ribbonReadModeTip',
        ),
        viewButton(
          'view.pagePreview',
          'docs.view.pagePreview',
          'wholePage',
          'ribbonPagePreview',
          'ribbonPagePreviewTip',
        ),
      ],
    },
    {
      id: 'view.zoom',
      labelKey: 'ribbonGroupZoom',
      controls: [
        viewButton(
          'view.zoomOut',
          'docs.view.zoomOut',
          'zoomOut',
          'ribbonZoomOut',
          'ribbonZoomOutTip',
        ),
        viewButton('view.zoomIn', 'docs.view.zoomIn', 'zoomIn', 'ribbonZoomIn', 'ribbonZoomInTip'),
        viewButton(
          'view.zoom100',
          'docs.view.zoom100',
          'zoom100',
          'ribbonZoom100',
          'ribbonZoom100Tip',
        ),
        viewButton(
          'view.pageWidth',
          'docs.view.zoomFitWidth',
          'pageWidth',
          'ribbonPageWidth',
          'ribbonPageWidthTip',
        ),
        viewButton(
          'view.wholePage',
          'docs.view.zoomFitPage',
          'wholePage',
          'ribbonWholePage',
          'ribbonWholePageTip',
        ),
      ],
    },
    {
      id: 'view.appearance',
      labelKey: 'ribbonGroupAppearance',
      controls: [
        viewButton(
          'view.aiPanel',
          'docs.ai.togglePanel',
          'aiPanel',
          'ribbonAiPanel',
          'ribbonAiPanelTip',
        ),
        viewButton(
          'view.darkCanvas',
          'docs.view.darkCanvas',
          'moon',
          'ribbonDarkMode',
          'ribbonDarkModeTip',
        ),
      ],
    },
    {
      id: 'view.show',
      labelKey: 'ribbonGroupShow',
      controls: [
        viewButton('view.ruler', 'docs.view.showRuler', 'ruler', 'ribbonRuler', 'ribbonRulerTip'),
        viewButton(
          'view.gridlines',
          'docs.view.showGrid',
          'gridlines',
          'ribbonGridlines',
          'ribbonGridlinesTip',
        ),
        viewButton(
          'view.navPane',
          'docs.view.showNav',
          'navPane',
          'ribbonNavPane',
          'ribbonNavPaneTip',
        ),
      ],
    },
    {
      id: 'view.window',
      labelKey: 'ribbonGroupWindow',
      // Switch-Tabs (async window list) joins as a custom control when the
      // schema hosts in the live app — see the file comment.
      controls: [
        viewButton(
          'view.newTab',
          'docs.view.newTab',
          'newWindow',
          'ribbonNewTab',
          'ribbonNewTabTip',
        ),
        viewButton('view.split', 'docs.view.splitView', 'split', 'ribbonSplit', 'ribbonSplitTip'),
      ],
    },
  ],
}

/**
 * The docs schema: tabs migrated so far. The file menu is fully declarative
 * (three command-backed items); the extracted tab components render through
 * renderBody hosts (host-tabs.tsx); the View tab is fully declarative. The
 * legacy Ribbon keeps rendering home + the contextual tabs until their
 * slices land (strangler order in the file comment). Version bumps per
 * migration slice.
 */
export const DOCS_SCHEMA: RibbonSchema<S, Sv> = {
  id: 'docs',
  version: 2,
  tabs: [FILE_TAB, ...HOSTED_TABS, VIEW_TAB, CHAYUAN_TAB],
}
