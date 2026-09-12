/**
 * 图标家族 v2 生成器 —— 结构纠偏后重做：
 * 每套 = 1 产品 logo（桌面应用快捷图标）+ 8 文件类型图标（docx/xlsx/pptx/md/pdf/html/思维导图/dwg→dxf）
 * 10 套设计语言；文件图标带 AI 直出格式字母，乱码格删除后重跑即补
 * 用法：AGNES_KEY=sk-xxx node gen-icon-families.mjs [familyId过滤] [member过滤...]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'icons-v2')
const KEY = process.env.AGNES_KEY
if (!KEY) { console.error('AGNES_KEY env required'); process.exit(1) }
const API = 'https://api.agnes-ai.cn/v1/images/generations'
const MODEL = 'agnes-image-2.5-flash'

const TAIL = ', high quality, clean rendering, centered composition, app icon style with rounded square filling the frame, no watermark, no extra text besides the label'

// 成员：slug / 字母 / 页面符号 / 主题色
const MEMBERS = [
  { slug: 'doc',  letter: 'DOC',  symbol: 'paragraph text lines on the page',                 color: 'bright blue' },
  { slug: 'xls',  letter: 'XLS',  symbol: 'a spreadsheet grid on the page',                   color: 'fresh green' },
  { slug: 'ppt',  letter: 'PPT',  symbol: 'a presentation screen with a rising bar chart',    color: 'warm orange' },
  { slug: 'md',   letter: 'MD',   symbol: 'a markdown arrow symbol on the page',              color: 'violet purple' },
  { slug: 'pdf',  letter: 'PDF',  symbol: 'a formal document seal ribbon on the page',        color: 'strong red' },
  { slug: 'html', letter: 'HTML', symbol: 'a code bracket symbol </> on the page',            color: 'teal' },
  { slug: 'mind', letter: 'MIND', symbol: 'a small mind-map of connected nodes on the page',  color: 'pink magenta' },
  { slug: 'dwg',  letter: 'DWG',  symbol: 'a floor-plan outline with a ruler on the page',    color: 'cool slate blue' },
]

const FAMILIES = [
  {
    id: '01-brand-gradient', label: '品牌蓝紫渐变',
    plate: 'soft indigo-to-violet gradient background, crisp white document page with folded top-right corner',
    style: 'modern brand design system, subtle depth and soft shadow, white page with vivid colored accents',
    logo: 'the ChatOffice product logo: a chat speech bubble merged with a document sheet and a small rising bar chart into one minimal white glyph, on a soft indigo-to-violet gradient background, modern brand design, subtle depth',
  },
  {
    id: '02-candy-notes', label: '多彩糖果便签',
    plate: 'solid vivid candy-colored background (each format has its own theme color), playful rounded white document page with folded corner',
    style: 'Google-Drive-style colorful file family, flat playful shapes, bold friendly look',
    logo: 'the ChatOffice product logo: a friendly rounded chat bubble merged with a document and a bar chart, white glyph on a vivid candy purple background, playful flat style',
  },
  {
    id: '03-ink-sketch', label: '墨线手绘',
    plate: 'warm cream paper background, white document page with folded corner drawn in hand-drawn ink line style',
    style: 'hand-drawn ink illustration family, sketchy confident strokes, minimal color accents on cream paper',
    logo: 'A hand-drawn ink sketch logo mark: an open chat bubble whose tail wraps a small document sheet and a tiny bar chart, loose confident ink strokes on warm cream paper, a small blank red square seal shape (completely blank, no characters inside it)',
  },
  {
    id: '04-neumorph', label: '新拟物浅盘',
    plate: 'light warm-gray neumorphism background, embossed soft-3D document page with folded corner, extruded from the surface',
    style: 'neumorphism design family, soft embossed relief, monochrome gray with one gentle tint per format',
    logo: 'the ChatOffice product logo: embossed neumorphic chat bubble with document and bar chart, soft relief on light warm-gray surface',
  },
  {
    id: '05-dark-glass', label: '深色玻璃拟物',
    plate: 'deep navy background, frosted glass document page with folded corner, glossy highlights and soft reflections',
    style: 'premium dark glassmorphism family, translucent layers, elegant depth',
    logo: 'the ChatOffice product logo: frosted glass chat bubble merged with a document sheet and a bar chart, glowing edges on deep navy background, premium glassmorphism',
  },
  {
    id: '06-outline-wire', label: '极简线框',
    plate: 'clean white background, thin-line outlined document page with folded corner, generous negative space',
    style: 'minimal outline wireframe family, consistent thin stroke weight, one colored accent band at the bottom edge of the page',
    logo: 'the ChatOffice product logo: minimal thin-line chat bubble combined with document and chart strokes, white background, indigo accent',
  },
  {
    id: '07-retro-print', label: '复古丝网印刷',
    plate: 'retro screen-print document page with folded corner, limited three-ink palette, grainy paper texture background',
    style: 'vintage screen-print family, flat ink colors with misregistration charm, tactile paper grain',
    logo: 'the ChatOffice product logo: retro screen-print style speech bubble with document and chart, three-ink palette, grainy texture',
  },
  {
    id: '08-neon-dark', label: '霓虹暗底',
    plate: 'dark charcoal background, document page with folded corner outlined in glowing neon light',
    style: 'neon glow family, luminous edges, futuristic office software, letters rendered as glowing neon tubes',
    logo: 'the ChatOffice product logo: neon glowing chat bubble fused with a document outline and a bar chart, dark background, cyan-to-magenta gradient neon',
  },
  {
    id: '09-tea-green', label: '茶园绿意',
    plate: 'fresh tea-green gradient background, white document page with folded corner and a tiny tea-leaf accent on the corner',
    style: 'natural fresh tea-garden family, soft green palette with warm cream, organic rounded shapes',
    logo: 'the ChatOffice product logo: a tea leaf sprout merged with a chat bubble and a document sheet, fresh tea-green palette, organic modern brand mark',
  },
  {
    id: '10-clay-3d', label: '3D 陶瓷软质感',
    plate: 'soft 3D clay-render document page with folded corner, pastel background, rounded toy-like volumes with soft studio light',
    style: 'cute 3D clay render family, matte pastel materials, plump rounded shapes',
    logo: 'the ChatOffice product logo: 3D clay-render chat bubble with a document and a bar chart, pastel matte materials, adorable rounded shapes',
  },
  {
    id: '11-wps-style', label: 'WPS 参考风',
    badgeStyle: true,
    plate: 'light neutral off-white background (not colored), clean white document page with folded corner and faint gray content preview lines inside, soft realistic drop shadow under the page, generous even margins',
    style: 'WPS-style modern flat file icon family, crisp professional flat design, letter badge with a gentle vermilion-to-orange gradient, clean office software look',
    logo: 'a bold product logo mark: rounded square filled with a vivid vermilion-to-orange gradient, centered bold white stylized letter C drawn as a dynamic wing swoosh, modern flat design with a subtle inner glow',
  },
  /* ── WPS 风 10 套（12-21）：左下徽标版式，主题渐变 × logo 字形各异 ── */
  {
    id: '12-wps-vermilion', label: 'WPS 风·朱红经典',
    badgeStyle: true,
    plate: 'light neutral off-white background, clean white document page with folded corner and faint gray content preview lines, soft drop shadow',
    style: 'WPS-style flat file icon family, classic vermilion identity, rounded-square letter badge with vermilion-to-orange gradient',
    logo: 'a product logo mark: rounded square with classic vermilion-to-orange gradient, bold white letter C drawn as a sweeping wing, flat modern style',
  },
  {
    id: '13-wps-ocean', label: 'WPS 风·深海蓝',
    badgeStyle: true,
    plate: 'light neutral off-white background, clean white document page with folded corner and faint gray content preview lines, soft drop shadow',
    style: 'WPS-style flat file icon family, deep ocean identity, rounded-square letter badge with deep-blue-to-indigo gradient, every icon sits on the SAME light cream rounded container, never dark never saturated backgrounds',
    logo: 'a product logo mark: rounded square with deep-blue-to-indigo gradient, bold white letter C drawn as a flowing ocean wave, flat modern style',
  },
  {
    id: '14-wps-emerald', label: 'WPS 风·翡翠',
    badgeStyle: true,
    plate: 'light neutral off-white background, clean white document page with folded corner and faint gray content preview lines, soft drop shadow',
    style: 'WPS-style flat file icon family, emerald identity, rounded-square letter badge with emerald-to-fresh-green gradient',
    logo: 'a product logo mark: rounded square with emerald-to-green gradient, bold white letter C drawn as a curling leaf vein, flat modern style',
  },
  {
    id: '15-wps-violet', label: 'WPS 风·紫罗兰',
    badgeStyle: true,
    badgeShape: 'circular',
    plate: 'light neutral off-white background, clean white document page with folded corner and faint gray content preview lines, soft drop shadow',
    style: 'WPS-style flat file icon family, violet identity, circular letter badge with violet-to-magenta gradient',
    logo: 'a product logo mark: circular icon with violet-to-magenta gradient, bold white letter C drawn as a looping ribbon, flat modern style',
  },
  {
    id: '16-wps-sunset', label: 'WPS 风·暖橙日落',
    badgeStyle: true,
    plate: 'light warm off-white background, clean white document page with folded corner and faint warm-gray content preview lines, soft drop shadow',
    style: 'WPS-style flat file icon family, warm sunset identity, rounded-square letter badge with amber-to-coral gradient, every icon sits on the SAME light cream rounded container, only the small badge is saturated, never dark containers',
    logo: 'a product logo mark: rounded square with amber-to-coral gradient, bold white letter C drawn as a rising flame, flat modern style',
  },
  {
    id: '17-wps-mint', label: 'WPS 风·青碧薄荷',
    badgeStyle: true,
    plate: 'light neutral off-white background, clean white document page with folded corner and faint gray content preview lines, soft drop shadow',
    style: 'WPS-style flat file icon family, fresh mint identity, rounded-square letter badge with teal-to-mint gradient',
    logo: 'a product logo mark: rounded square with teal-to-mint gradient, bold white letter C drawn as a water-drop arc, flat modern style',
  },
  {
    id: '18-wps-graphite', label: 'WPS 风·石墨商务',
    badgeStyle: true,
    badgeShape: 'square',
    plate: 'light neutral off-white background, clean white document page with folded corner and faint gray content preview lines, soft drop shadow',
    style: 'WPS-style flat file icon family, graphite business identity, rounded-square letter badge with graphite-to-slate gradient, monochrome elegance',
    logo: 'a product logo mark: sharp-cornered square with graphite-to-slate gradient, bold white letter C with angular architectural cuts, flat modern style',
  },
  {
    id: '19-wps-rose', label: 'WPS 风·樱粉',
    badgeStyle: true,
    plate: 'light neutral off-white background, clean white document page with folded corner and faint gray content preview lines, soft drop shadow',
    style: 'WPS-style flat file icon family, rose identity, rounded-square letter badge with rose-to-pink gradient',
    logo: 'a product logo mark: rounded square with rose-to-pink gradient, bold white letter C drawn as a curved petal, flat modern style',
  },
  {
    id: '20-wps-indigo-night', label: 'WPS 风·靛夜',
    badgeStyle: true,
    plate: 'very light cool-gray background, clean white document page with folded corner and faint gray content preview lines, soft drop shadow with a faint cool glow',
    style: 'WPS-style flat file icon family, indigo night identity, rounded-square letter badge with indigo-to-deep-purple gradient and a subtle luminous edge',
    logo: 'a product logo mark: rounded square with indigo-to-deep-purple gradient, bold white letter C drawn as an orbiting arc with a small star dot, flat modern style with faint glow',
  },
  {
    id: '21-wps-sand', label: 'WPS 风·暖沙大地',
    badgeStyle: true,
    badgeShape: 'wide pill',
    plate: 'light warm sand-white background, clean white document page with folded corner and faint warm content preview lines, soft drop shadow',
    style: 'WPS-style flat file icon family, warm earth identity, wide pill-shaped letter badge with sand-to-bronze gradient',
    logo: 'a product logo mark: rounded square with sand-to-bronze gradient, bold white letter C drawn as layered mountain ridges, flat modern style',
  },
  /* ── Office 风 10 套（22-31）：页底横带/磁贴版式，经典色 × 变体轴 ── */
  {
    id: '22-office-fluent', label: 'Office 风·Fluent 磁贴',
    badge: m => `a small blank ${m.color} rounded-square app tile overlapping the top-left corner of the page (no text on the tile), and a colored label ribbon across the bottom of the page with large bold uppercase text "${m.letter}" clearly legible`,
    plate: 'light neutral background, crisp white document page with folded corner, faint content preview, soft realistic shadow',
    style: 'Microsoft Office fluent file icon family, classic app colors, clean professional flat design',
    logo: 'a product logo mark: white rounded square containing four glossy rounded panes in classic Office colors (blue, green, orange, red) arranged as a window grid, flat fluent design',
  },
  {
    id: '23-office-band', label: 'Office 风·经典横带',
    plate: 'light neutral background, crisp white document page with folded corner and faint content preview lines, soft shadow',
    style: 'Microsoft Office classic file icon family, bottom color band with format text, every band is ONE single solid flat color with folds of the same hue, Word-blue Excel-green PowerPoint-orange classics, professional flat design',
    logo: 'a product logo mark: rounded square with a blue-to-green-to-orange subtle tri-tone gradient border and a white four-pane window grid centered, flat Office style',
  },
  {
    id: '24-office-round', label: 'Office 风·软圆角',
    plate: 'light neutral background, white document page with strongly rounded corners and folded corner, faint content preview, extra soft shadow',
    style: 'Microsoft Office fluent file icon family, extra-rounded friendly variant, gentle gradients on the bottom color band',
    logo: 'a product logo mark: superellipse rounded square in soft blue with a white four-pane grid of rounded panes, friendly fluent style',
  },
  {
    id: '25-office-dark', label: 'Office 风·深色',
    plate: 'dark charcoal background, white document page with folded corner floating with a strong soft shadow, faint content preview',
    style: 'Microsoft Office file icon family on dark theme, bottom color band keeps classic saturated colors that pop against the dark background',
    logo: 'a product logo mark: dark graphite rounded square with a white four-pane window grid, one pane accented vivid orange, flat Office style on dark',
  },
  {
    id: '26-office-mono', label: 'Office 风·竖条侧签',
    plate: 'light neutral background, crisp white document page with folded corner and faint content preview, soft shadow',
    style: 'Microsoft Office file icon family, vertical side-strip variant: the colored format band runs VERTICALLY along the left edge of the page with the format letter horizontal on it, classic per-format colors (Word blue, Excel green, PowerPoint orange, PDF red), clean professional flat design',
    logo: 'a product logo mark: rounded square in deep corporate blue with a white four-pane window grid, flat Office style, blue tones only',
  },
  {
    id: '27-office-thinline', label: 'Office 风·细带极简',
    plate: 'airy white background, crisp white document page with folded corner and very faint content preview, generous whitespace, minimal shadow',
    style: 'Microsoft Office file icon family, minimal airy variant, thin slim bottom color band with the format text',
    logo: 'a product logo mark: white rounded square with a thin multicolor ring border (blue green orange red segments) and a minimal white four-pane grid, airy Office style',
  },
  {
    id: '28-office-tile', label: 'Office 风·磁贴居中',
    badge: m => `a large ${m.color} rounded-square tile centered on the page occupying most of it, with large bold white uppercase text "${m.letter}" clearly legible on the tile, small page margins visible around the tile`,
    plate: 'light neutral background, white document page as the base layer with folded corner, soft shadow',
    style: 'Microsoft Office tile-first file icon family, the colored app tile dominates, bold and direct',
    logo: 'a product logo mark: large rounded square tile in gradient blue with a white four-pane window grid centered, bold tile-first Office style',
  },
  {
    id: '29-office-warm', label: 'Office 风·暖调环境',
    plate: 'light warm background, crisp white document page with folded corner and faint warm content preview, soft shadow',
    style: 'Microsoft Office file icon family in a warm scene: cream-beige background and warm soft shadow, the bottom format bands keep their CLASSIC colors (Word blue, Excel green, PowerPoint orange, PDF red), letters always white',
    logo: 'a product logo mark: rounded square in terracotta-to-coral gradient with a white four-pane window grid, warm Office style',
  },
  {
    id: '30-office-cool', label: 'Office 风·冷调环境',
    plate: 'light cool background, crisp white document page with folded corner and faint cool-gray content preview, soft shadow',
    style: 'Microsoft Office file icon family in a cool scene: cool ice-gray-blue background and crisp cool shadow, the bottom format bands keep their CLASSIC colors (Word blue, Excel green, PowerPoint orange, PDF red), letters always white',
    logo: 'a product logo mark: rounded square in navy-to-steel-blue gradient with a white four-pane window grid, cool Office style',
  },
  {
    id: '31-office-vivid', label: 'Office 风·高饱和满彩',
    plate: 'light neutral background, crisp white document page with folded corner and faint content preview, soft shadow',
    style: 'Microsoft Office file icon family in vivid high-saturation variant, each bottom band in a bold candy-saturated color, energetic modern identity',
    logo: 'a product logo mark: rounded square divided into four vivid candy-colored panes forming a window grid, playful vivid Office style',
  },
  /* ── 11 号 WPS 经典风的 5 套轻变体（32-36）：同版式基因，徽标/logo 细节变奏 ── */
  {
    id: '32-wps-wide-badge', label: 'WPS 经典·横条徽标',
    badgeStyle: true,
    badgeShape: 'wide short rounded bar',
    plate: 'light neutral off-white background (not colored), clean white document page with folded corner and faint gray content preview lines inside, soft realistic drop shadow under the page, generous even margins',
    style: 'WPS-style modern flat file icon family exactly like the classic WPS look, letter badge as a wide short rounded bar across the lower part of the page, vermilion-to-orange gradient, crisp professional flat design',
    logo: 'a bold product logo mark: rounded square filled with a vivid vermilion-to-orange gradient, centered bold white stylized letter C drawn as a dynamic wing swoosh, modern flat design with a subtle inner glow',
  },
  {
    id: '33-wps-round-badge', label: 'WPS 经典·圆形徽标',
    badgeStyle: true,
    badgeShape: 'circular',
    plate: 'light neutral off-white background (not colored), clean white document page with folded corner and faint gray content preview lines inside, soft realistic drop shadow under the page, generous even margins',
    style: 'WPS-style modern flat file icon family exactly like the classic WPS look, circular letter badge pinned at the lower-left, vermilion-to-pink gradient, crisp professional flat design',
    logo: 'a bold product logo mark: rounded square filled with a vermilion-to-pink gradient, centered bold white stylized letter C drawn as a folded ribbon wing, modern flat design with a subtle inner glow',
  },
  {
    id: '34-wps-squircle-badge', label: 'WPS 经典·方圆徽标',
    badgeStyle: true,
    badgeShape: 'squircle superellipse',
    plate: 'very light cool-gray background, clean white document page with folded corner and faint gray content preview lines inside, soft realistic drop shadow, generous even margins',
    style: 'WPS-style modern flat file icon family exactly like the classic WPS look, squircle letter badge pinned at the lower-left, vermilion-to-crimson gradient, crisp professional flat design',
    logo: 'a bold product logo mark: squircle rounded square filled with a vermilion-to-crimson gradient, centered bold white stylized letter C drawn with a swallow-tail wing, modern flat design with a subtle inner glow',
  },
  {
    id: '35-wps-outline-badge', label: 'WPS 经典·描边徽标',
    badgeStyle: true,
    plate: 'light neutral off-white background (not colored), clean white document page with folded corner and faint gray content preview lines inside, soft realistic drop shadow under the page, generous even margins',
    style: 'WPS-style modern flat file icon family exactly like the classic WPS look, rounded-square letter badge with a thin white outline ring, vermilion-to-orange gradient, every icon sits on the SAME light cream bare background with the bare white page, only the small badge is saturated, never colored page containers',
    logo: 'a bold product logo mark: rounded square filled with a vivid vermilion-to-orange gradient, centered bold white stylized letter C drawn as a dynamic wing with a softly beveled edge, modern flat design',
  },
  {
    id: '36-wps-tinted-corner', label: 'WPS 经典·折角着色',
    badgeStyle: true,
    plate: 'light neutral off-white background (not colored), clean white document page whose folded top-right corner is tinted vermilion, faint gray content preview lines inside, soft realistic drop shadow, generous even margins',
    style: 'WPS-style modern flat file icon family exactly like the classic WPS look, rounded-square letter badge pinned at the lower-left with vermilion-to-orange gradient, and the page folded corner tinted vermilion, crisp professional flat design',
    logo: 'a bold product logo mark: rounded square filled with a vivid vermilion-to-orange gradient, centered bold white stylized letter C drawn as a flowing streamer ribbon, modern flat design with a subtle inner glow',
  },
  {
    id: '37-wps-mix', label: 'WPS 经典·混搭定稿（34logo形×32色）',
    badgeStyle: true,
    badgeShape: 'wide short rounded bar',
    plate: 'light neutral off-white background (not colored), clean white document page with folded corner and faint gray content preview lines inside, soft realistic drop shadow under the page, generous even margins',
    style: 'WPS-style modern flat file icon family exactly like the classic WPS look, letter badge as a wide short rounded bar across the lower part of the page, vermilion-to-orange gradient, crisp professional flat design, every icon sits on the SAME light cream bare background with the bare white page, only the small badge is saturated',
    logo: 'a bold product logo mark: squircle rounded square filled with a vivid vermilion-to-orange gradient, centered bold white stylized letter C drawn with a swallow-tail wing, modern flat design with a subtle inner glow',
  },
]

