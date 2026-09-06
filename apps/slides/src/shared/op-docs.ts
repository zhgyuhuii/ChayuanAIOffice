/**
 * Op documentation, parsed from `prompts/ops/*.md` — the single source every
 * AI surface consumes, kept out of both prompt and handler so it cannot
 * drift: a test asserts the docs cover the registry exactly, and another runs
 * every example through the executor's dry run.
 *
 * Consumers:
 * - apply_ops tool description (renderer): `opVocabulary()` (grouped names,
 *   a couple hundred tokens) and `opSignatureIndex()` (one signature line per
 *   op) tell the model what EXISTS and how each op is shaped.
 * - load_guide tool (renderer): `opGuide(group)` returns a whole group file —
 *   field tables, examples, common mistakes — on demand.
 * - op executor guided errors (main): `opUsage(name)` appends the failing
 *   op's signature so the model learns the exact fields on first contact.
 *
 * Markdown block format (see prompts/ops/_format.md):
 *
 *   ### opName [(not-ai-callable[, pending])]
 *   `signature`
 *   ...free prose, tables, ```json examples...
 *
 * The files are inlined at build time (`?raw`); nothing is read from disk at
 * runtime, in the main process or the renderer.
 */
import textMd from './prompts/ops/text.md?raw'
import elementMd from './prompts/ops/element.md?raw'
import insertMd from './prompts/ops/insert.md?raw'
import tableMd from './prompts/ops/table.md?raw'
import slideMd from './prompts/ops/slide.md?raw'
import deckMd from './prompts/ops/deck.md?raw'

export type OpGroup = 'text' | 'element' | 'insert' | 'table' | 'slide' | 'deck'

export interface OpDoc {
  /** Compact usage signature: the fields beside target (? marks optional). */
  sig: string
  /** Vocabulary group in the tool description. */
  group: OpGroup
  /**
   * false: reachable through the executor but not advertised to the model —
   * the payload is bytes/clipboard/part-path data the model cannot produce,
   * or a dedicated tool already covers it better.
   */
  aiCallable?: false
  /**
   * Registered by an in-flight branch: hidden from the vocabulary AND from
   * usage lines until it actually lands (advertising it would make the model
   * call an unknown op; a usage line on the unknown-op error would read as a
   * field problem). Drop the flag when the branch merges.
   */
  pending?: true
  /** ```json examples inside the block, verbatim (tests dry-run each one). */
  examples: string[]
  /** The whole block below the signature line (prose, tables, examples). */
  body: string
}

export interface OpGuide {
  group: OpGroup
  /** H1 title of the group file */
  title: string
  /** One-line summary (the `>` line under the title) for the load_guide catalog */
  summary: string
  /** Full markdown of the group file */
  content: string
}

const GROUP_ORDER: OpGroup[] = ['text', 'element', 'insert', 'table', 'slide', 'deck']

const SOURCES: Record<OpGroup, string> = {
  text: textMd,
  element: elementMd,
  insert: insertMd,
  table: tableMd,
  slide: slideMd,
  deck: deckMd,
}

