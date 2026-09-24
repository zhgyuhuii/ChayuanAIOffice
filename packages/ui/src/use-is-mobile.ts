/**
 * Mobile breakpoint detection (consensus #5): an editor shows its mobile UI
 * when the primary pointer is coarse AND the viewport is narrower than the
 * breakpoint (≤ 768px by default). The AND keeps resized desktop windows on
 * the desktop UI; 'or' mode exists for tablet debugging. Both hooks run
 * inside each editor's own iframe bundle, so detection is per-editor.
 *
 * `useUIMode` adds the manual three-state override (auto / mobile / desktop)
 * persisted in storage — tablets default to the desktop UI but can be pinned
 * either way.
 *
 * The decision logic lives in the exported pure functions (decideIsMobile,
 * readUIMode) so node-env tests cover everything except React wiring.
 */
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'

export interface MediaQuerySnapshot {
  readonly matches: boolean
  readonly addEventListener?: (type: 'change', listener: () => void) => void
  readonly removeEventListener?: (type: 'change', listener: () => void) => void
  /** Legacy Safari signature. */
  readonly addListener?: (listener: () => void) => void
  readonly removeListener?: (listener: () => void) => void
}

export type MediaQuerySource = (query: string) => MediaQuerySnapshot

const defaultSource: MediaQuerySource = (query) => window.matchMedia(query)

export interface UseIsMobileOptions {
  /** Force the result; null/undefined = auto-detect. */
  readonly override?: boolean | null
  readonly breakpointPx?: number
  readonly mode?: 'and' | 'or'
  /** Injectable for tests (node has no matchMedia). */
  readonly mediaQuerySource?: MediaQuerySource
}

/** Media query pair for a breakpoint: narrow = strictly below breakpointPx. */
export function mobileQueries(breakpointPx: number): { coarse: string; narrow: string } {
  return { coarse: '(pointer: coarse)', narrow: `(max-width: ${breakpointPx - 1}px)` }
}

/** Pure decision, exported for tests. */
export function decideIsMobile(
  signals: { coarse: boolean; narrow: boolean },
  options: Pick<UseIsMobileOptions, 'override' | 'mode'> = {},
): boolean {
  const { override = null, mode = 'and' } = options
  if (override !== null && override !== undefined) return override
  return mode === 'and' ? signals.coarse && signals.narrow : signals.coarse || signals.narrow
}

function useMediaQuery(query: string, source: MediaQuerySource): boolean {
  // One MediaQueryList per (source, query): React reads getSnapshot on every
  // store check, and constructing the MQL there would allocate on each read.
  const mql = useMemo(() => source(query), [source, query])
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (mql.addEventListener) {
        mql.addEventListener('change', onChange)
        return () => mql.removeEventListener?.('change', onChange)
      }
      mql.addListener?.(onChange)
      return () => mql.removeListener?.(onChange)
    },
    [mql],
  )
  return useSyncExternalStore(
    subscribe,
    () => mql.matches,
    () => false,
  )
}

export function useIsMobile(options: UseIsMobileOptions = {}): boolean {
  const { breakpointPx = 768, mediaQuerySource = defaultSource } = options
  const queries = mobileQueries(breakpointPx)
  const coarse = useMediaQuery(queries.coarse, mediaQuerySource)
  const narrow = useMediaQuery(queries.narrow, mediaQuerySource)
  return decideIsMobile({ coarse, narrow }, options)
}

export type UIMode = 'auto' | 'mobile' | 'desktop'

export interface UIModeResult {
  readonly mode: UIMode
  readonly setMode: (mode: UIMode) => void
  readonly isMobile: boolean
}

export interface UseUIModeOptions extends Omit<UseIsMobileOptions, 'override'> {
  /** Injectable for tests (node has no localStorage). */
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'>
}

/** Pure read with fallback: anything but 'mobile'/'desktop' means 'auto'. */
export function readUIMode(storage: Pick<Storage, 'getItem'> | undefined, key: string): UIMode {
  try {
    const value = storage?.getItem(key)
    return value === 'mobile' || value === 'desktop' ? value : 'auto'
  } catch {
    return 'auto'
  }
}

export function useUIMode(storageKey: string, options: UseUIModeOptions = {}): UIModeResult {
  const storage =
    options.storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage)
  const [mode, setModeState] = useState<UIMode>(() => readUIMode(storage, storageKey))
  const setMode = useCallback(
    (next: UIMode) => {
      try {
        storage?.setItem(storageKey, next)
      } catch {
        // private browsing / quota: the in-memory mode still applies
      }
      setModeState(next)
    },
    [storage, storageKey],
  )
  const autoIsMobile = useIsMobile(options)
  return { mode, setMode, isMobile: mode === 'auto' ? autoIsMobile : mode === 'mobile' }
}
