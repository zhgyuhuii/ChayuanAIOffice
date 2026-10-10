import { lazy } from 'react'

/**
 * 惰性版整页模型设置覆盖层。插入图片对话框的「⚙ 设置」入口在 docs /
 * sheets / slides 三端各自挂载这张页（覆盖层 position:fixed z-index 1200，
 * 盖在对话框之上），lazy 是为了让厂商 logo 分组不进各编辑器的启动图 —
 * 与各端 AiPanel 内置的 ModelSettingsPage 懒加载策略一致。
 */
export const ModelSettingsPageLazy = lazy(() =>
  import('./ModelSettingsPage').then((m) => ({ default: m.ModelSettingsPage })),
)
