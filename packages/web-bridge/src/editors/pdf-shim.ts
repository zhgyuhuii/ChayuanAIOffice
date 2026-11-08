/**
 * PDF web shim — batch: view closed loop (open + read bytes), editing ops
 * (server-side pdfium composition) degrade until the pdfium service lands.
 */

import { createAiHttpBridge } from '../ai-bridge.js'
import { BridgeClient } from '../client.js'
import { b64ToBytes, makeShim, pendingFromHash } from '../shim-factory.js'

export function installPdfShim(client: BridgeClient): void {
  let consumed = false
  const readGranted = async (path: string): Promise<Uint8Array> => {
    const m = /^webfs:([^:]+):/.exec(path)
    if (!m) throw new Error(`web shim 只能读取通过宿主打开的文件：${path}`)
    return fileBytes(m[1]!)
  }

  /** the one bridge file held in memory: the chunked reader loops over it, so
   * every slice would otherwise re-fetch the whole file (R38 #2366 parity) */
  let cachedFile: { id: string; bytes: Uint8Array } | null = null
  const fileBytes = async (fileId: string): Promise<Uint8Array> => {
    if (cachedFile?.id === fileId) return cachedFile.bytes
    const doc = (await client.call('file', 'fs.read', fileId)) as { base64: string }
    const bytes = b64ToBytes(doc.base64)
    cachedFile = { id: fileId, bytes }
    return bytes
  }

  const impl = {
    ...createAiHttpBridge(),
    async consumePending(): Promise<string | null> {
      if (consumed) return null
      consumed = true
      const p = pendingFromHash()
      return p ? `webfs:${p.fileId}:${p.name}` : null
    },
    async readFile(path: string): Promise<ArrayBuffer> {
      const bytes = await readGranted(path)
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    },
    // desktop contract (pdf-main): [start, end) of the granted file plus the
    // whole file size — the renderer loop slices 8 MiB at a time and breaks on
    // an empty slice. Over the bridge the whole file is one fs.read, so the
    // chunked route is a cached slice of it.
    async readFileChunk(
      path: string,
      start: number,
      end: number,
    ): Promise<{ data: Uint8Array; fileSize: number }> {
      const bytes = await readGranted(path)
      const from = Number.isInteger(start) && start >= 0 ? start : 0
      const to = Number.isInteger(end) && end >= from ? end : bytes.length
      return {
        data: bytes.subarray(from, Math.min(to, bytes.length)),
        fileSize: bytes.length,
      }
    },
    async isUntitled(): Promise<boolean> {
      return false
    },
    async getLanguage(): Promise<string> {
      return (localStorage.getItem('chaoffice.lang') as string) ?? 'zh'
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
