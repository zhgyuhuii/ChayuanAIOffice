/**
 * 中继事件契约(P2,已签方案 B 双 loop 中继+Q4'' 铁律)。
 *
 * 一条会话里,首页对话把用户消息转发给**激活文档自己的 AgentLoop**(编辑器
 * 进程内),回复与工具活动以事件流回首页气泡。两个方向的形状:
 *
 * - RelayCommand  首页 → 编辑器:send/stop/seed(主线转录种子化)/confirm(决议)
 * - RelayEvent    编辑器 → 首页:turn 生命周期/累积文本/工具活动/确认请求/
 *   快照锚点/上下文上报(选区)/错误/busy
 *
 * 表现力纪律:首页停靠态对话 UI 能展示的一切,都必须由 RelayEvent 承载——
 * 这份 schema 就是壳的表现力上限(按 docs 面板现有 UI 能力反推:消息流、
 * 工具执行记录、确认/澄清、快照回滚锚点、错误条)。
 *
 * 传输无关:Electron 走主进程中转(wc id 路由),web 走 postMessage;
 * 两宿主共用本文件的类型与守卫。
 */

/** 主线转录的种子条目(确定性重放的原料,只带 role+text) */
export interface RelaySeedMessage {
  role: 'user' | 'assistant'
  text: string
}

/** 工具活动卡片:首页气泡里的工具时间线条目 */
export interface RelayToolActivity {
  callId: string
  name: string
  /** 简短摘要(如 "create_document"),i18n 由壳决定 */
  summary?: string
  phase: 'start' | 'end'
  /** phase=end 时携带 */
  ok?: boolean
  /** 预览文本(截断由发送方负责,契约上限 2000 字符) */
  outputPreview?: string
}

/** 确认请求:编辑器 loop 需要用户裁决时发(kind 决定首页的卡片形态) */
export interface RelayConfirmRequest {
  confirmId: string
  kind: 'ops' | 'plan' | 'outline'
  /** ops: 待应用的变更摘要;plan/outline: 计划或大纲文本(markdown) */
  payload: string
}

/** 快照锚点:一轮落定后的文档快照引用(首页可发起回滚) */
export interface RelaySnapshot {
  turnId: string
  snapshotId: string
  /** 回滚入口的展示名(如 "应用 4 处修改前") */
  label?: string
}

/** 编辑器 → 首页的反向上报(选区圈选标注等) */
export interface RelayContextReport {
  /** 选中文本(截断由发送方负责,上限 2000);空串=选区收起,首页清提示 */
  text: string
  /** 编辑器自述的上下文种类(自由标记,首页只透传展示) */
  kind?: string
}

/** dock 切换工具(P2-6 残项):文档 loop 请求首页激活/停靠另一份文档 */
export interface RelaySwitchRequest {
  /** 目标文件绝对路径(sync-docs 清单里给出的 filePath) */
  filePath?: string
  /** 目标文档名(sync-docs 清单里的 title;无 filePath 时的匹配键) */
  title?: string
}

/** Home → 编辑器的停靠文档清单同步(模型跨文档操作的眼与手) */
export interface RelayDockDocInfo {
  title: string
  filePath?: string
  kind: string
  active: boolean
}

export type RelayEvent =
  | { type: 'turn-started'; turnId: string }
  | { type: 'text'; turnId: string; text: string }
  | { type: 'tool'; turnId: string; activity: RelayToolActivity }
  | { type: 'confirm-request'; turnId: string; request: RelayConfirmRequest }
  | { type: 'snapshot'; turnId: string; snapshot: RelaySnapshot }
  | { type: 'context'; context: RelayContextReport }
  | { type: 'switch-request'; turnId: string; switch: RelaySwitchRequest }
  | { type: 'error'; turnId: string | null; message: string }
  | { type: 'busy'; busy: boolean }
  | { type: 'turn-finished'; turnId: string }

export type RelayCommand =
  | { type: 'send'; text: string }
  | { type: 'stop' }
  /** 种子化:把项目主线的转录一次种进编辑器 loop(Q4'' 铁律的入口) */
  | { type: 'seed'; messages: RelaySeedMessage[] }
  /** 用户对确认请求的决议(批准/驳回+反馈) */
  | { type: 'confirm'; confirmId: string; approved: boolean; feedback?: string }
  /** 停靠文档清单同步:tab 开/关/切换/改名时推送,供跨文档工具参考 */
  | { type: 'sync-docs'; docs: RelayDockDocInfo[] }
  /** 项目文件清单同步(P4 项目引用):文档 loop 跨文档引用的眼与手 */
  | { type: 'sync-project'; files: string[]; name?: string }

export const RELAY_PREVIEW_LIMIT = 2000

export function isRelayEvent(value: unknown): value is RelayEvent {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  switch (v.type) {
    case 'turn-started':
    case 'turn-finished':
    case 'text':
      return typeof v.turnId === 'string' && (v.type === 'text' ? typeof v.text === 'string' : true)
    case 'tool':
      return (
        typeof v.turnId === 'string' &&
        !!v.activity &&
        typeof (v.activity as RelayToolActivity).callId === 'string' &&
        typeof (v.activity as RelayToolActivity).name === 'string' &&
        ((v.activity as RelayToolActivity).phase === 'start' ||
          (v.activity as RelayToolActivity).phase === 'end')
      )
    case 'confirm-request':
      return (
        typeof v.turnId === 'string' &&
        !!v.request &&
        typeof (v.request as RelayConfirmRequest).confirmId === 'string' &&
        ['ops', 'plan', 'outline'].includes((v.request as RelayConfirmRequest).kind)
      )
    case 'snapshot':
      return (
        typeof v.turnId === 'string' &&
        !!v.snapshot &&
        typeof (v.snapshot as RelaySnapshot).snapshotId === 'string'
      )
    case 'context':
      return typeof (v.context as RelayContextReport | undefined)?.text === 'string'
    case 'switch-request':
      return (
        typeof v.turnId === 'string' &&
        !!v.switch &&
        (typeof (v.switch as RelaySwitchRequest).filePath === 'undefined' ||
          typeof (v.switch as RelaySwitchRequest).filePath === 'string') &&
        (typeof (v.switch as RelaySwitchRequest).title === 'undefined' ||
          typeof (v.switch as RelaySwitchRequest).title === 'string')
      )
    case 'error':
      return typeof v.message === 'string'
    case 'busy':
      return typeof v.busy === 'boolean'
    default:
      return false
  }
}

export function isRelayCommand(value: unknown): value is RelayCommand {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  switch (v.type) {
    case 'send':
      return typeof v.text === 'string'
    case 'stop':
      return true
    case 'seed':
      return (
        Array.isArray(v.messages) &&
        v.messages.every(
          (m) =>
            !!m &&
            typeof (m as RelaySeedMessage).text === 'string' &&
            ['user', 'assistant'].includes((m as RelaySeedMessage).role),
        )
      )
    case 'confirm':
      return typeof v.confirmId === 'string' && typeof v.approved === 'boolean'
    case 'sync-docs':
      return (
        Array.isArray(v.docs) &&
        v.docs.every(
          (d) =>
            !!d &&
            typeof (d as RelayDockDocInfo).title === 'string' &&
            typeof (d as RelayDockDocInfo).kind === 'string' &&
            typeof (d as RelayDockDocInfo).active === 'boolean',
        )
      )
    case 'sync-project':
      return (
        Array.isArray(v.files) &&
        v.files.every((f) => typeof f === 'string') &&
        (typeof v.name === 'undefined' || typeof v.name === 'string')
      )
    default:
      return false
  }
}
