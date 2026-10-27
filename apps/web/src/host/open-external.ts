/**
 * 统一外链出口：openExternal / openGitHubRepo / openGenTeam / openCreditUsage
 * 等「打开浏览器」类通道共用这一处。网页宿主没有主进程，按嵌入环境分两档：
 *   1. 察元OS 内嵌（本页是 dsh 页的同源 iframe）：沿 window→parent→top 找宿主
 *      dsh 页注入的 chatop 桌面桥（chatopDesktop.openExternal → Electron
 *      shell.openExternal，http(s) 校验在宿主主进程）；
 *   2. 普通浏览器（网页版直开 / 纯 web dsh）：window.open 新标签。
 * 两档都只放行 http(s)（与 shell 主进程 openExternal 同口径，其余 scheme 一律
 * 丢弃）；宿主桥被拒（跨域/主进程校验不过）时回落 window.open。
 */

type HostOpenExternal = (url: string) => Promise<void>

/** 只放行 http(s)，返回规范化 URL；无法解析或非 http(s) 返回 null。 */
export function sanitizeExternalUrl(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  return url.toString()
}

/**
 * 沿给定帧序列（window → parent → top）找宿主桌面桥。跨域帧读属性会直接抛，
 * 逐帧兜住换下一帧；独立浏览器环境（无桥）返回 null。
 */
export function findHostOpenExternal(frames: readonly unknown[]): HostOpenExternal | null {
  for (const frame of frames) {
    try {
      const bridge = (frame as { chatopDesktop?: { openExternal?: HostOpenExternal } }).chatopDesktop
      const fn = bridge?.openExternal
      if (typeof fn === 'function') return (url) => fn.call(bridge, url)
    } catch {
      /* 跨域帧：换下一帧 */
    }
  }
  return null
}

export function openExternalUrl(raw: string): Promise<void> {
  const target = sanitizeExternalUrl(raw)
  if (!target) return Promise.resolve()
  const viaHost = findHostOpenExternal([window, window.parent, window.top])
  if (viaHost) {
    return viaHost(target).catch(() => {
      window.open(target, '_blank', 'noopener')
    })
  }
  window.open(target, '_blank', 'noopener')
  return Promise.resolve()
}
