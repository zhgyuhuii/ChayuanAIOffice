/**
 * use-is-mobile tests (node env): the decision and persistence logic is pure
 * and covered directly; React wiring gets a renderToStaticMarkup smoke test
 * through an injected mediaQuerySource.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import {
  decideIsMobile,
  mobileQueries,
  readUIMode,
  useIsMobile,
  type MediaQuerySource,
} from '../src/use-is-mobile'

describe('mobileQueries', () => {
  it('builds the narrow query strictly below the breakpoint', () => {
    expect(mobileQueries(768)).toEqual({
      coarse: '(pointer: coarse)',
      narrow: '(max-width: 767px)',
    })
    expect(mobileQueries(1024).narrow).toBe('(max-width: 1023px)')
  })
})

describe('decideIsMobile', () => {
  it('defaults to coarse AND narrow', () => {
    expect(decideIsMobile({ coarse: true, narrow: true })).toBe(true)
    expect(decideIsMobile({ coarse: true, narrow: false })).toBe(false) // tablet landscape / desktop touchscreen
    expect(decideIsMobile({ coarse: false, narrow: true })).toBe(false) // resized desktop window
    expect(decideIsMobile({ coarse: false, narrow: false })).toBe(false)
  })

  it('or mode matches either signal', () => {
    expect(decideIsMobile({ coarse: true, narrow: false }, { mode: 'or' })).toBe(true)
    expect(decideIsMobile({ coarse: false, narrow: true }, { mode: 'or' })).toBe(true)
  })

  it('override wins over signals, null/undefined fall through', () => {
    expect(decideIsMobile({ coarse: false, narrow: false }, { override: true })).toBe(true)
    expect(decideIsMobile({ coarse: true, narrow: true }, { override: false })).toBe(false)
    expect(decideIsMobile({ coarse: true, narrow: true }, { override: null })).toBe(true)
  })
})

describe('readUIMode', () => {
  const storageWith = (value: string | null) => ({ getItem: () => value })

  it('reads mobile/desktop, falls back to auto otherwise', () => {
    expect(readUIMode(storageWith('mobile'), 'k')).toBe('mobile')
    expect(readUIMode(storageWith('desktop'), 'k')).toBe('desktop')
    expect(readUIMode(storageWith('AUTO'), 'k')).toBe('auto') // case-sensitive: no silent coercion
    expect(readUIMode(storageWith('garbage'), 'k')).toBe('auto')
    expect(readUIMode(storageWith(null), 'k')).toBe('auto')
    expect(readUIMode(undefined, 'k')).toBe('auto')
  })

  it('swallows storage exceptions (private browsing)', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied')
      },
    }
    expect(readUIMode(throwing, 'k')).toBe('auto')
  })
})

describe('useIsMobile wiring (server snapshot)', () => {
  const source =
    (matches: Record<string, boolean>): MediaQuerySource =>
    (query) => ({ matches: matches[query] ?? false })

  const renderProbe = (options: Parameters<typeof useIsMobile>[0]) =>
    renderToStaticMarkup(
      createElement(() => {
        const isMobile = useIsMobile(options)
        return createElement('span', null, isMobile ? 'mobile' : 'desktop')
      }),
    )

  it('renders desktop under the server snapshot (no window)', () => {
    expect(renderProbe({ mediaQuerySource: source({}) })).toContain('desktop')
  })

  it('honors an explicit override even in the server snapshot', () => {
    expect(renderProbe({ override: true, mediaQuerySource: source({}) })).toContain('mobile')
  })
})
