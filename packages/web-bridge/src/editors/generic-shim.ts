/**
 * Sheets / slides web shims: full API present via the Proxy shim (every call
 * degrades explicitly with batch info; on* subscribers no-op) until the
 * server-side engines land (xlsx Rust sidecar / pptx-engine, batches 3–4).
 * The editors boot and render their UI today instead of crashing.
 */

import { BridgeClient } from '../client.js'
import { createAiHttpBridge } from '../ai-bridge.js'
import { b64ToBytes, makeShim, pendingFromHash } from '../shim-factory.js'

function baseState() {
  return {
    ...createAiHttpBridge(),
    async getLanguage(): Promise<string> {
      return (localStorage.getItem('chatoffice.lang') as string) ?? 'zh'
    },
    async getTheme(): Promise<'light' | 'dark' | 'system'> {
      return 'system'
    },
    setDirty: () => undefined,
  }
}

export function installSheetsShim(client: BridgeClient): void {
  let consumed = false
  /** sidecar sessionId → host file id (for in-place saves) */
  const fileIds = new Map<string, string>()
  const fileIdFor = (sid: string) => fileIds.get(sid) ?? null
  const setFileId = (sid: string, fid: string) => fileIds.set(sid, fid)

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
        locale: localStorage.getItem('chatoffice.lang') ?? 'zh',
      })) as { opened: Record<string, unknown> & { sessionId?: string } }
      if (typeof res.opened.sessionId === 'string') setFileId(res.opened.sessionId, p.fileId)
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

    /** Save closed loop: the shared pipeline composes bytes; write in place / pick a target. */
    async saveWorkbook(request: Record<string, unknown> & { sessionId: string; mode?: string }) {
      let fileId = fileIdFor(request.sessionId)
      const res = (await client.call('rpc', 'xlsx.saveWorkbookBytes', {
        sessionId: request.sessionId,
        request,
      })) as { base64: string; touchedEntries?: unknown }
      if (request.mode === 'save-as' || !fileId) {
        const created = (await client.call('file', 'fs.saveAs', res.base64, '工作簿.xlsx')) as {
          id: string
          name: string
        } | null
        if (!created) return { canceled: true as const }
        setFileId(request.sessionId, created.id)
        await client.call('local', 'recent.record', created.id, created.name, 'sheets')
        await client.call('local', 'tab.setTitle', created.id, created.name)
        fileId = created.id
      } else {
        await client.call('file', 'fs.write', fileId, res.base64)
      }
      // 保存后以新字节重开（与主进程“换新 session”语义等价），返回严格 schema 的 file
      const reopened = (await client.call('rpc', 'xlsx.openWorkbookBytes', {
        base64: res.base64,
        name: 'saved.xlsx',
        locale: localStorage.getItem('chatoffice.lang') ?? 'zh',
      })) as { opened: Record<string, unknown> & { sessionId?: string } }
      const newSid =
        typeof reopened.opened.sessionId === 'string'
          ? reopened.opened.sessionId
          : request.sessionId
      if (newSid !== request.sessionId) {
        const prev = fileIdFor(request.sessionId)
        if (prev) setFileId(newSid, prev)
        await client
          .call('rpc', 'xlsx.command', { command: 'close', sessionId: request.sessionId })
          .catch(() => undefined)
      }
      return {
        canceled: false as const,
        file: {
          ...reopened.opened,
          path: fileId ? `webfs:${fileId}:saved.xlsx` : '',
          sha256: '',
          readOnly: false,
          needsSaveAs: false,
          restoredFromRecovery: false,
          automaticRecoveryDisabled: false,
        },
        touchedEntries: (res.touchedEntries as string[]) ?? [],
      }
    },
  }

  ;(window as unknown as Record<string, unknown>).desktopApi = makeShim(client, {
    impl: impl as unknown as Record<string, (...args: never[]) => unknown>,
    prefix: 'sheets',
  })
  void b64ToBytes
}

