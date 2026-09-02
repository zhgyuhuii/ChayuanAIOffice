/**
 * PDF web shim — batch: view closed loop (open + read bytes), editing ops
 * (server-side pdfium composition) degrade until the pdfium service lands.
 */

import { createAiHttpBridge } from '../ai-bridge.js'
import { BridgeClient } from '../client.js'
import { b64ToBytes, makeShim, pendingFromHash } from '../shim-factory.js'

export function installPdfShim(client: BridgeClient): void {
  let consumed = false

  const impl = {
    ...createAiHttpBridge(),
    async consumePending(): Promise<string | null> {
      if (consumed) return null
      consumed = true
      const p = pendingFromHash()
      return p ? `webfs:${p.fileId}:${p.name}` : null
    },
    async readFile(path: string): Promise<ArrayBuffer> {
      const m = /^webfs:([^:]+):/.exec(path)
      if (!m) throw new Error(`web shim 只能读取通过宿主打开的文件：${path}`)
      const doc = (await client.call('file', 'fs.read', m[1])) as { base64: string }
      const bytes = b64ToBytes(doc.base64)
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    },
    async isUntitled(): Promise<boolean> {
      return false
    },
    async getLanguage(): Promise<string> {
      return (localStorage.getItem('chatoffice.lang') as string) ?? 'zh'
    },
    async getTheme(): Promise<'light' | 'dark' | 'system'> {
      return 'system'
    },
    setDirty: () => undefined,
  }

  ;(window as unknown as Record<string, unknown>).pdfApi = makeShim(client, {
    impl: impl as unknown as Record<string, (...args: never[]) => unknown>,
    prefix: 'pdf',
  })
  ;(window as unknown as Record<string, unknown>).desktop = makeShim(client, { impl: {}, prefix: 'pdf.desktop' })
}