const HEADING_RE = /^### ([A-Za-z][A-Za-z0-9]*)(?:\s+\(([^)]*)\))?\s*$/
const SIG_RE = /^`([^`]+)`\s*$/
const FENCE_JSON_RE = /^```json\s*$/
const FENCE_END_RE = /^```\s*$/

function parseGroup(group: OpGroup, md: string): { docs: Record<string, OpDoc>; guide: OpGuide } {
  const lines = md.split(/\r?\n/)
  const docs: Record<string, OpDoc> = {}
  let title = ''
  let summary = ''
  let i = 0
  // Header: "# Title" then "> summary"
  for (; i < lines.length && !HEADING_RE.test(lines[i]!); i++) {
    const line = lines[i]!
    if (!title && line.startsWith('# ')) title = line.slice(2).trim()
    else if (title && !summary && line.startsWith('> ')) summary = line.slice(2).trim()
  }
  if (!title || !summary) {
    throw new Error(`op docs (${group}): missing "# Title" / "> summary" header`)
  }
  while (i < lines.length) {
    const heading = HEADING_RE.exec(lines[i]!)
    if (!heading) {
      i++
      continue
    }
    const name = heading[1]!
    const flags = (heading[2] ?? '')
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean)
    for (const flag of flags) {
      if (flag !== 'not-ai-callable' && flag !== 'pending') {
        throw new Error(`op docs (${group}): unknown flag "${flag}" on ### ${name}`)
      }
    }
    if (docs[name]) throw new Error(`op docs (${group}): duplicate block ### ${name}`)
    // Signature: first non-empty line after the heading, in single backticks
    i++
    while (i < lines.length && lines[i]!.trim() === '') i++
    const sigMatch = i < lines.length ? SIG_RE.exec(lines[i]!) : null
    if (!sigMatch) {
      throw new Error(
        `op docs (${group}): ### ${name} must be followed by its signature in backticks`,
      )
    }
    const sig = sigMatch[1]!
    i++
    // Body: until the next heading
    const bodyLines: string[] = []
    const examples: string[] = []
    let fence: string[] | null = null
    while (i < lines.length && !HEADING_RE.test(lines[i]!)) {
      const line = lines[i]!
      if (fence) {
        if (FENCE_END_RE.test(line)) {
          examples.push(fence.join('\n'))
          fence = null
        } else fence.push(line)
      } else if (FENCE_JSON_RE.test(line)) {
        fence = []
      }
      bodyLines.push(line)
      i++
    }
    if (fence) throw new Error(`op docs (${group}): unterminated json fence in ### ${name}`)
    docs[name] = {
      sig,
      group,
      ...(flags.includes('not-ai-callable') ? { aiCallable: false as const } : {}),
      ...(flags.includes('pending') ? { pending: true as const } : {}),
      examples,
      body: bodyLines.join('\n').trim(),
    }
  }
  return { docs, guide: { group, title, summary, content: md } }
}

const parsed = GROUP_ORDER.map((g) => parseGroup(g, SOURCES[g]))

