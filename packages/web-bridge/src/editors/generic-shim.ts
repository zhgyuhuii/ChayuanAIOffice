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
      return (localStorage.getItem('chaoffice.lang') as string) ?? 'zh'
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
        locale: localStorage.getItem('chaoffice.lang') ?? 'zh',
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
    // R37 headless-export 握手位（缺席即结构化 reject；仅 headless 导出用）
    async consumeHeadlessExport(): Promise<null> {
      return null
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
        locale: localStorage.getItem('chaoffice.lang') ?? 'zh',
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
  let session: {
    sessionId: string
    name: string
    fileId: string | null
    /** deck size in EMU (px→EMU conversions need it, mirrors the Electron session) */
    size?: { cx: number; cy: number }
  } | null = null

  const EMU_PER_PX_96 = 9525

  /** px (fitWidthPx space) → EMU, same conversion the Electron main runs */
  const toEmu = (px: number, fitWidthPx: number): number => {
    const size = session?.size
    if (!size) return Math.round(px * EMU_PER_PX_96)
    const baseWidthPx = size.cx / EMU_PER_PX_96
    const scale = fitWidthPx / baseWidthPx
    return Math.round((px / scale) * EMU_PER_PX_96)
  }

  /** One editor verb through the server pipeline: run the pptx-ops transaction
   *  against the session model and answer the renderer's {slide, sourceId}
   *  (the web twin of the Electron slides-main edit handlers). */
  const editThroughCommand = async (
    ops: unknown[],
    fitWidthPx: number,
    slideIndex: number,
  ): Promise<{ slide: unknown; sourceId: string } | null> => {
    if (!session) return null
    const res = (await client.call('rpc', 'pptx.command', {
      sessionId: session.sessionId,
      ops,
      fitWidthPx,
    })) as {
      ok: boolean
      failures?: { error: string }[]
      slide: unknown
      slideIndex: number
      sourceIds: (string | number)[]
    }
    if (!res.ok) {
      console.warn('[slides shim] op rejected:', res.failures?.[0]?.error ?? 'unknown')
      return null
    }
    if (!res.slide) return null
    return { slide: res.slide, sourceId: String(res.sourceIds[0] ?? '') }
  }

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
      session = { sessionId: res.sessionId, name: p.name, fileId: p.fileId, size: res.size as { cx: number; cy: number } }
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
      session = { sessionId: res.sessionId, name: m[2], fileId: m[1], size: res.size as { cx: number; cy: number } }
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
      session = { sessionId: res.sessionId, name: '未命名.pptx', fileId: null, size: res.size as { cx: number; cy: number } }
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
    // ── editor verbs through pptx.command (web twin of the Electron handlers) ──
    async addTable(op: {
      slideIndex: number
      rows: number
      cols: number
      xPx: number
      yPx: number
      wPx: number
      hPx: number
      rowHeightEmu?: number
      fitWidthPx: number
    }) {
      if (!session?.size) return null
      const rowH = op.rowHeightEmu && op.rowHeightEmu > 0 ? Math.round(op.rowHeightEmu) : null
      const r = await editThroughCommand(
        [
          {
            op: 'addTable',
            target: { slide: op.slideIndex },
            rows: op.rows,
            cols: op.cols,
            offset: {
              x: toEmu(op.xPx, op.fitWidthPx),
              y: toEmu(op.yPx, op.fitWidthPx),
              cx: toEmu(op.wPx, op.fitWidthPx),
              cy: rowH ? rowH * op.rows : toEmu(op.hPx, op.fitWidthPx),
            },
            ...(rowH ? { rowHeightsEmu: Array.from({ length: op.rows }, () => rowH) } : {}),
          },
        ],
        op.fitWidthPx,
        op.slideIndex,
      )
      return r
    },
    async addImageBytes(op: {
      slideIndex: number
      base64: string
      ext: string
      fitWidthPx: number
      name?: string
      xPx?: number
      yPx?: number
      wPx?: number
      hPx?: number
    }) {
      if (!session?.size) return null
      if (op.xPx === undefined) {
        throw new Error('该能力尚未在网页版开放（slides.addImageBytes natural-frame form）')
      }
      const bytes = Uint8Array.from(atob(op.base64), (c) => c.charCodeAt(0))
      const r = await editThroughCommand(
        [
          {
            op: 'addPicture',
            target: { slide: op.slideIndex },
            bytes,
            ext: op.ext,
            offset: {
              x: toEmu(op.xPx, op.fitWidthPx),
              y: toEmu(op.yPx!, op.fitWidthPx),
              cx: Math.max(1, toEmu(op.wPx ?? 320, op.fitWidthPx)),
              cy: Math.max(1, toEmu(op.hPx ?? 200, op.fitWidthPx)),
            },
            ...(op.name ? { name: op.name } : {}),
          },
        ],
        op.fitWidthPx,
        op.slideIndex,
      )
      return r
    },
    /** Local picture: the web file picker (fs.pick) replaces the native dialog,
     *  the bytes ride the same addImageBytes path. */
    async insertImage(slideIndex: number, fitWidthPx: number) {
      if (!session?.size) return null
      const picked = (await client.call('file', 'fs.pick')) as { id: string; name: string } | null
      if (!picked) return null
      const doc = (await client.call('file', 'fs.read', picked.id)) as { base64: string }
      const ext = (picked.name.split('.').pop() ?? 'png').toLowerCase()
      const b64 = doc.base64.includes(',') ? doc.base64.split(',')[1]! : doc.base64
      // centre at 60% of the slide width, aspect from the decoded bitmap
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      let ratio = 0.66
      try {
        const bmp = await createImageBitmap(new Blob([bytes as BlobPart]))
        ratio = bmp.height / bmp.width
        bmp.close()
      } catch {
        /* keep the default ratio */
      }
      const size = session.size
      const wPx = (size.cx / EMU_PER_PX_96) * 0.6 * (size.cx / EMU_PER_PX_96 > 0 ? 1 : 1)
      const hPx = wPx * ratio
      const xPx = (size.cx / EMU_PER_PX_96 - wPx) / 2
      const yPx = (size.cy / EMU_PER_PX_96 - hPx) / 2
      const r = await editThroughCommand(
        [
          {
            op: 'addPicture',
            target: { slide: slideIndex },
            bytes,
            ext: ext === 'jpg' ? 'jpeg' : ext,
            offset: {
              x: toEmu(xPx, fitWidthPx),
              y: toEmu(yPx, fitWidthPx),
              cx: Math.max(1, toEmu(wPx, fitWidthPx)),
              cy: Math.max(1, toEmu(hPx, fitWidthPx)),
            },
            ...(picked.name ? { name: picked.name } : {}),
          },
        ],
        fitWidthPx,
        slideIndex,
      )
      if (!r) return { error: 'unsupported' as const, ext }
      return r
    },
    /** Remote picture: fetch through the page (same-origin proxy lands with the
     *  sidecar file surface), then the standard addPicture path. */
    async remoteImage(url: string) {
      try {
        const res = await fetch(url, { mode: 'cors' })
        if (!res.ok) return null
        const blob = await res.blob()
        const buf = new Uint8Array(await blob.arrayBuffer())
        let bin = ''
        for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]!)
        return { mime: blob.type || 'image/png', base64: btoa(bin) }
      } catch {
        return null
      }
    },
    /** Clipboard probe: web has no system-clipboard read channel; the app
     *  degrades to "no external content" instead of a startup rejection. */
    async clipboardProbe(): Promise<boolean> {
      return false
    },
    // R37 headless-export 握手位（缺席即结构化 reject；仅 headless 导出用）
    async consumeHeadlessExport(): Promise<null> {
      return null
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
