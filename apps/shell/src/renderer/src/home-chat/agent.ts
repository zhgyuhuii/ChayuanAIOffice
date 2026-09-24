import { AgentLoop, createIpcTransport } from '@chatoffice/agent-core'
import type { AgentMessage, AgentSkill, AgentTransport, AgentToolDef } from '@chatoffice/agent-core'
import type { AiModelSelection } from '@chatoffice/ai-provider'
import type { HomeApi, HomeChatAttachment } from '../../../shared/home-api'
import type { ExternalMcpServerTools } from '../../../shared/mcp-client-api'
import { kbDoc, kbSelectedIds, kbSearchGroups } from '@chatoffice/ui'
import type { MediaCapabilityFlags } from '@chatoffice/agent-core'
import { buildMcpToolDefs, mcpSystemSection } from './mcp-tools'
import type { McpToolBinding } from './mcp-tools'
import { extractDocumentBody, markdownToRestrictedHtml } from './doc-body'

/** everything the home agent needs from the host (window.chatOffice on desktop, shims on web) */
export interface HomeAgentBridge {
  aiStream: HomeApi['aiStream']
  aiStreamCancel: HomeApi['aiStreamCancel']
  onAiStream: HomeApi['onAiStream']
  createDocument: HomeApi['createDocument']
  readAttachment: HomeApi['readAttachment']
  readAttachmentImage(path: string): Promise<{ ok: boolean; base64?: string; mime?: string }>
  recents: HomeApi['recents']
  starred: HomeApi['starred']
  listProjectFiles(): Promise<string[]>
  /** 项目中心模型 (P1-7): resolve (or lazily create) the project this
   *  conversation's documents belong to; null = creation failed, the
   *  document falls back to the global default directory */
  ensureProject?(title: string): Promise<string | null>
  /** open a document in a new tab, carrying the conversation over (docx/md) */
  openWithHandoff(path: string, transcript: AgentMessage[]): Promise<void>
  /** the UI only runs the agent when a current model is configured */
  getCurrentModel(): AiModelSelection
  /** create blank xlsx/pptx/html/pdf (they don't take content like docx/md) */
  newSheet?(opts?: { projectId?: string }): Promise<void>
  newSlide?(opts?: { projectId?: string }): Promise<void>
  newHtml?(opts?: { projectId?: string }): Promise<void>
  newPdf?(opts?: { projectId?: string }): Promise<void>
  /** system-wide file search across user directories */
  systemFileSearch(
    query: string,
    ext?: string,
  ): Promise<{
    entries: { name: string; path: string; ext: string; mtimeMs: number; sizeBytes: number }[]
    truncated: boolean
  }>
  /** 生图、媒体与搜索 capability tools (web search always; image gen when a default model exists) */
  webSearch?: (
    query: string,
    maxResults?: number,
  ) => Promise<{
    results: { title: string; url: string; snippet: string }[]
    answer?: string
    method: string
    error?: string
  }>
  /** live probe: a usable search backend resolves (keyed provider configured or
   *  the keyless DuckDuckGo fallback reachable) — absent = never gate web_search */
  searchCapabilities?(): Promise<{ search: boolean }>
  generateImage?: (op: {
    prompt: string
    aspectRatio?: string
  }) => Promise<{ images?: { dataUrl: string }[]; error?: string }>
  /** live probe: a default image-gen model resolves from settings (生图、媒体与搜索) */
  imageGenReady?(): Promise<boolean>
  /** live per-kind media capability flags (unified ai:media-capabilities probe) */
  mediaCapabilities?(): Promise<MediaCapabilityFlags>
  mediaVideo?(op: {
    prompt: string
    aspectRatio?: string
    durationSeconds?: number
  }): Promise<{ url?: string; filePath?: string; model?: string; error?: string }>
  mediaUnderstand?(op: {
    kind: 'image' | 'video' | 'auto'
    sources: string[]
    requirements: string
  }): Promise<{ text?: string; error?: string }>
  mediaAsr?(op: { source: string; language?: string }): Promise<{ text?: string; error?: string }>
  mediaTts?(op: { text: string; voice?: string }): Promise<{ url?: string; mime?: string; error?: string }>
  /** 外部 MCP (MCP 管理): live tools of every enabled server; absent on shims
   *  without the chatOfficeMcp bridge → the agent runs with built-ins only */
  listMcpTools?(): Promise<ExternalMcpServerTools[]>
  /** relay one tool call to an external MCP server (serverId from listMcpTools) */
  callMcpTool?(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ ok: boolean; output: string }>
}

export type DocType = 'docx' | 'xlsx' | 'pptx' | 'md' | 'html' | 'pdf'

export interface HomeAgentEvents {
  /** cumulative assistant text of the in-flight turn */
  onText(text: string): void
  /** tool execution phases of the in-flight turn (drives the tool timeline) */
  onToolActivity?(activity: {
    callId: string
    name: string
    summary?: string
    phase: 'start' | 'end'
    ok?: boolean
    outputPreview?: string
    /** search 命中文件(点击可打开);phase=end 时携带 */
    files?: Array<{ name: string; path: string }>
    /** update_task_list 的任务快照(全量覆盖);phase=end 时携带 */
    tasks?: Array<{ title: string; status: 'pending' | 'in_progress' | 'done' }>
    /** generate_image 的生成结果(data: URL);phase=end 时携带 */
    image?: string
  }): void
  onBusy(busy: boolean): void
  onDone(result: {
    text: string
    createdDoc?: { title: string; docType: DocType }
    openedDoc?: { title: string; filePath: string }
  }): void
  onError(error: string): void
}

export interface HomeAgentTexts {
  docBodyMissing: string
  createFailed(error: string): string
  openFailed(error: string): string
  unsupportedHandoff: string
  fileNotFound: string
  unknownError: string
}

const CREATE_DOC_TOOL = {
  name: 'create_document',
  description:
    'Create a new document and open it in a new tab. ' +
    'For docx/md/html/pdf: write the FULL body as your reply text FIRST, then call this tool — your reply text becomes the file content ' +
    '(a conversational preamble like "我来为你写…" / "Sure, here is…" is stripped; for docx/pdf a restricted HTML fragment is preferred, plain Markdown is auto-converted). ' +
    'For xlsx/pptx: these create blank files (no body needed); just call the tool with title and type.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'document title, used as the file name' },
      type: {
        type: 'string',
        enum: ['docx', 'xlsx', 'pptx', 'md', 'html', 'pdf'],
        description: "target file type (default 'docx')",
      },
    },
    required: ['title'],
  },
}