export const OP_DOCS: Record<string, OpDoc> = Object.assign({}, ...parsed.map((p) => p.docs))
// ChatOffice-local tools (no upstream ops/*.md counterpart)
// ChatOffice-local ops (no upstream ops/*.md counterpart): sig + true group
// (+aiCallable:false flags) extracted from the pre-sync OP_DOCS table
export const LOCAL_OP_DOCS: Record<string, { sig: string; group: OpGroup; aiCallable?: false }> = {
  setText: { sig: '{paragraphs:[{runs:[{text,bold?,italic?,fontSize?,color?}],align?}]} (group children: add group:"<group id>")', group: 'text' },
  setFont: { sig: '{font:{fontFamily?,fontSizePt?,bold?,italic?,underline?,strike?,color?}} — merges onto every run of the element', group: 'text' },
  setParagraphFormat: { sig: '{format:{align?,bullet?,lineSpacingPct?,spaceBeforePt?,spaceAfterPt?}}', group: 'text' },
  setFill: { sig: '{fill:"#RRGGBB"|"none"|{stops:[{pos,color}],angle?}}', group: 'element' },
  setStroke: { sig: '{stroke:{color:"#RRGGBB",widthEmu}|null} — null removes the outline', group: 'element' },
  setTransform: { sig: '{box:{x,y,cx,cy},rotDeg?} (group children: absBox instead of box, plus group:"<group id>")', group: 'element' },
  setConnectorEndpoints: { sig: '{p1:{x,y},p2:{x,y},start?:{targetId,idx}|null,end?:{targetId,idx}|null}', group: 'element' },
  setPictureSrcRect: { sig: '{srcRect:{l,t,r,b}|null} — crop fractions 0..1, null removes the crop', group: 'element' },
  setPictureLum: { sig: '{lum:{bright,contrast}|-1..1|null} — null clears (<a:lum>)', group: 'element' },
  setShapeAdjust: { sig: '{adjust:{<gdName>:number,…}} — preset-geometry avLst values (group children: add group)', group: 'element' },
  setTextBodyProps: { sig: '{props:{vert?:"horz"|"eaVert"|"vert"|"vert270"|"wordArtVert",autofit?:"none"|"shrink"|"resize",insets?:{l?,t?,r?,b?} (EMU),wrap?:boolean}}', group: 'element' },
  setEffects: { sig: '{effects:{shadow?:{color:"#RRGGBB(AA)",blurRad,dist,dirDeg,inner?,sx?,sy?,kxDeg?}|null,glow?:{color,radius}|null,reflection?:{blurRad,startA(0..1),endPos(0..1),dist}|null,softEdge?:EMU|null}} — null clears; EMU distances (12700/pt)', group: 'element' },
  setLink: { sig: '{link:{kind:"url",url}|{kind:"slide",slideIndex}|null}', group: 'element' },
  setImageFill: { sig: '{source:{mediaPath}|{bytes:base64|dataURL,ext},tile?} — use the image tools instead', group: 'element', aiCallable: false },
  addElement: { sig: '{kind:"textbox"|<preset geometry>,offset:{x,y,cx,cy},paragraphs?,fill?,stroke?,adjustments?:{<gd name>:val},bodyPr?:{autoFit?:"shrink"|"resize"}}', group: 'insert' },
  addPicture: { sig: '{bytes:base64|dataURL,ext?,svgText?,offset} — svgText upgrades to a double-part vector (raster fallback + asvg:svgBlip); use insert_web_image/generate_svg instead', group: 'insert', aiCallable: false },
  addWordArt: { sig: '{text,offset:{x,y,cx,cy},fontSizePt?,fill?,outline?:{color,widthPt?},bold?,italic?} — display text (big/bold/fill/outline); EMU rect, height ≈ fontSizePt*2.2', group: 'insert' },
  replacePicture: { sig: '{bytes:base64|dataURL,ext?} — use replace_image instead', group: 'insert', aiCallable: false },
  addTable: { sig: '{rows,cols,offset:{x,y,cx,cy},colWidthsEmu?,rowHeightsEmu?,cellProps?:[[{gridSpan?,rowSpan?,hMerge?,vMerge?,anchor?}]]}', group: 'insert' },
  addChart: { sig: '{kind:"bar"|"barStacked"|"line"|"area"|"pie"|"doughnut"|"scatter"|"radar"|"comboBarLine",categories:[…],series:[{name,values:[…]}],offset,title?,colorScheme?:["#RRGGBB"],holeSizePct?}', group: 'insert' },
  addMedia: { sig: '{kind:"video"|"audio",bytes:base64|dataURL,ext,offset} — bytes ≤40MB; generate via generate_video first', group: 'insert' },
  addEchart: { sig: '{pngBase64,optionJson,groupId,offset} — ECharts extended-family chart (poster PNG + sidecar)', group: 'insert', aiCallable: false },
  getEchart: { sig: '{target} — read the echart sidecar of a picture element', group: 'insert', aiCallable: false },
  updateEchart: { sig: '{target,pngBase64,optionJson} — rewrite sidecar + poster bytes in place', group: 'insert', aiCallable: false },
  pasteElements: { sig: '{items,dx,dy} — clipboard payload', group: 'insert', aiCallable: false },
  tableStructure: { sig: '{kind:"insert-row"|"delete-row"|"insert-col"|"delete-col",index,before?}', group: 'table' },
  setTableStyle: { sig: '{edit:TableStyleEdit} — use the edit_table_style tool instead', group: 'table', aiCallable: false },
  setChart: { sig: '{patch:ChartEdit} — use the edit_chart tool instead', group: 'table', aiCallable: false },
  addSlideWithLayout: { sig: '{layoutPath} — layout part path; not discoverable from tool results', group: 'slide', aiCallable: false },
  pasteSlide: { sig: '{afterIndex,bundle|png,mode?} — clipboard payload', group: 'slide', aiCallable: false },
  insertSlidePptx: { sig: '{source,at?,replace?} — generated-page landing payload (use generate_deck/regenerate_slide)', group: 'slide', aiCallable: false },
  setSlideLayout: { sig: '{layoutPath?} — layout part path; not discoverable from tool results', group: 'slide', aiCallable: false },
  setBackground: { sig: '{kind:"solid"|"gradient"|"reset"|"graphics"|"image",color?,from?,to?,angleDeg?,radial?,hidden?} — image kind needs a bytes source (use set_slide_background)', group: 'slide' },
  setAnimations: { sig: '{items:[{sourceId,effect,trigger,durationMs?,delayMs?,motionPath?,paragraph?,rewind?}]} — full replace per slide; sourceId resolves like every op; ≤24 items/page', group: 'slide' },
  findReplace: { sig: '{find,replace,matchCase?,slideIndex?} — whole deck unless slideIndex', group: 'deck' },
  applyHeaderFooter: { sig: '{settings:{footer?,slideNum?,date?,dateAuto?}} — every slide', group: 'deck' },
  applyTheme: { sig: '{name,colors:{dk1?,lt1?,dk2?,lt2?,accent1?..accent6?,hlink?,folHlink?},majorFont?,minorFont?} — "#RRGGBB" slots, whole deck', group: 'deck' },
}
for (const [name, doc] of Object.entries(LOCAL_OP_DOCS)) {
  if (!OP_DOCS[name]) OP_DOCS[name] = { ...doc, examples: [], body: '' }
}
// local Q5 unlock: setAnimations is AI-callable (upstream ops md gates it)
if (OP_DOCS.setAnimations) delete OP_DOCS.setAnimations.aiCallable

