/**
 * 内置地图注册(china/world GeoJSON,按需懒加载):
 * 官方示例的 geo/map 系列引用 'china' 等地图名,未注册时 ECharts 直接
 * "Map china not exists" 空图。data/maps/*.json 经 Vite glob 懒加载;
 * GL 帧场景由父页把 JSON 经 postMessage 送入帧内注册(见 gl-frame)。
 */

import * as echarts from 'echarts'

type JsonModule = Record<string, unknown>

// 字面量调用:Vite 转换期静态替换为懒加载映射;Node(vitest)无 glob → 空表
type ImportMetaWithGlob = ImportMeta & {
  glob(pattern: string, options?: Record<string, unknown>): Record<string, unknown>
}

function mapLoaders(): Record<string, () => Promise<JsonModule>> {
  try {
    const mods = (import.meta as ImportMetaWithGlob).glob('../../data/maps/*.json') as Record<
      string,
      () => Promise<JsonModule>
    >
    return mods
  } catch {
    return {}
  }
}

const registered = new Set<string>()
const pending = new Map<string, Promise<boolean>>()

/** 从 option 收集需要的地图名(series[].map/mapType、geo/geo3D.map) */
export function mapNamesInOption(option: unknown): string[] {
  const names = new Set<string>()
  const walk = (v: unknown, depth: number) => {
    if (!v || typeof v !== 'object' || depth > 6) return
    if (Array.isArray(v)) {
      for (const item of v) walk(item, depth + 1)
      return
    }
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if ((k === 'map' || k === 'mapType') && typeof val === 'string' && val) names.add(val)
      else walk(val, depth + 1)
    }
  }
  walk(option, 0)
  return [...names]
}

async function registerOne(name: string): Promise<boolean> {
  if (registered.has(name)) return true
  const entry = Object.entries(mapLoaders()).find(([path]) => path.endsWith(`/${name}.json`))
  if (!entry) return false
  const mod = await entry[1]()
  const geojson = (mod.default ?? mod) as JsonModule
  echarts.registerMap(name, geojson as never)
  registered.add(name)
  return true
}

/**
 * 确保 option 需要的地图已注册(仅限内置 china/world 等);
 * 返回实际注册成功的名字。未内置的名字(如省份/USA)交由调用方降级。
 */
export async function ensureMapsRegistered(names: string[]): Promise<string[]> {
  const results = await Promise.all(
    names.map(async (name) => {
      const p = pending.get(name) ?? registerOne(name)
      pending.set(name, p)
      return [name, await p] as const
    }),
  )
  return results.filter(([, ok]) => ok).map(([name]) => name)
}

export async function ensureMapsForOption(option: unknown): Promise<string[]> {
  return ensureMapsRegistered(mapNamesInOption(option))
}

/** GL 帧内注册用:读取内置地图 JSON(GeoJSON 对象,可结构化克隆跨帧传递) */
export async function loadBundledMap(name: string): Promise<JsonModule | null> {
  if (!/^[\w-]+$/.test(name)) return null
  const entry = Object.entries(mapLoaders()).find(([path]) => path.endsWith(`/${name}.json`))
  if (!entry) return null
  const mod = await entry[1]()
  return (mod.default ?? mod) as JsonModule
}
