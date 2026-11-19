import iconDocx from './assets/file-docx.svg'
import iconXlsx from './assets/file-xlsx.svg'
import iconPptx from './assets/file-pptx.svg'
import iconPdf from './assets/file-pdf.svg'
import iconMd from './assets/file-md.svg'
import iconHtml from './assets/file-html.svg'
import iconTxt from './assets/file-txt.svg'
import iconJson from './assets/file-json.svg'
import iconDwg from './assets/file-dwg.png'
import iconMind from './assets/file-mind.png'

/**
 * 单一字形瓦片（W/X/P/PDF 丝带/M↓/</>/行文/{}），与 OS 文件关联图标同源
 * （assets/file-*.svg → gen-file-association-icons.mjs 光栅化成 icns/ico）。
 * 缩略图尺寸下旧「文档页+格式横幅」的文字不可辨，单字形才可扫读——
 * 主页最近列表/文件树/会话附件共用此组件，勿再内联第三份映射。
 */
const FILE_ICONS: Record<string, string> = {
  docx: iconDocx,
  doc: iconDocx,
  dot: iconDocx,
  odt: iconDocx,
  ott: iconDocx,
  hwp: iconDocx,
  hwpx: iconDocx,
  xlsx: iconXlsx,
  xlsm: iconXlsx,
  xls: iconXlsx,
  csv: iconXlsx,
  tsv: iconXlsx,
  ods: iconXlsx,
  ots: iconXlsx,
  pptx: iconPptx,
  ppt: iconPptx,
  odp: iconPptx,
  otp: iconPptx,
  pdf: iconPdf,
  md: iconMd,
  markdown: iconMd,
  txt: iconTxt,
  json: iconJson,
  html: iconHtml,
  htm: iconHtml,
  dwg: iconDwg,
  dxf: iconDwg,
  mind: iconMind,
  mindmap: iconMind,
}

export function FileBadge({ ext, size }: { ext: string; size: number }) {
  const icon = FILE_ICONS[ext]
  if (icon) {
    return <img src={icon} width={size} height={size} alt="" aria-hidden="true" />
  }
  const label = ext ? ext[0].toUpperCase() : '?'
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7.5" fill="#98a2b3" />
      <text
        x="16"
        y="16.5"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#fff"
        fontSize={17}
        fontWeight="700"
        fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
      >
        {label}
      </text>
    </svg>
  )
}