// ── 过滤参数 ──
const args = process.argv.slice(2)
let famFilter = null, memFilters = []
if (args.length) {
  const first = args[0]
  if (FAMILIES.some(f => f.id.startsWith(first) || f.id.includes(first))) { famFilter = first; memFilters = args.slice(1) }
  else memFilters = args
}

const manifestPath = join(outDir, 'manifest.json')
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : []

function promptFor(fam, logoOrMember) {
  if (logoOrMember.logo) return `${logoOrMember.logo}, pure abstract glyph only, absolutely no text, no letters, no wordmark, no brand name, no caption, no signature, no calligraphy, no handwriting words anywhere in the image${TAIL}`
  const m = logoOrMember
  const creativeC = fam.badgeStyle ? ', the C silhouette clearly formed by the described shape, not a plain font glyph' : ''
  if (logoOrMember.logo) return `${logoOrMember.logo}${creativeC}, pure abstract glyph only, absolutely no text, no letters, no wordmark, no brand name, no caption, no signature, no calligraphy, no handwriting words anywhere in the image${TAIL}`
  const labelPhrase = typeof fam.badge === 'function'
    ? fam.badge(m)
    : fam.badgeStyle
      ? `a ${fam.badgeShape ?? 'rounded-square'} badge in ${m.color} pinned at the lower-left of the page, containing large bold white uppercase text "${m.letter}" clearly legible`
      : `a colored label ribbon at the bottom of the page with large bold uppercase text "${m.letter}" clearly legible`
  return `A file-type icon for the ${fam.label} family: white document page with folded top-right corner on a rounded square, ${m.symbol}, ${labelPhrase}, ${m.color} accent color. Family design system: ${fam.style}. Base plate: ${fam.plate}${TAIL}`
}

