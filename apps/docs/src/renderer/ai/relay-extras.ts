import type { AgentSkill, AgentToolCall, ToolExecution } from '@chatoffice/agent-core'
import type {
  RelayDockDocInfo,
  RelayEvent,
  RelaySwitchRequest,
} from '../../../../shell/src/shared/relay-protocol'
import type { RelayConfirmGate } from './relay-confirm'

/**
 * P2 中继附加技能(新增文件,不碰 docs-skill——上游红线):仅停靠态的
 * relay-server 会挂载。三件事:
 *
 * 1. 确认门(Q7 生成体验):propose_outline / propose_plan 在动手前把
 *    大纲/计划发给用户,loop 挂起等首页的批准/驳回;驳回带反馈时模型
 *    按反馈修订再提,不直接产出。
 * 2. dock 切换(Q4'' 第③条):activate_document 让模型把对话焦点切到
 *    另一份停靠文档;清单由 Home 经 sync-docs 推送,buildContext 里
 *    始终可见(模型的眼),activate 是手。
 * 3. 项目引用(P4):search_project_files / read_document 让文档 loop
 *    能读同项目其他文档的内容(用户指定目录的项目同样生效)——清单由
 *    Home 经 sync-project 推送。
 */

export interface RelayProjectListing {
  name?: string
  files: string[]
}

export interface RelayExtrasDeps {
  gate: RelayConfirmGate
  emit: (event: RelayEvent) => void
  /** 当前 turn id(confirm-request 事件的归因键) */
  turnId: () => string | null
  /** Home 同步来的停靠文档清单 */
  docsListing: () => RelayDockDocInfo[]
  /** Home 同步来的项目文件清单(null=会话不属于任何项目) */
  projectListing: () => RelayProjectListing | null
  /** 读任意本地文档的抽取文本(files:read,与首页 agent 同一管线) */
  readDocumentFile: (
    path: string,
    offset: number,
    maxChars: number,
  ) => Promise<{
    ok: boolean
    name?: string
    totalChars?: number
    offset?: number
    text?: string
    error?: string
  }>
}

const GATE_SYSTEM_PROMPT = `## Relay extensions (docked-home conversation only)
- Before authoring a NEW document from scratch (report/letter/long article), call propose_outline with a short markdown outline first and WAIT for the user's decision. If they reject it, revise the outline per their feedback and propose again — never start writing after a rejection. Only after approval write the document.
- Before a multi-step restructuring of the CURRENT document (reorder chapters, merge/split sections, restyle globally), call propose_plan with the numbered steps and wait for approval; apply only after approval.
- Several documents may be docked beside this one. Their list appears in the context. Use activate_document to shift the conversation's focus to another docked document before editing it; after activating, continue the user's request against that document.
- This conversation belongs to a project. Other files of the project appear in the context ("Project files"). Use search_project_files to locate one by name and read_document to read its content when the task needs to reference or incorporate other documents (quotations, data lookups, cross-references). Never claim you cannot access other project files before trying.`

function fail(name: string, message: string): ToolExecution {
  return { output: message, isError: true, summary: name }
}

function outlineGate(
  deps: RelayExtrasDeps,
  call: AgentToolCall,
  kind: 'outline' | 'plan',
  signal?: AbortSignal,
): Promise<ToolExecution> {
  const payload = String(call.input.payload ?? '').trim()
  if (!payload) return Promise.resolve(fail(call.name, 'payload must not be empty'))
  const turnId = deps.turnId()
  if (!turnId)
    return Promise.resolve(fail(call.name, 'no relay turn is running; do not use this tool now'))
  return deps.gate
    .request(turnId, kind, payload, (request) => {
      deps.emit({ type: 'confirm-request', turnId, request })
    })
    .then((decision): ToolExecution => {
      if (signal?.aborted) return fail(call.name, 'stopped by the user before the decision arrived')
      if (decision.approved) {
        return {
          output: decision.feedback
            ? `The user APPROVED with a note: "${decision.feedback}". Proceed accordingly.`
            : 'The user APPROVED. Proceed now.',
          summary: `${kind} confirmed`,
        }
      }
      return {
        output: `The user REJECTED. Do NOT proceed with writing or applying anything. ${
          decision.feedback ? `Their feedback: "${decision.feedback}". ` : ''
        }Revise the ${kind} based on the feedback and propose it again, or ask a clarifying question if the feedback is unclear.`,
        summary: `${kind} rejected`,
      }
    })
}

function activateDocument(deps: RelayExtrasDeps, call: AgentToolCall): ToolExecution {
  const target = String(call.input.document ?? '').trim()
  if (!target) return fail(call.name, 'document must not be empty')
  const docs = deps.docsListing()
  const hit =
    docs.find((d) => (d.filePath ?? '') === target) ??
    docs.find((d) => d.title === target) ??
    docs.find((d) => d.title.toLowerCase().includes(target.toLowerCase()))
  if (!hit)
    return fail(
      call.name,
      `no docked document matches "${target}". Docked documents: ${
        docs.map((d) => d.title).join(', ') || '(none)'
      }`,
    )
  const turnId = deps.turnId()
  if (turnId) {
    const sw: RelaySwitchRequest = { title: hit.title }
    if (hit.filePath) sw.filePath = hit.filePath
    deps.emit({ type: 'switch-request', turnId, switch: sw })
  }
  return {
    output: `Requested the workspace to activate "${hit.title}". The next user message will drive that document; finish this turn by summarizing what you did here.`,
    summary: `activate ${hit.title}`,
  }
}