const SEARCH_FILES_TOOL = {
  name: 'search_files',
  description:
    "Search the user's files (recent, starred, project files) by name. Returns a JSON list of {name, path, ext, mtimeMs}, newest first.",
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'case-insensitive substring matched against file names',
      },
      ext: { type: 'string', description: "optional extension filter, e.g. 'docx'" },
    },
    required: ['query'],
  },
}

const SYSTEM_SEARCH_TOOL = {
  name: 'system_search',
  description:
    "Search the user's entire computer (Documents, Desktop, Downloads) for document files. Use when search_files finds no results or the user explicitly asks to search the whole computer. Returns {entries: [{name, path, ext, mtimeMs, sizeBytes}], truncated: boolean}.",
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'case-insensitive substring matched against file names',
      },
      ext: {
        type: 'string',
        description: 'optional extension filter (docx, xlsx, pptx, md, html, pdf)',
      },
    },
    required: ['query'],
  },
}

const READ_DOCUMENT_TOOL = {
  name: 'read_document',
  description:
    "Read the extracted text of one of the user's files. Long documents are paged: use offset (characters) to continue.",
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'absolute file path from search_files or an attachment',
      },
      offset: { type: 'number', description: 'character offset to start from (default 0)' },
      maxChars: { type: 'number', description: 'slice length, max 48000 (default 12000)' },
    },
    required: ['path'],
  },
}

const OPEN_DOCUMENT_TOOL = {
  name: 'open_document',
  description:
    "Open an existing file in its editor tab so the user can edit it. For docx/md the current conversation is handed over to that tab's AI panel, where further edits happen.",
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string', description: 'absolute file path from search_files' } },
    required: ['path'],
  },
}

const WEB_SEARCH_TOOL = {
  name: 'web_search',
  description:
    'Search the web for up-to-date information (news, facts, references). Returns {results: [{title, url, snippet}], answer?}. Use it whenever a question needs current or external knowledge instead of guessing.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'the search query (keep it short and specific)' },
      maxResults: { type: 'number', description: 'number of results (default 6, max 10)' },
    },
    required: ['query'],
  },
}

const GENERATE_IMAGE_TOOL = {
  name: 'generate_image',
  description:
    'Generate an image with the default AI image model (设置 → 生图、媒体与搜索) and show it in the conversation. Prompt in English works best; include subject, style and composition.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'detailed English description of the image' },
      aspectRatio: {
        type: 'string',
        description: "desired aspect ratio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4'",
      },
    },
    required: ['prompt'],
  },
}

const GENERATE_VIDEO_TOOL = {
  name: 'generate_video',
  description:
    'Generate a short AI video clip with the default video-generation model (设置 → 生图、媒体与搜索). Vendor-billed and slow (often minutes); only when the user asks for video/motion. The saved file path is returned.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Motion description, English works better' },
      aspectRatio: { type: 'string', description: "e.g. '16:9' | '9:16'" },
      durationSeconds: { type: 'number', description: 'clip length in seconds (vendor limits apply)' },
    },
    required: ['prompt'],
  },
}

const ANALYZE_MEDIA_TOOL = {
  name: 'analyze_media',
  description:
    'Analyze images/video/audio with the media-understanding models configured in Settings (生图、媒体与搜索). Pass direct URLs or local file paths; returns analysis text for you to act on.',
  inputSchema: {
    type: 'object',
    properties: {
      sources: {
        type: 'array',
        items: { type: 'string' },
        description: 'Direct http(s) URLs or local file paths of the media files',
      },
      requirements: {
        type: 'string',
        description: 'What to extract and how the result will be used (English works better)',
      },
    },
    required: ['sources', 'requirements'],
  },
}

const TRANSCRIBE_AUDIO_TOOL = {
  name: 'transcribe_audio',
  description:
    'Transcribe an audio file to text with the default ASR model (设置 → 生图、媒体与搜索). Pass a direct URL or a local file path; returns the transcript.',
  inputSchema: {
    type: 'object',
    properties: {
      source: { type: 'string', description: 'Direct http(s) URL or local file path of the audio' },
      language: { type: 'string', description: 'ISO language hint, e.g. "zh" / "en"; omit for auto' },
    },
    required: ['source'],
  },
}

const GENERATE_SPEECH_TOOL = {
  name: 'generate_speech',
  description:
    'Synthesize spoken audio from text with the default TTS model (设置 → 生图、媒体与搜索). Returns the saved audio file path.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The text to speak' },
      voice: { type: 'string', description: 'Vendor voice id; omit for the default voice' },
    },
    required: ['text'],
  },
}

const UPDATE_TASKS_TOOL = {
  name: 'update_task_list',
  description:
    'Maintain the visible task checklist for a complex multi-step request. Call it once with the full breakdown BEFORE starting work, then again each time a step completes (send the FULL updated list every time — it replaces the previous one). Use short titles. Skip it for simple one-step requests.',
  inputSchema: {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        description: 'full snapshot of the checklist; replaces the previous list',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'short step title (≤ 24 chars)' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'done'] },
          },
          required: ['title', 'status'],
        },
      },
    },
    required: ['tasks'],
  },
}

