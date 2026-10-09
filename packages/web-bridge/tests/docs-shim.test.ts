// @vitest-environment jsdom
// docs shim 的保存契约:渲染层(file-actions saveOnce)按 apps/docs shared/ipc.ts
// 期待 {ok, path?, error?} 信封。裸字符串返回会让 result.ok 恒 falsy——每次保存
// 走失败分支、路径永不落定,下一次保存再弹保存对话框(dsh 形态「不停弹出保存」
// 事故的回归门)。
import { beforeEach, describe, expect, it } from 'vitest'

import { installDocsShim } from '../src/editors/docs-shim'

type Call = { kind: string; channel: string; args: unknown[] }

const calls: Call[] = []
/** per-test routing table: channel → result (or throw) */
let routes: Record<string, () => unknown> = {}

beforeEach(() => {
  calls.length = 0
  routes = {}
  installDocsShim({
    call: (kind: string, channel: string, ...args: unknown[]) => {
      calls.push({ kind, channel, args })
      const route = routes[`${kind}.${channel}`]
      if (route) return route()
      return null
    },
  } as never)
})

const bytes = (s: string): ArrayBuffer => {
  const buf = new ArrayBuffer(s.length)
  new Uint8Array(buf).set([...s].map((c) => c.charCodeAt(0)))
  return buf
}

const desktop = () =>
  (window as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>).desktop

describe('docs web shim save contract', () => {
  it('saveDocxAs returns {ok:true, path} on a created file', async () => {
    routes['file.fs.saveAs'] = () => ({ id: 'f2', name: 'a.docx' })
    const result = (await desktop().saveDocxAs('a', bytes('hi'))) as {
      ok: boolean
      path?: string
    }
    expect(result.ok).toBe(true)
    expect(result.path).toBe('webfs:f2:a.docx')
  })

  it('saveDocxAs cancel is silent {ok:false} with no error field', async () => {
    routes['file.fs.saveAs'] = () => null
    const result = (await desktop().saveDocxAs('a', bytes('hi'))) as {
      ok: boolean
      error?: string
    }
    expect(result.ok).toBe(false)
    expect(result.error).toBeUndefined()
  })

  it('saveDocxAs surfaces a picker failure as {ok:false, error}', async () => {
    routes['file.fs.saveAs'] = () => {
      throw new Error('boom')
    }
    const result = (await desktop().saveDocxAs('a', bytes('hi'))) as {
      ok: boolean
      error?: string
    }
    expect(result.ok).toBe(false)
    expect(result.error).toContain('boom')
  })

  it('saveDocx returns {ok:true, path} in place and {ok:false, error} on failure', async () => {
    routes['file.fs.write'] = () => undefined
    const ok = (await desktop().saveDocx('webfs:f1:a.docx', bytes('hi'))) as {
      ok: boolean
      path?: string
    }
    expect(ok).toEqual({ ok: true, path: 'webfs:f1:a.docx' })

    routes['file.fs.write'] = () => {
      throw new Error('该文件以只读方式打开（浏览器限制）')
    }
    const fail = (await desktop().saveDocx('webfs:f1:a.docx', bytes('hi'))) as {
      ok: boolean
      error?: string
    }
    expect(fail.ok).toBe(false)
    expect(fail.error).toContain('只读')
  })

  it('saveDocxNew delegates to saveDocxAs and returns the same envelope', async () => {
    routes['file.fs.saveAs'] = () => ({ id: 'f3', name: 'new.docx' })
    const result = (await desktop().saveDocxNew('new', bytes('hi'))) as {
      ok: boolean
      path?: string
    }
    expect(result).toEqual({ ok: true, path: 'webfs:f3:new.docx' })
  })
})
