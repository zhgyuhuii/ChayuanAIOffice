/**
 * Sheets / slides web shims: full API present via the Proxy shim (every call
 * degrades explicitly with batch info; on* subscribers no-op) until the
 * server-side engines land (xlsx Rust sidecar / pptx-engine, batches 3–4).
 * The editors boot and render their UI today instead of crashing.
 */

import { BridgeClient } from '../client.js'
import { b64ToBytes, makeShim, pendingFromHash } from '../shim-factory.js'

function baseState() {
  return {
    async getLanguage(): Promise<string> {
      return (localStorage.getItem('genoffice.lang') as string) ?? 'zh'
    },
    async getTheme(): Promise<'light' | 'dark' | 'system'> {
      return 'system'
    },
    setDirty: () => undefined,
  }
}

export function installSheetsShim(client: BridgeClient): void {
  let consumed = false

  const impl = {
    ...baseState(),

    /** Batch-3 view closed loop: open a host-picked xlsx through the Rust sidecar. */
    async selectWorkbook() {
      const p = pendingFromHash()
      if (!p) throw new Error('请从主页的“打开本地文件”选择表格文件')
      if (consumed) throw new Error('请通过主页打开其他文件')
      consumed = true
      const doc = (await client.call('file', 'fs.read', p.fileId)) as { base64: string }
      const res = (await client.call('rpc', 'xlsx.openWorkbookBytes', {
        base64: doc.base64,
        name: p.name,
        locale: localStorage.getItem('genoffice.lang') ?? 'zh',
      })) as { opened: Record<string, unknown> }
      return {
        ...res.opened,
        path: `webfs:${p.fileId}:${p.name}`,
        sha256: '',
        readOnly: false,
        needsSaveAs: false,
        restoredFromRecovery: false,
        automaticRecoveryDisabled: false,
      }
    },
    async consumeNewBlankWorkbook(): Promise<boolean> {
      return !pendingFromHash()
    },

    // session commands → sidecar passthrough
    async readWorkbookRange(request: Record<string, unknown>) {
      return client.call('rpc', 'xlsx.command', { command: 'read_range', ...request })
    },
    async readWorkbookFormulas(request: Record<string, unknown>) {
      return client.call('rpc', 'xlsx.command', { command: 'read_formula_cells', ...request })
    },
    async recalcWorkbook(request: Record<string, unknown>) {
      return client.call('rpc', 'xlsx.command', { command: 'recalc_cells', ...request })
    },
    async readWorkbookMedia(request: Record<string, unknown>) {
      return client.call('rpc', 'xlsx.command', { command: 'read_media', ...request })
    },
    async closeWorkbook(sessionId: string) {
      return client.call('rpc', 'xlsx.command', { command: 'close', sessionId })
    },
  }

  ;(window as unknown as Record<string, unknown>).desktopApi = makeShim(client, {
    impl: impl as unknown as Record<string, (...args: never[]) => unknown>,
    prefix: 'sheets',
  })
  void b64ToBytes
}

export function installSlidesShim(client: BridgeClient): void {
  ;(window as unknown as Record<string, unknown>).slidesApi = makeShim(client, {
    impl: baseState() as unknown as Record<string, (...args: never[]) => unknown>,
    prefix: 'slides',
  })
  ;(window as unknown as Record<string, unknown>).desktop = makeShim(client, { impl: {}, prefix: 'slides.desktop' })
}