const SYSTEM_PROMPT = `You are the ChatOffice home assistant. You create documents, answer questions, and work with the user's existing files.

## Creating documents
When the user asks to create/write a document (report, plan, letter, summary, note, ...):
1. For docx/md/html/pdf: Write the FULL document body as your reply text in this very turn:
   - Word document (.docx, the default): a restricted HTML fragment using only <h1>-<h3>, <p>, <ul>/<ol>/<li>, <blockquote>, <pre>, <table>/<thead>/<tbody>/<tr>/<th>/<td>, <strong>/<em>/<u>/<s>, <br>. No <html>/<head>/<body> wrappers, no attributes except colspan/rowspan on table cells.
   - Markdown file (.md, only when the user explicitly asks for Markdown): plain Markdown source.
   - HTML page (.html): a complete HTML document with <html>, <head>, <body>, including basic CSS for styling.
   - PDF (.pdf): same restricted HTML as docx; the app converts it to PDF on creation.
2. Then, in the SAME turn, call create_document with just the title and type. Never pass the body as a tool argument — your reply text becomes the file content verbatim.
3. For xlsx/pptx: these create blank files (no body content needed). Just call create_document with title and type directly.
4. After the tool succeeds the document opens in a new tab automatically and the conversation continues there. Do not repeat the body afterwards; a single short closing sentence is enough.

Table of contents: when the user asks for a TOC / 目录 / clickable outline with jumps in a docx, place an empty <toc></toc> tag (allowed in addition to the tags above) exactly where the TOC should appear — usually right after the opening <h1>. Keep a clean <h1>-<h3> hierarchy in the body: the app turns the tag into a real Word TOC field whose entries come from those headings (clickable, page numbers refresh on open). One <toc> per document.

Never stall by asking for details: when something is unspecified, make a reasonable choice and proceed. Infer a concise file-name-style title from the request when none is given. Default to docx unless the user specifies another type.

## Working with existing files
- search_files locates files from recent/starred/project lists; if it finds nothing, use system_search to scan the user's entire computer (Documents, Desktop, Downloads).
- Answer from your own knowledge first; call web_search only for facts you cannot reliably know (current news, dates, prices, versions, locale-specific facts) and cite the source URL when you use its results.
- generate_image draws an image with the user's default image model and shows it in the conversation; use it whenever the user asks for a picture or illustration (detailed English prompt).
- system_search searches the whole computer for document files (docx, xlsx, pptx, md, html, pdf). Use it when the user asks to "search the computer" or when search_files returns no results.
- read_document reads a file's text (page long files with offset); open_document opens a file in its editor tab.
- To EDIT an existing document: open_document it, then the editing continues in that tab's AI panel (the conversation moves with it). For files open_document cannot carry the conversation to (xlsx/pptx/pdf), tell the user the file was opened and they can continue with the AI panel there.
- Never claim you cannot access files before trying search_files and system_search.

## Task checklist
When the request involves 3 or more distinct steps (e.g. research files → draft a document → verify numbers, or multi-part deliverables), call update_task_list FIRST with the breakdown, then keep it current as you work: mark finished steps done and exactly one step in_progress. Simple requests skip the checklist.

## Answering questions
Reply directly in concise Markdown.`

/** turn texts below this length cannot be a document body — the model skipped step 1 */
const MIN_DOC_BODY_CHARS = 50

/**
 * create_document 以「回复即正文」为契约,但模型常先写一段对话性开场白
 * (「我来为你写…下面开始生成」)就调工具——开场白原样落盘便成了整份文档。
 * 门槛挡不住百来字的开场白,所以 docx/pdf 在落盘前做两级归一:
 * ①回复里有块级 HTML 标签 → 提取,剥掉正文前的开场白;
 * ②没有标签但有 Markdown 块级信号 → 就地转受限 HTML(用户要 word 时模型
 *   常无视契约按 Markdown 写——拒绝会把类型逼成 md,转换保住类型与产物);
 * ③两者皆无(纯对话文本) → 拒绝并让模型先写正文再重试。
 */
const DOC_BODY_CONTRACT_HINT =
  'Your reply so far is conversational preamble, not a document body — nothing was written into the file. ' +
  'Write the FULL document body as your reply text now — a restricted HTML fragment (<h1>-<h3>, <p>, <ul>/<ol>/<li>, <table>, <blockquote>, <strong>/<em>) — then call create_document again. ' +
  'Keep the SAME title and type the user asked for; never switch the document type because of this error.'

/** 历史回溯用:单段文本按目标类型归一成正文,带块级信号要求;空串 = 不合格 */
function normalizeDocBody(docType: DocType, text: string): string {
  const trimmed = text.trim()
  if (docType === 'docx' || docType === 'pdf') {
    return extractDocumentBody(trimmed) || markdownToRestrictedHtml(trimmed)
  }
  // md/html 契约为全文直传;回溯历史时必须有块级信号,否则任意一段
  // 聊天回复(>50 字)都会被误当 md 正文
  const long = trimmed.replace(/\s/g, '').length >= MIN_DOC_BODY_CHARS
  if (docType === 'md') return long && markdownToRestrictedHtml(trimmed) ? trimmed : ''
  return long && /<\/html\s*>|<body\b/i.test(trimmed) ? trimmed : ''
}

/**
 * 弱模型常把「写正文」和「调 create_document」拆成两轮:先空着正文调工具
 * (被拒),下一轮补写正文后却不再调工具——运行就此死掉,文档永远不创建
 * (「生成文档后打不开编辑器」的根因)。所以正文来源是「当前轮 + 本次运行
 * 的助手历史」:当前轮按原契约(直传 + 长度门槛;docx/pdf 归一),不够格再
 * 倒序回溯历史。系统注入的合成消息([System]/[Summary 开头)不是模型正文,
 * 跳过。
 */
function resolveDocBody(
  docType: DocType,
  turnText: string,
  transcript: Array<{ role: string; text?: string }>,
): string {
  const trimmed = turnText.trim()
  const current =
    docType === 'docx' || docType === 'pdf'
      ? extractDocumentBody(trimmed) || markdownToRestrictedHtml(trimmed)
      : trimmed
  if (current.replace(/\s/g, '').length >= MIN_DOC_BODY_CHARS) return current
  const history = [...transcript]
    .filter((m) => m.role === 'assistant' && typeof m.text === 'string')
    .map((m) => m.text as string)
    .filter((t) => !t.startsWith('[System]') && !t.startsWith('[Summary of earlier'))
    .reverse()
  for (const candidate of history) {
    const body = normalizeDocBody(docType, candidate)
    if (body.replace(/\s/g, '').length >= MIN_DOC_BODY_CHARS) return body
  }
  return ''
}

/**
 * Appended to the system prompt while a session is in plan mode: the agent
 * advises instead of acting. Read-only tools stay available (research is not
 * mutation); only file-creating/opening actions are constrained.
 */
export const PLAN_MODE_SUFFIX = `

## Plan mode (active for this conversation)
The user switched this conversation to plan mode. Produce plans, advice and analysis only:
- Do NOT call create_document. Do NOT create or modify any file.
- search_files and read_document stay available for research; only open_document when the user explicitly asks to see the file.
- End with a concrete, step-by-step proposal the user can approve, then wait — do not execute anything.`

