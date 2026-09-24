/**
 * The 察元 AI tab — the harvested chayuan-wps ribbon (察元AI助理 + 察元AI编审
 * merged into one docs tab). Fully declarative: every control maps to a
 * docs.chayuan.* command; dropdown menus carry their per-item args. Layout
 * mirrors the wps groups (analysis §2): 常用助手 / 安全保密 / 文档批量 /
 * 批量操作 / 表单辅助.
 */
import { commandId, type RibbonTab } from '@chatoffice/ribbon'
import type { DocsCommandState } from '../command-state'
import type { DocsCommandServices } from '../host-services'
import type { DocOpsDialogKind } from '../../docops/dialogs'

type S = DocsCommandState
type Sv = DocsCommandServices

const big = (
  id: string,
  command: string,
  icon: string,
  labelKey: string,
  args?: Record<string, unknown>,
) => ({
  kind: 'button' as const,
  id,
  command: commandId(command),
  icon,
  size: 'big' as const,
  labelKey,
  ...(args ? { args } : {}),
})

const menu = (id: string, icon: string, labelKey: string, items: MenuItems) => ({
  kind: 'dropdown' as const,
  id,
  icon,
  size: 'big' as const,
  labelKey,
  menu: items,
})

type MenuItems = ReturnType<typeof menuItem>[]
const menuItem = (
  id: string,
  command: string,
  labelKey: string,
  args: Record<string, unknown>,
) => ({
  id,
  labelKey,
  command: commandId(command),
  args,
})

/** 文本分析 dropdown — the harvested analysis family (registry ids ride args) */
const textAnalysisMenu: MenuItems = [
  menuItem('chayuan.ta.rewrite', 'docs.chayuan.assistant', 'appAiRewrite', { id: 'core.rewrite' }),
  menuItem('chayuan.ta.polish', 'docs.chayuan.assistant', 'appAiPolishMenu', { id: 'core.polish' }),
  menuItem('chayuan.ta.formalize', 'docs.chayuan.assistant', 'appAiFormalize', { id: 'core.formalize' }),
  menuItem('chayuan.ta.simplify', 'docs.chayuan.assistant', 'appAiSimplify', { id: 'core.simplify' }),
  menuItem('chayuan.ta.expand', 'docs.chayuan.assistant', 'appAiExpand', { id: 'core.expand' }),
  menuItem('chayuan.ta.abbreviate', 'docs.chayuan.assistant', 'appAiAbbreviate', { id: 'core.abbreviate' }),
  menuItem('chayuan.ta.keywords', 'docs.chayuan.assistant', 'appAiExtractKeywords', { id: 'core.extract-keywords' }),
  menuItem('chayuan.ta.actionItems', 'docs.chayuan.assistant', 'appAiActionItems', { id: 'core.action-items' }),
  menuItem('chayuan.ta.termUnify', 'docs.chayuan.assistant', 'appAiTermUnify', { id: 'core.term-unify' }),
  menuItem('chayuan.ta.title', 'docs.chayuan.assistant', 'appAiGenTitle', { id: 'core.title' }),
  menuItem('chayuan.ta.numbering', 'docs.chayuan.assistant', 'appAiParagraphNumbering', { id: 'core.paragraph-numbering-check' }),
  menuItem('chayuan.ta.trace', 'docs.chayuan.assistant', 'appAiTraceCheck', { id: 'core.ai-trace-check' }),
  menuItem('chayuan.ta.commentExplain', 'docs.chayuan.assistant', 'appAiCommentExplain', { id: 'core.comment-explain' }),
  menuItem('chayuan.ta.linkExplain', 'docs.chayuan.assistant', 'appAiHyperlinkExplain', { id: 'core.hyperlink-explain' }),
]

/** 表格批量操作 dropdown — the 14-item wps menu (analysis §3) */
const tableBatchMenu: MenuItems = [
  menuItem('chayuan.tb.export', 'docs.chayuan.export', 'ribbonTbExportAll', { what: 'tables' }),
  menuItem('chayuan.tb.deleteAll', 'docs.chayuan.op', 'ribbonTbDeleteAll', { op: 'tables.deleteAll' }),
  menuItem('chayuan.tb.autoFitContent', 'docs.chayuan.op', 'ribbonTbAutoFitContent', { op: 'tables.autoFitContent' }),
  menuItem('chayuan.tb.autoFitWindow', 'docs.chayuan.op', 'ribbonTbAutoFitWindow', { op: 'tables.autoFitWindow' }),
  menuItem('chayuan.tb.refreshStyle', 'docs.chayuan.op', 'ribbonTbRefreshStyle', { op: 'tables.refreshStyle' }),
  menuItem('chayuan.tb.deleteTextRow', 'docs.chayuan.dialog', 'ribbonTbDeleteTextRow', { kind: 'deleteTextRow' as DocOpsDialogKind }),
  menuItem('chayuan.tb.deleteTextCol', 'docs.chayuan.dialog', 'ribbonTbDeleteTextColumn', { kind: 'deleteTextColumn' as DocOpsDialogKind }),
  menuItem('chayuan.tb.appendReplace', 'docs.chayuan.dialog', 'ribbonTbAppendReplace', { kind: 'appendReplace' as DocOpsDialogKind }),
  menuItem('chayuan.tb.firstColNumbers', 'docs.chayuan.op', 'ribbonTbFirstColNumbers', { op: 'tables.firstColNumbers' }),
  menuItem('chayuan.tb.manualColWidth', 'docs.chayuan.dialog', 'ribbonTbManualColWidth', { kind: 'manualColWidth' as DocOpsDialogKind }),
  menuItem('chayuan.tb.firstColStyle', 'docs.chayuan.dialog', 'ribbonTbFirstColStyle', { kind: 'firstColStyle' as DocOpsDialogKind }),
  menuItem('chayuan.tb.firstRowStyle', 'docs.chayuan.dialog', 'ribbonTbFirstRowStyle', { kind: 'firstRowStyle' as DocOpsDialogKind }),
  menuItem('chayuan.tb.addCaption', 'docs.chayuan.dialog', 'ribbonTbAddCaption', { kind: 'tableCaption' as DocOpsDialogKind }),
  menuItem('chayuan.tb.deleteCaption', 'docs.chayuan.op', 'ribbonTbDeleteCaption', { op: 'tables.deleteCaptions' }),
]

