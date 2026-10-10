import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const toasts: Array<{ text: string; kind: string }> = []

vi.mock('../src/renderer/toast-bus', () => ({
  showToast: (text: string, kind: string = 'success') => {
    toasts.push({ text, kind })
  },
}))

vi.mock('../src/renderer/i18n/locale', () => ({
  t: (key: string, params?: Record<string, string>) =>
    `${key}${params ? ` ${JSON.stringify(params)}` : ''}`,
}))

import {
  noteBackgroundFlushOutcome,
  resetBackgroundFlushHealthForTests,
} from '../src/renderer/flush-health'

describe('background flush health', () => {
  beforeEach(() => {
    toasts.length = 0
    resetBackgroundFlushHealthForTests()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-10T01:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stays quiet for isolated failures', () => {
    noteBackgroundFlushOutcome(false, 'boom')
    noteBackgroundFlushOutcome(false)
    expect(toasts).toEqual([])
  })

  it('warns once on the third consecutive failure', () => {
    noteBackgroundFlushOutcome(false, 'boom')
    noteBackgroundFlushOutcome(false)
    noteBackgroundFlushOutcome(false)
    expect(toasts).toEqual([{ text: 'appBackgroundFlushFailing', kind: 'error' }])
  })

  it('does not re-warn inside the cooldown even while failures continue', () => {
    for (let i = 0; i < 4; i++) noteBackgroundFlushOutcome(false)
    expect(toasts).toHaveLength(1)
    vi.advanceTimersByTime(5 * 60_000)
    noteBackgroundFlushOutcome(false)
    expect(toasts).toHaveLength(1)
  })

  it('re-warns after the cooldown once more failures accumulate', () => {
    for (let i = 0; i < 3; i++) noteBackgroundFlushOutcome(false)
    expect(toasts).toHaveLength(1)
    vi.advanceTimersByTime(10 * 60_000)
    noteBackgroundFlushOutcome(false)
    expect(toasts).toHaveLength(2)
  })

  it('a success resets the streak: three fresh failures are needed again', () => {
    noteBackgroundFlushOutcome(false)
    noteBackgroundFlushOutcome(false)
    noteBackgroundFlushOutcome(true)
    noteBackgroundFlushOutcome(false)
    noteBackgroundFlushOutcome(false)
    expect(toasts).toEqual([])
    noteBackgroundFlushOutcome(false)
    expect(toasts).toHaveLength(1)
  })
})
