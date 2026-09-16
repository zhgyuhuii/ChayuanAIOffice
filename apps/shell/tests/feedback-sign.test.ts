/**
 * 主进程反馈模块测试：签名与 website/server/feedback-routes.js 算法一致、
 * submit/upload 请求形状（注入 fetch 桩）、probe 超时/失败语义。
 */
import { describe, expect, it } from 'vitest'
import { createHash, createHmac } from 'node:crypto'
import {
  FEEDBACK_APP,
  FEEDBACK_APP_NAME,
  createFeedbackClient,
  signFeedback,
} from '../src/main/feedback'

const SECRET = 'cy-fb-sign-2026-7Qx9Kp2Vw8Lm4Zr'

function serverSign({ mid, app, ts, content }: { mid: string; app: string; ts: number; content: string }) {
  const canonical = `${mid}\n${app}\n${ts}\n${createHash('sha256').update(String(content)).digest('hex')}`
  return createHmac('sha256', SECRET).update(canonical).digest('hex')
}

describe('signFeedback', () => {
  it('与服务端算法输出一致', () => {
    const sig = signFeedback(SECRET, { mid: '0123456789abcdef', app: FEEDBACK_APP, ts: 1730000000000, content: '表格打不开了' })
    expect(sig).toBe(serverSign({ mid: '0123456789abcdef', app: FEEDBACK_APP, ts: 1730000000000, content: '表格打不开了' }))
  })
})

describe('createFeedbackClient', () => {
  it('submit：POST aidooo.com/api/feedback，签名头可被服务端算法复算', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const client = createFeedbackClient({
      fetchImpl: async (url, init) => {
        calls.push({ url, init })
        return new Response(JSON.stringify({ ok: true, id: 'fb-1', status: 'new' }), { status: 200 })
      },
    })
    const res = await client.submit({
      mid: '0123456789abcdef',
      type: 'bug',
      content: '导出 PDF 失败',
      attachments: [{ name: 'a.png', url: '/feedback-uploads/up-1/a.png', kind: 'image', size: 3 }],
      logJson: '{"version":"0.10.0"}',
      appVersion: '0.10.0',
      os: 'linux',
      osVer: '',
      arch: 'arm64',
    })
    expect(res.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://aidooo.com/api/feedback')
    expect(calls[0].init.method).toBe('POST')
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers['content-type']).toBe('application/json')
    const body = JSON.parse(String(calls[0].init.body))
    expect(body.app).toBe(FEEDBACK_APP)
    expect(body.appName).toBe(FEEDBACK_APP_NAME)
    expect(body.type).toBe('bug')
    expect(body.content).toBe('导出 PDF 失败')
    expect(body.attachments).toHaveLength(1)
    expect(body.logJson).toBe('{"version":"0.10.0"}')
    const expectSig = serverSign({ mid: body.mid, app: body.app, ts: Number(headers['x-cy-ts']), content: body.content })
    expect(headers['x-cy-sig']).toBe(expectSig)
  })

  it('submit：网络异常→ok:false + offline:true（渲染层据此存草稿）', async () => {
    const client = createFeedbackClient({
      fetchImpl: async () => {
        throw new Error('network down')
      },
    })
    const res = await client.submit({ mid: '0123456789abcdef', type: 'bug', content: 'x', attachments: [], logJson: '' })
    expect(res.ok).toBe(false)
    expect(res.offline).toBe(true)
  })

  it('upload：二进制直传 + x-filename 头，路径分隔符被清洗', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const client = createFeedbackClient({
      fetchImpl: async (url, init) => {
        calls.push({ url, init })
        return new Response(JSON.stringify({ id: 'up-1', url: '/feedback-uploads/up-1/a.png', kind: 'image', size: 3 }), { status: 200 })
      },
    })
    const res = await client.upload('../ev/il.png', 'image/png', new Uint8Array([1, 2, 3]))
    expect(res.ok).toBe(true)
    expect(res.kind).toBe('image')
    expect(calls[0].url).toBe('https://aidooo.com/api/feedback/upload')
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers['x-filename']).toBe('.._ev_il.png')
    expect(headers['content-type']).toBe('image/png')
    expect(calls[0].init.body).toBeInstanceOf(Uint8Array)
    expect((calls[0].init.body as Uint8Array).byteLength).toBe(3)
  })

  it('upload：空数据/超限被拒绝，不发请求', async () => {
    let called = 0
    const client = createFeedbackClient({
      fetchImpl: async () => {
        called++
        return new Response('{}', { status: 200 })
      },
    })
    expect((await client.upload('a', 'text/plain', new Uint8Array(0))).ok).toBe(false)
    const huge = new Uint8Array(8 * 1024 * 1024 + 1)
    expect((await client.upload('a', 'text/plain', huge)).ok).toBe(false)
    expect(called).toBe(0)
  })

  it('probe：2xx→true，异常/非 2xx→false', async () => {
    const ok = createFeedbackClient({ fetchImpl: async () => new Response('{}', { status: 200 }) })
    const bad = createFeedbackClient({ fetchImpl: async () => new Response('{}', { status: 502 }) })
    const dead = createFeedbackClient({ fetchImpl: async () => { throw new Error('offline') } })
    expect(await ok.probe()).toBe(true)
    expect(await bad.probe()).toBe(false)
    expect(await dead.probe()).toBe(false)
  })
})
