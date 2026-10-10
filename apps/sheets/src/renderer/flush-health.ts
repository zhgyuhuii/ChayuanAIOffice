/**
 * Background disk-flush health. The crash-recovery snapshot tick and the
 * quiet AutoSave tick fail silently by design (no dialogs, no status spam),
 * so a flush that never lands — for a new sheet's hidden draft the recovery
 * copy is the ONLY disk path — used to go unnoticed while a large pending
 * journal sat in renderer memory (the shell watchdog's resource reports were
 * the first visible symptom). Consecutive failures escalate to one
 * cooldown-gated error toast; any success resets the streak. A journal with
 * nothing pending is not a flush and feeds neither branch.
 */
import { t } from './i18n/locale'
import { showToast } from './toast-bus'

/// Failures before the first warning: one failed tick can be a blip (sidecar
/// restarting, machine asleep); three in a row across 30 s ticks is a flush
/// that is genuinely not landing.
const FAILURES_BEFORE_TOAST = 3
/// Minimum gap between two warnings, so a flush that stays broken nags about
/// every ten minutes instead of every tick.
const TOAST_COOLDOWN_MS = 10 * 60_000

let failStreak = 0
let lastToastAt = 0

export function noteBackgroundFlushOutcome(ok: boolean, detail?: string): void {
  if (ok) {
    failStreak = 0
    return
  }
  failStreak += 1
  if (detail !== undefined) {
    console.warn(`[sheets] background flush failed (streak ${failStreak}):`, detail)
  }
  if (failStreak < FAILURES_BEFORE_TOAST) return
  const now = Date.now()
  if (now - lastToastAt < TOAST_COOLDOWN_MS) return
  lastToastAt = now
  showToast(t('appBackgroundFlushFailing'), 'error')
}

/** Test hook: the streak and cooldown live at module scope and would leak
 * across vitest cases in the same file. */
export function resetBackgroundFlushHealthForTests(): void {
  failStreak = 0
  lastToastAt = 0
}
