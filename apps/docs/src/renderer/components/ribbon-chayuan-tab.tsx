/**
 * 察元 AI tab (legacy desktop ribbon) — the harvested chayuan-wps surface
 * (察元AI助理+察元AI编审 merged). The declarative twin lives at
 * ribbon/schema/chayuan-tab.ts (MobileRibbon); this component renders the same
 * five groups with the legacy classes so the desktop strip (still the legacy
 * Ribbon until the schema strangler finishes) shows the tab too. All actions
 * funnel through the chayuan host-services group — identical to the schema
 * commands, so behaviour cannot drift between desktop and mobile.
 */
import type { ReactNode } from 'react'
import { t, type StringKey } from '../i18n/locale'
import type { DocsCommandServices } from '../ribbon/host-services'
import type { SetDropdown } from './ribbon-tabs'
import { toggleDropdown } from './ribbon-tabs'
import {
  IconCheckbox,
  IconCrop,
  IconDoc,
  IconEraser,
  IconEye,
  IconKey,
  IconLock,
  IconPicture,
  IconRowDelete,
  IconSparkle,
  IconSpellcheck,
  IconTable,
  IconTableProperties,
  IconWand,
  IconWordCount,
} from './icons'
import { isFormModeActive } from '../docops/form-mode'
import type { DocOpsDialogKind } from '../docops/dialogs'

export interface ChayuanTabProps {
  hasDoc: boolean
  dropdown: string | null
  setDropdown: SetDropdown
  chayuan: DocsCommandServices['chayuan']
}

function bigBtn(opts: {
  labelKey: StringKey
  icon: ReactNode
  disabled?: boolean
  active?: boolean
  onClick: () => void
  menuKey?: string
  setDropdown?: SetDropdown
}) {
  return (
    <button
      key={opts.menuKey ?? opts.labelKey}
      className={`rb-big${opts.active ? ' active' : ''}`}
      disabled={opts.disabled}
      data-tip={t(opts.labelKey)}
      onClick={
        opts.menuKey && opts.setDropdown
          ? () => toggleDropdown(opts.setDropdown as SetDropdown, opts.menuKey!)
          : opts.onClick
      }
    >
      <span className="rb-big-icon">{opts.icon}</span>
      <span className="rb-big-label">{t(opts.labelKey)}</span>
    </button>
  )
}

const icon = (I: (props: { size?: number }) => ReactNode) => <I size={24} />

/** the harvested analysis family (ids ride the core assistant pack) */
const TEXT_ANALYSIS_ITEMS: Array<{ id: string; labelKey: StringKey }> = [
  { id: 'core.rewrite', labelKey: 'appAiRewrite' },
  { id: 'core.polish', labelKey: 'appAiPolishMenu' },
  { id: 'core.formalize', labelKey: 'appAiFormalize' },
  { id: 'core.simplify', labelKey: 'appAiSimplify' },
  { id: 'core.expand', labelKey: 'appAiExpand' },
  { id: 'core.abbreviate', labelKey: 'appAiAbbreviate' },
  { id: 'core.extract-keywords', labelKey: 'appAiExtractKeywords' },
  { id: 'core.action-items', labelKey: 'appAiActionItems' },
  { id: 'core.term-unify', labelKey: 'appAiTermUnify' },
  { id: 'core.title', labelKey: 'appAiGenTitle' },
  { id: 'core.paragraph-numbering-check', labelKey: 'appAiParagraphNumbering' },
  { id: 'core.ai-trace-check', labelKey: 'appAiTraceCheck' },
  { id: 'core.comment-explain', labelKey: 'appAiCommentExplain' },
  { id: 'core.hyperlink-explain', labelKey: 'appAiHyperlinkExplain' },
]

