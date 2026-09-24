import { AgentLoop, composeSkills, type AgentMessage } from '@chatoffice/agent-core'
import type { Editor } from '@tiptap/core'
import type { AiImageSource, AiSettingsV2 } from '@chatoffice/ai-provider'
import type { PmNode } from '../editor/convert'
import type { NumIds } from './protocol'
import type { AiCommentsAccess, AiHeaderFooterAccess } from './tools'
import { createDocsSkill } from './docs-skill'
import { createFilesSkill } from './files-skill'
import { createElectronTransport } from './transport'
import { RelayConfirmGate } from './relay-confirm'
import { createRelayExtrasSkill, type RelayProjectListing } from './relay-extras'
import {
  isRelayCommand,
  RELAY_PREVIEW_LIMIT,
  type RelayCommand,
  type RelayDockDocInfo,
  type RelayEvent,
  type RelaySeedMessage,
} from '../../../../shell/src/shared/relay-protocol'

/**
 * P2 中继服务(方案 B 双 loop 中继):停靠在首页右栏的文档,其对话由首页
 * 中栏驱动——这里持有文档**自己的 AgentLoop**(与 AiPanel 的 loop 同款
 * skill 组合),经 IPC 收 RelayCommand、发 RelayEvent。面板隐藏时本服务是
 * 文档唯一的对话回路;面板弹出后与面板 loop 并存(各自轮次都写 per-file
 * 历史,见 P2-5 回流钩)。
 *
 * 上游红线:本文件是新增文件,AiPanel/loop 内部结构零改动。
 */

export interface DocsRelayDeps {
  /** live tiptap editor (same instance the panel's skill uses) */
  getEditor: () => Editor | null
  getNumIds: () => NumIds
  getComments: () => AiCommentsAccess
  getHf: () => AiHeaderFooterAccess
  getImageSource: () => AiImageSource
  getSettings: () => AiSettingsV2
  /** i18n directive appended as system suffix (same text the panel uses) */
  systemSuffix: string
}

export interface DocsRelayServer {
  /**
   * T3 排版接力: run one LOCAL turn on the doc loop (the boot-time formatting
   * pass seeded by create_document). Emits the same turn events as a relayed
   * 'send' (the Home conversation mirrors them). Returns false while a turn is
   * in flight — callers degrade silently, the document content stands.
   */
  runLocal(text: string): boolean
  dispose(): void
}

/**
 * The one-shot formatting prompt for the boot relay (T3): the document body is
 * already written; this turn only applies the layout the user asked for.
 * Self-contained — it does not assume the mainline seed has landed.
 */
export function formattingRelayPrompt(instruction: string): string {
  return (
    'Apply the formatting the user asked for to the CURRENT document (read it from the ' +
    'editor): fonts, font sizes, table of contents, page numbers, clickable navigation ' +
    'and any other layout asks in the request below. Do NOT rewrite, expand or ' +
    're-translate the content — only apply formatting. If the request asks for nothing ' +
    'formatting-related, reply with a single short sentence and touch nothing.\n\n' +
    `The user's original request:\n${instruction}`
  )
}

function emit(event: RelayEvent): void {
  // relaySend is injected by the docs preload (desktop bridge); guard for
  // standalone docs windows where the relay never boots
  void (window.desktop as unknown as { relaySend?: (e: RelayEvent) => void }).relaySend?.(event)
}

const preview = (text: string | undefined): string | undefined =>
  text ? text.slice(0, RELAY_PREVIEW_LIMIT) : undefined

