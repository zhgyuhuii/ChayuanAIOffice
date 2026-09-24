/**
 * Home tab body — extracted verbatim from Ribbon.tsx during the schema
 * migration (strangler step 2): the schema host renders it through
 * `renderBody` until this tab converts to declarative controls. Same JSX,
 * same class strings, same behavior; the tab's own dropdown state, the
 * editor-bound mutation helpers and the painter machinery arrive as props
 * from RibbonInner.
 */
import type { ReactNode, RefObject } from 'react'
import type { Editor } from '@tiptap/core'
import type {
  CustomNumberingLevel,
  DefaultFonts,
  DocDefaults,
  StyleInfo,
  ThemeFonts,
} from '@chatoffice/docx-engine'
import { isSymbolFontFamily } from '@chatoffice/ui'
import { useI18n } from '../i18n/locale'
import type { CaseMode } from '../editor/case-transform'
import { cssFontFamily } from '../line-metrics'
import { fontFamiliesFor } from '../font-list'
import { formatNumber } from '../editor/numbering'
import { HIGHLIGHT_CSS } from '../editor/extensions'
import { useSystemFontFamilies } from '../system-fonts'
import { setInactiveSelectionShown } from '../editor/inactive-selection'
import type { RibbonFormatState } from './ribbon-format-state'
import { setParagraphDirection, setSelectionAlign } from '../editor/direction'
import { applyPhoneticGuide, clearPhoneticGuide } from '../editor/ruby'
import {
  BULLET_LIBRARY,
  COLORS,
  FONT_SIZES,
  HIGHLIGHTS,
  LINE_SPACINGS,
  MULTILEVEL_LIBRARY,
  NOOP_CHAIN,
  NUMBER_LIBRARY,
  ShapeColorPalette,
  bulletPresetLevels,
  numberPresetLevels,
  previewLevelText,
} from './ribbon-tab-shared'
import {
  IconAlignCenter,
  IconAlignDistribute,
  IconAlignJustify,
  IconAlignLeft,
  IconAlignRight,
  IconBorderAll,
  IconBullets,
  IconCaret,
  IconChangeCase,
  IconClearFormat,
  IconCopy,
  IconCut,
  IconDirLtr,
  IconDirRtl,
  IconFontColorA,
  IconFormatPainter,
  IconGrowFont,
  IconHighlight,
  IconIndentDec,
  IconIndentInc,
  IconLineSpacing,
  IconMultilevel,
  IconNumbered,
  IconPaste,
  IconPilcrow,
  IconShading,
  IconShrinkFont,
  IconSort,
  IconSubscript,
  IconSuperscript,
} from './icons'

/** format-painter pickup snapshot (kept structurally identical to Ribbon's) */
interface PainterState {
  marks: Array<{ type: string; attrs: Record<string, unknown> }>
  /** source paragraph's node type + formatting attrs (null when the caret is not in a paintable block) */
  block: { type: string; attrs: Record<string, unknown> } | null
}

export interface HomeTabProps {
  readonly canEdit: boolean
  readonly hasDoc: boolean
  /** tab-scoped dropdown id (palettes/galleries), owned by the ribbon shell */
  readonly dropdown: string | null
  readonly setDropdown: (
    update: string | null | ((current: string | null) => string | null),
  ) => void
  readonly fs: RibbonFormatState
  readonly editor: Editor
  readonly painter: PainterState | null
  readonly styleGalleryRef: RefObject<HTMLDivElement | null>
  readonly docDefaults: DocDefaults | undefined
  readonly themeFonts: ThemeFonts | null
  /** document styles, from ParsedDoc.styles (scope selector lists paragraph + character) */
  readonly styles?: Map<string, StyleInfo>
  readonly showMarks: boolean
  readonly onShowMarks: (v: boolean) => void
  readonly onParagraphDialog?: () => void
  readonly setListDialog: (v: boolean) => void
  readonly penColor: string
  readonly setPenColor: (hex: string) => void
  readonly penHighlight: string
  readonly setPenHighlight: (name: string) => void
  readonly fontCommitRef: RefObject<boolean>
  readonly stepFontSize: (dir: 1 | -1) => void
  readonly togglePainter: () => void
  readonly markBtn: (name: string, active: boolean, title: string, label: ReactNode) => ReactNode
  readonly clipboard: (action: 'cut' | 'copy' | 'paste') => Promise<void>
  readonly setParaAttr: (attrs: Record<string, unknown>) => void
  readonly setTextStyle: (patch: Record<string, unknown>) => void
  /** slot-aware font write: 'font' = East Asian rFonts slot, 'fontAscii' = Latin */
  readonly setFont: (slot: 'font' | 'fontAscii', name: string) => void
  /** target of font writes: 'selection' | 'defaults' | 'style:<styleId>' */
  readonly fontScope: string
  readonly setFontScope: (v: string) => void
  readonly fontSettingsBusy: boolean
  readonly onFontSettings?: (scope: string, patch: DefaultFonts) => Promise<void>
  readonly toggleList: (kind: 'bullet' | 'ordered') => void
  readonly clearList: () => void
  readonly applyListPreset: (levels: CustomNumberingLevel[]) => void
  readonly changeIndent: (delta: 1 | -1) => void
  readonly toggleVertAlign: (kind: 'superscript' | 'subscript') => void
  readonly changeCase: (mode: CaseMode) => void
  readonly renderStyleCards: (inMenu: boolean) => ReactNode
}