export const OP_GUIDES: Record<OpGroup, OpGuide> = Object.fromEntries(
  parsed.map((p) => [p.guide.group, p.guide]),
) as Record<OpGroup, OpGuide>

/** Names the model may call: registered, documented, not hidden, not pending. */
function callableNames(group?: OpGroup): string[] {
  return Object.keys(OP_DOCS).filter((n) => {
    const d = OP_DOCS[n]!
    return (group === undefined || d.group === group) && d.aiCallable !== false && !d.pending
  })
}

/** Grouped names of AI-callable ops, one line per group — the tool description's vocabulary block. */
export function opVocabulary(): string {
  return GROUP_ORDER.map((g) => `- ${g}: ${callableNames(g).join(', ')}`).join('\n')
}

/** One-line usage for a failing op, appended to its guided error. */
export function opUsage(name: string): string | undefined {
  const doc = OP_DOCS[name]
  if (!doc || doc.pending) return undefined
  return `Usage: ${name} ${doc.sig}`
}

/**
 * Every AI-callable op with its one-line signature, grouped — the complete
 * shape reference at roughly 4 KB, for the always-on part of the prompt.
 */
export function opSignatureIndex(): string {
  return GROUP_ORDER.map(
    (g) =>
      `## ${g}\n${callableNames(g)
        .map((n) => `${n} ${OP_DOCS[n]!.sig}`)
        .join('\n')}`,
  ).join('\n')
}

/** Full markdown of one group (field tables, examples, common mistakes) for load_guide. */
export function opGuide(group: string): string | undefined {
  return (OP_GUIDES as Record<string, OpGuide | undefined>)[group]?.content
}

/** `group: summary` lines for the load_guide tool description. */
export function opGuideCatalog(): string {
  return GROUP_ORDER.map((g) => `${g} — ${OP_GUIDES[g].summary}`).join('\n')
}

export const OP_GROUPS: readonly OpGroup[] = GROUP_ORDER
