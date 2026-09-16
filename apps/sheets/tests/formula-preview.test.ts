import { describe, expect, it } from 'vitest'

import { previewFormulaValue } from '../src/renderer/formula-preview'

function runtimeReturning(value: unknown, throws = false) {
  return {
    univer: {
      __getInjector: () => ({
        get: () => ({
          calculate: async () => {
            if (throws) throw new Error('engine refused')
            return { getValue: () => value }
          },
        }),
      }),
    },
  } as never
}

describe('previewFormulaValue', () => {
  it('renders numbers with float noise rounded away', async () => {
    expect(await previewFormulaValue(runtimeReturning(6), '=SUM(1:3)')).toBe('6')
    expect(await previewFormulaValue(runtimeReturning(0.1 + 0.2), '=SUM(0.1,0.2)')).toBe('0.3')
    expect(await previewFormulaValue(runtimeReturning(NaN), '=1/0')).toBe('NaN')
  })

  it('renders booleans and strings, nulls as no-result', async () => {
    expect(await previewFormulaValue(runtimeReturning(true), '=1>0')).toBe('TRUE')
    expect(await previewFormulaValue(runtimeReturning('ok'), '=A1')).toBe('ok')
    expect(await previewFormulaValue(runtimeReturning(null), '=BLANK()')).toBeNull()
    expect(await previewFormulaValue(runtimeReturning(''), '=A1')).toBeNull()
  })

  it('guards non-formulas and engine failures', async () => {
    expect(await previewFormulaValue(runtimeReturning(1), 'SUM(1)')).toBeNull()
    expect(await previewFormulaValue(null, '=SUM(1)')).toBeNull()
    expect(await previewFormulaValue(runtimeReturning(1, true), '=SUM(1)')).toBeNull()
  })
})
