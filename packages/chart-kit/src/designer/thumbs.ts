/**
 * 示例缩略图 URL 装载器。
 * 文件在 packages/chart-kit/data/thumb/*.webp(采集管线拷入,仅收录示例);
 * Vite 环境(编辑器渲染进程/vitest)经 import.meta.glob 拿 ?url 地址;
 * 纯 Node 无该替换时 try/catch 吞掉,返回空表,UI 退化为类型字形占位。
 */

type UrlMap = Record<string, string>

let urlMap: UrlMap | null = null

function loadUrlMap(): UrlMap {
  const map: UrlMap = {}
  try {
    // 类型断言在 esbuild 剥离后仍是字面量 import.meta.glob(...) 调用,Vite
    // 才能静态替换(值别名间接引用会破坏替换);不用全局 ImportMeta 增强,
    // 避免与消费方 tsconfig 的 vite/client 类型撞名
    type ImportMetaWithGlob = ImportMeta & {
      glob(pattern: string, options?: Record<string, unknown>): Record<string, unknown>
    }
    const mods = (import.meta as ImportMetaWithGlob).glob('../../data/thumb/*.webp', {
      query: '?url',
      import: 'default',
      eager: true,
    }) as Record<string, string>
    for (const [path, url] of Object.entries(mods)) {
      const id = path
        .split('/')
        .pop()
        ?.replace(/\.webp$/, '')
      if (id) map[id] = url
    }
  } catch {
    // 非 Vite 环境:无 glob,保持空表
  }
  return map
}

export function thumbUrl(exampleId: string): string | null {
  urlMap ??= loadUrlMap()
  return urlMap[exampleId] ?? null
}
