import { AgentLoop, createIpcTransport } from '@chatoffice/agent-core'
import type { AgentMessage, AgentSkill, AgentTransport } from '@chatoffice/agent-core'
import type { AiModelSelection } from '@chatoffice/ai-provider'
import type { HomeApi, HomeChatAttachment } from '../../../shared/home-api'

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
}

export interface HomeAgentEvents {
  /** cumulative assistant text of the in-flight turn */
  onText(text: string): void
  onBusy(busy: boolean): void
  onDone(result: {
    text: string
    createdDoc?: { title: string; docType: 'docx' | 'md' }
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
    "Create the document whose full body you have JUST written as this turn's reply text, then open it in a new tab. " +
    "Call this ONLY after writing the complete body. type 'docx' (default) takes the restricted-HTML body; 'md' takes the Markdown body.",
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'document title, used as the file name' },
      type: {
        type: 'string',
        enum: ['docx', 'md'],
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

const SYSTEM_PROMPT = `You are the ChatOffice home assistant. You create documents, answer questions, and work with the user's existing files.

## Creating documents
When the user asks to create/write a document (report, plan, letter, summary, note, ...):
1. Write the FULL document body as your reply text in this very turn:
   - Word document (.docx, the default): a restricted HTML fragment using only <h1>-<h3>, <p>, <ul>/<ol>/<li>, <blockquote>, <pre>, <table>/<thead>/<tbody>/<tr>/<th>/<td>, <strong>/<em>/<u>/<s>, <br>. No <html>/<head>/<body> wrappers, no attributes except colspan/rowspan on table cells.
   - Markdown file (.md, only when the user explicitly asks for Markdown): plain Markdown source.
2. Then, in the SAME turn, call create_document with just the title and type. Never pass the body as a tool argument — your reply text becomes the file content verbatim.
3. After the tool succeeds the document opens in a new tab automatically and the conversation continues there. Do not repeat the body afterwards; a single short closing sentence is enough.

Never stall by asking for details: when something is unspecified, make a reasonable choice and proceed. Infer a concise file-name-style title from the request when none is given. Default to docx unless the user says Markdown.

## Working with existing files
- search_files locates files by name; read_document reads their text (page long files with offset); open_document opens a file in its editor tab.
- To EDIT an existing document: open_document it, then the editing continues in that tab's AI panel (the conversation moves with it). For files open_document cannot carry the conversation to (xlsx/pptx/pdf), tell the user the file was opened and they can continue with the AI panel there.
- Never claim you cannot access files before trying search_files.

## Answering questions
Reply directly in concise Markdown.`

/** turn texts below this length cannot be a document body — the model skipped step 1 */
const MIN_DOC_BODY_CHARS = 50

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

function homeSkill(
  bridge: HomeAgentBridge,
  state: {
    turnText: () => string
    transcript: () => AgentMessage[]
    onCreatedDoc(info: { title: string; docType: 'docx' | 'md' }): void
    onOpenedDoc(info: { title: string; filePath: string }): void
  },
  texts: HomeAgentTexts,
): AgentSkill {
  return {
    id: 'home',
    systemPrompt: SYSTEM_PROMPT,
    tools: [CREATE_DOC_TOOL, SEARCH_FILES_TOOL, READ_DOCUMENT_TOOL, OPEN_DOCUMENT_TOOL],
    async executeTool(call) {
      switch (call.name) {
        case 'create_document': {
          const title = String(call.input.title ?? '').trim()
          if (!title)
            return { output: 'title must not be empty', isError: true, summary: 'create_document' }
          const docType: 'docx' | 'md' = call.input.type === 'md' ? 'md' : 'docx'
          const body = state.turnText().trim()
          if (body.length < MIN_DOC_BODY_CHARS) {
            return { output: texts.docBodyMissing, isError: true, summary: 'create_document' }
          }
          // 惰性建项目: an unattached session's first document creates the
          // project (named after the conversation) and re-scopes the session
          let projectId: string | null | undefined
          if (bridge.ensureProject) {
            try {
              projectId = await bridge.ensureProject(title)
            } catch {
              projectId = null
            }
          }
          const result = await bridge.createDocument({
            type: docType,
            title,
            content: body,
            ...(projectId ? { projectId } : {}),
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
        default:
          return { output: `Unknown tool: ${call.name}`, isError: true, summary: call.name }
      }
    },
    verifyResponse(finalText, executed) {
      const created = executed.some((c) => c.name === 'create_document' && c.ok)
      if (created) return null
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

/**
 * The home chat agent: one AgentLoop per session, with send queueing
 * (messages sent mid-run fire automatically when the run finishes) and a
 * stop button wired to the loop's cancel.
 */
export class HomeAgent {
  private readonly loop: AgentLoop
  private turnTextValue = ''
  private createdDoc: { title: string; docType: 'docx' | 'md' } | null = null
  private openedDoc: { title: string; filePath: string } | null = null
  private queued: { text: string; attachments: HomeChatAttachment[] } | null = null

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
        onDone: () => {
          this.events.onBusy(false)
          this.events.onDone({
            text: this.turnTextValue,
            ...(this.createdDoc ? { createdDoc: this.createdDoc } : {}),
            ...(this.openedDoc ? { openedDoc: this.openedDoc } : {}),
          })
          this.flushQueue()
        },
        onError: (error) => {
          this.events.onBusy(false)
          this.events.onError(error)
          this.flushQueue()
        },
      },
    })
  }

  get busy(): boolean {
    return this.loop.busy
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
  async send(text: string, attachments: HomeChatAttachment[] = []): Promise<void> {
    if (this.loop.busy) {
      this.queued = { text, attachments }
      return
    }
    await this.start(text, attachments)
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

  private async start(text: string, attachments: HomeChatAttachment[]): Promise<void> {
    this.turnTextValue = ''
    this.createdDoc = null
    this.openedDoc = null
    this.events.onBusy(true)
    this.events.onText('')
    const images: { base64: string; mime: string }[] = []
    const textBlocks: string[] = []
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
    const instruction = textBlocks.length ? `${text}\n\n${textBlocks.join('\n\n')}` : text
    this.loop.run(instruction, images)
  }
}
