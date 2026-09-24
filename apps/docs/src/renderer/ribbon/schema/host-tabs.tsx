/**
 * renderBody hosts for the tab components that are already extracted
 * (strangler step 3): each adapter maps the schema context — DocsCommandState
 * + DocsCommandServices — back onto the legacy component's explicit props,
 * so the schema can carry the tab strip while the tab bodies stay on their
 * proven components. Home stays Ribbon-hosted for now: its painter state
 * machine and style-gallery machinery are still RibbonInner locals.
 *
 * The legacy components manage their own dropdown id; the adapter bridges
 * the renderer's RibbonDropdownApi onto the flat (dropdown, setDropdown)
 * pair they expect, updater form included.
 */
import type { CustomRenderContext, RibbonDropdownApi, RibbonTab } from '@chatoffice/ribbon'
import { commandId } from '@chatoffice/ribbon'
import type { DocsCommandState } from '../command-state'
import type { DocsCommandServices } from '../host-services'
import { DesignTab } from '../../components/ribbon-design-tab'
import { InsertTab } from '../../components/ribbon-insert-tab'
import { LayoutTab } from '../../components/ribbon-layout-tab'
import { ReferencesTab } from '../../components/ribbon-references-tab'
import { DrawTab, ReviewTab } from '../../components/ribbon-tabs'

type S = DocsCommandState
type Sv = DocsCommandServices
type Ctx = CustomRenderContext<S, Sv>

/** Flat (dropdown, setDropdown) pair over the renderer's dropdown api. */
function legacyDropdown(ctx: Ctx): {
  dropdown: string | null
  setDropdown: (update: string | null | ((current: string | null) => string | null)) => void
} {
  const api: RibbonDropdownApi = ctx.dropdown
  const setDropdown = (update: string | null | ((current: string | null) => string | null)) => {
    const next = typeof update === 'function' ? update(api.openId) : update
    if (next === null) api.close()
    else if (api.openId === next) api.close()
    else api.open(next)
  }
  return { dropdown: api.openId, setDropdown }
}

function insertTabBody(ctx: Ctx) {
  const { dropdown, setDropdown } = legacyDropdown(ctx)
  return (
    <InsertTab
      editor={ctx.services.editor.main()!}
      hasDoc={ctx.state.canEdit}
      dropdown={dropdown}
      setDropdown={setDropdown}
      header={ctx.state.doc.header}
      onHeader={ctx.services.hf.setHeader}
      onPageNumFormat={ctx.services.dialogs.pageNumFormat}
      onInsertField={ctx.services.insert.field}
      footer={ctx.state.doc.footer}
      onFooter={ctx.services.hf.setFooter}
      titlePg={ctx.state.doc.titlePg}
      onTitlePg={ctx.services.hf.setTitlePg}
      evenOddHf={ctx.state.doc.evenOddHf}
      onEvenOddHf={ctx.services.hf.setEvenOddHf}
      commentCount={ctx.state.review.commentCount}
      onShowComments={ctx.services.review.showComments}
      canComment={ctx.state.review.canComment}
      onNewComment={ctx.services.review.newComment}
      isProtected={ctx.state.review.isProtected}
      commentsAllowed={ctx.state.review.commentsAllowed}
    />
  )
}

function drawTabBody(ctx: Ctx) {
  return (
    <DrawTab
      hasDoc={ctx.state.hasDoc}
      tool={ctx.state.draw.inkTool}
      onTool={ctx.services.draw.setInkTool}
      pen={ctx.state.draw.inkPen}
      onPen={ctx.services.draw.setInkPen}
      highlighter={ctx.state.draw.inkHighlighter}
      onHighlighter={ctx.services.draw.setInkHighlighter}
      annotationCount={ctx.state.draw.inkCount}
      onClearAll={ctx.services.draw.clearAll}
    />
  )
}

function designTabBody(ctx: Ctx) {
  const { dropdown, setDropdown } = legacyDropdown(ctx)
  return (
    <DesignTab
      editor={ctx.services.editor.main()!}
      hasDoc={ctx.state.canEdit}
      dropdown={dropdown}
      setDropdown={setDropdown}
      pageColor={ctx.state.doc.pageColor}
      onPageColor={ctx.services.design.setPageColor}
      section={ctx.state.doc.section}
      onSection={ctx.services.layout.setSection}
      watermark={ctx.state.doc.watermark}
      onWatermark={ctx.services.design.setWatermark}
      themeFonts={ctx.state.doc.themeFonts}
      onThemeFonts={ctx.services.design.setThemeFonts}
      onThemeColors={ctx.services.design.setThemeColors}
    />
  )
}

