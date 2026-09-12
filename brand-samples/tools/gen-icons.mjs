/**
 * brand-samples 图标候选批量生成器
 * agnes-image-2.5-flash（OpenAI images 兼容），10 组设计方向 × 9 变体 = 90 张
 * 服务端固定出 1024×1024 PNG → sips 缩到 512 JPEG 落盘，1024 原图即弃
 * 断点续跑：已存在的目标文件跳过；manifest.json 记录每次调用的 url/耗时
 * 用法：AGNES_KEY=sk-xxx node gen-icons.mjs
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const iconsDir = join(root, 'icons')
const KEY = process.env.AGNES_KEY
if (!KEY) { console.error('AGNES_KEY env required'); process.exit(1) }
const API = 'https://api.agnes-ai.cn/v1/images/generations'
const MODEL = 'agnes-image-2.5-flash'

const STYLE_TAIL =
  ', premium modern office software branding, app icon design, rounded-square icon filling the frame, centered composition, high quality, clean vector rendering, no watermark, no text, no letters'

const GROUPS = [
  {
    id: '01-gradient-modern', label: '渐变几何·三件套',
    base: 'Flat app icon, smooth diagonal gradient background, centered white abstract geometric mark combining a document rectangle, a spreadsheet grid and a presentation triangle into one unified minimal symbol',
    variants: [
      'azure blue to violet gradient', 'teal to cyan gradient', 'sunset orange to coral gradient',
      'pink to magenta gradient', 'emerald green to lime gradient', 'indigo to blue gradient with subtle inner glow',
      'amber to gold gradient', 'crimson red to orange gradient', 'dark graphite to slate gradient with white mark',
    ],
  },
  {
    id: '02-letter-c', label: '字母 C monogram',
    base: 'App icon, a single bold letter C as the hero mark centered',
    variants: [
      'glossy gradient glass letter C on deep blue background', 'origami folded paper letter C', 'glowing neon tube letter C on dark background',
      'engraved letter C on brushed metal plate', 'liquid chrome metal letter C', 'matte ceramic pastel letter C',
      'letter C formed by three stacked overlapping office sheets', 'letter C made of colorful mosaic tiles', 'thin elegant line-art letter C inside a thin circle',
    ],
  },
  {
    id: '03-ai-bubble', label: '对话气泡×文档',
    base: 'Modern app icon, a white chat speech bubble elegantly fused with a document page symbol, AI office assistant concept',
    variants: [
      'azure blue gradient background', 'violet gradient background', 'green gradient background',
      'dark navy background with glowing bubble', 'two overlapping bubbles, one document one chat', 'outlined stroke bubble style on pastel background',
      'bubble with small sparkle accent', 'bubble merged with folded-corner document', '3d glossy bubble render',
    ],
  },
  {
    id: '04-flat-badge', label: '扁平徽章印章',
    base: 'Flat vector emblem badge app icon, solid single-color background, centered emblem with geometric frame and a document motif',
    variants: [
      'shield emblem, deep blue and white', 'circular seal emblem, forest green', 'ribbon banner badge, burgundy and cream',
      'hexagon frame emblem, slate and amber', 'laurel wreath emblem, ink navy', 'rubber stamp style emblem, red on paper white',
      'pennant flag emblem, teal', 'star badge emblem, royal blue and gold', 'thin keyline roundel emblem, black and ivory',
    ],
  },
  {
    id: '05-glass-3d', label: '3D 玻璃陶瓷',
    base: '3D rendered app icon, glossy translucent glass or ceramic shape forming an office document with a folded corner, soft studio lighting, subtle reflections, soft pastel background',
    variants: [
      'stacked glass cubes', 'glass folder shape', 'glass bar chart rising from a sheet',
      'frosted glass sheets stack', 'glass speech bubble', 'triangular glass prism with light refraction',
      'glass pen nib on a sheet', 'three layered glass panes', 'glass letter C sculpture',
    ],
  },
  {
    id: '06-outline', label: '极简线条',
    base: 'Minimal line-art app icon, single-weight thin outline drawing of a document sheet with grid lines, generous negative space, flat solid pastel background',
    variants: [
      'document outline on soft cream background', 'spreadsheet grid outline on soft mint background', 'presentation screen outline on soft peach background',
      'folder outline on soft sky background', 'pen writing on sheet outline on soft lilac background', 'chat bubble outline on soft sand background',
      'bar chart outline on soft gray background', 'calendar grid outline on soft rose background', 'paper plane outline on soft blue background',
    ],
  },
  {
    id: '07-tea-sprout', label: '茶园彩蛋·茶芽',
    base: 'Premium app icon, a delicate tea leaf sprout elegantly merged with a document page silhouette, organic modern branding, soft gradient background',
    variants: [
      'jade green gradient background', 'gold leaf on deep green', 'thin line-art version on ivory',
      'enamel badge style', 'soft watercolor wash style', 'three ascending leaves on gradient',
      'leaf merged with a chat bubble', 'leaf curving into a C shape', 'macro 3d ceramic leaf render',
    ],
  },
  {
    id: '08-retro-print', label: '复古丝网印刷',
    base: 'Retro screen-print style app icon, limited three-color ink palette, grainy print texture, vintage office motif',
    variants: [
      'typewriter motif, mustard teal cream palette', 'document and fountain pen motif, red navy paper palette', 'floppy disk motif, burnt orange brown palette',
      'envelope motif, olive cream palette', 'ink bottle and nib motif, indigo ivory palette', 'drafting compass and ruler motif, brick red palette',
      'label maker cassette motif, teal coral palette', 'postage stamp edge frame motif, purple gold palette', 'sunburst behind document motif, burgundy mustard palette',
    ],
  },
  {
    id: '09-dark-neon', label: '深色霓虹',
    base: 'App icon on deep charcoal background, glowing neon gradient line forming an office document outline with luminous edges, futuristic office software',
    variants: [
      'cyan neon document outline', 'magenta neon spreadsheet grid outline', 'lime neon bar chart outline',
      'purple neon chat bubble outline', 'orange neon folder outline', 'electric blue neon letter C outline',
      'gradient cyan to magenta neon document', 'neon dashboard panels outline, green and blue', 'neon paper plane outline, violet',
    ],
  },
  {
    id: '10-origami', label: '折纸构成',
    base: 'Origami paper-fold app icon, the symbol built from crisp folded paper planes with realistic paper texture and soft shadows, light background',
    variants: [
      'origami crane beside a folded sheet', 'folded paper folder shape', 'letter C built from folded paper ribbons',
      'paper boat on a folded sheet', 'geometric origami bird', 'folded envelope with flap',
      'pyramid of stacked folded sheets', 'upward arrow built from folded paper', 'pinwheel of four folded corners',
    ],
  },
]

const manifestPath = join(iconsDir, 'manifest.json')
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : []

async function genOne(group, idx, variant) {
  const prompt = `${group.base}, ${variant}${STYLE_TAIL}`
  const file = join(iconsDir, group.id, `${String(idx + 1).padStart(2, '0')}.jpg`)
  if (existsSync(file)) { console.log(`skip ${group.id}/${idx + 1}`); return null }
  const t0 = Date.now()
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, prompt, n: 1 }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
      const data = await res.json()
      const url = data?.data?.[0]?.url
      if (!url) throw new Error(`no url in response: ${JSON.stringify(data).slice(0, 200)}`)
      const imgRes = await fetch(url)
      if (!imgRes.ok) throw new Error(`image HTTP ${imgRes.status}`)
      const buf = Buffer.from(await imgRes.arrayBuffer())
      const tmp = file.replace(/\.jpg$/, '.png')
      writeFileSync(tmp, buf)
      execFileSync('sips', ['-z', '512', '512', '-s', 'format', 'jpeg', '-s', 'formatOptions', '85', tmp, '--out', file], { stdio: 'pipe' })
      execFileSync('rm', [tmp])
      const rec = { group: group.id, idx: idx + 1, url, file, ms: Date.now() - t0, attempts: attempt }
      console.log(`ok ${group.id}/${idx + 1} in ${rec.ms}ms (attempt ${attempt})`)
      return rec
    } catch (e) {
      console.log(`retry ${group.id}/${idx + 1} attempt ${attempt}: ${e.message}`)
      if (attempt === 4) return { group: group.id, idx: idx + 1, error: e.message }
      await new Promise(r => setTimeout(r, attempt * 15000))
    }
  }
}

const tasks = []
for (const g of GROUPS) {
  mkdirSync(join(iconsDir, g.id), { recursive: true })
  g.variants.forEach((v, i) => tasks.push({ g, i }))
}
let done = 0
const CONCURRENCY = 3
async function worker() {
  while (tasks.length) {
    const t = tasks.shift()
    const rec = await genOne(t.g, t.i, t.g.variants[t.i])
    if (rec) manifest.push(rec)
    done++
    if (rec) writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
    console.log(`progress ${done}/90`)
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker))
const errs = manifest.filter(m => m.error)
console.log(`DONE: ${manifest.length - errs.length} ok, ${errs.length} failed`)
if (errs.length) { console.log(JSON.stringify(errs, null, 2)); process.exit(2) }
