import { AgentLoop, composeSkills, type AgentMessage } from '@chatoffice/agent-core'
import type { Editor } from '@tiptap/core'
import type { AiImageSource, AiSettingsV2 } from '@chatoffice/ai-provider'
import type { PmNode } from '../editor/convert'
import type { NumIds } from './protocol'
import type { AiCommentsAccess, AiHeaderFooterAccess } from './tools'
import { createDocsSkill } from './docs-skill'
import { createFilesSkill } from './files-skill'
import { createElectronTransport } from './transport'
import {
  isRelayCommand,
  RELAY_PREVIEW_LIMIT,
  type RelayCommand,
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
  dispose(): void
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

  const loop = new AgentLoop<PmNode>({
    transport: createElectronTransport(() => deps.getSettings().currentModel!),
    systemSuffix: () => deps.systemSuffix,
    skill: composeSkills('docs+files', '', [
      createDocsSkill(
        () => deps.getEditor()!,
        deps.getNumIds,
        () => undefined,
        deps.getComments,
        deps.getHf,
        deps.getImageSource,
      ),
      createFilesSkill(() => []),
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

  const handle = (command: RelayCommand): void => {
    switch (command.type) {
      case 'seed': {
        // 铁律入口:项目主线转录一次种进本 loop(Q4'')
        const messages: AgentMessage[] = command.messages.map((m: RelaySeedMessage) => ({
          role: m.role,
          text: m.text,
        }))
        loop.restore(messages)
        break
      }
      case 'send': {
        if (loop.busy) return
        currentTurnId = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        emit({ type: 'turn-started', turnId: currentTurnId })
        emit({ type: 'busy', busy: true })
        void loop.run(command.text)
        break
      }
      case 'stop': {
        loop.cancel()
        break
      }
      case 'confirm': {
        // docs 工具集当前无确认门(P2-7 接入大纲确认门时落地);决议暂记
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
    dispose() {
      offCommand?.()
      loop.cancel()
    },
  }
}
