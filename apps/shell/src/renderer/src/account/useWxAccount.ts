/**
 * WeChat account state shared by Home's sidebar button and the settings modal
 * (LOCAL module — upstream has no account surface here). Module-level
 * singleton: one IPC /me round-trip feeds every consumer, so the two buttons
 * can never disagree about the login state.
 */
import { useEffect, useState } from 'react'
import type { WxLoginSession } from '../../../shared/home-api'

let session: WxLoginSession = { loggedIn: false }
/** true once the first wxStatus round-trip answered (local check — no session means no network) */
let resolved = false
let inFlight = false
let lastFetch = 0
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

/** Re-read the session from main (throttled unless forced). */
export async function refreshWxAccount(force = false): Promise<void> {
  if (inFlight) return
  if (!force && Date.now() - lastFetch < 30_000) return
  inFlight = true
  try {
    session = await window.chaOffice.wxStatus()
    lastFetch = Date.now()
    resolved = true
    emit()
  } catch {
    /* keep the previous view; a later refresh retries */
  } finally {
    inFlight = false
  }
}

/** Has the first status check answered? Callers use it to gate "not logged in"
 *  decisions (the default session state is logged-out until proven otherwise). */
export function useWxAccountResolved(): boolean {
  const [value, setValue] = useState(resolved)
  useEffect(() => {
    const update = (): void => setValue(resolved)
    listeners.add(update)
    return () => {
      listeners.delete(update)
    }
  }, [])
  return value
}

export function useWxAccount(): WxLoginSession {
  const [value, setValue] = useState<WxLoginSession>(session)
  useEffect(() => {
    const update = (): void => setValue(session)
    listeners.add(update)
    void refreshWxAccount()
    return () => {
      listeners.delete(update)
    }
  }, [])
  return value
}
