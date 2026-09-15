import { existsSync, readFileSync, appendFileSync, truncateSync, writeFileSync } from 'node:fs'

/**
 * Local log for the MCP server: a bounded in-memory ring plus an append-only
 * file under userData, so both the settings UI (recent lines) and a saved file
 * the user can open/share are covered. Appending is synchronous on purpose —
 * log volume is tiny (lifecycle, sessions, tool calls) and a lost line on
 * crash is acceptable, while ordering guarantees are not.
 */

const MAX_BUFFER_LINES = 500
/** how many lines the settings pane fetches at once */
export const MCP_LOG_TAIL = 200

/** Device-local timestamp for log lines (YYYY-MM-DD HH:mm:ss.SSS): the log is
 *  read by the user in the settings pane / a shared file, so it shows wall-clock
 *  time, not UTC (toISOString's Z suffix read as a 8h-off time in zh locales). */
export function localTimestamp(date = new Date()): string {
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.` +
    `${pad(date.getMilliseconds(), 3)}`
  )
}

export class McpLogger {
  private readonly buffer: string[] = []

  constructor(readonly filePath: string) {
    // the log covers the current app launch only: reset the file at startup so
    // it never grows across runs (the settings pane reads it live anyway)
    try {
      writeFileSync(this.filePath, '', 'utf8')
    } catch {
      // best-effort; append() recreates what it can
    }
  }

  append(message: string): void {
    const line = `[${localTimestamp()}] ${message}`
    this.buffer.push(line)
    if (this.buffer.length > MAX_BUFFER_LINES) this.buffer.shift()
    try {
      appendFileSync(this.filePath, line + '\n', 'utf8')
    } catch {
      // a broken log target must never take the MCP server down
    }
  }

  /** most recent lines, file-backed (falls back to the ring when unreadable) */
  recent(limit = MCP_LOG_TAIL): string[] {
    try {
      if (existsSync(this.filePath)) {
        const raw = readTail(this.filePath, limit)
        if (raw.length > 0) return raw
      }
    } catch {
      // fall through to the ring buffer
    }
    return this.buffer.slice(-limit)
  }

  clear(): void {
    this.buffer.length = 0
    try {
      if (existsSync(this.filePath)) truncateSync(this.filePath, 0)
    } catch {
      // best-effort
    }
  }

  /** create the file when missing so "reveal in file manager" has a target */
  ensureFile(): void {
    try {
      if (!existsSync(this.filePath)) writeFileSync(this.filePath, '', 'utf8')
    } catch {
      // best-effort
    }
  }
}

/** last `limit` lines of a text file without loading it all */
function readTail(filePath: string, limit: number): string[] {
  const raw = readFileSync(filePath, 'utf8')
  const lines = raw.split('\n').filter((l) => l.length > 0)
  return lines.slice(-limit)
}
