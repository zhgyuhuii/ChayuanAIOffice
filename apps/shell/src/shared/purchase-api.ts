/**
 * Offline purchase / license channels shared by the main process and the
 * preload bridge (LOCAL feature, B-zone: new file only).
 *
 * Contract mirrors the harness desktop implementation (desktop/src/shared/
 * contract.ts purchase channels) so both products stay conceptually aligned:
 * - purchasing never gates any feature; activating only stops the reminders
 * - 90-day free period from first run, then a once-per-day purchase dialog
 *   plus a gentle bottom-right toast every 30 minutes
 * - activation is an offline HMAC short serial bound to the machine
 *   fingerprint; Chayuan AI Office accepts serials carrying the OS bit
 *   (1 << 10) OR its own office bit (1 << 11) — one-way coverage per the
 *   2026-09-20 purchase consensus (Q9)
 */

export const PURCHASE_CHANNELS = {
  state: 'chatoffice/purchase:state',
  activate: 'chatoffice/purchase:activate',
  event: 'chatoffice/purchase:event',
} as const

/** Snapshot served to the renderer for the dialog and any status display. */
export interface PurchaseSnapshot {
  /** 16-hex machine fingerprint (what the customer sends to support). */
  fingerprint: string
  firstRunAt: string
  /** Free period end (firstRunAt + 90 days). */
  freeUntil: string
  /** Whole days left in the free period (0 once over). */
  freeDaysLeft: number
  entitled: boolean
  expireAt: string | null
  activatedAt: string | null
  serialMasked: string | null
  /** Whether a signing key is available (false = activation entry disabled). */
  keyConfigured: boolean
}

/** Scheduler events pushed from main to the shell renderer. */
export type PurchaseEventPayload = { kind: 'open-page' } | { kind: 'reminder' }

export type PurchaseActivateResult =
  | { ok: true; expireAt: string; days: number }
  | { ok: false; reason: string }
