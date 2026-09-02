import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { AiPanelToggle, Dropdown, useDismissablePopover } from '@chatoffice/ui'
import { useI18n } from '../i18n/locale'
import type { StringKey } from '../i18n/locale'
import { liftFromList } from '../editor/slashCommand'
import {
  IconBullets,
  IconHr,
  IconInlineCode,
  IconLink,
  IconNumbered,
  IconPicture,
  IconProperties,
  IconRedo,
  IconSave,
  IconTable,
  IconTaskList,
  IconUndo,
} from './icons'

interface Props {
  editor: Editor | null
  disabled: boolean
  dirty: boolean
  onSave: () => void
  autoSave: boolean
  onToggleAutoSave: (on: boolean) => void
  imageEnabled: boolean
  onInsertImage: () => void
  frontmatterOpen: boolean
  onToggleFrontmatter: () => void
  aiPanelAvailable: boolean
  aiPanelOpen: boolean
  onToggleAiPanel: () => void
}

type BlockStyle = 'paragraph' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'quote' | 'codeBlock'

const STYLE_LABEL: Record<BlockStyle, StringKey> = {
  paragraph: 'styleParagraph',
  h1: 'styleH1',
  h2: 'styleH2',
  h3: 'styleH3',
  h4: 'styleH4',
  h5: 'styleH5',
  h6: 'styleH6',
  quote: 'styleQuote',
  codeBlock: 'styleCodeBlock',
}