/** 图像批量操作 dropdown — the 6-item wps menu (analysis §4) */
const imageBatchMenu: MenuItems = [
  menuItem('chayuan.ib.export', 'docs.chayuan.export', 'ribbonIbExportAll', { what: 'images' }),
  menuItem('chayuan.ib.deleteAll', 'docs.chayuan.op', 'ribbonIbDeleteAll', { op: 'images.deleteAll' }),
  menuItem('chayuan.ib.uniformFormat', 'docs.chayuan.dialog', 'ribbonIbUniformFormat', { kind: 'uniformImageFormat' as DocOpsDialogKind }),
  menuItem('chayuan.ib.clearFormat', 'docs.chayuan.op', 'ribbonIbClearFormat', { op: 'images.clearFormat' }),
  menuItem('chayuan.ib.addCaption', 'docs.chayuan.dialog', 'ribbonIbAddCaption', { kind: 'imageCaption' as DocOpsDialogKind }),
  menuItem('chayuan.ib.deleteCaption', 'docs.chayuan.op', 'ribbonIbDeleteCaption', { op: 'images.deleteCaptions' }),
]

export const CHAYUAN_TAB: RibbonTab<S, Sv> = {
  id: 'chayuan',
  kind: 'regular',
  labelKey: 'ribbonTabChayuanAI',
  groups: [
    {
      id: 'chayuan.assist',
      labelKey: 'ribbonGroupChayuanAssist',
      controls: [
        big('chayuan.spellCheck', 'docs.chayuan.assistant', 'spellCheck', 'ribbonChayuanSpellCheck', { id: 'core.spell-check' }),
        big('chayuan.summary', 'docs.chayuan.assistant', 'doc', 'ribbonChayuanSummary', { id: 'core.summary' }),
        menu('chayuan.textAnalysis', 'wand', 'ribbonChayuanTextAnalysis', textAnalysisMenu),
        big('chayuan.textToImage', 'docs.chayuan.assistant', 'picture', 'ribbonChayuanTextToImage', { id: 'core.text-to-image' }),
        big('chayuan.textToVideo', 'docs.chayuan.assistant', 'sparkle', 'ribbonChayuanTextToVideo', { id: 'core.text-to-video' }),
      ],
    },
    {
      id: 'chayuan.security',
      labelKey: 'ribbonGroupChayuanSecurity',
      controls: [
        big('chayuan.securityCheck', 'docs.chayuan.assistant', 'eye', 'ribbonChayuanSecurityCheck', { id: 'core.security-check' }),
        big('chayuan.declassify', 'docs.chayuan.dialog', 'lock', 'ribbonChayuanDeclassify', { kind: 'declassify' as DocOpsDialogKind }),
        big('chayuan.declassifyRestore', 'docs.chayuan.dialog', 'key', 'ribbonChayuanDeclassifyRestore', { kind: 'declassifyRestore' as DocOpsDialogKind }),
      ],
    },
    {
      id: 'chayuan.docBatch',
      labelKey: 'ribbonGroupChayuanDocBatch',
      controls: [
        big('chayuan.cleanStyles', 'docs.chayuan.dialog', 'eraser', 'ribbonChayuanCleanStyles', { kind: 'unusedStyles' as DocOpsDialogKind }),
        big('chayuan.styleStats', 'docs.chayuan.dialog', 'wordCount', 'ribbonChayuanStyleStats', { kind: 'styleStatistics' as DocOpsDialogKind }),
        big('chayuan.deleteBlankRows', 'docs.chayuan.op', 'rowDelete', 'ribbonChayuanDeleteBlankRows', { op: 'text.deleteBlankRows' }),
      ],
    },
    {
      id: 'chayuan.batch',
      labelKey: 'ribbonGroupChayuanBatch',
      controls: [
        menu('chayuan.tableBatch', 'table', 'ribbonChayuanTableBatch', tableBatchMenu),
        menu('chayuan.imageBatch', 'crop', 'ribbonChayuanImageBatch', imageBatchMenu),
      ],
    },
    {
      id: 'chayuan.form',
      labelKey: 'ribbonGroupChayuanForm',
      controls: [
        {
          kind: 'toggle',
          id: 'chayuan.formMode',
          command: commandId('docs.chayuan.formToggle'),
          statePath: 'chayuan.formMode',
          icon: 'checkbox',
          size: 'big',
          labelKey: 'ribbonChayuanFormMode',
        },
        big('chayuan.formContent', 'docs.chayuan.dialog', 'tableProperties', 'ribbonChayuanFormContent', { kind: 'formContent' as DocOpsDialogKind }),
      ],
    },
  ],
}