const KB_SEARCH_TOOL = {
  name: 'kb_search',
  description:
    'Search the selected knowledge bases (察元知识库) for relevant passages. Returns numbered excerpts with their document name and heading path. Use it to dig deeper than the context injected with the message, or when the user asks about the knowledge base.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'the search query (short and specific works best)' },
      topK: { type: 'number', description: 'excerpts per library (default 6, max 20)' },
    },
    required: ['query'],
  },
}

const KB_READ_DOC_TOOL = {
  name: 'kb_read_doc',
  description:
    'Read a knowledge-base document: metadata (name, type, size, parse status) by document id. Pair it with kb_search results (each hit carries docId).',
  inputSchema: {
    type: 'object',
    properties: {
      kbId: { type: 'string', description: 'knowledge-base id (from kb_search context header)' },
      docId: { type: 'string', description: 'document id (from kb_search hits)' },
    },
    required: ['kbId', 'docId'],
  },
}

const HOME_TOOLS: AgentToolDef[] = [
  CREATE_DOC_TOOL,
  SEARCH_FILES_TOOL,
  SYSTEM_SEARCH_TOOL,
  READ_DOCUMENT_TOOL,
  OPEN_DOCUMENT_TOOL,
  UPDATE_TASKS_TOOL,
]

/** external MCP tools surfaced to the skill (built-in list + namespaced extras) */
interface McpSkillState {
  tools(): AgentToolDef[]
  section(): string
  /** null when the wire name is not an MCP tool */
  call(
    wireName: string,
    input: Record<string, unknown>,
  ): Promise<{ output: string; isError?: boolean } | null>
}

