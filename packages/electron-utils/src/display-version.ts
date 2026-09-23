import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 六段显示版本（版本号规范 2026-09-23）：`自有版本.上游版本`。
 * package.json 的 `version` 只能存前三段（electron-builder/npm 的 semver 校验），
 * 合并到的上游版本存 `chatofficeUpstreamVersion` 字段，显示层在此拼接为
 * `1.0.2.0.10.1038` 形态；字段缺失（历史构建/字段未配）时退化为纯 semver。
 */
let cached: string | null = null

export function displayVersion(): string {
  if (cached !== null) return cached
  const semver = app.getVersion()
  let upstream = ''
  try {
    const pkg = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')) as {
      chatofficeUpstreamVersion?: unknown
    }
    if (typeof pkg.chatofficeUpstreamVersion === 'string') upstream = pkg.chatofficeUpstreamVersion
  } catch {
    // unreadable package.json (odd app layouts): fall back to the semver only
  }
  cached = upstream ? `${semver}.${upstream}` : semver
  return cached
}
