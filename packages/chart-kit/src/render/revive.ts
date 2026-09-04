/**
 * 主线程 option 复活(函数安全串 → 含活函数的 option):
 * 直接 new Function 会被宿主页 CSP(script-src 'self')拦(Worker 修复后
 * 剩下的最后一处主线程 eval),此时退到同源 eval-frame 里复活——帧文档
 * 无 CSP,编译发生在帧内,父页拿到的只是对象/函数引用(同源直读合法)。
 * 帧也不可用时(jsdom/测试)最终兜底 JSON.parse:丢函数保渲染。
 *
 * 关键:官方示例函数常引用 `echarts` 全局,而函数作用域链指向创建它的
 * realm(eval 帧)——所以帧在 revive 前必须先装载 echarts 挂到自己的
 * window(boot 消息传模块 URL,`echarts?url` 由父页解析)。
 */

import { parseOption } from '../sandbox/serialize'
import evalFrameUrl from './eval-frame.html?url'
import echartsUrl from 'echarts?url'

type ReviveFrame = Window & {
  __ckrevive?: (json: string) => unknown
  __ckping?: boolean
}

let frameWindowP: Promise<ReviveFrame | null> | null = null

function getFrameWindow(): Promise<ReviveFrame | null> {
  // null(帧不可用)不永久缓存:页面早期调用(如 body 未就绪)失败后,
  // 后续调用仍应重试建帧
  if (frameWindowP) return frameWindowP
  frameWindowP = new Promise<ReviveFrame | null>((resolve) => {
    try {
      if (typeof document === 'undefined' || !document.body) {
        resolve(null)
        return
      }
      if (/jsdom/i.test(navigator.userAgent)) {
        resolve(null) // 测试环境:帧无法加载,直接走兜底
        return
      }
      const iframe = document.createElement('iframe')
      iframe.src = evalFrameUrl
      iframe.style.cssText = 'position:fixed;left:-99999px;top:0;width:12px;height:12px;border:0'
      iframe.setAttribute('aria-hidden', 'true')
      let settled = false
      const win = () => (iframe.contentWindow ?? null) as ReviveFrame | null
      const finish = (w: ReviveFrame | null) => {
        if (settled) return
        settled = true
        resolve(w && w.__ckping ? w : null)
      }
      iframe.addEventListener('load', () => {
        // 通知帧装载 echarts(函数作用域链需要它);booted 消息回来才算就绪。
        // 消息监听必须挂在帧自己的 window 上(父 window 监听会被多个帧/
        // 多次调用串扰,曾致 finish(null) 抢先 settle)
        const w = win()
        if (!w) {
          finish(null)
          return
        }
        const onMsg = (ev: MessageEvent) => {
          const m = ev.data as {
            __ckeval?: boolean
            type?: string
            ok?: boolean
            error?: string
          } | null
          if (!m || m.__ckeval !== true || m.type !== 'booted') return
          finish(m.ok ? win() : null)
        }
        w.addEventListener('message', onMsg)
        w.postMessage({ __ckeval: true, type: 'boot', echartsUrl }, '*')
        setTimeout(() => finish(win()), 8000)
      })
      iframe.addEventListener('error', () => finish(null))
      document.body.append(iframe)
    } catch {
      resolve(null)
    }
  })
  frameWindowP.then((w) => {
    if (!w) frameWindowP = null
  })
  return frameWindowP
}

/**
 * 复活 option:优先帧外直解(页面允许 eval 时零开销),CSP 拦截时帧内
 * 复活,最终兜底纯 JSON(丢函数)。(页面允许 eval 时零开销),CSP 拦截时帧内
 * 复活,最终兜底纯 JSON(丢函数)。
 */
export async function parseOptionSmart(json: string): Promise<unknown> {
  try {
    return parseOption(json)
  } catch (e) {}
  try {
    const w = await getFrameWindow()
    if (w?.__ckrevive) {
      const out = w.__ckrevive(json)
      return out
    }
  } catch (e) {}
  return JSON.parse(json)
}