function homeSkill(
  bridge: HomeAgentBridge,
  state: {
    turnText: () => string
    /** T3 排版接力: the user's original instruction for the in-flight turn */
    turnInstruction: () => string
    transcript: () => AgentMessage[]
    onCreatedDoc(info: { title: string; docType: DocType }): void
    onOpenedDoc(info: { title: string; filePath: string }): void
    mcp: McpSkillState
    /** live predicate: a default image-gen model is configured (settings-driven) */
    imageGenReady: () => boolean
    /** live predicate: a usable search backend resolves (web_search tool gate) */
    searchReady: () => boolean
    /** live per-kind media capability flags (unified ai:media-capabilities probe) */
    mediaFlags: () => MediaCapabilityFlags | null
    /** generated image display channel (tool timeline card) */
    onGeneratedImage(dataUrl: string): void
  },
  texts: HomeAgentTexts,
): AgentSkill {
  return {
    id: 'home',
    // getters: the loop re-reads these before every model request, so tools
    // added by an MCP refresh (or a mid-session server toggle) apply to the
    // next turn without recreating the agent
    get systemPrompt() {
      const section = state.mcp.section()
      return section ? `${SYSTEM_PROMPT}\n\n${section}` : SYSTEM_PROMPT
    },
    get tools() {
      const imageGen = bridge.generateImage && state.imageGenReady() ? [GENERATE_IMAGE_TOOL] : []
      // web_search 只在搜索通道可用时挂进工具箱:通道不可用时模型自然全程用
      // 自身知识回答,不再撞上必失败的调用(优雅降级优先于报错重试)
      const webSearchTool =
        bridge.webSearch && state.searchReady() ? [WEB_SEARCH_TOOL] : []
      const flags = state.mediaFlags()
      const media: AgentToolDef[] = []
      if (flags?.video && bridge.mediaVideo) media.push(GENERATE_VIDEO_TOOL)
      if (flags?.imageUnderstanding && bridge.mediaUnderstand) media.push(ANALYZE_MEDIA_TOOL)
      if (flags?.asr && bridge.mediaAsr) media.push(TRANSCRIBE_AUDIO_TOOL)
      if (flags?.tts && bridge.mediaTts) media.push(GENERATE_SPEECH_TOOL)
      // KB tools join only while libraries are selected in the composer
      const kb = kbSelectedIds().length > 0 ? [KB_SEARCH_TOOL, KB_READ_DOC_TOOL] : []
      return [...HOME_TOOLS, ...webSearchTool, ...imageGen, ...media, ...kb, ...state.mcp.tools()]
    },
    async executeTool(call) {
      const mcpResult = await state.mcp.call(call.name, call.input)
      if (mcpResult) {
        return { ...mcpResult, summary: call.name }
      }
      if (call.name === 'kb_search') {
        const query = String(call.input.query ?? '').trim()
        const kbIds = kbSelectedIds()
        if (!query)
          return { output: 'query must not be empty', isError: true, summary: 'kb_search' }
        if (kbIds.length === 0)
          return {
            output: 'no knowledge base selected in the composer',
            isError: true,
            summary: 'kb_search',
          }
        const topK = Math.min(Math.max(Number(call.input.topK ?? 6) || 6, 1), 20)
        const groups = await kbSearchGroups(kbIds, query, topK)
        const lines: string[] = []
        for (const group of groups) {
          for (const hit of group) {
            const head = hit.headingPath ? ` › ${hit.headingPath}` : ''
            lines.push(`[${hit.docId}] ${hit.docName}${head}\n${hit.text.slice(0, 1200)}`)
          }
        }
        return {
          output: lines.length
            ? lines.join('\n\n')
            : 'no matching passages found in the selected knowledge bases',
          summary: 'kb_search',
        }
      }
      if (call.name === 'kb_read_doc') {
        const kbId = String(call.input.kbId ?? '')
        const docId = String(call.input.docId ?? '')
        if (!kbId || !docId)
          return { output: 'kbId and docId are required', isError: true, summary: 'kb_read_doc' }
        const res = await kbDoc(kbId, docId)
        if (!res.ok || !res.doc)
          return {
            output: `document not found: ${res.reason ?? 'unknown error'}`,
            isError: true,
            summary: 'kb_read_doc',
          }
        const doc = res.doc
        return {
          output: `name: ${doc.name}\ntype: ${doc.mime ?? 'unknown'}\nsize: ${
            doc.size ?? 'unknown'
          } bytes\nparse status: ${doc.status ?? 'unknown'}\n(chunk text: use kb_search)`,
          summary: 'kb_read_doc',
        }
      }
      switch (call.name) {
        case 'create_document': {
          const title = String(call.input.title ?? '').trim()
          if (!title)
            return { output: 'title must not be empty', isError: true, summary: 'create_document' }
          const rawType = typeof call.input.type === 'string' ? call.input.type : ''
          const docType: DocType = (
            ['docx', 'xlsx', 'pptx', 'md', 'html', 'pdf'].includes(rawType) ? rawType : 'docx'
          ) as DocType
          const isBlank = docType === 'xlsx' || docType === 'pptx'
          // 正文来源:当前轮文本,不够格时回溯本次运行的助手历史(倒序),
          // 承接「先空调工具被拒、下一轮才补写正文」的拆轮写法
          const body = resolveDocBody(docType, state.turnText(), state.transcript())
          if (!isBlank && body.replace(/\s/g, '').length < MIN_DOC_BODY_CHARS) {
            return {
              output: `${texts.docBodyMissing}\n${DOC_BODY_CONTRACT_HINT}`,
              isError: true,
              summary: 'create_document',
            }
          }
          let projectId: string | null | undefined
          if (bridge.ensureProject) {
            try {
              projectId = await bridge.ensureProject(title)
            } catch {
              projectId = null
            }
          }
          if (isBlank) {
            const createFn = docType === 'xlsx' ? bridge.newSheet : bridge.newSlide
            if (!createFn) {
              return {
                output: texts.createFailed(`${docType} creation not supported`),
                isError: true,
                summary: 'create_document',
              }
            }
            try {
              await createFn(projectId ? { projectId } : {})
            } catch (e) {
              return {
                output: texts.createFailed(e instanceof Error ? e.message : String(e)),
                isError: true,
                summary: 'create_document',
              }
            }
            state.onCreatedDoc({ title, docType })
            return {
              output: `created and opened: ${title}.${docType}`,
              mutated: true,
              summary: 'create_document',
            }
          }
          const result = await bridge.createDocument({
            type: docType,
            title,
            content: body,
            ...(projectId ? { projectId } : {}),
            ...(docType === 'docx' && state.turnInstruction()
              ? { instruction: state.turnInstruction() }
              : {}),
          })
          if (!result.ok) {
            return {
              output: texts.createFailed(result.error ?? ''),
              isError: true,
              summary: 'create_document',
            }
          }
          state.onCreatedDoc({ title, docType })
          return {
            output: `created and opened: ${title}.${docType}`,
            mutated: true,
            summary: 'create_document',
          }
        }
        case 'search_files': {
          const query = String(call.input.query ?? '')
            .trim()
            .toLowerCase()
          const ext = typeof call.input.ext === 'string' ? call.input.ext.toLowerCase() : ''
          const [recents, starred, projectFiles] = await Promise.all([
            bridge.recents({ offset: 0, limit: 100 }),
            bridge.starred({ offset: 0, limit: 100 }),
            bridge.listProjectFiles().catch(() => [] as string[]),
          ])
          const byPath = new Map<
            string,
            { name: string; path: string; ext: string; mtimeMs: number }
          >()
          for (const e of [...recents.entries, ...starred.entries]) byPath.set(e.path, e)
          for (const p of projectFiles) {
            if (byPath.has(p)) continue
            const name = p.split(/[\\/]/).pop() ?? p
            byPath.set(p, {
              name,
              path: p,
              ext: name.split('.').pop()?.toLowerCase() ?? '',
              mtimeMs: 0,
            })
          }
          const hits = [...byPath.values()]
            .filter(
              (e) => (!ext || e.ext === ext) && (!query || e.name.toLowerCase().includes(query)),
            )
            .sort((a, b) => b.mtimeMs - a.mtimeMs)
            .slice(0, 10)
          return {
            output: hits.length
              ? JSON.stringify(hits)
              : JSON.stringify({ results: [], hint: texts.fileNotFound }),
            summary: 'search_files',
          }
        }
        case 'system_search': {
          const query = String(call.input.query ?? '').trim()
          const ext = typeof call.input.ext === 'string' ? call.input.ext.toLowerCase() : ''
          if (!bridge.systemFileSearch) {
            return {
              output: JSON.stringify({ results: [], hint: 'system search not available' }),
              summary: 'system_search',
            }
          }
          const result = await bridge.systemFileSearch(query, ext || undefined)
          return {
            output: result.entries.length
              ? JSON.stringify(result)
              : JSON.stringify({ entries: [], truncated: false, hint: texts.fileNotFound }),
            summary: 'system_search',
          }
        }
        case 'web_search': {
          const query = String(call.input.query ?? '').trim()
          if (!query) {
            return { output: 'query must not be empty', isError: true, summary: 'web_search' }
          }
          if (!bridge.webSearch) {
            return { output: 'web search not available', isError: true, summary: 'web_search' }
          }
          const maxResults = Math.min(10, Math.max(1, Number(call.input.maxResults) || 6))
          const r = await bridge.webSearch(query, maxResults)
          // a backend failure must not read as "no results" — the model would fabricate conclusions;
          // the feedback orders a knowledge fallback so one dead backend never dead-ends the turn
          if (r.error) {
            return {
              output:
                `web search failed (${r.error}). Search is unavailable right now — retry at most once, ` +
                'then answer from your own knowledge and clearly tell the user the information may be outdated or unverified.',
              isError: true,
              summary: 'web_search',
            }
          }
          const lines: string[] = []
          if (r.answer) lines.push(`Direct answer: ${r.answer}\n`)
          r.results.forEach((it, i) =>
            lines.push(`${i + 1}. ${it.title}\n   ${it.url}\n   ${it.snippet}`),
          )
          return {
            output: lines.join('\n') || '(no results)',
            summary: `web_search · ${query}`,
          }
        }
        case 'generate_image': {
          const prompt = String(call.input.prompt ?? '').trim()
          if (!prompt) {
            return { output: 'prompt must not be empty', isError: true, summary: 'generate_image' }
          }
          if (!bridge.generateImage) {
            return {
              output: 'image generation not available',
              isError: true,
              summary: 'generate_image',
            }
          }
          const aspectRatio = String(call.input.aspectRatio ?? '').trim()
          const r = await bridge.generateImage({ prompt, ...(aspectRatio ? { aspectRatio } : {}) })
          const dataUrl = r.images?.[0]?.dataUrl
          if (!dataUrl) {
            return {
              output: `image generation failed: ${r.error ?? 'unknown error'}`,
              isError: true,
              summary: 'generate_image',
            }
          }
          // the image rides the tool-timeline event (display-only); the tool
          // output stays compact so the transcript never duplicates the bytes
          state.onGeneratedImage(dataUrl)
          return {
            output: 'image generated successfully (shown to the user in the tool card)',
            summary: `generate_image · ${prompt.slice(0, 40)}`,
          }
        }
        case 'generate_video': {
          const prompt = String(call.input.prompt ?? '').trim()
          if (!prompt)
            return { output: 'prompt must not be empty', isError: true, summary: 'generate_video' }
          if (!bridge.mediaVideo)
            return { output: 'video generation not available', isError: true, summary: 'generate_video' }
          const aspectRatio = String(call.input.aspectRatio ?? '').trim()
          const durationSeconds = Number(call.input.durationSeconds) || undefined
          const r = await bridge.mediaVideo({
            prompt,
            ...(aspectRatio ? { aspectRatio } : {}),
            ...(durationSeconds ? { durationSeconds } : {}),
          })
          if (!r.url && !r.filePath)
            return { output: `video generation failed: ${r.error ?? 'unknown error'}`, isError: true, summary: 'generate_video' }
          const where = r.filePath ?? r.url
          return {
            output: `Video generated (${r.model ?? 'configured model'}): ${where}\nThe file is saved on this machine; report the path to the user (video cannot be shown inline here).`,
            summary: `generate_video · ${prompt.slice(0, 40)}`,
          }
        }
        case 'analyze_media': {
          const sources = Array.isArray(call.input.sources)
            ? (call.input.sources as unknown[]).map(String).filter((s) => s.trim() !== '')
            : []
          const requirements = String(call.input.requirements ?? '').trim()
          if (!sources.length)
            return { output: 'sources must not be empty', isError: true, summary: 'analyze_media' }
          if (!requirements)
            return { output: 'requirements must not be empty', isError: true, summary: 'analyze_media' }
          if (!bridge.mediaUnderstand)
            return { output: 'media analysis not available', isError: true, summary: 'analyze_media' }
          const r = await bridge.mediaUnderstand({ kind: 'auto', sources, requirements })
          if (!r.text)
            return { output: `media analysis failed: ${r.error ?? 'unknown error'}`, isError: true, summary: 'analyze_media' }
          return {
            output: r.text,
            summary: `analyze_media · ${sources.length} file(s)`,
          }
        }
        case 'transcribe_audio': {
          const source = String(call.input.source ?? '').trim()
          if (!source)
            return { output: 'source must not be empty', isError: true, summary: 'transcribe_audio' }
          if (!bridge.mediaAsr)
            return { output: 'transcription not available', isError: true, summary: 'transcribe_audio' }
          const language = String(call.input.language ?? '').trim()
          const r = await bridge.mediaAsr({ source, ...(language ? { language } : {}) })
          if (!r.text)
            return { output: `transcription failed: ${r.error ?? 'unknown error'}`, isError: true, summary: 'transcribe_audio' }
          return {
            output: `Transcript:\n${r.text}`,
            summary: 'transcribe_audio',
          }
        }
        case 'generate_speech': {
          const text = String(call.input.text ?? '').trim()
          if (!text)
            return { output: 'text must not be empty', isError: true, summary: 'generate_speech' }
          if (!bridge.mediaTts)
            return { output: 'speech synthesis not available', isError: true, summary: 'generate_speech' }
          const voice = String(call.input.voice ?? '').trim()
          const r = await bridge.mediaTts({ text, ...(voice ? { voice } : {}) })
          if (!r.url)
            return { output: `speech synthesis failed: ${r.error ?? 'unknown error'}`, isError: true, summary: 'generate_speech' }
          return {
            output: `Audio generated: ${r.url}\nThe audio file is saved on this machine; report the path to the user.`,
            summary: 'generate_speech',
          }
        }
        case 'read_document': {
          const path = String(call.input.path ?? '')
          const result = await bridge.readAttachment(
            path,
            Number(call.input.offset) || 0,
            Number(call.input.maxChars) || 12_000,
          )
          if (!result.ok)
            return {
              output: result.error ?? 'read failed',
              isError: true,
              summary: 'read_document',
            }
          return {
            output: JSON.stringify({
              name: result.name,
              totalChars: result.totalChars,
              offset: result.offset,
              text: result.text,
            }),
            summary: 'read_document',
          }
        }
        case 'open_document': {
          const path = String(call.input.path ?? '')
          const name = path.split(/[\\/]/).pop() ?? path
          const ext = name.split('.').pop()?.toLowerCase() ?? ''
          const carries = ext === 'docx' || ext === 'md'
          try {
            await bridge.openWithHandoff(path, carries ? state.transcript() : [])
          } catch (e) {
            return {
              output: texts.openFailed(e instanceof Error ? e.message : String(e)),
              isError: true,
              summary: 'open_document',
            }
          }
          state.onOpenedDoc({ title: name, filePath: path })
          return {
            output: carries ? `opened: ${name}` : `${texts.unsupportedHandoff}: ${name}`,
            summary: 'open_document',
          }
        }
        case 'update_task_list': {
          const tasks = normalizeTasks(call.input.tasks)
          if (tasks.length === 0) {
            return {
              output: 'tasks must be a non-empty array of {title, status}',
              isError: true,
              summary: 'update_task_list',
            }
          }
          return {
            output: `task list updated: ${tasks.length} items`,
            summary: 'update_task_list',
          }
        }
        default:
          return { output: `Unknown tool: ${call.name}`, isError: true, summary: call.name }
      }
    },
    verifyResponse(finalText, executed) {
      const created = executed.some((c) => c.name === 'create_document' && c.ok)
      if (created) return null
      // 死胡同修复:create_document 曾被拒(正文缺失),模型随后把正文补在了
      // 末轮回复里却不再调工具 → 强制补一轮工具调用(正文工具会从历史里取)
      const attemptedFailed = executed.some((c) => c.name === 'create_document' && !c.ok)
      if (
        attemptedFailed &&
        (extractDocumentBody(finalText) ||
          markdownToRestrictedHtml(finalText) ||
          finalText.trim().replace(/\s/g, '').length >= MIN_DOC_BODY_CHARS)
      ) {
        return (
          'Your earlier create_document call failed because the body was not written yet. ' +
          'The full document body is now in your reply — call create_document again with the SAME title and type as that earlier attempt. ' +
          'Do not rewrite the body; the tool reads it from your reply. Just call the tool.'
        )
      }
      // claimed creation without a successful tool call → force the real call once
      const claimsCreate =
        /(已创建|已生成|已建立|create(d)? the document|document (has been|is) created)/i.test(
          finalText,
        )
      if (claimsCreate) {
        return 'You said the document was created, but create_document never ran successfully. If the body is already written in your previous reply, call create_document now with the title and type.'
      }
      return null
    },
  }
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])

