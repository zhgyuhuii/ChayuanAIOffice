// 单字形文件类型瓦片的唯一权威映射（2026-11-19 收口）：file-*.svg 与
// OS 关件关联图标（tools/gen-file-association-icons.mjs → icns/ico）及
// 原生菜单图标（tools/gen-menu-icons.mjs）同源。apps/shell 的 FileBadge
// 与本包 FilesPane 共用此组件——勿再内联第三份映射。
import iconDocx from './file-docx.svg'
import iconXlsx from './file-xlsx.svg'
import iconPptx from './file-pptx.svg'
import iconPdf from './file-pdf.svg'
import iconMd from './file-md.svg'
import iconHtml from './file-html.svg'
import iconTxt from './file-txt.svg'
import iconJson from './file-json.svg'
import iconDwg from './file-dwg.svg'
import iconMind from './file-mind.svg'
import iconImage from './file-image.svg'
import iconVideo from './file-video.svg'
import iconVoice from './file-voice.svg'

export const FILE_TILE_ICONS: Record<string, string> = {
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
  // media tiles (2026-11-19 attachment-card consolidation): same rounded-square
  // family — image reads as a photo, video as a play frame, voice as a mic
  png: iconImage,
  jpg: iconImage,
  jpeg: iconImage,
  gif: iconImage,
  webp: iconImage,
  bmp: iconImage,
  svg: iconImage,
  tiff: iconImage,
  heic: iconImage,
  mp4: iconVideo,
  mov: iconVideo,
  avi: iconVideo,
  mkv: iconVideo,
  webm: iconVideo,
  m4v: iconVideo,
  mp3: iconVoice,
  wav: iconVoice,
  m4a: iconVoice,
  aac: iconVoice,
  flac: iconVoice,
  ogg: iconVoice,
  opus: iconVoice,
  // plain-text/code attachments (old banner "document" group) ride the txt tile
  rtf: iconTxt,
  log: iconTxt,
  yaml: iconTxt,
  yml: iconTxt,
  xml: iconTxt,
  js: iconTxt,
  ts: iconTxt,
  tsx: iconTxt,
  jsx: iconTxt,
  py: iconTxt,
  java: iconTxt,
  c: iconTxt,
  h: iconTxt,
  cpp: iconTxt,
  go: iconTxt,
  rs: iconTxt,
  rb: iconTxt,
  sh: iconTxt,
  sql: iconTxt,
  css: iconTxt,
}

/** 未知扩展的兜底瓦片：中性底 + 首字母（与既有兜底同观感） */
export function FileTileBadge({ ext, size }: { ext: string; size: number }) {
  const icon = FILE_TILE_ICONS[ext]
  if (icon) {
    return <img src={icon} width={size} height={size} alt="" aria-hidden="true" />
  }
  const label = ext ? ext.charAt(0).toUpperCase() : '?'
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
