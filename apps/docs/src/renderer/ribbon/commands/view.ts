/**
 * View tab command definitions (schema migration beachhead 1/N): everything
 * on the legacy ViewTab is a toggle or a direct view-service delegation, so
 * the whole tab maps 1:1 onto commands — the first tab whose schema is fully
 * declarative. Toggles flip the same state they report (isActive reads the
 * same path), mirroring the legacy onClick bodies. New Tab reaches
 * window.desktop directly (the legacy button did the same from the renderer).
 *
 * The tab's Switch-Tabs control (async window list + focus) stays bespoke —
 * it will move into the schema as a custom control when the tab hosts in the
 * live app.
 */
import { commandId, type AnyCommandDefinition, type CommandContext } from '@chatoffice/ribbon'
import type { DocsCommandState } from '../command-state'
import type { DocsCommandServices } from '../host-services'

type State = DocsCommandState
type Services = DocsCommandServices
type Ctx = CommandContext<State, Services>
/** heterogeneous store form: run() args are typed by each definition's own annotation */
type Def = AnyCommandDefinition<State, Services>

const hasDoc = (ctx: Ctx) => ctx.state.hasDoc

/** page preview is a print-layout-only concern (legacy disabled attribute) */
const canPagePreview = (ctx: Ctx) =>
  ctx.state.hasDoc && ctx.state.view.viewMode === 'print' && !ctx.state.view.readMode

const layoutCommands: Def[] = [
  {
    id: commandId('docs.view.printLayout'),
    isEnabled: hasDoc,
    isActive: (ctx) => ctx.state.view.viewMode === 'print' && !ctx.state.view.readMode,
    run: (ctx) => {
      ctx.services.view.setViewMode('print')
      ctx.services.view.setReadMode(false)
    },
  },
  {
    // legacy toggles: clicking the active layout returns to print layout
    id: commandId('docs.view.webLayout'),
    isEnabled: hasDoc,
    isActive: (ctx) => ctx.state.view.viewMode === 'web',
    run: (ctx) =>
      ctx.services.view.setViewMode(ctx.state.view.viewMode === 'web' ? 'print' : 'web'),
  },
  {
    id: commandId('docs.view.outlineLayout'),
    isEnabled: hasDoc,
    isActive: (ctx) => ctx.state.view.viewMode === 'outline',
    run: (ctx) =>
      ctx.services.view.setViewMode(ctx.state.view.viewMode === 'outline' ? 'print' : 'outline'),
  },
  {
    id: commandId('docs.view.readMode'),
    isEnabled: hasDoc,
    isActive: (ctx) => ctx.state.view.readMode,
    run: (ctx) => ctx.services.view.setReadMode(!ctx.state.view.readMode),
  },
  {
    id: commandId('docs.view.pagePreview'),
    isEnabled: canPagePreview,
    run: (ctx) => ctx.services.view.pagePreview(),
  },
]

const zoomCommands: Def[] = [
  {
    id: commandId('docs.view.zoomOut'),
    isEnabled: hasDoc,
    run: (ctx) => ctx.services.view.setZoom(Math.max(50, ctx.state.view.zoom - 10)),
  },
  {
    id: commandId('docs.view.zoomIn'),
    isEnabled: hasDoc,
    run: (ctx) => ctx.services.view.setZoom(Math.min(200, ctx.state.view.zoom + 10)),
  },
  {
    id: commandId('docs.view.zoom100'),
    isEnabled: hasDoc,
    isActive: (ctx) => ctx.state.view.zoom === 100,
    run: (ctx) => ctx.services.view.setZoom(100),
  },
  {
    id: commandId('docs.view.zoomFitWidth'),
    isEnabled: hasDoc,
    run: (ctx) => ctx.services.view.zoomFit('width'),
  },
  {
    id: commandId('docs.view.zoomFitPage'),
    isEnabled: hasDoc,
    run: (ctx) => ctx.services.view.zoomFit('page'),
  },
]

const displayCommands: Def[] = [
  {
    // the AI panel toggle lives on the view tab (legacy ribbon placement)
    id: commandId('docs.ai.togglePanel'),
    isActive: (ctx) => ctx.state.ai.showAi,
    run: (ctx) => ctx.services.ai.toggle(),
  },
  {
    id: commandId('docs.view.darkCanvas'),
    isActive: (ctx) => ctx.state.view.darkCanvas,
    run: (ctx) => ctx.services.view.setDarkCanvas(!ctx.state.view.darkCanvas),
  },
  {
    id: commandId('docs.view.showRuler'),
    isEnabled: hasDoc,
    isActive: (ctx) => ctx.state.view.showRuler,
    run: (ctx) => ctx.services.view.setShowRuler(!ctx.state.view.showRuler),
  },
  {
    id: commandId('docs.view.showGrid'),
    isEnabled: hasDoc,
    isActive: (ctx) => ctx.state.view.showGrid,
    run: (ctx) => ctx.services.view.setShowGrid(!ctx.state.view.showGrid),
  },
  {
    id: commandId('docs.view.showNav'),
    isEnabled: hasDoc,
    isActive: (ctx) => ctx.state.view.showNav,
    run: (ctx) => ctx.services.view.setShowNav(!ctx.state.view.showNav),
  },
  {
    id: commandId('docs.view.splitView'),
    isEnabled: hasDoc,
    isActive: (ctx) => ctx.state.view.splitView,
    run: (ctx) => ctx.services.view.setSplitView(!ctx.state.view.splitView),
  },
  {
    id: commandId('docs.view.newTab'),
    run: (ctx) => void window.desktop.openNewTab(ctx.state.doc.filePath),
  },
]

/** every view-tab command, in ribbon visual order (layout → zoom → display → window) */
export const VIEW_COMMANDS: readonly AnyCommandDefinition<State, Services>[] = [
  ...layoutCommands,
  ...zoomCommands,
  ...displayCommands,
]