async function genOne(fam, member) {
  const name = member.slug === 'logo' ? 'logo' : member.slug
  const file = join(outDir, fam.id, `${name}.jpg`)
  if (existsSync(file)) { console.log(`skip ${fam.id}/${name}`); return null }
  const t0 = Date.now()
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, prompt: promptFor(fam, member), n: 1 }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`)
      const data = await res.json()
      const url = data?.data?.[0]?.url
      if (!url) throw new Error(`no url: ${JSON.stringify(data).slice(0, 160)}`)
      const imgRes = await fetch(url)
      if (!imgRes.ok) throw new Error(`image HTTP ${imgRes.status}`)
      const buf = Buffer.from(await imgRes.arrayBuffer())
      const tmp = file.replace(/\.jpg$/, '.png')
      writeFileSync(tmp, buf)
      execFileSync('sips', ['-z', '512', '512', '-s', 'format', 'jpeg', '-s', 'formatOptions', '88', tmp, '--out', file], { stdio: 'pipe' })
      execFileSync('rm', [tmp])
      console.log(`ok ${fam.id}/${name} in ${Date.now() - t0}ms`)
      return { family: fam.id, member: name, url, file, ms: Date.now() - t0 }
    } catch (e) {
      console.log(`retry ${fam.id}/${name} #${attempt}: ${e.message}`)
      if (attempt === 4) return { family: fam.id, member: name, error: e.message }
      await new Promise(r => setTimeout(r, attempt * 15000))
    }
  }
}

const tasks = []
for (const fam of FAMILIES) {
  if (famFilter && !fam.id.includes(famFilter) && !fam.id.startsWith(famFilter)) continue
  mkdirSync(join(outDir, fam.id), { recursive: true })
  tasks.push({ fam, member: { slug: 'logo', logo: fam.logo } })
  for (const m of MEMBERS) {
    if (memFilters.length && !memFilters.includes(m.slug)) continue
    tasks.push({ fam, member: m })
  }
}
console.log(`queue: ${tasks.length} images`)

let done = 0
const CONCURRENCY = 3
async function worker() {
  while (tasks.length) {
    const t = tasks.shift()
    const rec = await genOne(t.fam, t.member)
    if (rec) { manifest.push(rec); writeFileSync(manifestPath, JSON.stringify(manifest, null, 2)) }
    done++
    console.log(`progress ${done}/${tasks.length + done}`)
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker))
const errs = manifest.filter(m => m.error)
console.log(`DONE: ${manifest.length - errs.length} ok total, ${errs.length} failed total`)
if (errs.length) process.exit(2)
