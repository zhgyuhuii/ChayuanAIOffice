import type { ReactNode } from 'react'

/** 首页左栏图标统一收口：lucide 几何（24 视框 / strokeWidth 2 / 圆头圆角），
 *  与 zcode-ref 同源同观感（lucide-react v1.17.0，ISC）。尺寸两档：
 *  行动作/chevron 14，头部新建/添加类 lead 16；12-13 仅限次级标记（清除 ×、置钉）。 */
export interface TreeIconProps {
  size?: number
  className?: string
}

function Svg({
  size = 14,
  className,
  filled = false,
  children,
}: TreeIconProps & { filled?: boolean; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/** 过滤漏斗（分组头/tab 头）— lucide list-filter */
export function TreeFunnelIcon(props: TreeIconProps) {
  return (
    <Svg {...props}>
      <path d="M2 5h20" />
      <path d="M6 12h12" />
      <path d="M9 19h6" />
    </Svg>
  )
}

/** 归档 — lucide archive */
export function TreeArchiveIcon(props: TreeIconProps) {
  return (
    <Svg {...props}>
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
      <path d="M10 12h4" />
      <rect x="2" y="3" width="20" height="5" rx="1" />
    </Svg>
  )
}

/** 加号（新建项目/新建文件夹 lead）— lucide plus */
export function TreePlusIcon(props: TreeIconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </Svg>
  )
}

/** 添加文件夹（拖入根目录）— lucide folder-input */
export function TreeFolderInputIcon(props: TreeIconProps) {
  return (
    <Svg {...props}>
      <path d="M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1" />
      <path d="M2 13h10" />
      <path d="m9 16 3-3-3-3" />
    </Svg>
  )
}

/** 搜索（过滤条）— lucide search */
export function TreeSearchIcon(props: TreeIconProps) {
  return (
    <Svg {...props}>
      <path d="m21 21-4.34-4.34" />
      <circle cx="11" cy="11" r="8" />
    </Svg>
  )
}

/** 删除/清空 — lucide trash-2 */
export function TreeTrashIcon(props: TreeIconProps) {
  return (
    <Svg {...props}>
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </Svg>
  )
}

/** 展开箭头 — lucide chevron-right（展开态旋转由调用方 CSS/样式负责） */
export function TreeChevronIcon(props: TreeIconProps) {
  return (
    <Svg {...props}>
      <path d="m9 18 6-6-6-6" />
    </Svg>
  )
}

/** 新建任务（行尾）— lucide message-circle-plus */
export function TreeChatPlusIcon(props: TreeIconProps) {
  return (
    <Svg {...props}>
      <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />
      <path d="M8 12h8" />
      <path d="M12 8v8" />
    </Svg>
  )
}

/** 查看文件（行尾）— lucide list-tree（zcode 同款） */
export function TreeListTreeIcon(props: TreeIconProps) {
  return (
    <Svg {...props}>
      <path d="M8 5h13" />
      <path d="M13 12h8" />
      <path d="M13 19h8" />
      <path d="M3 10a2 2 0 0 0 2 2h3" />
      <path d="M3 5v12a2 2 0 0 0 2 2h3" />
    </Svg>
  )
}

/** 更多（行尾三点）— lucide ellipsis（实心点） */
export function TreeDotsIcon(props: TreeIconProps) {
  return (
    <Svg {...props} filled>
      <circle cx="5" cy="12" r="1.9" stroke="none" />
      <circle cx="12" cy="12" r="1.9" stroke="none" />
      <circle cx="19" cy="12" r="1.9" stroke="none" />
    </Svg>
  )
}

/** 会话行前导气泡 — lucide message-circle */
export function TreeChatIcon(props: TreeIconProps) {
  return (
    <Svg {...props}>
      <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />
    </Svg>
  )
}

/** 置顶标记 — lucide pin */
export function TreePinIcon(props: TreeIconProps) {
  return (
    <Svg {...props}>
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </Svg>
  )
}

/** 清除/关闭 — lucide x */
export function TreeXIcon(props: TreeIconProps) {
  return (
    <Svg {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Svg>
  )
}

/** 归档面板返回 — lucide arrow-left */
export function TreeArrowLeftIcon(props: TreeIconProps) {
  return (
    <Svg {...props}>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </Svg>
  )
}

/** 星标（最近列表；filled = 已星标实心）— lucide star */
export function TreeStarIcon(props: TreeIconProps & { filled?: boolean }) {
  return (
    <Svg {...props} filled={props.filled}>
      <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />
    </Svg>
  )
}

/** 文件夹 — lucide folder（open 态淡填充，语义同旧版） */
export function TreeFolderIcon(props: TreeIconProps & { open?: boolean }) {
  return (
    <Svg {...props} filled={false}>
      <path
        d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
        fill={props.open ? 'currentColor' : 'none'}
        fillOpacity={props.open ? 0.12 : 0}
      />
    </Svg>
  )
}

/** 文件夹展开态 — lucide folder-open */
export function TreeFolderOpenIcon(props: TreeIconProps) {
  return (
    <Svg {...props}>
      <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
    </Svg>
  )
}