/** update_task_list 入参 → 干净快照(空数组 = 非法/空清单) */
function normalizeTasks(
  raw: unknown,
): Array<{ title: string; status: 'pending' | 'in_progress' | 'done' }> {
  if (!Array.isArray(raw)) return []
  const out: Array<{ title: string; status: 'pending' | 'in_progress' | 'done' }> = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const { title, status } = item as { title?: unknown; status?: unknown }
    if (typeof title !== 'string' || !title.trim()) continue
    if (status !== 'pending' && status !== 'in_progress' && status !== 'done') continue
    out.push({ title: title.trim().slice(0, 80), status })
    if (out.length >= 20) break
  }
  return out
}

/** search_files/system_search 的 JSON 输出 → 命中文件(封顶 10,点击可打开) */
function parseFoundFiles(output: string): Array<{ name: string; path: string }> {
  let parsed: unknown
  try {
    parsed = JSON.parse(output)
  } catch {
    return []
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as { entries?: unknown }).entries)
      ? (parsed as { entries: unknown[] }).entries
      : []
  const out: Array<{ name: string; path: string }> = []
  const seen = new Set<string>()
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const { name, path } = item as { name?: unknown; path?: unknown }
    if (typeof path !== 'string' || !path || typeof name !== 'string' || !name) continue
    if (seen.has(path)) continue
    seen.add(path)
    out.push({ name, path })
    if (out.length >= 10) break
  }
  return out
}

