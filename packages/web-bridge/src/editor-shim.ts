/**
 * Editor-side shim entry (plan v2.2): injected as <script src="/bridge-shim.js">
 * into each editor's index.html by build:web. If a REAL preload bridge exists
 * (Electron form) it does nothing; otherwise it installs the web shims over
 * the postMessage BridgeClient. Editor renderer code stays untouched.
 */

import { BridgeClient } from './client.js'
import { createAiHttpBridge } from './ai-bridge.js'
import { installKbFetchBridge } from './kb-bridge.js'
import { installDocsShim } from './editors/docs-shim.js'
import { installPdfShim } from './editors/pdf-shim.js'
import { installSheetsShim, installSlidesShim } from './editors/generic-shim.js'

const client = new BridgeClient()

// boot-error capture: the shim runs before the editor bundle, so host-side
// debugging can read window.__goErrs from the iframe after a failure
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__goErrs = []
  window.addEventListener('error', function (e) {
    ;(window as unknown as { __goErrs: string[] }).__goErrs.push(
      'E: ' + String(e.message) + ' @' + String(e.filename).slice(-40) + ':' + e.lineno,
    )
  })
  window.addEventListener('unhandledrejection', function (e) {
    const r = (e as PromiseRejectionEvent).reason
    ;(window as unknown as { __goErrs: string[] }).__goErrs.push(
      'R: ' + String((r && r.message) || r).slice(0, 200),
    )
  })
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

/** #gofile=<id>&name=<n> injected by the host when opening a file. */
function pendingFromHash(): { fileId: string; name: string } | null {
  const m = /[?#&]gofile=([^&]+)(?:&name=([^&]*))?/.exec(location.hash + location.search)
  if (!m) return null
  return { fileId: decodeURIComponent(m[1]), name: decodeURIComponent(m[2] ?? '文件') }
}

function degrade(channel: string): (...args: never[]) => Promise<never> {
  return () => client.call('local', channel) as Promise<never>
}

// ── markdownApi (batch-1 closed loop: open → edit → save in place) ──────────

function installMarkdownShim(): void {
  let currentFile: { id: string; name: string } | null = null
  let pendingConsumed = false

  const textEncoder = new TextEncoder()

  ;(window as unknown as Record<string, unknown>).markdownApi = {
    // AI runs over the BFF: SSE chunks forwarded into onAiStream, keys stay server-side
    ...createAiHttpBridge(),
    consumePending: async () => {
      if (pendingConsumed) return null
      pendingConsumed = true
      const p = pendingFromHash()
      if (!p) return null
      currentFile = { id: p.fileId, name: p.name }
      return `webfs:${p.fileId}:${p.name}`
    },
    readFile: async (path: string) => {
      const m = /^webfs:([^:]+):(.*)$/.exec(path)
      if (!m) throw new Error(`web shim 只能读取通过宿主打开的文件：${path}`)
      currentFile = { id: m[1], name: m[2] }
      const doc = (await client.call('file', 'fs.read', m[1])) as { text?: string }
      if (doc.text === undefined) throw new Error('文件内容不可读')
      return doc.text
    },
    save: async (request: { text: string; mode: 'save' | 'saveAs'; suggestedName?: string }) => {
      const bytes = textEncoder.encode(request.text)
      if (request.mode === 'save' && currentFile) {
        await client.call('file', 'fs.write', currentFile.id, bytesToB64(bytes))
        return { ok: true as const, path: `webfs:${currentFile.id}:${currentFile.name}` }
      }
      // save-as / untitled first save
      const created = (await client.call(
        'file',
        'fs.saveAs',
        bytesToB64(bytes),
        request.suggestedName ?? '未命名.md',
      )) as { id: string; name: string } | null
      if (!created) return { ok: true as const, canceled: true }
      currentFile = created
      await client.call('local', 'recent.record', created.id, created.name, 'markdown')
      await client.call('local', 'tab.setTitle', created.id, created.name)
      return { ok: true as const, path: `webfs:${created.id}:${created.name}` }
    },
    setDirty: () => undefined,
    onSaveRequest: () => () => undefined,
    sendSaveRequestAck: () => undefined,
    onCloseSaveRequest: () => () => undefined,
    sendCloseSaveResult: () => undefined,
    onFileRenamed: () => () => undefined,
    pickImage: degrade('markdown.pickImage') as unknown as () => Promise<null>,
    saveImage: degrade('markdown.saveImage') as unknown as () => Promise<null>,
    readImage: async () => null,
    onExportRequest: () => () => undefined,
    onPrintRequest: () => () => undefined,
    exportDocx: degrade('markdown.exportDocx') as unknown as () => Promise<never>,
    exportPdf: degrade('markdown.exportPdf') as unknown as () => Promise<never>,
    getLanguage: async () => 'zh',
    onLanguageChanged: () => () => undefined,
    getTheme: async () => 'system' as const,
    onThemeChanged: () => () => undefined,
    onChromePressed: () => () => undefined,
  }
}

// ── dispatch by editor path ──────────────────────────────────────────────────

function alreadyElectron(): boolean {
  const w = window as unknown as Record<string, unknown>
  return (
    w.markdownApi !== undefined ||
    w.desktop !== undefined ||
    w.pdfApi !== undefined ||
    w.desktopApi !== undefined ||
    w.slidesApi !== undefined
  )
}

export function installEditorShims(): void {
  installKbFetchBridge()
  if (alreadyElectron()) return
  const path = location.pathname
  if (/\/editors\/markdown\//.test(path)) installMarkdownShim()
  else if (/\/editors\/docs\//.test(path)) installDocsShim(client)
  else if (/\/editors\/pdf\//.test(path)) installPdfShim(client)
  else if (/\/editors\/sheets\//.test(path)) installSheetsShim(client)
  else if (/\/editors\/slides\//.test(path)) installSlidesShim(client)
}

if (typeof window !== 'undefined') installEditorShims()
