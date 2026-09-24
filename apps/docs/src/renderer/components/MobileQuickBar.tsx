/**
 * MobileQuickBar: the thumb-reachable bottom formatting bar for the mobile UI
 * mode (P1). Every action dispatches through the command registry — the same
 * commands the desktop ribbon uses (no second action path). The bar floats
 * above the virtual keyboard via useKeyboardInset (a zero no-op on desktop);
 * hit targets stay ≥44px for touch.
 */
import { useKeyboardInset } from '@chatoffice/mobile-touch'
import type { CommandContext, CommandRegistry } from '@chatoffice/ribbon'
import type { ReactNode } from 'react'
import { IconRedo, IconSave, IconUndo } from './icons'
import { useI18n } from '../i18n/locale'
import type { DocsCommandState } from '../ribbon/command-state'
import type { DocsCommandServices } from '../ribbon/host-services'

interface QuickButton {
  readonly id: string
  readonly command: string
  readonly label: string
  readonly content: ReactNode
  readonly glyph?: 'b' | 'i' | 'u' | 's'
}

export function MobileQuickBar({
  ctx,
  registry,
}: {
  ctx: CommandContext<DocsCommandState, DocsCommandServices>
  registry: CommandRegistry<DocsCommandState, DocsCommandServices>
}) {
  const { t } = useI18n()
  const { insetBottom } = useKeyboardInset()

  const buttons: QuickButton[] = [
    {
      id: 'save',
      command: 'docs.file.save',
      label: t('ribbonSave'),
      content: <IconSave size={18} />,
    },
    {
      id: 'undo',
      command: 'docs.edit.undo',
      label: t('appUndo'),
      content: <IconUndo size={18} />,
    },
    {
      id: 'redo',
      command: 'docs.edit.redo',
      label: t('appRedo'),
      content: <IconRedo size={18} />,
    },
    {
      id: 'bold',
      command: 'docs.format.toggleBold',
      label: t('ribbonBoldTip'),
      content: <span className="mqb-glyph mqb-glyph-b">B</span>,
      glyph: 'b',
    },
    {
      id: 'italic',
      command: 'docs.format.toggleItalic',
      label: t('ribbonItalicTip'),
      content: <span className="mqb-glyph mqb-glyph-i">I</span>,
      glyph: 'i',
    },
    {
      id: 'underline',
      command: 'docs.format.toggleUnderline',
      label: t('ribbonUnderlineTip'),
      content: <span className="mqb-glyph mqb-glyph-u">U</span>,
      glyph: 'u',
    },
    {
      id: 'strike',
      command: 'docs.format.toggleStrike',
      label: t('ribbonStrikethrough'),
      content: <span className="mqb-glyph mqb-glyph-s">S</span>,
      glyph: 's',
    },
    {
      id: 'grow',
      command: 'docs.format.fontSize.stepGrow',
      label: t('ribbonGrowFont'),
      content: <span className="mqb-glyph">A+</span>,
    },
    {
      id: 'shrink',
      command: 'docs.format.fontSize.stepShrink',
      label: t('ribbonShrinkFont'),
      content: <span className="mqb-glyph">A−</span>,
    },
  ]

  return (
    <div className="mqb" role="toolbar" style={{ marginBottom: insetBottom }}>
      {buttons.map((button) => {
        const enabled = registry.isEnabled(button.command, ctx)
        const active = registry.isActive(button.command, ctx)
        return (
          <button
            key={button.id}
            className={`mqb-btn ${button.glyph ? `mqb-${button.glyph}` : ''} ${active ? 'active' : ''}`}
            aria-label={button.label}
            title={button.label}
            aria-pressed={active}
            disabled={!enabled}
            onClick={() => registry.execute(button.command, ctx)}
          >
            {button.content}
          </button>
        )
      })}
    </div>
  )
}