function searchProjectFiles(deps: RelayExtrasDeps, call: AgentToolCall): ToolExecution {
  const query = String(call.input.query ?? '')
    .trim()
    .toLowerCase()
  const ext = typeof call.input.ext === 'string' ? call.input.ext.toLowerCase() : ''
  const listing = deps.projectListing()
  if (!listing || listing.files.length === 0)
    return fail(call.name, 'this conversation has no project file list (no project scope)')
  const hits = listing.files
    .map((path) => {
      const name = path.split(/[\\/]/).pop() ?? path
      return { name, path, ext: name.split('.').pop()?.toLowerCase() ?? '' }
    })
    .filter((f) => (!ext || f.ext === ext) && (!query || f.name.toLowerCase().includes(query)))
    .slice(0, 20)
  return {
    output: hits.length
      ? JSON.stringify(hits)
      : JSON.stringify({ results: [], hint: 'no project file matches; try a shorter query' }),
    summary: `search_project_files${query ? ` "${query}"` : ''}`,
  }
}

async function readProjectDocument(
  deps: RelayExtrasDeps,
  call: AgentToolCall,
): Promise<ToolExecution> {
  const path = String(call.input.path ?? '')
  if (!path) return fail(call.name, 'path must not be empty')
  const offset = Number(call.input.offset) || 0
  const maxChars = Math.min(Number(call.input.maxChars) || 12_000, 48_000)
  const result = await deps.readDocumentFile(path, offset, maxChars)
  if (!result.ok) return fail(call.name, result.error ?? 'read failed')
  return {
    output: JSON.stringify({
      name: result.name,
      totalChars: result.totalChars,
      offset: result.offset,
      text: result.text,
    }),
    summary: `read ${result.name ?? path}`,
  }
}

export function createRelayExtrasSkill(deps: RelayExtrasDeps): AgentSkill {
  return {
    id: 'relay-extras',
    systemPrompt: GATE_SYSTEM_PROMPT,
    tools: [
      {
        name: 'propose_outline',
        description:
          'Propose a document outline for the user to approve BEFORE writing a new document. payload = markdown outline (short headings + one-line notes). The turn suspends until the user approves or rejects it in the home chat.',
        inputSchema: {
          type: 'object',
          properties: {
            payload: { type: 'string', description: 'markdown outline to confirm' },
          },
          required: ['payload'],
        },
      },
      {
        name: 'propose_plan',
        description:
          'Propose a numbered plan for a multi-step restructuring of the current document and wait for user approval BEFORE applying any of it. payload = markdown plan.',
        inputSchema: {
          type: 'object',
          properties: {
            payload: { type: 'string', description: 'markdown plan to confirm' },
          },
          required: ['payload'],
        },
      },
      {
        name: 'activate_document',
        description:
          'Switch the conversation focus to another docked document (by its exact title or file path from the docked-documents list). Use before editing a different docked document.',
        inputSchema: {
          type: 'object',
          properties: {
            document: {
              type: 'string',
              description: 'target document title or file path (from the docked-documents list)',
            },
          },
          required: ['document'],
        },
      },
      {
        name: 'search_project_files',
        description:
          "Search the conversation's project files by name (all files of the project this conversation belongs to, including a user-bound folder). Returns a JSON list of {name, path, ext}.",
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
      },
      {
        name: 'read_document',
        description:
          'Read the extracted text of another project file (path from search_project_files or the project-files context). Long documents are paged: use offset (characters) to continue.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'absolute file path from search_project_files' },
            offset: { type: 'number', description: 'character offset to start from (default 0)' },
            maxChars: { type: 'number', description: 'slice length, max 48000 (default 12000)' },
          },
          required: ['path'],
        },
      },
    ],
    buildContext: () => {
      const sections: string[] = []
      const docs = deps.docsListing()
      if (docs.length > 0) {
        const lines = docs.map(
          (d) =>
            `- ${d.title}${d.active ? ' (active)' : ''}${d.filePath ? ` | ${d.filePath}` : ''} | ${d.kind}`,
        )
        sections.push(`Docked documents in this workspace:\n${lines.join('\n')}`)
      }
      const listing = deps.projectListing()
      if (listing && listing.files.length > 0) {
        // cap the listing: paths repeat the project dir, names carry the signal
        const names = listing.files.slice(0, 80).map((p) => p.split(/[\\/]/).pop() ?? p)
        const more = listing.files.length - names.length
        sections.push(
          `Project${listing.name ? ` "${listing.name}"` : ''} files (${listing.files.length}) — reference them with search_project_files + read_document:\n- ${names.join('\n- ')}${more > 0 ? `\n- …and ${more} more (search by name)` : ''}`,
        )
      }
      return sections.join('\n\n')
    },
    executeTool: async (call, signal) => {
      switch (call.name) {
        case 'propose_outline':
          return outlineGate(deps, call, 'outline', signal)
        case 'propose_plan':
          return outlineGate(deps, call, 'plan', signal)
        case 'activate_document':
          return activateDocument(deps, call)
        case 'search_project_files':
          return searchProjectFiles(deps, call)
        case 'read_document':
          return readProjectDocument(deps, call)
        default:
          return fail(call.name, `unknown tool: ${call.name}`)
      }
    },
  }
}