export function startDocsRelayServer(deps: DocsRelayDeps): DocsRelayServer {
  let currentTurnId: string | null = null
  /** P2-7 确认门(propose_outline/plan 挂起处) */
  const confirmGate = new RelayConfirmGate()
  /** P2-6 残项:Home 经 sync-docs 推送的停靠文档清单(activate_document 的依据) */
  let dockedDocs: RelayDockDocInfo[] = []
  /** P4 项目引用:Home 经 sync-project 推送的项目文件清单(null=无项目) */
  let projectListing: RelayProjectListing | null = null

  const loop = new AgentLoop<PmNode>({
    transport: createElectronTransport(() => deps.getSettings().currentModel!),
    systemSuffix: () => deps.systemSuffix,
    skill: composeSkills('docs+files+relay', '', [
      createDocsSkill(
        () => deps.getEditor()!,
        deps.getNumIds,
        () => undefined,
        deps.getComments,
        deps.getHf,
        deps.getImageSource,
      ),
      createFilesSkill(() => []),
      createRelayExtrasSkill({
        gate: confirmGate,
        emit: emit,
        turnId: () => currentTurnId,
        docsListing: () => dockedDocs,
        projectListing: () => projectListing,
        // files:read — 与首页 agent 同一抽取管线(ATTACHMENT 白名单内)
        readDocumentFile: (path, offset, maxChars) =>
          window.desktop.readAttachment(path, offset, maxChars),
      }),
    ]),
    events: {
      onText: (text) => {
        if (currentTurnId) emit({ type: 'text', turnId: currentTurnId, text })
      },
      onToolStart: (call) => {
        if (!currentTurnId) return
        emit({
          type: 'tool',
          turnId: currentTurnId,
          activity: {
            callId: call.id,
            name: call.name,
            summary: call.name.replace(/[_-]+/g, ' '),
            phase: 'start',
          },
        })
      },
      onToolExecuted: ({ call, execution }) => {
        if (!currentTurnId) return
        emit({
          type: 'tool',
          turnId: currentTurnId,
          activity: {
            callId: call.id,
            name: call.name,
            summary: call.name.replace(/[_-]+/g, ' '),
            phase: 'end',
            ok: !execution.isError,
            outputPreview: preview(execution.output),
          },
        })
      },
      onError: (message) => {
        emit({ type: 'error', turnId: currentTurnId, message })
        currentTurnId = null
        emit({ type: 'busy', busy: false })
      },
      onDone: () => {
        if (currentTurnId) emit({ type: 'turn-finished', turnId: currentTurnId })
        currentTurnId = null
        emit({ type: 'busy', busy: false })
      },
    },
  })

  // P2-6 圈选标注:选区变化(防抖)经 context 事件上报首页,中栏显示
  // 「针对所选」提示;空选区发空 text 清提示。选区监听挂在本服务的 loop
  // 依赖的 editor 实例上,与面板互不干扰。
  let selectionTimer: ReturnType<typeof setTimeout> | undefined
  const onSelectionUpdate = (): void => {
    clearTimeout(selectionTimer)
    selectionTimer = setTimeout(() => {
      const editor = deps.getEditor()
      if (!editor) return
      const { from, to, empty } = editor.state.selection
      if (empty) {
        emit({ type: 'context', context: { text: '', kind: 'selection' } })
        return
      }
      const text = editor.state.doc.textBetween(from, to, '\n')
      if (text.trim())
        emit({
          type: 'context',
          context: { text: text.slice(0, RELAY_PREVIEW_LIMIT), kind: 'selection' },
        })
    }, 300)
  }
  deps.getEditor()?.on('selectionUpdate', onSelectionUpdate)

  /** one relayed turn on the doc loop (shared by 'send' and runLocal) */
  const startTurn = (text: string): boolean => {
    // 首页在忙时会排队(dockRelay 队列),这里收到 send 即非忙;竞态
    // 双发时丢弃后者(主线镜像以事件流为准,不重复入镜像)。
    if (loop.busy) return false
    currentTurnId = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    emit({ type: 'turn-started', turnId: currentTurnId })
    emit({ type: 'busy', busy: true })
    void loop.run(text)
    return true
  }

  const handle = (command: RelayCommand): void => {
    // 诊断口径:命令到达与载荷规模(端到端验收经 CDP console 捕获)
    console.debug(
      '[docs-relay] command:',
      command.type,
      command.type === 'seed' ? `n=${command.messages.length}` : '',
      command.type === 'sync-docs' ? `docs=${command.docs.length}` : '',
      command.type === 'sync-project' ? `files=${command.files.length}` : '',
    )
    switch (command.type) {
      case 'seed': {
        // 铁律(Q4''):文档 loop 上下文=主线转录的确定性函数——每次种子
        // 都是 reset+重放(主线镜像含历史中继轮次,重放无损);这让切文档
        // /杀视图重开的重种子与首次种子同一条路径。reset 硬杀在飞轮次
        // (generation 守卫丢弃其迟到事件),确认门先落地防 await 吊死。
        confirmGate.rejectAll('the conversation was re-seeded')
        if (currentTurnId) {
          emit({ type: 'turn-finished', turnId: currentTurnId })
          currentTurnId = null
          emit({ type: 'busy', busy: false })
        }
        const messages: AgentMessage[] = command.messages.map((m: RelaySeedMessage) => ({
          role: m.role,
          text: m.text,
        }))
        loop.reset()
        loop.restore(messages)
        break
      }
      case 'send': {
        startTurn(command.text)
        break
      }
      case 'stop': {
        confirmGate.rejectAll('stopped by the user')
        loop.cancel()
        break
      }
      case 'confirm': {
        confirmGate.resolve(command.confirmId, {
          approved: command.approved,
          feedback: command.feedback,
        })
        break
      }
      case 'sync-docs': {
        dockedDocs = command.docs
        break
      }
      case 'sync-project': {
        projectListing = command.files.length
          ? { files: command.files, ...(command.name ? { name: command.name } : {}) }
          : null
        break
      }
    }
  }

  const offCommand = (
    window.desktop as unknown as {
      onRelayCommand?: (handler: (command: unknown) => void) => () => void
    }
  ).onRelayCommand?.((raw) => {
    if (isRelayCommand(raw)) handle(raw)
  })

  return {
    runLocal: startTurn,
    dispose() {
      offCommand?.()
      clearTimeout(selectionTimer)
      deps.getEditor()?.off('selectionUpdate', onSelectionUpdate)
      confirmGate.rejectAll('the relay server is disposed')
      loop.cancel()
    },
  }
}