/**
 * The home chat agent: one AgentLoop per session, with send queueing
 * (messages sent mid-run fire automatically when the run finishes) and a
 * stop button wired to the loop's cancel.
 */
export class HomeAgent {
  private readonly loop: AgentLoop
  private turnTextValue = ''
  private turnInstructionValue = ''
  private createdDoc: { title: string; docType: DocType } | null = null
  private openedDoc: { title: string; filePath: string } | null = null
  private queued: { text: string; attachments: HomeChatAttachment[] } | null = null
  /** external MCP: namespaced tool cache refreshed before every run (single-flight) */
  private mcpToolDefs: AgentToolDef[] = []
  private mcpBindings = new Map<string, McpToolBinding>()
  private mcpRefresh: Promise<void> | null = null
  /** the last generate_image result (display-only; drained into the tool card) */
  private pendingGenImage: string | null = null
  /** cached capability probe: a default image-gen model resolves from settings */
  private imageGenReady = false
  /** cached search-backend probe (web_search tool gate); true until a probe says otherwise */
  private searchReadyFlag = true
  private mediaFlags: MediaCapabilityFlags | null = null
  /** busy from send() until the run settles; loop.busy alone lags behind the
   *  pre-run awaits (attachment reads, MCP refresh) and would leave a gap
   *  where isBusy() reads false mid-start */
  private busyFlag = false

  constructor(
    private readonly bridge: HomeAgentBridge,
    private readonly events: HomeAgentEvents,
    texts: HomeAgentTexts,
    systemSuffix?: () => string,
    transport?: AgentTransport,
  ) {
    const skill = homeSkill(
      bridge,
      {
        turnText: () => this.turnTextValue,
        turnInstruction: () => this.turnInstructionValue,
        transcript: () =>
          this.loop.messages
            .filter(
              (m): m is Extract<AgentMessage, { text: string }> =>
                m.role !== 'tool' && Boolean(m.text.trim()),
            )
            .map((m) => ({ role: m.role, text: m.text }) as AgentMessage),
        onCreatedDoc: (info) => {
          this.createdDoc = info
        },
        onOpenedDoc: (info) => {
          this.openedDoc = info
        },
        mcp: {
          tools: () => this.mcpToolDefs,
          section: () => mcpSystemSection(this.mcpBindings),
          call: (wireName, input) => this.callMcpTool(wireName, input),
        },
        imageGenReady: () => this.imageGenReady,
        searchReady: () => this.searchReadyFlag,
        mediaFlags: () => this.mediaFlags,
        onGeneratedImage: (dataUrl) => {
          this.pendingGenImage = dataUrl
        },
      },
      texts,
    )
    this.loop = new AgentLoop({
      transport:
        transport ??
        createIpcTransport<AiModelSelection>({
          onStream: (listener) => bridge.onAiStream(listener),
          start: (request) => bridge.aiStream(request),
          cancel: (requestId) => void bridge.aiStreamCancel(requestId),
          getSettings: () => bridge.getCurrentModel(),
          unknownErrorText: () => texts.unknownError,
        }),
      skill,
      ...(systemSuffix ? { systemSuffix } : {}),
      events: {
        onText: (text) => {
          this.turnTextValue = text
          this.events.onText(text)
        },
        onToolStart: (call) => {
          // 任务清单不是时间线工具:start 不出 chip,只在 end 携带快照
          if (call.name === 'update_task_list') return
          this.events.onToolActivity?.({ callId: call.id, name: call.name, phase: 'start' })
        },
        onToolExecuted: ({ call, execution }) => {
          // 结构化补充:搜索命中文件(可点击打开)与任务清单快照(时间线之外的单列 UI)
          const files =
            call.name === 'search_files' || call.name === 'system_search'
              ? parseFoundFiles(execution.output)
              : undefined
          const tasks =
            call.name === 'update_task_list' ? normalizeTasks(call.input.tasks) : undefined
          const image = call.name === 'generate_image' ? this.pendingGenImage : undefined
          if (call.name === 'generate_image') this.pendingGenImage = null
          this.events.onToolActivity?.({
            callId: call.id,
            name: call.name,
            summary: execution.summary,
            phase: 'end',
            ok: !execution.isError,
            outputPreview: execution.output.slice(0, 120),
            ...(files && files.length > 0 ? { files } : {}),
            ...(tasks && tasks.length > 0 ? { tasks } : {}),
            ...(image ? { image } : {}),
          })
        },
        onDone: () => {
          this.busyFlag = false
          this.events.onBusy(false)
          this.events.onDone({
            text: this.turnTextValue,
            ...(this.createdDoc ? { createdDoc: this.createdDoc } : {}),
            ...(this.openedDoc ? { openedDoc: this.openedDoc } : {}),
          })
          this.flushQueue()
        },
        onError: (error) => {
          this.busyFlag = false
          this.events.onBusy(false)
          this.events.onError(error)
          this.flushQueue()
        },
      },
    })
    // warm the MCP tool list in the background so the first send already sees
    // the enabled servers' tools (start() re-refreshes before every run)
    if (this.bridge.listMcpTools) void this.ensureMcpTools()
    void this.probeMediaFlags()
    this.probeSearch()
  }

