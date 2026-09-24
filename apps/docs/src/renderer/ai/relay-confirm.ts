import type { RelayConfirmRequest } from '../../../../shell/src/shared/relay-protocol'

/**
 * P2-7 大纲/计划确认门:文档 loop 在动手前挂起,等首页用户的决议。
 *
 * 生命周期约束(全部收敛在这里,relay-server 只调用):
 * - request() 创建挂起项并返回 Promise;confirm 命令到达时 resolve。
 * - stop/seed/dispose 都必须 rejectAll——loop.cancel() 会 abort signal,
 *   但 loop 对工具的 await 仍在,Promise 不落地整轮就吊死。
 * - 同一时间至多一个挂起确认(单用户单对话,后发覆盖:旧的按 expired 落地)。
 */

export interface ConfirmDecision {
  approved: boolean
  feedback?: string
}

interface PendingConfirm {
  request: RelayConfirmRequest
  turnId: string
  resolve: (decision: ConfirmDecision) => void
}

export class RelayConfirmGate {
  private pending: PendingConfirm | null = null
  private seq = 0

  get current(): RelayConfirmRequest | null {
    return this.pending?.request ?? null
  }

  /** 工具执行中调用:经 onCreated 发出带真实 confirmId 的 confirm-request
   *  并挂起等待决议(onCreated 同步调用,emit 不会落在挂起之后) */
  request(
    turnId: string,
    kind: RelayConfirmRequest['kind'],
    payload: string,
    onCreated: (request: RelayConfirmRequest) => void,
  ): Promise<ConfirmDecision> {
    this.rejectAll('superseded by a newer confirmation request')
    const confirmId = `cf-${Date.now()}-${this.seq++}`
    return new Promise<ConfirmDecision>((resolve) => {
      this.pending = { request: { confirmId, kind, payload }, turnId, resolve }
      onCreated({ confirmId, kind, payload })
    })
  }

  /** confirm 命令:决议当前挂起项;无挂起时是 no-op(迟到的决议) */
  resolve(confirmId: string, decision: ConfirmDecision): boolean {
    const p = this.pending
    if (!p || p.request.confirmId !== confirmId) return false
    this.pending = null
    p.resolve(decision)
    return true
  }

  /** stop/seed/dispose:把挂起项按「已中止」落地,防轮次吊死 */
  rejectAll(reason: string): void {
    const p = this.pending
    this.pending = null
    p?.resolve({ approved: false, feedback: `(interrupted: ${reason})` })
  }
}