/** 表格批量操作 — the 14-item wps menu */
const TABLE_BATCH_ITEMS: Array<{
  labelKey: StringKey
  run: (svc: DocsCommandServices['chayuan']) => void
}> = [
  { labelKey: 'ribbonTbExportAll', run: (s) => s.exportAll('tables') },
  { labelKey: 'ribbonTbDeleteAll', run: (s) => s.runOp('tables.deleteAll') },
  { labelKey: 'ribbonTbAutoFitContent', run: (s) => s.runOp('tables.autoFitContent') },
  { labelKey: 'ribbonTbAutoFitWindow', run: (s) => s.runOp('tables.autoFitWindow') },
  { labelKey: 'ribbonTbRefreshStyle', run: (s) => s.runOp('tables.refreshStyle') },
  { labelKey: 'ribbonTbDeleteTextRow', run: (s) => s.openDialog('deleteTextRow') },
  { labelKey: 'ribbonTbDeleteTextColumn', run: (s) => s.openDialog('deleteTextColumn') },
  { labelKey: 'ribbonTbAppendReplace', run: (s) => s.openDialog('appendReplace') },
  { labelKey: 'ribbonTbFirstColNumbers', run: (s) => s.runOp('tables.firstColNumbers') },
  { labelKey: 'ribbonTbManualColWidth', run: (s) => s.openDialog('manualColWidth') },
  { labelKey: 'ribbonTbFirstColStyle', run: (s) => s.openDialog('firstColStyle') },
  { labelKey: 'ribbonTbFirstRowStyle', run: (s) => s.openDialog('firstRowStyle') },
  { labelKey: 'ribbonTbAddCaption', run: (s) => s.openDialog('tableCaption') },
  { labelKey: 'ribbonTbDeleteCaption', run: (s) => s.runOp('tables.deleteCaptions') },
]

/** 图像批量操作 — the 6-item wps menu */
const IMAGE_BATCH_ITEMS: Array<{
  labelKey: StringKey
  run: (svc: DocsCommandServices['chayuan']) => void
}> = [
  { labelKey: 'ribbonIbExportAll', run: (s) => s.exportAll('images') },
  { labelKey: 'ribbonIbDeleteAll', run: (s) => s.runOp('images.deleteAll') },
  { labelKey: 'ribbonIbUniformFormat', run: (s) => s.openDialog('uniformImageFormat') },
  { labelKey: 'ribbonIbClearFormat', run: (s) => s.runOp('images.clearFormat') },
  { labelKey: 'ribbonIbAddCaption', run: (s) => s.openDialog('imageCaption') },
  { labelKey: 'ribbonIbDeleteCaption', run: (s) => s.runOp('images.deleteCaptions') },
]