  /** warm the web_search gate (constructor + refreshed before every run) */
  private probeSearch(): void {
    if (!this.bridge.searchCapabilities) return
    void this.bridge.searchCapabilities().then(
      (r) => {
        this.searchReadyFlag = r.search
      },
      () => {},
    )
  }

  /** warm the per-kind capability flags (constructor + refreshed before every run) */
  private probeMediaFlags(): void {
    if (!this.bridge.mediaCapabilities) {
      // fall back to the image-only probe so generate_image still gates correctly
      void this.bridge.imageGenReady?.().then(
        (ready) => {
          this.imageGenReady = ready
        },
        () => {},
      )
      return
    }
    void this.bridge
      .mediaCapabilities()
      .then((flags) => {
        this.mediaFlags = flags
        this.imageGenReady = flags.image
      })
      .catch(() => {})
  }

  get busy(): boolean {
    return this.busyFlag || this.loop.busy
  }

  /** restore a persisted session's transcript into model context */
  restore(messages: AgentMessage[]): void {
    this.loop.restore(messages)
  }

  /** transcript snapshot for persistence / handoff */
  transcript(): AgentMessage[] {
    return [...this.loop.messages]
  }

  /** a mid-run send queues and fires when the run finishes (ChatGPT-style) */
  async send(
    text: string,
    attachments: HomeChatAttachment[] = [],
    kbBlock?: string,
  ): Promise<void> {
    if (this.loop.busy) {
      this.queued = { text, attachments }
      return
    }
    await this.start(text, attachments, kbBlock)
  }

  stop(): void {
    this.queued = null
    this.loop.cancel()
  }

  private flushQueue(): void {
    const next = this.queued
    this.queued = null
    if (next) void this.start(next.text, next.attachments)
  }
  // queued KB blocks are dropped with their turn (queue holds one send)

  /** fetch the enabled MCP servers' live tools (single-flight, failure = empty) */
  private ensureMcpTools(): Promise<void> {
    this.mcpRefresh ??= (async () => {
      if (!this.bridge.listMcpTools) return
      try {
        const built = buildMcpToolDefs(await this.bridge.listMcpTools())
        this.mcpToolDefs = built.tools
        this.mcpBindings = built.bindings
      } catch {
        this.mcpToolDefs = []
        this.mcpBindings = new Map()
      } finally {
        this.mcpRefresh = null
      }
    })()
    return this.mcpRefresh
  }

  /** relay a namespaced mcp__ call to its server; null when not an MCP tool */
  private async callMcpTool(
    wireName: string,
    input: Record<string, unknown>,
  ): Promise<{ output: string; isError?: boolean } | null> {
    const binding = this.mcpBindings.get(wireName)
    if (!binding) return null
    if (!this.bridge.callMcpTool) {
      return { output: 'MCP bridge unavailable', isError: true }
    }
    try {
      const result = await this.bridge.callMcpTool(binding.serverId, binding.toolName, input)
      return { output: result.output, isError: !result.ok }
    } catch (e) {
      return {
        output: `MCP call failed: ${e instanceof Error ? e.message : String(e)}`,
        isError: true,
      }
    }
  }

  private async start(
    text: string,
    attachments: HomeChatAttachment[],
    kbBlock?: string,
  ): Promise<void> {
    this.turnTextValue = ''
    this.turnInstructionValue = text
    this.createdDoc = null
    this.openedDoc = null
    this.busyFlag = true
    this.events.onBusy(true)
    this.events.onText('')
    const images: { base64: string; mime: string }[] = []
    const textBlocks: string[] = []
    try {
      for (const a of attachments) {
        if (IMAGE_EXTS.has(a.ext)) {
          const img = await this.bridge.readAttachmentImage(a.path)
          if (img.ok && img.base64 && img.mime) images.push({ base64: img.base64, mime: img.mime })
        } else {
          const r = await this.bridge.readAttachment(a.path, 0, 12_000)
          if (r.ok && r.text) {
            const more =
              (r.totalChars ?? 0) > r.text.length
                ? '\n[…truncated; read more with read_document]'
                : ''
            textBlocks.push(`[Attached file: ${a.name}]\n${r.text}${more}`)
          }
        }
      }
      const withKb = kbBlock ? `${text}\n\n${kbBlock}` : text
      const instruction = textBlocks.length ? `${withKb}\n\n${textBlocks.join('\n\n')}` : withKb
      // pick up MCP server changes (added/toggled in settings) for this run; a
      // cold stdio connect can take a while, so never block the send on it
      await Promise.race([
        this.ensureMcpTools().catch(() => {}),
        new Promise<void>((resolve) => window.setTimeout(resolve, 12_000)),
      ])
      // capability probe (生图、媒体与搜索 defaults) — generate_image joins the
      // toolset only when a default image model resolves
      if (this.bridge.mediaCapabilities) {
        try {
          this.mediaFlags = await this.bridge.mediaCapabilities()
          this.imageGenReady = this.mediaFlags.image
        } catch {
          this.mediaFlags = null
        }
      } else if (this.bridge.imageGenReady) {
        try {
          this.imageGenReady = await this.bridge.imageGenReady()
        } catch {
          this.imageGenReady = false
        }
      }
      // web_search 门控(搜索通道可用性):无 key 且免 key 兜底不可达时收起
      // 工具,模型用自身知识作答 —— 配好 key 后下一次发送即刻恢复
      if (this.bridge.searchCapabilities) {
        try {
          this.searchReadyFlag = (await this.bridge.searchCapabilities()).search
        } catch {
          /* keep the last known gate state */
        }
      }
      this.loop.run(instruction, images)
    } catch (e) {
      this.busyFlag = false
      this.events.onBusy(false)
      this.events.onError(e instanceof Error ? e.message : String(e))
      this.flushQueue()
    }
  }
}
