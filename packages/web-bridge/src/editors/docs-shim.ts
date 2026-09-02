/**
 * Docs (window.desktop) web shim — batch-2 closed loop (plan v2.2 decision #5):
 * open .docx → edit → save in place / save-as, byte-faithful pipeline intact
 * (the renderer's docx-engine does the parsing; we only move bytes).
 */

import { BridgeClient } from '../client.js'
import { createAiHttpBridge } from '../ai-bridge.js'
import { b64ToBytes, bytesToB64, makeShim, pendingFromHash, sha256Hex } from '../shim-factory.js'

interface OpenFileResult {
  path: string
  name: string
  data: ArrayBuffer
  hash: string
}

export function installDocsShim(client: BridgeClient): void {
  let consumedPending = false
  const enc = new TextEncoder()

  async function openByFileId(fileId: string, name: string): Promise<OpenFileResult | null> {
    const doc = (await client.call('file', 'fs.read', fileId)) as { base64: string }
    const bytes = b64ToBytes(doc.base64)
    return {
      path: `webfs:${fileId}:${name}`,
      name,
      data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      hash: await sha256Hex(bytes),
    }
  }

  const impl = {
    async consumePendingOpenDocx(): Promise<OpenFileResult | null> {
      if (consumedPending) return null
      consumedPending = true
      const p = pendingFromHash()
      if (!p) return null
      return openByFileId(p.fileId, p.name)
    },
    async consumeNewBlankDoc(): Promise<boolean> {
      return !pendingFromHash()
    },
    async consumeAiDocContent(): Promise<null> {
      return null
    },
    async openDocx(): Promise<null> {
      // picker lives on the host (browse card); inside the editor, degrade
      throw new Error('请从主页的“打开本地文件”选择文件')
    },
    async openDocxPath(path: string): Promise<OpenFileResult | null> {
      const m = /^webfs:([^:]+):(.*)$/.exec(path)
      if (!m) throw new Error(`web shim 只能打开通过宿主选择的文件：${path}`)
      return openByFileId(m[1], m[2])
    },
    async saveDocx(path: string, data: ArrayBuffer): Promise<string> {
      const m = /^webfs:([^:]+):(.*)$/.exec(path)
      if (!m) throw new Error('无法原位保存：文件不是从本地打开的')
      await client.call('file', 'fs.write', m[1], bytesToB64(new Uint8Array(data)))
      return path
    },
    async saveDocxAs(defaultName: string, data: ArrayBuffer): Promise<string | null> {
      const created = (await client.call(
        'file',
        'fs.saveAs',
        bytesToB64(new Uint8Array(data)),
        defaultName.endsWith('.docx') ? defaultName : `${defaultName}.docx`,
      )) as { id: string; name: string } | null
      if (!created) return null
      await client.call('local', 'recent.record', created.id, created.name, 'docs')
      await client.call('local', 'tab.setTitle', created.id, created.name)
      return `webfs:${created.id}:${created.name}`
    },
    async saveDocxNew(defaultName: string, data: ArrayBuffer): Promise<string | null> {
      return impl.saveDocxAs(defaultName, data)
    },

    async getLanguage(): Promise<string> {
      return (localStorage.getItem('chatoffice.lang') as string) ?? 'zh'
    },
    async getTheme(): Promise<'light' | 'dark' | 'system'> {
      return ((localStorage.getItem('chatoffice.theme') as 'light' | 'dark' | 'system') ?? 'system')
    },
    onLanguageChanged: (h: (l: string) => void) => {
      window.addEventListener('go-lang', () => h(localStorage.getItem('chatoffice.lang') ?? 'zh'))
      return () => undefined
    },
    onThemeChanged: (h: (t: string) => void) => {
      window.addEventListener('go-theme', () => h(localStorage.getItem('chatoffice.theme') ?? 'system'))
      return () => undefined
    },
    onChromePressed: () => () => undefined,
    async setDocPassword(): Promise<void> {
      return undefined
    },
    async docPasswordIntentRevision(): Promise<number> {
      return 0
    },
    async discardDocPasswordIntents(): Promise<void> {
      return undefined
    },
    async reportDirty(): Promise<void> {
      return undefined
    },
    void8: undefined,
  }
  void enc

  ;(window as unknown as Record<string, unknown>).desktop = makeShim(client, {
    impl: {
      ...impl,
      // AI runs over the BFF: SSE chunks forwarded into onAiStream, keys stay server-side
      ...createAiHttpBridge(),
    } as unknown as Record<string, (...args: never[]) => unknown>,
    prefix: 'docs',
  })
}
