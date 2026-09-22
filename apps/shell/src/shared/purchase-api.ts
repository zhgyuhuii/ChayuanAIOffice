/**
 * Offline purchase / license channels shared by the main process and the
 * preload bridge (LOCAL feature, B-zone: new file only).
 *
 * Contract mirrors the harness implementation (desktop/src/shared/contract.ts
 * purchase channels) and the chayuan-desktop-own LicenseDialog flow:
 * - purchasing never gates any feature; activating only stops the reminders
 * - 90-day free period from first run, then a once-per-day purchase dialog
 *   plus a gentle bottom-right toast every 30 minutes
 * - the dialog shows a locally generated QR of the buy page
 *   ({base}/buy?app=office&mid={fingerprint}) — the phone picks the tier and
 *   pays there, the page hands back a serial bound to this fingerprint; no
 *   prices or tiers exist in this client
 * - activation verifies that offline HMAC short serial locally; the serial's
 *   module bitmap + duration auto-describe what was bought; Chayuan AI Office
 *   accepts serials carrying the OS bit (1 << 11) OR its own office bit
 *   (1 << 12) — one-way coverage per the 2026-09-20 purchase consensus (Q9)
 */

export const PURCHASE_CHANNELS = {
  state: 'chatoffice/purchase:state',
  activate: 'chatoffice/purchase:activate',
  event: 'chatoffice/purchase:event',
} as const

/** Snapshot served to the renderer for the dialog and any status display. */
export interface PurchaseSnapshot {
  /** 16-hex machine fingerprint (what the buy page binds the order to). */
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
  /** Phone-facing buy page with this machine's fingerprint prefilled:
   * {base}/buy?app=office&mid={fp} — what the local QR encodes. Prices and
   * tiers live there, never in this client. */
  buyUrl: string
  /** Share page URL ({base}/share?mid={fp}): invite friends, earn counts. */
  shareUrl: string
}

/** Scheduler events pushed from main to the shell renderer. */
export type PurchaseEventPayload = { kind: 'open-page' } | { kind: 'reminder' }

export type PurchaseActivateResult =
  | { ok: true; expireAt: string; days: number; modules: number }
  | { ok: false; reason: string }