export function HomeTab({
  canEdit,
  hasDoc,
  dropdown,
  setDropdown,
  fs,
  editor,
  painter,
  styleGalleryRef,
  docDefaults,
  themeFonts,
  styles,
  fontScope,
  setFontScope,
  fontSettingsBusy,
  onFontSettings,
  showMarks,
  onShowMarks,
  onParagraphDialog,
  setListDialog,
  penColor,
  setPenColor,
  penHighlight,
  setPenHighlight,
  fontCommitRef,
  stepFontSize,
  togglePainter,
  markBtn,
  clipboard,
  setParaAttr,
  setTextStyle,
  setFont,
  toggleList,
  clearList,
  applyListPreset,
  changeIndent,
  toggleVertAlign,
  changeCase,
  renderStyleCards,
}: HomeTabProps) {
  const { t, lang } = useI18n()
  // RibbonInner locals the extracted JSX closes over, recomputed verbatim
  const sub = fs.sub
  const ed = sub ?? editor
  const chain = () => (canEdit ? ed.chain().focus() : NOOP_CHAIN)
  const currentSize = fs.fontSizePt
  const { families: systemFontFamilies, load: loadSystemFonts } = useSystemFontFamilies()
  const fontFamilies = fontFamiliesFor(lang)
  const activeAlign = fs.align ?? (fs.bidi ? 'right' : 'left')
  const activeSpacing = fs.lineSpacing
  return (
    <>
      {/* ---- Clipboard ---- */}
      <div className="ribbon-group">
        <div className="ribbon-group-items">
          <button className="rb-big" disabled={!canEdit} onClick={() => void clipboard('paste')}>
            <span className="rb-big-icon">
              <IconPaste size={28} />
            </span>
            <span>{t('ribbonPaste')}</span>
          </button>
          <div className="rb-col">
            <button
              className="rb-small"
              disabled={!canEdit}
              data-tip={t('ribbonCutTip')}
              aria-label={t('ribbonCutTip')}
              onClick={() => void clipboard('cut')}
            >
              <IconCut />
            </button>
            <button
              className="rb-small"
              disabled={!hasDoc}
              data-tip={t('ribbonCopyTip')}
              aria-label={t('ribbonCopyTip')}
              onClick={() => void clipboard('copy')}
            >
              <IconCopy />
            </button>
            <button
              className={`rb-small ${painter ? 'active' : ''}`}
              disabled={!canEdit || !!sub}
              data-tip={painter ? t('ribbonPainterActiveTip') : t('ribbonPainterTip')}
              aria-label={painter ? t('ribbonPainterActiveTip') : t('ribbonPainterTip')}
              onClick={togglePainter}
            >
              <IconFormatPainter />
            </button>
          </div>
        </div>
        <div className="ribbon-group-label">{t('ribbonGroupClipboard')}</div>
      </div>

      <div className="ribbon-sep" />

      {/* ---- Font ---- */}
      <div className="ribbon-group">
        <div className="ribbon-group-items rb-font-group">
          <div className="rb-row">
            {/* Editable combobox (free-typed input + full preset dropdown): real
                      documents use fonts and sizes outside any fixed list (GB/T 9704
                      fonts, half sizes like 13.5pt). East Asian and Latin picks target
                      only their own rFonts slot (Word never flattens the other one). */}
            {(['font', 'fontAscii'] as const).map((slot) => {
              const eastAsia = slot === 'font'
              const fontLabel = t(eastAsia ? 'ribbonFontEastAsia' : 'ribbonFontLatin')
              const slotBodyFontName = eastAsia
                ? docDefaults?.eastAsiaFont || 'SimSun'
                : docDefaults?.asciiFont || themeFonts?.minor || 'Calibri'
              const style = fontScope.startsWith('style:')
                ? styles?.get(fontScope.slice(6))?.display
                : undefined
              const currentFont =
                fontScope === 'selection'
                  ? eastAsia
                    ? fs.fontEastAsia
                    : fs.fontLatin
                  : fontScope === 'defaults'
                    ? eastAsia
                      ? (docDefaults?.eastAsiaFont ?? '')
                      : (docDefaults?.asciiFont ?? '')
                    : eastAsia
                      ? (style?.eastAsiaFont ??
                        (style?.font !== style?.fontAscii ? style?.font : undefined) ??
                        docDefaults?.eastAsiaFont ??
                        '')
                      : (style?.fontAscii ?? docDefaults?.asciiFont ?? '')
              return (
                <div className="rb-split-wrap" key={slot}>
                  <span className="rb-font-slot-label">{fontLabel}</span>
                  <input
                    className="rb-select rb-font-family"
                    disabled={!canEdit || fontSettingsBusy}
                    key={`f:${fontScope}:${slot}:${currentFont}:${hasDoc}`}
                    defaultValue={currentFont ?? ''}
                    data-font-slot={slot}
                    aria-label={fontLabel}
                    placeholder={currentFont === null ? t('ribbonFontMixed') : fontLabel}
                    data-tip={fontLabel}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        fontCommitRef.current = true
                        ;(e.target as HTMLInputElement).blur()
                      }
                    }}
                    // focusing the input relocates the DOM selection into it,
                    // hiding the document highlight — the decoration keeps the
                    // target text visibly selected, like Word (r119)
                    onFocus={(e) => {
                      e.currentTarget.select()
                      setInactiveSelectionShown(ed, true)
                    }}
                    onBlur={(e) => {
                      const committed = fontCommitRef.current
                      fontCommitRef.current = false
                      setInactiveSelectionShown(ed, false)
                      const v = e.target.value.trim()
                      // Enter applies to every selected run; click-away keeps the no-op guard.
                      if (v && (v !== currentFont || committed)) setFont(slot, v)
                      else e.target.value = currentFont ?? ''
                    }}
                  />
                  <button
                    className="rb-caret rb-combo-caret"
                    disabled={!canEdit || fontSettingsBusy}
                    data-tip={fontLabel}
                    aria-label={fontLabel}
                    onClick={() => {
                      if (dropdown !== slot) loadSystemFonts()
                      setDropdown((v) => (v === slot ? null : slot))
                    }}
                  >
                    <IconCaret />
                  </button>
                  {dropdown === slot && (
                    <div data-rb-panel="" className="spacing-menu rb-font-family-menu">
                      <button
                        className={!currentFont ? 'active' : ''}
                        style={{ fontFamily: cssFontFamily(slotBodyFontName) }}
                        onClick={() => setFont(slot, slotBodyFontName)}
                      >
                        {t('ribbonFontBodyNamed', { font: slotBodyFontName })}
                      </button>
                      {fontFamilies
                        .filter((f) => f !== slotBodyFontName)
                        .map((f) => (
                          <button
                            key={f}
                            className={f === currentFont ? 'active' : ''}
                            style={{ fontFamily: cssFontFamily(f) }}
                            onClick={() => setFont(slot, f)}
                          >
                            {f}
                          </button>
                        ))}
                      {systemFontFamilies.length > 0 && (
                        <>
                          <div className="rb-menu-group-label">{t('ribbonFontsSystem')}</div>
                          {systemFontFamilies
                            .filter((f) => f !== slotBodyFontName)
                            .map((f) => (
                              <button
                                key={f}
                                className={f === currentFont ? 'active' : ''}
                                // symbol fonts would render their own name as pictographs
                                style={{
                                  fontFamily: isSymbolFontFamily(f) ? undefined : cssFontFamily(f),
                                }}
                                onClick={() => setFont(slot, f)}
                              >
                                {f}
                              </button>
                            ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            <div className="rb-split-wrap">
              <input
                className="rb-select rb-font-size"
                type="number"
                min={1}
                max={1638}
                step={0.5}
                disabled={!canEdit}
                key={`s:${currentSize}:${hasDoc}`}
                defaultValue={currentSize}
                data-tip={t('ribbonFontSizeTip')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    fontCommitRef.current = true
                    ;(e.target as HTMLInputElement).blur()
                  }
                }}
                onFocus={(e) => {
                  e.currentTarget.select()
                  setInactiveSelectionShown(ed, true)
                }}
                onBlur={(e) => {
                  const committed = fontCommitRef.current
                  fontCommitRef.current = false
                  setInactiveSelectionShown(ed, false)
                  const v = Number(e.target.value)
                  if (!Number.isFinite(v) || v <= 0) return
                  const half = Math.round(Math.min(1638, Math.max(1, v)) * 2)
                  // same r121 rule as the family box: Enter normalizes a
                  // mixed-size selection to the shown value
                  if (half !== Math.round(currentSize * 2) || committed)
                    setTextStyle({ sizeHalfPoints: half })
                }}
              />
              <button
                className="rb-caret rb-combo-caret"
                disabled={!canEdit}
                data-tip={t('ribbonFontSizeTip')}
                aria-label={t('ribbonFontSizeTip')}
                onClick={() => setDropdown((v) => (v === 'fontSize' ? null : 'fontSize'))}
              >
                <IconCaret />
              </button>
              {dropdown === 'fontSize' && (
                <div data-rb-panel="" className="spacing-menu rb-font-size-menu">
                  {FONT_SIZES.map((s) => (
                    <button
                      key={s}
                      className={Math.round(s * 2) === Math.round(currentSize * 2) ? 'active' : ''}
                      onClick={() => setTextStyle({ sizeHalfPoints: Math.round(s * 2) })}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              className="rb-icon"
              disabled={!canEdit}
              data-tip={t('ribbonGrowFont')}
              aria-label={t('ribbonGrowFont')}
              onClick={() => stepFontSize(1)}
            >
              <IconGrowFont />
            </button>
            <button
              className="rb-icon"
              disabled={!canEdit}
              data-tip={t('ribbonShrinkFont')}
              aria-label={t('ribbonShrinkFont')}
              onClick={() => stepFontSize(-1)}
            >
              <IconShrinkFont />
            </button>
            <span className="rb-mini-sep" />
            <div className="rb-split-wrap">
              <button
                className="rb-icon"
                disabled={!canEdit}
                data-tip={t('ribbonChangeCase')}
                onClick={() => setDropdown((v) => (v === 'case' ? null : 'case'))}
              >
                <IconChangeCase />
                <span className="rb-caret-inline">
                  <IconCaret />
                </span>
              </button>
              {dropdown === 'case' && (
                <div data-rb-panel="" className="spacing-menu case-menu">
                  <button onClick={() => changeCase('sentence')}>{t('ribbonCaseSentence')}</button>
                  <button onClick={() => changeCase('lower')}>{t('ribbonCaseLower')}</button>
                  <button onClick={() => changeCase('upper')}>{t('ribbonCaseUpper')}</button>
                  <button onClick={() => changeCase('title')}>{t('ribbonCaseTitle')}</button>
                </div>
              )}
            </div>
            <button
              className="rb-icon"
              disabled={!canEdit}
              data-tip={t('ribbonClearFormatting')}
              aria-label={t('ribbonClearFormatting')}
              onClick={() => chain().unsetAllMarks().run()}
            >
              <IconClearFormat />
            </button>
          </div>
          <div className="rb-row">
            {markBtn('bold', fs.bold, t('ribbonBoldTip'), <b>B</b>)}
            {markBtn('italic', fs.italic, t('ribbonItalicTip'), <i>I</i>)}
            {markBtn('underline', fs.underline, t('ribbonUnderlineTip'), <u>U</u>)}
            {markBtn('strike', fs.strike, t('ribbonStrikethrough'), <s>ab</s>)}
            {/* 拼音指南⌄ (WPS 字体组 #11): per-char ruby phonetic guide over the selection */}
            <div className="rb-split-wrap">
              <button
                className="rb-icon"
                disabled={!canEdit}
                data-tip={t('ribbonPhoneticTip')}
                aria-label={t('ribbonPhoneticTip')}
                onClick={() => setDropdown((v) => (v === 'phonetic' ? null : 'phonetic'))}
              >
                <span className="rb-phonetic" aria-hidden="true">
                  pīn
                </span>
                <IconCaret />
              </button>
              {dropdown === 'phonetic' && (
                <div data-rb-panel="" className="rb-menu">
                  <button
                    onClick={() => {
                      if (applyPhoneticGuide(editor)) setDropdown(null)
                    }}
                  >
                    {t('ribbonPhoneticApply')}
                  </button>
                  <button
                    onClick={() => {
                      if (clearPhoneticGuide(editor)) setDropdown(null)
                    }}
                  >
                    {t('ribbonPhoneticClear')}
                  </button>
                </div>
              )}
            </div>
            <button
              className={`rb-icon ${fs.vertAlign === 'subscript' ? 'active' : ''}`}
              disabled={!canEdit}
              data-tip={t('ribbonSubscript')}
              onClick={() => toggleVertAlign('subscript')}
            >
              <IconSubscript />
            </button>
            <button
              className={`rb-icon ${fs.vertAlign === 'superscript' ? 'active' : ''}`}
              disabled={!canEdit}
              data-tip={t('ribbonSuperscript')}
              onClick={() => toggleVertAlign('superscript')}
            >
              <IconSuperscript />
            </button>
            <span className="rb-mini-sep" />
            {/* highlight: main button applies pen color, caret opens palette */}
            <div className="rb-split-wrap">
              <button
                className={`rb-icon rb-color-btn ${fs.highlight ? 'active' : ''}`}
                disabled={!canEdit}
                data-tip={t('ribbonTextHighlightColor')}
                aria-label={t('ribbonTextHighlightColor')}
                onClick={() =>
                  setTextStyle({
                    highlight: fs.highlight === penHighlight ? null : penHighlight,
                  })
                }
              >
                <span className="rb-color-glyph rb-color-glyph-svg">
                  <IconHighlight />
                  <span
                    className="rb-color-bar"
                    style={{ background: HIGHLIGHT_CSS[penHighlight] }}
                  />
                </span>
              </button>
              <button
                className={`rb-caret rb-color-caret${dropdown === 'highlight' ? ' active' : ''}`}
                disabled={!canEdit}
                onClick={() => setDropdown((v) => (v === 'highlight' ? null : 'highlight'))}
              >
                <IconCaret />
              </button>
              {dropdown === 'highlight' && (
                <div
                  data-rb-panel=""
                  className="color-palette color-palette-highlight color-palette-highlight-word"
                >
                  <div className="color-section-title color-highlight-title">
                    {t('ribbonHighlightColors')}
                  </div>
                  <div className="color-highlight-grid">
                    {HIGHLIGHTS.map((h) => (
                      <button
                        key={h}
                        className={`color-swatch color-highlight-swatch ${fs.highlight === h ? 'selected' : ''}`}
                        data-tip={h}
                        aria-label={h}
                        style={{ background: HIGHLIGHT_CSS[h] }}
                        onClick={() => {
                          setPenHighlight(h)
                          setTextStyle({ highlight: h })
                        }}
                      />
                    ))}
                  </div>
                  <button
                    className={`color-none color-highlight-none ${!fs.highlight ? 'selected' : ''}`}
                    onClick={() => setTextStyle({ highlight: null })}
                  >
                    {t('ribbonNoColor')}
                  </button>
                </div>
              )}
            </div>
            {/* 字符边框 / 字符底纹 (WPS 字体组 #12-13): run-level w:bdr / w:shd toggles */}
            <button
              className={`rb-icon ${fs.charBorder ? 'active' : ''}`}
              disabled={!canEdit}
              data-tip={t('ribbonCharBorderTip')}
              aria-label={t('ribbonCharBorderTip')}
              onClick={() => setTextStyle({ border: fs.charBorder ? null : true })}
            >
              <span className="rb-char-box" aria-hidden="true">
                A
              </span>
            </button>
            <button
              className={`rb-icon ${fs.charShading ? 'active' : ''}`}
              disabled={!canEdit}
              data-tip={t('ribbonCharShadingTip')}
              aria-label={t('ribbonCharShadingTip')}
              onClick={() => setTextStyle({ shading: fs.charShading ? null : 'D9D9D9' })}
            >
              <span className="rb-char-shade" aria-hidden="true">
                A
              </span>
            </button>
            {/* font color: main button applies pen color, caret opens palette */}
            <div className="rb-split-wrap">
              <button
                className="rb-icon rb-color-btn"
                disabled={!canEdit}
                data-tip={t('ribbonFontColor')}
                onClick={() => setTextStyle({ color: penColor === '000000' ? null : penColor })}
              >
                <span className="rb-color-glyph rb-color-glyph-svg">
                  <IconFontColorA />
                  <span className="rb-color-bar" style={{ background: `#${penColor}` }} />
                </span>
              </button>
              <button
                className={`rb-caret rb-color-caret${dropdown === 'color' ? ' active' : ''}`}
                disabled={!canEdit}
                onClick={() => setDropdown((v) => (v === 'color' ? null : 'color'))}
              >
                <IconCaret />
              </button>
              {dropdown === 'color' && (
                <ShapeColorPalette
                  current={fs.textColor}
                  noneLabel={t('ribbonAutomatic')}
                  onPick={(hex) => {
                    if (!hex) {
                      setPenColor('000000')
                      setTextStyle({ color: null })
                    } else {
                      setPenColor(hex)
                      setTextStyle({ color: hex === '000000' ? null : hex })
                    }
                  }}
                />
              )}
            </div>
            {/* Font-settings scope: what the two family boxes above target
                      (selection / document defaults / one style). It rides this
                      row's right slack because the ribbon band is hard-fixed at
                      two 30px rows — as its own row it overflows the band and
                      gets clipped (upstream #474 regression). */}
            {onFontSettings && (
              <select
                className="rb-select rb-font-scope"
                aria-label={t('ribbonFontScope')}
                data-tip={t('ribbonFontScope')}
                value={fontScope}
                disabled={!canEdit || fontSettingsBusy}
                onChange={(e) => {
                  setFontScope(e.target.value)
                  setDropdown(null)
                }}
              >
                <option value="selection">{t('ribbonFontSelection')}</option>
                <option value="defaults">{t('ribbonFontDefaults')}</option>
                {[...(styles?.values() ?? [])]
                  .filter((style) => style.type === 'paragraph' || style.type === 'character')
                  .map((style) => (
                    <option key={style.styleId} value={`style:${style.styleId}`}>
                      {t(
                        style.type === 'character'
                          ? 'ribbonFontCharacterStyle'
                          : 'ribbonFontParagraphStyle',
                      )}
                      : {style.name}
                    </option>
                  ))}
              </select>
            )}
          </div>
        </div>
        <div className="ribbon-group-label">{t('ribbonGroupFont')}</div>
      </div>

      <div className="ribbon-sep" />

      {/* ---- Paragraph ---- */}
      <div className="ribbon-group">
        <div className="ribbon-group-items rb-font-group">
          <div className="rb-row">
            <div className="rb-split-wrap">
              <button
                className={`rb-icon ${fs.listBullet ? 'active' : ''}`}
                disabled={!canEdit || !!sub}
                data-tip={t('ribbonBullets')}
                aria-label={t('ribbonBullets')}
                onClick={() => toggleList('bullet')}
              >
                <IconBullets />
              </button>
              <button
                className={`rb-caret${dropdown === 'bulletLib' ? ' active' : ''}`}
                disabled={!canEdit || !!sub}
                data-tip={t('ribbonBullets')}
                aria-label={t('ribbonBullets')}
                onClick={() => setDropdown((v) => (v === 'bulletLib' ? null : 'bulletLib'))}
              >
                <IconCaret />
              </button>
              {dropdown === 'bulletLib' && (
                <div data-rb-panel="" className="layout-menu list-gallery list-gallery-word">
                  <div className="list-gallery-title">{t('ribbonBulletLibTitle')}</div>
                  <button
                    className={`list-gallery-card list-gallery-none${!fs.listBullet && !fs.listOrdered ? ' selected' : ''}`}
                    onClick={() => {
                      clearList()
                      setDropdown(null)
                    }}
                  >
                    {t('ribbonListNone')}
                  </button>
                  {BULLET_LIBRARY.map((glyph) => (
                    <button
                      key={glyph}
                      className="list-gallery-card list-gallery-glyph"
                      onClick={() => {
                        applyListPreset(bulletPresetLevels(glyph))
                        setDropdown(null)
                      }}
                    >
                      {glyph}
                    </button>
                  ))}
                  <button
                    className="list-gallery-define"
                    onClick={() => {
                      setListDialog(true)
                      setDropdown(null)
                    }}
                  >
                    {t('ribbonDefineNewBullet')}…
                  </button>
                </div>
              )}
            </div>
            <div className="rb-split-wrap">
              <button
                className={`rb-icon ${fs.listOrdered ? 'active' : ''}`}
                disabled={!canEdit || !!sub}
                data-tip={t('ribbonNumbering')}
                aria-label={t('ribbonNumbering')}
                onClick={() => toggleList('ordered')}
              >
                <IconNumbered />
              </button>
              <button
                className={`rb-caret${dropdown === 'numberLib' ? ' active' : ''}`}
                disabled={!canEdit || !!sub}
                data-tip={t('ribbonNumbering')}
                aria-label={t('ribbonNumbering')}
                onClick={() => setDropdown((v) => (v === 'numberLib' ? null : 'numberLib'))}
              >
                <IconCaret />
              </button>
              {dropdown === 'numberLib' && (
                <div data-rb-panel="" className="layout-menu list-gallery list-gallery-word">
                  <div className="list-gallery-title">{t('ribbonNumberLibTitle')}</div>
                  <button
                    className={`list-gallery-card list-gallery-none${!fs.listBullet && !fs.listOrdered ? ' selected' : ''}`}
                    onClick={() => {
                      clearList()
                      setDropdown(null)
                    }}
                  >
                    {t('ribbonListNone')}
                  </button>
                  {NUMBER_LIBRARY.map((n, i) => {
                    const levels = numberPresetLevels(n.numFmt, n.pattern)
                    return (
                      <button
                        key={i}
                        className="list-gallery-card list-gallery-preview"
                        onClick={() => {
                          applyListPreset(levels)
                          setDropdown(null)
                        }}
                      >
                        {[1, 2, 3].map((v) => (
                          <span key={v} className="list-gallery-preview-row">
                            <span className="list-gallery-preview-prefix">
                              {n.pattern.replace('%1', formatNumber(v, n.numFmt))}
                            </span>
                            <span className="list-gallery-preview-line" />
                          </span>
                        ))}
                      </button>
                    )
                  })}
                  <button
                    className="list-gallery-define"
                    onClick={() => {
                      setListDialog(true)
                      setDropdown(null)
                    }}
                  >
                    {t('ribbonDefineNewNumber')}…
                  </button>
                </div>
              )}
            </div>
            <div className="rb-split-wrap">
              <button
                className="rb-icon"
                disabled={!canEdit || !!sub}
                data-tip={t('ribbonMultilevelTip')}
                aria-label={t('ribbonMultilevelTip')}
                onClick={() => setDropdown((v) => (v === 'multiLib' ? null : 'multiLib'))}
              >
                <IconMultilevel />
              </button>
              {dropdown === 'multiLib' && (
                <div data-rb-panel="" className="layout-menu list-gallery list-gallery-multi">
                  {MULTILEVEL_LIBRARY.map((levels, i) => (
                    <button
                      key={i}
                      className="list-gallery-card list-gallery-card-multi"
                      onClick={() => {
                        applyListPreset(levels)
                        setDropdown(null)
                      }}
                    >
                      {[0, 1, 2].map((lvl) => (
                        <span key={lvl} style={{ paddingLeft: lvl * 10 }}>
                          {previewLevelText(levels, lvl)} ———
                        </span>
                      ))}
                    </button>
                  ))}
                  <button
                    className="list-gallery-define"
                    onClick={() => {
                      setListDialog(true)
                      setDropdown(null)
                    }}
                  >
                    {t('ribbonDefineNewList')}…
                  </button>
                </div>
              )}
            </div>
            <span className="rb-mini-sep" />
            <button
              className="rb-icon"
              disabled={!canEdit || !!sub}
              data-tip={t('ribbonDecreaseIndent')}
              aria-label={t('ribbonDecreaseIndent')}
              onClick={() => changeIndent(-1)}
            >
              <IconIndentDec />
            </button>
            <button
              className="rb-icon"
              disabled={!canEdit || !!sub}
              data-tip={t('ribbonIncreaseIndent')}
              aria-label={t('ribbonIncreaseIndent')}
              onClick={() => changeIndent(1)}
            >
              <IconIndentInc />
            </button>
            <span className="rb-mini-sep" />
            <button
              className="rb-icon"
              disabled
              data-tip={t('ribbonNotSupportedSuffix', { label: t('ribbonSort') })}
              aria-label={t('ribbonNotSupportedSuffix', { label: t('ribbonSort') })}
            >
              <IconSort />
            </button>
            <button
              className={`rb-icon ${showMarks ? 'active' : ''}`}
              disabled={!hasDoc}
              data-tip={t('ribbonShowMarks')}
              aria-label={t('ribbonShowMarks')}
              onClick={() => onShowMarks(!showMarks)}
            >
              <IconPilcrow />
            </button>
          </div>
          <div className="rb-row">
            <button
              className={`rb-icon ${activeAlign === 'left' ? 'active' : ''}`}
              disabled={!canEdit}
              data-tip={t('ribbonAlignLeftTip')}
              aria-label={t('ribbonAlignLeftTip')}
              onClick={() => setSelectionAlign(ed, 'left')}
            >
              <IconAlignLeft />
            </button>
            <button
              className={`rb-icon ${activeAlign === 'center' ? 'active' : ''}`}
              disabled={!canEdit}
              data-tip={t('ribbonAlignCenterTip')}
              aria-label={t('ribbonAlignCenterTip')}
              onClick={() => setSelectionAlign(ed, 'center')}
            >
              <IconAlignCenter />
            </button>
            <button
              className={`rb-icon ${activeAlign === 'right' ? 'active' : ''}`}
              disabled={!canEdit}
              data-tip={t('ribbonAlignRightTip')}
              aria-label={t('ribbonAlignRightTip')}
              onClick={() => setSelectionAlign(ed, 'right')}
            >
              <IconAlignRight />
            </button>
            <button
              className={`rb-icon ${activeAlign === 'justify' ? 'active' : ''}`}
              disabled={!canEdit}
              data-tip={t('ribbonJustifyTip')}
              aria-label={t('ribbonJustifyTip')}
              onClick={() => setSelectionAlign(ed, 'justify')}
            >
              <IconAlignJustify />
            </button>
            <button
              className="rb-icon"
              disabled={!canEdit}
              data-tip={t('ribbonDistributeTip')}
              aria-label={t('ribbonDistributeTip')}
              onClick={() => setSelectionAlign(ed, 'distribute')}
            >
              <IconAlignDistribute />
            </button>
            <span className="rb-mini-sep" />
            <button
              className={`rb-icon ${!fs.bidi ? 'active' : ''}`}
              disabled={!canEdit || !!sub}
              data-tip={t('ribbonDirLtrTip')}
              aria-label={t('ribbonDirLtrTip')}
              onClick={() => setParagraphDirection(editor, 'ltr')}
            >
              <IconDirLtr />
            </button>
            <button
              className={`rb-icon ${fs.bidi ? 'active' : ''}`}
              disabled={!canEdit || !!sub}
              data-tip={t('ribbonDirRtlTip')}
              aria-label={t('ribbonDirRtlTip')}
              onClick={() => setParagraphDirection(editor, 'rtl')}
            >
              <IconDirRtl />
            </button>
            <span className="rb-mini-sep" />
            <div className="rb-split-wrap">
              <button
                className={`rb-icon ${activeSpacing ? 'active' : ''}`}
                disabled={!canEdit}
                data-tip={t('ribbonLineSpacing')}
                aria-label={t('ribbonLineSpacing')}
                onClick={() => setDropdown((v) => (v === 'spacing' ? null : 'spacing'))}
              >
                <IconLineSpacing />
                <span className="rb-caret-inline">
                  <IconCaret />
                </span>
              </button>
              {dropdown === 'spacing' && (
                <div data-rb-panel="" className="spacing-menu">
                  {LINE_SPACINGS.map((s) => (
                    <button
                      key={s}
                      className={activeSpacing === s ? 'active' : ''}
                      // presets are multiples: clear any atLeast/exact rule so they take effect
                      onClick={() =>
                        setParaAttr({ lineSpacing: s, lineRule: null, lineRawTwips: null })
                      }
                    >
                      {s.toFixed(2).replace(/0+$/, '').replace(/\.$/, '.0')}
                    </button>
                  ))}
                  <button
                    onClick={() =>
                      setParaAttr({ lineSpacing: null, lineRule: null, lineRawTwips: null })
                    }
                  >
                    {t('ribbonDefault')}
                  </button>
                  {onParagraphDialog && (
                    <button
                      onClick={() => {
                        setDropdown(null)
                        onParagraphDialog()
                      }}
                    >
                      {t('ribbonLineSpacingOptions')}
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="rb-split-wrap">
              <button
                className={`rb-icon ${fs.shadingFill ? 'active' : ''}`}
                disabled={!canEdit}
                data-tip={t('ribbonParagraphShading')}
                aria-label={t('ribbonParagraphShading')}
                onClick={() => setDropdown((v) => (v === 'shading' ? null : 'shading'))}
              >
                <IconShading />
                <span className="rb-caret-inline">
                  <IconCaret />
                </span>
              </button>
              {dropdown === 'shading' && (
                <div data-rb-panel="" className="color-palette">
                  {COLORS.map((c) => (
                    <button
                      key={c.hex}
                      className="color-swatch"
                      style={{ background: `#${c.hex}` }}
                      data-tip={t(c.nameKey)}
                      aria-label={t(c.nameKey)}
                      onClick={() => setParaAttr({ shadingFill: c.hex })}
                    />
                  ))}
                  <button
                    className="color-clear"
                    onClick={() => setParaAttr({ shadingFill: null })}
                  >
                    {t('ribbonNoShading')}
                  </button>
                </div>
              )}
            </div>
            <div className="rb-split-wrap">
              <button
                className={`rb-icon ${fs.paraBorders ? 'active' : ''}`}
                disabled={!canEdit}
                data-tip={t('ribbonParagraphBorders')}
                aria-label={t('ribbonParagraphBorders')}
                onClick={() => setDropdown((v) => (v === 'borders' ? null : 'borders'))}
              >
                <IconBorderAll />
                <span className="rb-caret-inline">
                  <IconCaret />
                </span>
              </button>
              {dropdown === 'borders' && (
                <div data-rb-panel="" className="spacing-menu borders-menu">
                  <button onClick={() => setParaAttr({ borders: 'b' })}>
                    {t('ribbonBorderBottom')}
                  </button>
                  <button onClick={() => setParaAttr({ borders: 't' })}>
                    {t('ribbonBorderTop')}
                  </button>
                  <button onClick={() => setParaAttr({ borders: 'l' })}>
                    {t('ribbonBorderLeft')}
                  </button>
                  <button onClick={() => setParaAttr({ borders: 'r' })}>
                    {t('ribbonBorderRight')}
                  </button>
                  <button onClick={() => setParaAttr({ borders: 'tblr' })}>
                    {t('ribbonBorderBox')}
                  </button>
                  <button onClick={() => setParaAttr({ borders: null })}>
                    {t('ribbonNoBorders')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="ribbon-group-label">{t('ribbonGroupParagraph')}</div>
      </div>

      <div className="ribbon-sep" />

      {/* ---- Styles ---- */}
      <div className="ribbon-group ribbon-group-styles">
        <div className="ribbon-group-items rb-split-wrap style-gallery-wrap">
          <div className="style-gallery" ref={styleGalleryRef}>
            {renderStyleCards(false)}
          </div>
          {/* WPS/Word parity: the expander is permanent so the full style
                    list stays reachable even when every card fits the row */}
          <button
            className="style-gallery-more"
            data-tip={t('ribbonMoreStyles')}
            aria-label={t('ribbonMoreStyles')}
            aria-expanded={dropdown === 'styleGallery'}
            onClick={() => setDropdown((v) => (v === 'styleGallery' ? null : 'styleGallery'))}
          >
            <IconCaret />
          </button>
          {dropdown === 'styleGallery' && (
            <div data-rb-panel="" className="style-gallery-menu">
              {renderStyleCards(true)}
            </div>
          )}
        </div>
        <div className="ribbon-group-label">{t('ribbonGroupStyles')}</div>
      </div>
    </>
  )
}
