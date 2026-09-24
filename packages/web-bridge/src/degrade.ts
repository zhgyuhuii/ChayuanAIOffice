/**
 * Degrade registry (plan v2.2, decision #3): bridge channels not yet
 * implemented on the web forms fail EXPLICITLY — callers get a rejected
 * promise carrying batch info, so UI can grey the control and explain,
 * instead of silent breakage. One registry shared by every form (②③④);
 * Electron never consults it (real preload present).
 */

export interface DegradeInfo {
  /** human-facing reason (i18n at the call site) */
  reason: string
  /** batch that will enable it, e.g. "第 2 批" */
  batch?: string
}

/** channel → why it is not available yet */
const DEGRADED = new Map<string, DegradeInfo>()

/** Permanently impossible in a browser (physical replacements, decision v2.2) */
export const UNSUPPORTED_IN_BROWSER: ReadonlySet<string> = new Set([
  'chatOffice.revealPath',
  'chatOffice.openTrash',
])

export function degrade(channel: string, info: DegradeInfo): void {
  DEGRADED.set(channel, info)
}

export function degradeMany(entries: Record<string, DegradeInfo>): void {
  for (const [channel, info] of Object.entries(entries)) degrade(channel, info)
}

export function degradeInfo(channel: string): DegradeInfo | null {
  if (UNSUPPORTED_IN_BROWSER.has(channel)) {
    return { reason: '浏览器环境不支持该系统能力' }
  }
  return DEGRADED.get(channel) ?? null
}

/** Snapshot for tests / debugging. */
export function degradedChannels(): string[] {
  return [...DEGRADED.keys(), ...UNSUPPORTED_IN_BROWSER].sort()
}

/**
 * Batch-1 default registry (plan v2.2 decision #5): everything outside the
 * acceptance line ships degraded with its enabling batch.
 */
export function registerBatch1Degradations(): void {
  degradeMany({
    // sheets / slides / pdf: open-existing lands in batches 3 / 4
    'chatOffice.openPath:xlsx': { reason: '打开已有表格将在第 3 批可用', batch: '第 3 批' },
    'chatOffice.openPath:pptx': { reason: '打开已有演示将在第 4 批可用', batch: '第 4 批' },
    'chatOffice.openPath:pdf': { reason: '打开已有 PDF 将在第 4 批可用', batch: '第 4 批' },
    // account / cloud: awaiting the BFF channels
    'chatOffice.accountStatus': { reason: '账号能力将在云端通道接入后可用', batch: '后续' },
    'chatOffice.accountLogin': { reason: '账号能力将在云端通道接入后可用', batch: '后续' },
    'chatOffice.cloudProjectsSync': { reason: '云项目将在云端通道接入后可用', batch: '后续' },
  })
}
