/**
 * A blank-draft session (shell-created new workbook, converted import) keeps
 * its content in the hidden backing file + draft chain, not the journal —
 * the journal intentionally stays cold there. Save on such a session must
 * therefore route to Save As (the naming dialog, defaulting to the suggested
 * name) instead of dead-ending on "nothing to save": ⌘S / 保存 were no-ops
 * on every new workbook (R30 release-test observation ①).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { handleSave, type SaveContext } from '../src/renderer/save-actions'
import { createEditJournal } from '../src/renderer/edit-journal'

const saveWorkbookEdits = vi.fn()

beforeEach(() => {
  saveWorkbookEdits.mockReset().mockResolvedValue({ canceled: true })
  ;(globalThis as unknown as { window: unknown }).window = {
    desktopApi: { saveWorkbookEdits },
  }
})

function blankDraftCtx(): { ctx: SaveContext; messages: string[] } {
  const messages: string[] = []
  return {
    messages,
    ctx: {
      univerRef: { current: null },
      stashViewRestore: () => {},
      lazyWorkbookRef: {
        current: {
          editJournal: createEditJournal(),
          recalc: {
            timer: null,
            generation: 0,
            failed: false,
            formulaCells: new Map(),
            overlay: new Map(),
          },
          file: {
            sessionId: '22222222-2222-4222-8222-222222222222',
            needsSaveAs: true,
            blankDraft: true,
          },
        },
      } as never,
      setMessage: (m: string) => messages.push(m),
      openLazyWorkbook: () => {},
    },
  }
}

describe('handleSave on a blank-draft session', () => {
  it('Save with a cold journal routes to Save As (the naming dialog), not a dead end', async () => {
    const { ctx, messages } = blankDraftCtx()
    await handleSave(ctx, 'save')
    expect(saveWorkbookEdits).toHaveBeenCalledTimes(1)
    const payload = saveWorkbookEdits.mock.calls[0]![0] as Record<string, unknown>
    expect(payload.mode).toBe('save-as')
    // the old dead end told the user there was nothing to save
    expect(messages).not.toContain('没有可保存的编辑。')
  })

  it('Save As reaches the dialog directly, as before', async () => {
    const { ctx } = blankDraftCtx()
    await handleSave(ctx, 'save-as')
    const payload = saveWorkbookEdits.mock.calls[0]![0] as Record<string, unknown>
    expect(payload.mode).toBe('save-as')
  })

  it('a canceled dialog reports cancellation and stays out of the status bar', async () => {
    saveWorkbookEdits.mockResolvedValueOnce({ canceled: true })
    const { ctx, messages } = blankDraftCtx()
    const outcome = await handleSave(ctx, 'save')
    expect(outcome.ok).toBe(false)
    expect(messages).toContain('保存已取消。')
  })
})
