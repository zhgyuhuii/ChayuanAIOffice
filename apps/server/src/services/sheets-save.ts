/**
 * Workbook save over the shared pipeline (batch 3 stage 2): the renderer's
 * SaveWorkbookRequest flows to /rpc/xlsx/saveWorkbookBytes, the SAME
 * orchestration the Electron main runs (apps/sheets save-pipeline) composes
 * the streaming sidecar save, and the composed bytes come back for an
 * in-place FS-Access write.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { saveWorkbookPlan } from '../../../sheets/src/main/save-pipeline'
import { workbookSaveRequestSchema } from '../../../sheets/src/shared/desktop-api'
import type { XlsxSidecarClient } from '../../../sheets/src/main/xlsx-sidecar-client'

type Command = (req: Record<string, unknown>) => Promise<unknown>

/** Duck-typed XlsxSidecarClient over the service's command passthrough. */
function clientAdapter(command: Command): XlsxSidecarClient {
  return {
    open: (async (input: Record<string, unknown>) => command({ command: 'open', ...input })) as never,
    readRange: (async (input: Record<string, unknown>) => command({ command: 'read_range', ...input })) as never,
    readFormulaCells: (async (input: Record<string, unknown>) =>
      command({ command: 'read_formula_cells', ...input })) as never,
    close: (async (sessionId: string) => command({ command: 'close', sessionId })) as never,
    readMedia: (async (input: Record<string, unknown>) => command({ command: 'read_media', ...input })) as never,
    convertWorkbook: (async (input: Record<string, unknown>) =>
      command({ command: 'convert_workbook', ...input })) as never,
    archiveManifest: (async (path: string) => command({ command: 'archive_manifest', path })) as never,
    readEntries: (async (input: Record<string, unknown>) => command({ command: 'read_entries', ...input })) as never,
    scanEntries: (async (input: Record<string, unknown>) => command({ command: 'scan_entries', ...input })) as never,
    saveArchive: (async (input: Record<string, unknown>) => command({ command: 'save_archive', ...input })) as never,
    recalcCells: (async (input: Record<string, unknown>) => command({ command: 'recalc_cells', ...input })) as never,
    start: () => undefined,
    getProcessId: () => null,
    stop: () => undefined,
  } as unknown as XlsxSidecarClient
}

export interface SaveWorkbookBytesInput {
  sessionId: string
  /** the renderer's WorkbookSaveRequest verbatim */
  request: Record<string, unknown>
}

export interface SaveWorkbookBytesResult {
  base64: string
  touchedEntries?: unknown
}

export function createSheetsSaveService(deps: { xlsx: { command: Command; sessionInfo(id: string): { snapshotPath: string; sheetNames: Record<string, string> } } }) {
  return {
    async saveWorkbookBytes(input: SaveWorkbookBytesInput): Promise<SaveWorkbookBytesResult> {
      // Same contract as the Electron handler: parse-then-plan, so field
      // errors surface as precise schema messages instead of deep TypeErrors.
      const request = workbookSaveRequestSchema.parse(input.request)
      const info = deps.xlsx.sessionInfo(input.sessionId)
      const targetDir = mkdtempSync(join(tmpdir(), 'chatoffice-save-'))
      const targetPath = join(targetDir, `saved-${randomUUID()}.xlsx`)
      try {
        const session = {
          path: info.snapshotPath,
          snapshotPath: info.snapshotPath,
          sha256: '',
          sheetNames: new Map(Object.entries(info.sheetNames)),
        }
        const mutation = (await saveWorkbookPlan(clientAdapter(deps.xlsx.command), session as never, request, targetPath)) as { touchedEntries?: unknown }
        const base64 = readFileSync(targetPath).toString('base64')
        return { base64, touchedEntries: mutation?.touchedEntries }
      } finally {
        rmSync(targetDir, { recursive: true, force: true })
      }
    },
  }
}
