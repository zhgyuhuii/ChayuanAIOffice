import { describe, expect, it } from 'vitest'

import { MAX_PENDING_AI_EDIT_CELLS } from '../src/renderer/app-constants'
import {
  createEditJournal,
  pendingEditCellCount,
  recordBulkConstantFill,
  recordSetRangeValues,
  recordSheetRemove,
} from '../src/renderer/edit-journal'
import { pendingEditBudgetError } from '../src/renderer/op-executor'

describe('pendingEditCellCount', () => {
  it('counts zero on an empty journal', () => {
    expect(pendingEditCellCount(createEditJournal())).toBe(0)
  })

  it('counts stored cell entries per surviving sheet', () => {
    const journal = createEditJournal()
    recordSetRangeValues(journal, 'sheet-1', { 1: { 2: { v: 'a' } } })
    recordSetRangeValues(journal, 'sheet-1', { 3: { 4: { v: 'b' }, 5: { v: 'c' } } })
    expect(pendingEditCellCount(journal)).toBe(3)
  })

  it('counts the full area of a bulk constant fill, not one per record', () => {
    const journal = createEditJournal()
    recordBulkConstantFill(journal, {
      sheetId: 'sheet-1',
      startRow: 0,
      endRow: 99,
      startColumn: 0,
      endColumn: 9,
      value: 'x',
    })
    // journalSize sees one fill record; the memory-facing count sees 1000 cells
    expect(pendingEditCellCount(journal)).toBe(1000)
  })

  it('ignores entries and fills on removed sheets', () => {
    const journal = createEditJournal()
    // Outside the fill's 10×10 box: a fill purges the journaled cells it
    // covers, so an inside cell would fold into the fill record.
    recordSetRangeValues(journal, 'sheet-1', { 20: { 20: { v: 'keep' } } })
    recordBulkConstantFill(journal, {
      sheetId: 'sheet-1',
      startRow: 0,
      endRow: 9,
      startColumn: 0,
      endColumn: 9,
      value: 'keep',
    })
    recordSheetRemove(journal, 'sheet-gone')
    recordSetRangeValues(journal, 'sheet-gone', { 1: { 1: { v: 'drop' } } })
    recordBulkConstantFill(journal, {
      sheetId: 'sheet-gone',
      startRow: 0,
      endRow: 999,
      startColumn: 0,
      endColumn: 9,
      value: 'drop',
    })
    expect(pendingEditCellCount(journal)).toBe(1 + 100)
  })
})

describe('pendingEditBudgetError', () => {
  it('passes everything under the cap', () => {
    expect(pendingEditBudgetError(0, 0)).toBeNull()
    expect(pendingEditBudgetError(MAX_PENDING_AI_EDIT_CELLS, 0)).toBeNull()
    expect(pendingEditBudgetError(0, MAX_PENDING_AI_EDIT_CELLS)).toBeNull()
  })

  it('refuses the batch that would cross the cap and names the budget', () => {
    const error = pendingEditBudgetError(MAX_PENDING_AI_EDIT_CELLS, 1)
    expect(error).toContain(String(MAX_PENDING_AI_EDIT_CELLS))
  })
})