function applyBlockStyle(editor: Editor, style: BlockStyle): void {
  // block-type conversions are illegal inside list items — leave the list first
  liftFromList(editor)
  const chain = editor.chain().focus()
  switch (style) {
    case 'paragraph':
      chain.setParagraph().run()
      break
    case 'quote':
      chain.setParagraph().setBlockquote().run()
      break
    case 'codeBlock':
      chain.setCodeBlock().run()
      break
    default:
      chain.setHeading({ level: Number(style.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6 }).run()
  }
}

function IconBtn({
  title,
  active,
  disabled,
  onClick,
  children,
}: {
  title: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={`rb-btn${active ? ' active' : ''}`}
      data-tip={title}
      aria-label={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export function Ribbon({
  editor,
  disabled,
  dirty,
  onSave,
  autoSave,
  onToggleAutoSave,
  imageEnabled,
  onInsertImage,
  frontmatterOpen,
  onToggleFrontmatter,
  aiPanelAvailable,
  aiPanelOpen,
  onToggleAiPanel,
}: Props) {
  const { t } = useI18n()
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const linkInputRef = useRef<HTMLInputElement>(null)
  const linkAnchorRef = useRef<HTMLSpanElement>(null)

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null
      const style: BlockStyle = e.isActive('codeBlock')
        ? 'codeBlock'
        : e.isActive('blockquote')
          ? 'quote'
          : e.isActive('heading')
            ? (`h${e.getAttributes('heading').level}` as BlockStyle)
            : 'paragraph'
      return {
        style,
        empty: e.isEmpty,
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        strike: e.isActive('strike'),
        code: e.isActive('code'),
        link: e.isActive('link'),
        bullet: e.isActive('bulletList'),
        ordered: e.isActive('orderedList'),
        task: e.isActive('taskList'),
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
      }
    },
  })

  useEffect(() => {
    if (linkOpen) linkInputRef.current?.focus()
  }, [linkOpen])

  useDismissablePopover(linkOpen, () => setLinkOpen(false), {
    inside: () => [linkAnchorRef.current],
  })

  const off = disabled || !editor || !state

  const openLink = () => {
    if (!editor) return
    setLinkUrl(String(editor.getAttributes('link').href ?? ''))
    setLinkOpen((v) => !v)
  }

  const applyLink = () => {
    if (!editor) return
    const url = linkUrl.trim()
    const chain = editor.chain().focus().extendMarkRange('link')
    if (url) chain.setLink({ href: url }).run()
    else chain.unsetLink().run()
    setLinkOpen(false)
  }

  // 20px inline-row rendering, same as the docs toolbar these icons come from
  // (pinned stroke paints 1.5px at this size per the suite-wide icon rules)
  const ICON = 20

  return (
    <div className="ribbon">
      {/* quick-access row above the toolbar (save / undo / redo / autosave), same as the docs QAT row */}
      <div className="ribbon-tabs">
        <button
          type="button"
          className="qa-btn"
          data-tip={t('save')}
          aria-label={t('save')}
          disabled={off || !dirty}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onSave}
        >
          <IconSave size={16} />
        </button>
        <button
          type="button"
          className="qa-btn"
          data-tip={t('undo')}
          aria-label={t('undo')}
          disabled={off || !state?.canUndo}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor?.chain().focus().undo().run()}
        >
          <IconUndo size={16} />
        </button>
        <button
          type="button"
          className="qa-btn"
          data-tip={t('redo')}
          aria-label={t('redo')}
          disabled={off || !state?.canRedo}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor?.chain().focus().redo().run()}
        >
          <IconRedo size={16} />
        </button>
        <label className={`autosave-toggle${autoSave ? ' on' : ''}`} data-tip={t('autoSaveTip')}>
          <span className="autosave-knob" />
          <span className="autosave-text">{t('autoSave')}</span>
          <input
            type="checkbox"
            checked={autoSave}
            onChange={(e) => onToggleAutoSave(e.target.checked)}
          />
        </label>
        {aiPanelAvailable && (
          <AiPanelToggle open={aiPanelOpen} onToggle={onToggleAiPanel} label={t('aiOpenAssistant')} />
        )}
      </div>

      <div className="ribbon-body">
        <div className="ribbon-group">
          <div className="ribbon-group-items">
            <Dropdown
              className="rb-style"
              value={state?.style ?? 'paragraph'}
              disabled={off}
              options={(Object.keys(STYLE_LABEL) as BlockStyle[]).map((s) => ({
                value: s,
                label: t(STYLE_LABEL[s]),
              }))}
              onPick={(s) => editor && applyBlockStyle(editor, s)}
            />
          </div>
        </div>

        <div className="rb-sep" />

        <div className="ribbon-group">
          <div className="ribbon-group-items">
            <IconBtn
              title={t('bold')}
              active={state?.bold}
              disabled={off}
              onClick={() => editor?.chain().focus().toggleBold().run()}
            >
              <b>B</b>
            </IconBtn>
            <IconBtn
              title={t('italic')}
              active={state?.italic}
              disabled={off}
              onClick={() => editor?.chain().focus().toggleItalic().run()}
            >
              <i>I</i>
            </IconBtn>
            <IconBtn
              title={t('strike')}
              active={state?.strike}
              disabled={off}
              onClick={() => editor?.chain().focus().toggleStrike().run()}
            >
              <s>ab</s>
            </IconBtn>
            <IconBtn
              title={t('inlineCode')}
              active={state?.code}
              disabled={off}
              onClick={() => editor?.chain().focus().toggleCode().run()}
            >
              <IconInlineCode size={ICON} />
            </IconBtn>
            <span className="rb-link-anchor" ref={linkAnchorRef}>
              <IconBtn title={t('link')} active={state?.link} disabled={off} onClick={openLink}>
                <IconLink size={ICON} />
              </IconBtn>
              {linkOpen && (
                <span className="rb-link-pop" onMouseDown={(e) => e.stopPropagation()}>
                  <input
                    ref={linkInputRef}
                    value={linkUrl}
                    placeholder={t('linkPlaceholder')}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && linkUrl.trim()) applyLink()
                      if (e.key === 'Escape') setLinkOpen(false)
                    }}
                  />
                  <button type="button" disabled={!linkUrl.trim()} onClick={applyLink}>
                    {t('linkApply')}
                  </button>
                </span>
              )}
            </span>
          </div>
        </div>

        <div className="rb-sep" />

        <div className="ribbon-group">
          <div className="ribbon-group-items">
            <IconBtn
              title={t('bulletList')}
              active={state?.bullet}
              disabled={off}
              onClick={() => editor?.chain().focus().toggleBulletList().run()}
            >
              <IconBullets size={ICON} />
            </IconBtn>
            <IconBtn
              title={t('orderedList')}
              active={state?.ordered}
              disabled={off}
              onClick={() => editor?.chain().focus().toggleOrderedList().run()}
            >
              <IconNumbered size={ICON} />
            </IconBtn>
            <IconBtn
              title={t('taskList')}
              active={state?.task}
              disabled={off}
              onClick={() => editor?.chain().focus().toggleTaskList().run()}
            >
              <IconTaskList size={ICON} />
            </IconBtn>
          </div>
        </div>

        <div className="rb-sep" />

        <div className="ribbon-group">
          <div className="ribbon-group-items">
            <IconBtn
              title={t('insertTable')}
              disabled={off}
              onClick={() =>
                editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
              }
            >
              <IconTable size={ICON} />
            </IconBtn>
            <IconBtn
              title={t('insertImage')}
              disabled={off || !imageEnabled}
              onClick={onInsertImage}
            >
              <IconPicture size={ICON} />
            </IconBtn>
            <IconBtn
              title={t('insertHr')}
              disabled={off}
              onClick={() => editor?.chain().focus().setHorizontalRule().run()}
            >
              <IconHr size={ICON} />
            </IconBtn>
          </div>
        </div>

        <div className="rb-spacer" />

        <div className="ribbon-group">
          <div className="ribbon-group-items">
            <IconBtn
              title={t('fmProperties')}
              active={frontmatterOpen}
              disabled={disabled}
              onClick={onToggleFrontmatter}
            >
              <IconProperties size={ICON} />
            </IconBtn>
          </div>
        </div>
      </div>
    </div>
  )
}
