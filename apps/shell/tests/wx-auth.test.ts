/**
 * 微信扫码登录主进程模块测试（LOCAL wx-auth.ts）：qr-start 二维码转 data URL、
 * poll ok 落档 + 匿名资料标记、/me Bearer 校验（401 清档）、退出清档并通知服务端。
 * 全离线：electron 打桩 + fetch 桩路由。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}))

import { ipcMain } from 'electron'
import {
  isProfileIncomplete,
  reloadWxAuth,
  wxAuthPath,
  wxLoginPoll,
  wxLoginQrStart,
  wxLoginStatus,
  wxLogout,
  wxProfileQrDataUrl,
} from '../src/main/wx-auth'

const STATE = 'a'.repeat(36)
const TOKEN = 'header.payload.signature'
const PNG = Buffer.from('89504e470d0a1a0a000000', 'hex')

let authDir = ''

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>
let route: Handler = () => new Response('{}', { status: 404 })

async function fetchStub(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  return route(String(url), init)
}

beforeEach(() => {
  authDir = mkdtempSync(join(tmpdir(), 'wx-auth-test-'))
  process.env.CHAOFFICE_WX_AUTH_DIR = authDir
  process.env.CHAOFFICE_WX_BASE_URL = 'https://wx.test'
  reloadWxAuth()
  vi.stubGlobal('fetch', fetchStub)
  vi.mocked(ipcMain.handle).mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.CHAOFFICE_WX_AUTH_DIR
  delete process.env.CHAOFFICE_WX_BASE_URL
  rmSync(authDir, { recursive: true, force: true })
})

function okRoute(opts: { meStatus?: number } = {}): Handler {
  return (url, init) => {
    const u = new URL(url)
    if (u.pathname === '/api/auth/wx/qr-start') {
      return Response.json({
        mode: 'mpqrcode',
        state: u.searchParams.get('client') === 'desktop' ? STATE : 'z'.repeat(36),
        url: 'https://mp.weixin.qq.com/showqrcode?ticket=TK',
        expiresIn: 600,
      })
    }
    if (u.hostname === 'mp.weixin.qq.com') {
      return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } })
    }
    if (u.pathname === '/a.png') {
      return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } })
    }
    if (u.pathname === '/api/qr') {
      return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } })
    }
    if (u.pathname === '/api/auth/wx/poll') {
      if (u.searchParams.get('client') !== 'desktop') {
        return Response.json({ status: 'ok', user: { id: 1, nickname: 'x' } })
      }
      if (u.searchParams.get('state') === STATE) {
        return Response.json({
          status: 'ok',
          token: TOKEN,
          user: { id: 7, nickname: '微信用户10007', avatarUrl: 'https://wx.test/a.png', loginCount: 3 },
        })
      }
      return Response.json({ status: 'pending' })
    }
    if (u.pathname === '/api/auth/wx/me') {
      const auth = String(init?.headers && new Headers(init.headers).get('authorization'))
      if (auth !== `Bearer ${TOKEN}`) return Response.json({ user: null }, { status: 401 })
      const status = opts.meStatus ?? 200
      if (status !== 200) return new Response('{}', { status })
      return Response.json({
        user: { id: 7, nickname: '张三', avatarUrl: 'https://wx.test/a.png', loginCount: 4 },
      })
    }
    if (u.pathname === '/api/auth/wx/logout') {
      const auth = String(init?.headers && new Headers(init.headers).get('authorization'))
      return Response.json({ ok: auth === `Bearer ${TOKEN}` })
    }
    return new Response('{}', { status: 404 })
  }
}

describe('wxLoginQrStart', () => {
  it('mpqrcode 直链图片转 data URL，state 透传', async () => {
    route = okRoute()
    const qr = await wxLoginQrStart()
    expect(qr.mode).toBe('mpqrcode')
    expect(qr.state).toBe(STATE)
    expect(qr.qrDataUrl).toMatch(/^data:image\/png;base64,/)
    expect(qr.expiresInSec).toBe(600)
  })

  it('服务端报错时抛出 message', async () => {
    route = () => Response.json({ error: 'qr_login_not_configured', message: '扫码登录未配置' }, { status: 503 })
    await expect(wxLoginQrStart()).rejects.toThrow('扫码登录未配置')
  })
})

describe('wxLoginPoll', () => {
  it('非法 state 直接拒绝，不出网', async () => {
    let hits = 0
    route = () => {
      hits++
      return Response.json({ status: 'pending' })
    }
    const res = await wxLoginPoll('../etc/passwd')
    expect(res).toEqual({ status: 'error', error: 'invalid_state' })
    expect(hits).toBe(0)
  })

  it('ok 时落档：token+用户持久化，昵称匿名 → profileIncomplete', async () => {
    route = okRoute()
    const res = await wxLoginPoll(STATE)
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.session.loggedIn).toBe(true)
    expect(res.session.user?.nickname).toBe('微信用户10007')
    expect(res.session.profileIncomplete).toBe(true)
    expect(res.session.avatarDataUrl).toMatch(/^data:image\/png;base64,/)
    const stored = JSON.parse(readFileSync(wxAuthPath(), 'utf-8')) as { token: string; user: { id: number } }
    expect(stored.token).toBe(TOKEN)
    expect(stored.user.id).toBe(7)
  })

  it('expired 透传过期态', async () => {
    route = (url) => {
      const u = new URL(String(url))
      return Response.json({ status: u.searchParams.get('state') === STATE ? 'expired' : 'pending' })
    }
    await expect(wxLoginPoll(STATE)).resolves.toEqual({ status: 'expired' })
  })
})

describe('wxLoginStatus', () => {
  it('/me 200 刷新昵称与登录计数', async () => {
    route = okRoute()
    await wxLoginPoll(STATE)
    const s = await wxLoginStatus()
    expect(s.loggedIn).toBe(true)
    expect(s.user?.nickname).toBe('张三')
    expect(s.profileIncomplete).toBe(false)
  })

  it('/me 401 清档视为未登录', async () => {
    route = okRoute()
    await wxLoginPoll(STATE)
    route = () => Response.json({ user: null }, { status: 401 })
    reloadWxAuth()
    await expect(wxLoginStatus()).resolves.toEqual({ loggedIn: false })
    expect(existsSync(wxAuthPath())).toBe(false)
  })

  it('/me 网络失败时保住缓存会话（离线不掉登录）', async () => {
    route = okRoute()
    await wxLoginPoll(STATE)
    route = () => {
      throw new Error('network down')
    }
    reloadWxAuth()
    const s = await wxLoginStatus()
    expect(s.loggedIn).toBe(true)
    expect(s.user?.nickname).toBe('微信用户10007')
  })

  it('无本地会话 → 未登录且不出网', async () => {
    let hits = 0
    route = () => {
      hits++
      return Response.json({ user: null })
    }
    await expect(wxLoginStatus()).resolves.toEqual({ loggedIn: false })
    expect(hits).toBe(0)
  })
})

describe('wxLogout', () => {
  it('清档并携带 Bearer 通知服务端', async () => {
    route = okRoute()
    await wxLoginPoll(STATE)
    let sawAuth = ''
    route = (url, init) => {
      const u = new URL(String(url))
      if (u.pathname === '/api/auth/wx/logout') {
        sawAuth = String(init?.headers && new Headers(init.headers).get('authorization'))
        return Response.json({ ok: true })
      }
      return Response.json({ user: null })
    }
    await wxLogout()
    expect(sawAuth).toBe(`Bearer ${TOKEN}`)
    expect(existsSync(wxAuthPath())).toBe(false)
    await expect(wxLoginStatus()).resolves.toEqual({ loggedIn: false })
  })
})

describe('wxProfileQrDataUrl', () => {
  it('snsapi_userinfo 授权页经 /api/qr 渲染为 data URL', async () => {
    route = okRoute()
    let qrText = ''
    route = (url) => {
      const u = new URL(String(url))
      if (u.pathname === '/api/qr') {
        qrText = u.searchParams.get('text') ?? ''
        return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } })
      }
      return Response.json({}, { status: 404 })
    }
    const dataUrl = await wxProfileQrDataUrl()
    expect(dataUrl).toMatch(/^data:image\/png;base64,/)
    expect(qrText).toContain('/api/auth/wx/mp?scope=userinfo')
  })
})

describe('isProfileIncomplete', () => {
  it('匿名昵称或无头像视为待完善；真实资料视为完整', () => {
    expect(isProfileIncomplete({ id: 1, nickname: '微信用户10007', avatarUrl: '' })).toBe(true)
    expect(isProfileIncomplete({ id: 1, nickname: '张三', avatarUrl: '' })).toBe(true)
    expect(isProfileIncomplete({ id: 1, nickname: '微信用户10007', avatarUrl: 'https://a.png' })).toBe(true)
    expect(isProfileIncomplete({ id: 1, nickname: '张三', avatarUrl: 'https://a.png' })).toBe(false)
  })
})
