/**
 * xlsx sidecar service (plan v2.2 batch 3): hosts the Rust xlsx engine as a
 * service so the web forms get real .xlsx open/read — the same binary the
 * Electron main spawns (apps/sheets/native/xlsx-engine). Protocol: JSON
 * lines over stdio, {version:1, requestId, ...command} → {ok, result}.
 *
 * openWorkbookBytes bridges the browser world (FS Access bytes) to the
 * sidecar's path-based open: bytes land in a temp snapshot, the sidecar
 * opens the snapshot, and every later command for that session flows
 * through `command` passthrough.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ServiceContext } from '../runtime.js'
import { defineService } from '../runtime.js'

const PROTOCOL_VERSION = 1
const REQUEST_TIMEOUT_MS = 30_000
const ARCHIVE_TIMEOUT_MS = 120_000

export interface XlsxSidecarApi {
  /** Writes bytes to a temp snapshot and opens it; returns the sidecar open result + session bookkeeping. */
  openWorkbookBytes(input: { base64: string; name: string; locale?: string }): Promise<{
    sessionId: string
    snapshotDigest: string
    /** the sidecar `open` result (snapshot model, sheets, …) verbatim */
    opened: unknown
  }>
  /** Raw command passthrough (read_range, read_formula_cells, recalc_cells, read_media, close, …). */
  command(request: Record<string, unknown>): Promise<unknown>
  /** Session bookkeeping for the shared save pipeline (snapshot path + sheet names). */
  sessionInfo(sessionId: string): { snapshotPath: string; sheetNames: Record<string, string> }
  status(): { running: boolean; pid: number | null; openSessions: number }
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timeout: NodeJS.Timeout
}

export function xlsxSidecarService(deps: { binaryPath?: string } = {}) {
  return defineService<XlsxSidecarApi>({
    name: 'xlsx',
    create(_context: ServiceContext): XlsxSidecarApi {
      const binaryPath =
        deps.binaryPath ??
        process.env.GENOFFICE_XLSX_SIDECAR ??
        defaultBinaryPath()

      // Windows cannot exec a .cjs directly; allow "<node>|<script>" pairs
      // (tests use this; production passes the real binary path).
      const [exe, script] = binaryPath.includes('|') ? binaryPath.split('|') : [binaryPath, undefined]

      let child: ChildProcessWithoutNullStreams | null = null
      let lines: ReturnType<typeof createInterface> | null = null
      let stderr = ''
      const pending = new Map<string, Pending>()
      const sessions = new Map<string, { snapshotPath: string; sheetNames: Record<string, string> }>()

      function ensureStarted(): ChildProcessWithoutNullStreams {
        if (child && !child.killed) return child
        const proc = spawn(exe, script ? [script] : [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
        child = proc
        lines = createInterface({ input: proc.stdout })
        lines.on('line', (line) => handleLine(line))
        proc.stderr.setEncoding('utf8')
        proc.stderr.on('data', (c: string) => (stderr = `${stderr}${c}`.slice(-4000)))
        proc.once('error', (e) => {
          child = null
          rejectPending(e)
        })
        proc.once('exit', (code, signal) => {
          child = null
          lines?.close()
          lines = null
          rejectPending(new Error(stderr.trim() || `xlsx sidecar exited (${code}/${signal})`))
        })
        return proc
      }

      function handleLine(line: string): void {
        let res: { requestId: string; ok: boolean; result?: unknown; error?: { message: string } }
        try {
          res = JSON.parse(line)
        } catch {
          return
        }
        const entry = pending.get(res.requestId)
        if (!entry) return
        pending.delete(res.requestId)
        clearTimeout(entry.timeout)
        if (res.ok) entry.resolve(res.result)
        else entry.reject(new Error(res.error?.message ?? 'xlsx sidecar error'))
      }

      function rejectPending(err: Error): void {
        for (const [, p] of [...pending]) {
          clearTimeout(p.timeout)
          p.reject(err)
        }
        pending.clear()
      }

      function request(cmd: Record<string, unknown>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
        const proc = ensureStarted()
        const requestId = randomUUID()
        const payload = JSON.stringify({ version: PROTOCOL_VERSION, requestId, ...cmd })
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            pending.delete(requestId)
            reject(new Error('xlsx sidecar request timed out'))
          }, timeoutMs)
          pending.set(requestId, { resolve, reject, timeout })
          proc.stdin.write(`${payload}\n`, (err) => {
            if (err) {
              const p = pending.get(requestId)
              if (p) {
                clearTimeout(p.timeout)
                pending.delete(requestId)
                p.reject(err)
              }
            }
          })
        })
      }

      return {
        async openWorkbookBytes(input) {
          const bytes = Buffer.from(input.base64, 'base64')
          if (bytes.byteLength === 0) throw new Error('empty workbook bytes')
          const dir = mkdtempSync(join(tmpdir(), 'genoffice-xlsx-'))
          const snapshotPath = join(dir, input.name.replace(/[\\/:*?"<>|]/g, '_') || 'workbook.xlsx')
          writeFileSync(snapshotPath, bytes)
          const digest = createHash('sha256').update(bytes).digest('hex')
          const opened = (await request({
            command: 'open',
            path: snapshotPath,
            locale: input.locale ?? 'zh',
          })) as { sessionId: string; sheets?: Array<{ id: string; name: string }> }
          const sheets = (opened.sheets ?? []) as Array<{ id: string; name: string }>
          const sheetNames: Record<string, string> = {}
          for (const sh of sheets) sheetNames[sh.id] = sh.name
          sessions.set(opened.sessionId, { snapshotPath, sheetNames })
          return { sessionId: opened.sessionId, snapshotDigest: digest, opened }
        },
        command(req) {
          if (req.command === 'close' && typeof req.sessionId === 'string') {
            const s = sessions.get(req.sessionId)
            if (s) {
              sessions.delete(req.sessionId)
              rmSync(join(s.snapshotPath, '..'), { recursive: true, force: true })
            }
          }
          const timeout =
            req.command === 'convert_workbook' || req.command === 'save_archive'
              ? ARCHIVE_TIMEOUT_MS
              : REQUEST_TIMEOUT_MS
          return request(req, timeout)
        },
        sessionInfo(sessionId) {
          const s = sessions.get(sessionId)
          if (!s) throw new Error(`unknown xlsx session: ${sessionId}`)
          return { snapshotPath: s.snapshotPath, sheetNames: s.sheetNames }
        },
        status() {
          return { running: !!child && !child.killed, pid: child?.pid ?? null, openSessions: sessions.size }
        },
      }
    },
  })
}

function defaultBinaryPath(): string {
  const plat = process.platform === 'win32' ? 'xlsx-sidecar.exe' : 'xlsx-sidecar'
  const candidates = [
    join(process.cwd(), 'native', 'xlsx-sidecar', plat),
    join(process.cwd(), 'apps', 'sheets', 'native', 'xlsx-engine', 'target', 'release', plat),
  ]
  return candidates[0] // existence checked lazily at spawn
}
