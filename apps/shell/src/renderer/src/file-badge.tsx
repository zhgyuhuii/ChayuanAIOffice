import { FileTileBadge } from '@chaoffice/ui/file-tiles/badge'

/**
 * 单一字形瓦片（W/X/P/PDF 丝带/M↓/</>/行文/{}），与 OS 文件关联图标同源。
 * 权威映射已收口到 @chaoffice/ui/file-tiles（单一事实源，编辑器 FilesPane
 * 与主页共用）；本文件保留壳内消费名 FileBadge。
 */
export function FileBadge({ ext, size }: { ext: string; size: number }) {
  return <FileTileBadge ext={ext} size={size} />
}