export function installSlidesShim(client: BridgeClient): void {
  let consumed = false
  let session: { sessionId: string; name: string; fileId: string | null } | null = null

  const impl = {
    ...baseState(),

    /** Batch-4 view closed loop: open + render through the server pipeline. */
    async consumePendingOpen(fitWidthPx: number) {
      if (consumed) return null
      consumed = true
      const p = pendingFromHash()
      if (!p) return null
      const doc = (await client.call('file', 'fs.read', p.fileId)) as { base64: string }
      const res = (await client.call('rpc', 'pptx.openBytes', {
        base64: doc.base64,
        name: p.name,
        fitWidthPx,
      })) as { sessionId: string; slides: unknown[]; size: unknown; defaultFont?: string }
      session = { sessionId: res.sessionId, name: p.name, fileId: p.fileId }
      return {
        path: `webfs:${p.fileId}:${p.name}`,
        slides: res.slides,
        size: res.size,
        defaultFont: res.defaultFont,
      }
    },
    async openPptxPath(path: string, fitWidthPx: number) {
      const m = /^webfs:([^:]+):(.*)$/.exec(path)
      if (!m) throw new Error(`web shim 只能打开通过宿主选择的文件：${path}`)
      const doc = (await client.call('file', 'fs.read', m[1])) as { base64: string }
      const res = (await client.call('rpc', 'pptx.openBytes', {
        base64: doc.base64,
        name: m[2],
        fitWidthPx,
      })) as { sessionId: string; slides: unknown[]; size: unknown; defaultFont?: string }
      session = { sessionId: res.sessionId, name: m[2], fileId: m[1] }
      return { path, slides: res.slides, size: res.size, defaultFont: res.defaultFont }
    },
    // ── per-slide data: safe empty states (server animation/section engines land later) ──
    async getAnimations(): Promise<unknown[]> {
      return []
    },
    async getComments(): Promise<unknown[]> {
      return []
    },
    async getNotes(): Promise<string> {
      return ''
    },
    async getTransition(): Promise<null> {
      return null
    },
    /** Transitions-tab full echo — web has no transition writer yet (setTransition degrades) */
    async getTransitionSpec(): Promise<{ kind: string; durationMs: null }> {
      return { kind: 'none', durationMs: null }
    },
    /** Transitions tab 声音 playback — web has no transition writer (degrades to none) */
    async getTransitionSound(): Promise<null> {
      return null
    },
    /** Transitions tab 换片方式 echo — web has no advTm writer yet (setAdvanceTimes degrades) */
    async getAdvanceTime(): Promise<number | null> {
      return null
    },
    /** 放映设置 echo — web has no presProps writer (setShowSettings degrades) */
    async getShowSettings(): Promise<{ loop: boolean }> {
      return { loop: false }
    },
    async getSections(): Promise<unknown[]> {
      return []
    },
    async getRecentFiles(): Promise<unknown[]> {
      return []
    },
    async isDirty(): Promise<boolean> {
      return false
    },

    /** New blank deck through the server pipeline (Electron slides:new-blank). */
    async newBlank(fitWidthPx: number) {
      const res = (await client.call('rpc', 'pptx.newBlank', { fitWidthPx })) as {
        sessionId: string
        slides: unknown[]
        size: unknown
        defaultFont?: string
      }
      session = { sessionId: res.sessionId, name: '未命名.pptx', fileId: null }
      return { path: '', slides: res.slides, size: res.size, defaultFont: res.defaultFont }
    },
    /** Serialize the server-side model and write it back in place / via picker. */
    async save() {
      if (!session) return { ok: false, error: 'no file open' }
      const res = (await client.call('rpc', 'pptx.saveBytes', session.sessionId)) as {
        base64: string
      }
      if (session.fileId) {
        await client.call('file', 'fs.write', session.fileId, res.base64)
        return { ok: true, path: `webfs:${session.fileId}:${session.name}` }
      }
      const created = (await client.call('file', 'fs.saveAs', res.base64, session.name)) as {
        id: string
        name: string
      } | null
      if (!created) return { ok: false, error: 'canceled' }
      session = { ...session, fileId: created.id, name: created.name }
      await client.call('local', 'recent.record', created.id, created.name, 'slides')
      await client.call('local', 'tab.setTitle', created.id, created.name)
      return { ok: true, path: `webfs:${created.id}:${created.name}` }
    },
    async saveAs(defaultName: string) {
      if (!session) return { ok: false, error: 'no file open' }
      const res = (await client.call('rpc', 'pptx.saveBytes', session.sessionId)) as {
        base64: string
      }
      const created = (await client.call(
        'file',
        'fs.saveAs',
        res.base64,
        `${defaultName}.pptx`,
      )) as { id: string; name: string } | null
      if (!created) return { ok: false }
      session = { ...session, fileId: created.id, name: created.name }
      await client.call('local', 'recent.record', created.id, created.name, 'slides')
      await client.call('local', 'tab.setTitle', created.id, created.name)
      return { ok: true, path: `webfs:${created.id}:${created.name}` }
    },
  }

  ;(window as unknown as Record<string, unknown>).slidesApi = makeShim(client, {
    impl: impl as unknown as Record<string, (...args: never[]) => unknown>,
    prefix: 'slides',
  })
  ;(window as unknown as Record<string, unknown>).desktop = makeShim(client, {
    impl: {},
    prefix: 'slides.desktop',
  })
}