export function ChayuanTab({ hasDoc, dropdown, setDropdown, chayuan }: ChayuanTabProps) {
  const run = (id: string) => () => chayuan.runAssistant(id)
  const dialog = (kind: DocOpsDialogKind) => () => chayuan.openDialog(kind)

  const menuPanel = (key: string, items: Array<{ labelKey: StringKey; onClick: () => void }>) =>
    dropdown === key ? (
      <div data-rb-panel="" className="layout-menu">
        {items.map((item) => (
          <button
            key={item.labelKey}
            onClick={() => {
              setDropdown(() => null)
              item.onClick()
            }}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>
    ) : null

  return (
    <>
      <div className="ribbon-group">
        <div className="ribbon-group-items">
          <div className="rb-menu-anchor">
            {bigBtn({
              labelKey: 'ribbonChayuanSpellCheck',
              icon: icon(IconSpellcheck),
              disabled: !hasDoc,
              onClick: run('core.spell-check'),
            })}
          </div>
          {bigBtn({
            labelKey: 'ribbonChayuanSummary',
            icon: icon(IconDoc),
            disabled: !hasDoc,
            onClick: run('core.summary'),
          })}
          <div className="rb-menu-anchor">
            {bigBtn({
              labelKey: 'ribbonChayuanTextAnalysis',
              icon: icon(IconWand),
              disabled: !hasDoc,
              menuKey: 'chayuanTextAnalysis',
              setDropdown,
              onClick: () => {},
            })}
            {menuPanel(
              'chayuanTextAnalysis',
              TEXT_ANALYSIS_ITEMS.map((item) => ({
                labelKey: item.labelKey,
                onClick: run(item.id),
              })),
            )}
          </div>
          {bigBtn({
            labelKey: 'ribbonChayuanTextToImage',
            icon: icon(IconPicture),
            disabled: !hasDoc,
            onClick: run('core.text-to-image'),
          })}
          {bigBtn({
            labelKey: 'ribbonChayuanTextToVideo',
            icon: icon(IconSparkle),
            disabled: !hasDoc,
            onClick: run('core.text-to-video'),
          })}
        </div>
        <div className="ribbon-group-label">{t('ribbonGroupChayuanAssist')}</div>
      </div>

      <div className="ribbon-group">
        <div className="ribbon-group-items">
          {bigBtn({
            labelKey: 'ribbonChayuanSecurityCheck',
            icon: icon(IconEye),
            disabled: !hasDoc,
            onClick: run('core.security-check'),
          })}
          {bigBtn({
            labelKey: 'ribbonChayuanDeclassify',
            icon: icon(IconLock),
            disabled: !hasDoc,
            onClick: dialog('declassify'),
          })}
          {bigBtn({
            labelKey: 'ribbonChayuanDeclassifyRestore',
            icon: icon(IconKey),
            disabled: !hasDoc,
            onClick: dialog('declassifyRestore'),
          })}
        </div>
        <div className="ribbon-group-label">{t('ribbonGroupChayuanSecurity')}</div>
      </div>

      <div className="ribbon-group">
        <div className="ribbon-group-items">
          {bigBtn({
            labelKey: 'ribbonChayuanCleanStyles',
            icon: icon(IconEraser),
            disabled: !hasDoc,
            onClick: dialog('unusedStyles'),
          })}
          {bigBtn({
            labelKey: 'ribbonChayuanStyleStats',
            icon: icon(IconWordCount),
            disabled: !hasDoc,
            onClick: dialog('styleStatistics'),
          })}
          {bigBtn({
            labelKey: 'ribbonChayuanDeleteBlankRows',
            icon: icon(IconRowDelete),
            disabled: !hasDoc,
            onClick: () => chayuan.runOp('text.deleteBlankRows'),
          })}
        </div>
        <div className="ribbon-group-label">{t('ribbonGroupChayuanDocBatch')}</div>
      </div>

      <div className="ribbon-group">
        <div className="ribbon-group-items">
          <div className="rb-menu-anchor">
            {bigBtn({
              labelKey: 'ribbonChayuanTableBatch',
              icon: icon(IconTable),
              disabled: !hasDoc,
              menuKey: 'chayuanTableBatch',
              setDropdown,
              onClick: () => {},
            })}
            {menuPanel(
              'chayuanTableBatch',
              TABLE_BATCH_ITEMS.map((item) => ({
                labelKey: item.labelKey,
                onClick: () => item.run(chayuan),
              })),
            )}
          </div>
          <div className="rb-menu-anchor">
            {bigBtn({
              labelKey: 'ribbonChayuanImageBatch',
              icon: icon(IconCrop),
              disabled: !hasDoc,
              menuKey: 'chayuanImageBatch',
              setDropdown,
              onClick: () => {},
            })}
            {menuPanel(
              'chayuanImageBatch',
              IMAGE_BATCH_ITEMS.map((item) => ({
                labelKey: item.labelKey,
                onClick: () => item.run(chayuan),
              })),
            )}
          </div>
        </div>
        <div className="ribbon-group-label">{t('ribbonGroupChayuanBatch')}</div>
      </div>

      <div className="ribbon-group">
        <div className="ribbon-group-items">
          {bigBtn({
            labelKey: 'ribbonChayuanFormMode',
            icon: icon(IconCheckbox),
            disabled: !hasDoc,
            active: isFormModeActive(),
            onClick: () => chayuan.runOp('form.toggle'),
          })}
          {bigBtn({
            labelKey: 'ribbonChayuanFormContent',
            icon: icon(IconTableProperties),
            disabled: !hasDoc,
            onClick: dialog('formContent'),
          })}
        </div>
        <div className="ribbon-group-label">{t('ribbonGroupChayuanForm')}</div>
      </div>
    </>
  )
}
