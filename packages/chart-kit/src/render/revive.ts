/**
 * 主线程 option 复活(函数安全串 → 含活函数的 option):
 * 直接 new Function 会被宿主页 CSP(script-src 'self')拦(Worker 修复后
 * 剩下的最后一处主线程 eval),此时退到同源 eval-frame 里复活——帧文档
 * 无 CSP,编译发生在帧内,父页拿到的只是对象/函数引用(同源直读合法)。
 * 帧也不可用时(jsdom/测试)最终兜底 JSON.parse:丢函数保渲染。
 */

import { parseOption } from '../sandbox/serialize'
import evalFrameUrl from './eval-frame.html?url'

type ReviveFrame = Window & { __ckrevive?: (json: string) => unknown; __ckping?: boolean }

let frameWindowP: Promise<ReviveFrame | null> | null = null

function getFrameWindow(): Promise<ReviveFrame | null> {
  frameWindowP ??= new Promise<ReviveFrame | null>((resolve) => {
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
      const finish = (w: ReviveFrame | null) => {
        if (settled) return
        settled = true
        resolve(w && w.__ckping ? w : null)
      }
      iframe.addEventListener('load', () =>
        finish((iframe.contentWindow ?? null) as ReviveFrame | null),
      )
      iframe.addEventListener('error', () => finish(null))
      document.body.append(iframe)
      setTimeout(() => finish((iframe.contentWindow ?? null) as ReviveFrame | null), 3000)
    } catch {
      resolve(null)
    }
  })
  return frameWindowP
}

/**
 * 复活 option:优先帧外直解(页面允许 eval 时零开销),CSP 拦截时帧内
 * 复活,最终兜底纯 JSON(丢函数)。
 */
export async function parseOptionSmart(json: string): Promise<unknown> {
  try {
    return parseOption(json)
  } catch {
    // CSP 拦 eval 或 JSON 本身损坏:交给帧再试一次
  }
  try {
    const w = await getFrameWindow()
    if (w?.__ckrevive) return w.__ckrevive(json)
  } catch {
    /* 落入最终兜底 */
  }
  return JSON.parse(json)
}
