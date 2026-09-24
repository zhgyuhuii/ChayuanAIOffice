import type { ReactElement } from 'react'

/** 侧栏行内单色文件图标：家族轮廓单色版（currentColor 描线，随主题灰阶）。
 *  彩色家族徽标只在 ≥32px 大画布登场（新建宫格/主区文件卡），此处保持 chrome 安静。 */

const STROKE = 1.3

/** 家族同源的纸页底形：圆角矩形 + 右上折角 */
function PageShell({ children }: { children?: ReactElement | ReactElement[] }) {
  return (
    <>
      <rect
        x="2.2"
        y="1.6"
        width="11.6"
        height="12.8"
        rx="2"
        stroke="currentColor"
        strokeWidth={STROKE}
        fill="none"
      />
      <path
        d="M9.4 1.8v2.6c0 .5.4.9.9.9h2.6"
        stroke="currentColor"
        strokeWidth={STROKE}
        fill="none"
        strokeLinecap="round"
      />
      {children}
    </>
  )
}

const GLYPHS: Record<string, ReactElement> = {
  // 文档：段落线
  doc: (
    <PageShell>
      <path
        d="M5 8h6M5 10.2h4.4"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
    </PageShell>
  ),
  // 表格：网格
  xls: (
    <PageShell>
      <path
        d="M4.6 7.4h6.8M4.6 10.2h6.8M7.4 7.4v5.4"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
    </PageShell>
  ),
  // 演示：升势柱图
  ppt: (
    <PageShell>
      <path
        d="M5.2 11.4V9.2M8 11.4V7.2M10.8 11.4V8.4"
        stroke="currentColor"
        strokeWidth={STROKE + 0.2}
        strokeLinecap="round"
      />
    </PageShell>
  ),
  // markdown：M 下箭头
  md: (
    <PageShell>
      <path
        d="M4.8 7.6h2v2.6M6.8 10.2l1.5-1.5 1.5 1.5V7.6h1.4"
        stroke="currentColor"
        strokeWidth={STROKE}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </PageShell>
  ),
  // pdf：印章
  pdf: (
    <PageShell>
      <circle cx="8" cy="9.2" r="1.7" stroke="currentColor" strokeWidth={STROKE} fill="none" />
      <path
        d="M7 10.7l-.9 2M9 10.7l.9 2"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
    </PageShell>
  ),
  // html：代码括号
  html: (
    <PageShell>
      <path
        d="M6.6 7.8L5.2 9.2l1.4 1.4M9.4 7.8l1.4 1.4-1.4 1.4"
        stroke="currentColor"
        strokeWidth={STROKE}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </PageShell>
  ),
  // 思维导图：节点树
  mind: (
    <PageShell>
      <circle cx="5.4" cy="9.4" r="1" stroke="currentColor" strokeWidth={STROKE} fill="none" />
      <circle cx="10.6" cy="7.6" r="1" stroke="currentColor" strokeWidth={STROKE} fill="none" />
      <circle cx="10.6" cy="11.2" r="1" stroke="currentColor" strokeWidth={STROKE} fill="none" />
      <path
        d="M6.4 9.4h1.4c.9 0 .9-1.8 1.8-1.8h.9M6.4 9.4h1.4c.9 0 .9 1.8 1.8 1.8h.9"
        stroke="currentColor"
        strokeWidth={STROKE}
        fill="none"
        strokeLinecap="round"
      />
    </PageShell>
  ),
  // 工程图：尺规
  dwg: (
    <PageShell>
      <path
        d="M4.8 11.2L11 5.4l1 1.1-6.2 5.8H4.8z"
        stroke="currentColor"
        strokeWidth={STROKE}
        fill="none"
        strokeLinejoin="round"
      />
      <path
        d="M6.6 9.5l.9.9M8.2 8l.9.9"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
    </PageShell>
  ),
}

const EXT_MAP: Record<string, string> = {
  docx: 'doc',
  doc: 'doc',
  xlsx: 'xls',
  xlsm: 'xls',
  xls: 'xls',
  csv: 'xls',
  pptx: 'ppt',
  md: 'md',
  markdown: 'md',
  pdf: 'pdf',
  html: 'html',
  htm: 'html',
  dwg: 'dwg',
  dxf: 'dwg',
  mind: 'mind',
  mindmap: 'mind',
}

/** 侧栏行内单色徽标：unknown ext 回退到无饰纸页 */
export function MonoFileIcon({ ext, size = 16 }: { ext: string; size?: number }): ReactElement {
  const glyph = GLYPHS[EXT_MAP[ext] ?? ''] ?? GLYPHS.doc
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {glyph}
    </svg>
  )
}
