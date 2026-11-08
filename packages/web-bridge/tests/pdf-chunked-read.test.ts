// @vitest-environment jsdom
// pdf shim 的分片读取契约（R38 #2366）：渲染层 readFileBytes 以 8MiB 步进循环
// 调 readFileChunk(path, start, end)，靠 {data, fileSize} 判停——桥上整文件只有
// 一次 fs.read，切片在内存里完成。缺这个实现时整个方法走结构化 reject，
// 网页/dsh 形态 PDF 一律「文件打开失败」（1.0.16 真机回归的缺口）。
import { beforeEach, describe, expect, it } from 'vitest'

import { installPdfShim } from '../src/editors/pdf-shim'

type Call = { kind: string; channel: string; args: unknown[] }
const calls: Call[] = []
let routes: Record<string, () => unknown> = {}

beforeEach(() => {
  calls.length = 0
  routes = {}
  installPdfShim({
    call: (kind: string, channel: string, ...args: unknown[]) => {
      calls.push({ kind, channel, args })
      const route = routes[`${kind}.${channel}`]
      if (route) return route()
      return null
    },
  } as never)
})

const pdfApi = () =>
  (window as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>).pdfApi

const b64 = (bytes: Uint8Array): string => {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

describe('pdf web shim readFileChunk', () => {
  it('serves the 8MiB loop from one bridge read, desktop semantics', async () => {
    const file = new Uint8Array(21)
    for (let i = 0; i < file.length; i++) file[i] = i
    routes['file.fs.read'] = () => ({ base64: b64(file) })

    // the renderer loop: first slice against fileSize=Infinity → [0, 8MiB)
    const first = (await pdfApi().readFileChunk('webfs:f1:doc.pdf', 0, 8 * 1024 * 1024)) as {
      data: Uint8Array
      fileSize: number
    }
    expect(first.fileSize).toBe(21)
    expect([...first.data]).toEqual([...file])

    // second slice beyond EOF → empty data, loop breaks
    const second = (await pdfApi().readFileChunk('webfs:f1:doc.pdf', 21, 8 * 1024 * 1024 + 21)) as {
      data: Uint8Array
      fileSize: number
    }
    expect(second.data.length).toBe(0)
    expect(second.fileSize).toBe(21)

    // exactly one fs.read for the whole loop (cache hit on slice 2)
    expect(calls.filter((c) => c.channel === 'fs.read')).toHaveLength(1)

    // a mid-file slice carries the requested window
    const mid = (await pdfApi().readFileChunk('webfs:f1:doc.pdf', 5, 9)) as { data: Uint8Array }
    expect([...mid.data]).toEqual([5, 6, 7, 8])
  })

  it('refuses paths no host opened', async () => {
    await expect(pdfApi().readFileChunk('/etc/passwd', 0, 10)).rejects.toThrow(
      'web shim 只能读取通过宿主打开的文件',
    )
  })

  it('keeps readFile working on the same cache', async () => {
    routes['file.fs.read'] = () => ({ base64: b64(new Uint8Array([1, 2, 3])) })
    const buf = (await pdfApi().readFile('webfs:f1:doc.pdf')) as ArrayBuffer
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([1, 2, 3]))
    expect(calls.filter((c) => c.channel === 'fs.read')).toHaveLength(1)
  })
})