function layoutTabBody(ctx: Ctx) {
  const { dropdown, setDropdown } = legacyDropdown(ctx)
  return (
    <LayoutTab
      editor={ctx.services.editor.main()!}
      hasDoc={ctx.state.canEdit}
      dropdown={dropdown}
      setDropdown={setDropdown}
      section={ctx.state.doc.section}
      onSection={ctx.services.layout.setSection}
      activeSection={ctx.state.doc.activeSection}
      onInsertSectionBreak={ctx.services.insert.sectionBreak}
    />
  )
}

function referencesTabBody(ctx: Ctx) {
  const { dropdown, setDropdown } = legacyDropdown(ctx)
  return (
    <ReferencesTab
      editor={ctx.services.editor.main()!}
      hasDoc={ctx.state.canEdit}
      blocks={ctx.state.doc.blocks as never}
      dropdown={dropdown}
      setDropdown={setDropdown}
      onInsertNote={ctx.services.insert.note}
      sources={ctx.state.sources as never}
      onAddSource={ctx.services.references.addSource}
      headingPages={ctx.services.references.headingPages}
    />
  )
}

function reviewTabBody(ctx: Ctx) {
  const { dropdown, setDropdown } = legacyDropdown(ctx)
  const review = ctx.state.review
  return (
    <ReviewTab
      editor={ctx.services.editor.main()!}
      hasDoc={ctx.state.hasDoc}
      dropdown={dropdown}
      setDropdown={setDropdown}
      onAiPreset={ctx.services.ai.preset}
      spellcheck={ctx.state.view.spellcheck ?? false}
      onSpellcheck={ctx.services.view.setSpellcheck ?? (() => {})}
      commentCount={review.commentCount}
      openCommentCount={review.openCommentCount}
      onShowComments={ctx.services.review.showComments}
      canComment={review.canComment}
      onNewComment={ctx.services.review.newComment}
      trackChanges={review.trackChanges}
      onTrackChanges={ctx.services.review.setTrackChanges}
      revisionDisplay={review.revisionDisplay}
      onRevisionDisplay={ctx.services.review.setRevisionDisplay}
      revisionCount={review.revisionCount}
      onAcceptRevision={ctx.services.review.acceptRevision}
      onRejectRevision={ctx.services.review.rejectRevision}
      onGotoRevision={ctx.services.review.gotoRevision}
      isProtected={review.isProtected}
      commentsAllowed={review.commentsAllowed}
      trackChangesForced={review.trackChangesForced}
      protectActive={review.protectActive}
      onProtectDoc={ctx.services.dialogs.protectDoc}
      onCompare={ctx.services.file.compare}
    />
  )
}

function hostedTab(
  id: string,
  labelKey: string,
  render: (ctx: Ctx) => React.ReactNode,
): RibbonTab<S, Sv> {
  return { id, kind: 'regular', labelKey, groups: [], renderBody: render }
}

/** File menu: exactly the legacy three items, all command-backed (shortcuts included). */
export const FILE_TAB: RibbonTab<S, Sv> = {
  id: 'file',
  kind: 'file',
  labelKey: 'ribbonTabFile',
  groups: [],
  menu: [
    {
      id: 'file.open',
      labelKey: 'ribbonOpen',
      command: commandId('docs.file.open'),
      shortcut: 'Ctrl+O',
    },
    {
      id: 'file.save',
      labelKey: 'ribbonSave',
      command: commandId('docs.file.save'),
      shortcut: 'Ctrl+S',
    },
    {
      id: 'file.saveAs',
      labelKey: 'ribbonSaveAs',
      command: commandId('docs.file.saveAs'),
      shortcut: 'Ctrl+Shift+S',
    },
  ],
}

/** WPS「页面」:布局(页面设置|段落|排列)+设计(页面背景|文档格式)两个托管体合一。 */
function pageTabBody(ctx: Ctx) {
  return (
    <>
      {layoutTabBody(ctx)}
      <div className="ribbon-sep" />
      {designTabBody(ctx)}
    </>
  )
}

export const HOSTED_TABS: readonly RibbonTab<S, Sv>[] = [
  hostedTab('insert', 'ribbonTabInsert', insertTabBody),
  hostedTab('page', 'ribbonTabPage', pageTabBody),
  hostedTab('draw', 'ribbonTabDraw', drawTabBody),
  hostedTab('references', 'ribbonTabReferences', referencesTabBody),
  hostedTab('review', 'ribbonTabReview', reviewTabBody),
]
