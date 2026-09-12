import type { AgentSkill, AgentToolCall, ToolExecution } from '@chatoffice/agent-core'
import type {
  RelayDockDocInfo,
  RelayEvent,
  RelaySwitchRequest,
} from '../../../../shell/src/shared/relay-protocol'
import type { RelayConfirmGate } from './relay-confirm'

/**
 * P2 中继附加技能(新增文件,不碰 docs-skill——上游红线):仅停靠态的
 * relay-server 会挂载。两件事:
 *
 * 1. 确认门(Q7 生成体验):propose_outline / propose_plan 在动手前把
 *    大纲/计划发给用户,loop 挂起等首页的批准/驳回;驳回带反馈时模型
 *    按反馈修订再提,不直接产出。
 * 2. dock 切换(Q4'' 第③条):activate_document 让模型把对话焦点切到
 *    另一份停靠文档;清单由 Home 经 sync-docs 推送,buildContext 里
 *    始终可见(模型的眼),activate 是手。
 */

export interface RelayExtrasDeps {
  gate: RelayConfirmGate
  emit: (event: RelayEvent) => void
  /** 当前 turn id(confirm-request 事件的归因键) */
  turnId: () => string | null
  /** Home 同步来的停靠文档清单 */
  docsListing: () => RelayDockDocInfo[]
}

const GATE_SYSTEM_PROMPT = `## Relay extensions (docked-home conversation only)
- Before authoring a NEW document from scratch (report/letter/long article), call propose_outline with a short markdown outline first and WAIT for the user's decision. If they reject it, revise the outline per their feedback and propose again — never start writing after a rejection. Only after approval write the document.
- Before a multi-step restructuring of the CURRENT document (reorder chapters, merge/split sections, restyle globally), call propose_plan with the numbered steps and wait for approval; apply only after approval.
- Several documents may be docked beside this one. Their list appears in the context. Use activate_document to shift the conversation's focus to another docked document before editing it; after activating, continue the user's request against that document.`

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
    ],
    buildContext: () => {
      const docs = deps.docsListing()
      if (docs.length === 0) return ''
      const lines = docs.map(
        (d) =>
          `- ${d.title}${d.active ? ' (active)' : ''}${d.filePath ? ` | ${d.filePath}` : ''} | ${d.kind}`,
      )
      return `Docked documents in this workspace:\n${lines.join('\n')}`
    },
    executeTool: async (call, signal) => {
      switch (call.name) {
        case 'propose_outline':
          return outlineGate(deps, call, 'outline', signal)
        case 'propose_plan':
          return outlineGate(deps, call, 'plan', signal)
        case 'activate_document':
          return activateDocument(deps, call)
        default:
          return fail(call.name, `unknown tool: ${call.name}`)
      }
    },
  }
}
