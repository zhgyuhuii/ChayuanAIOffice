import { ICalculateFormulaService } from '@univerjs/engine-formula'

import type { UniverRuntime } from './univer-state'

/// A1-like reference anywhere in the formula (SUM(A1:A5), Sheet2!B2 …).
const REF_PATTERN = /[A-Za-z]{1,3}\d+/

/// One-shot evaluation for the Insert Function wizard's result line: run the
/// assembled formula through the engine's calculate() against the live
/// runtime data, without writing anything to the sheet. Null = no meaningful
/// value (parse error, engine refusal, blank).
export async function previewFormulaValue(
  runtime: UniverRuntime | null,
  formula: string,
): Promise<string | null> {
  if (!runtime || !formula.startsWith('=')) return null
  try {
    // Identifier token, not the class: vite dev can serve two module
    // instances of engine-formula (preset copy + optimized copy), and a class
    // token from the wrong copy no longer matches the injector's registration.
    const injector = runtime.univer.__getInjector()
    const service = injector.get(ICalculateFormulaService)
    if (REF_PATTERN.test(formula)) {
      // calculate() resolves range refs against the engine's runtime cell
      // snapshot, which is only populated by a real calculation pass. A
      // workbook with no formulas of its own (blank sheet, values-only
      // import) never triggers one, so refs would silently read as 0. One
      // throwaway executeFormulas() pass warms the snapshot; its dummy
      // formula is evaluated in memory and never touches the sheets.
      const workbook = runtime.univerAPI?.getActiveWorkbook()
      const worksheet = workbook?.getActiveSheet()
      if (workbook && worksheet) {
        await service.executeFormulas({
          [workbook.getId()]: { [worksheet.getSheetId()]: { 0: { 0: ['=1+1'] } } },
        })
      }
    }
    const variant = await service.calculate(formula)
    const value = (variant as { getValue?: () => unknown } | null | undefined)?.getValue?.()
    if (value === null || value === undefined) return null
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return String(value)
      // Float noise (0.30000000000000004) should not read as a wrong answer.
      return String(Math.round(value * 1e10) / 1e10)
    }
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
    const text = String(value)
    return text === '' ? null : text
  } catch {
    return null
  }
}
