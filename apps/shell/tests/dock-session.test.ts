import { describe, expect, it } from 'vitest'

import type { DockApi, DockTabSummary } from '../src/shared/dock-api'
import { planRestore, restoreDockTabs, snapshotFromTabs } from '../src/renderer/src/dock-session'

function tab(partial: Partial<DockTabSummary> & { id: string }): DockTabSummary {
  return { kind: 'docs', title: partial.id, active: false, ...partial }
}

describe('snapshotFromTabs', () => {
  it('records kinds, files and the active index', () => {
    const memory = snapshotFromTabs([
      tab({ id: 'a', kind: 'docs', filePath: '/tmp/a.docx' }),
      tab({ id: 'b', kind: 'sheets', filePath: '/tmp/b.xlsx', active: true }),
    ])
    expect(memory.tabs).toEqual([
      { kind: 'docs', file: '/tmp/a.docx' },
      { kind: 'sheets', file: '/tmp/b.xlsx' },
    ])
    expect(memory.activeIndex).toBe(1)
  })

  it('blank tabs carry no file; nothing active → no index', () => {
    const memory = snapshotFromTabs([tab({ id: 'a' })])
    expect(memory.tabs).toEqual([{ kind: 'docs' }])
    expect(memory.activeIndex).toBeUndefined()
  })
})

describe('planRestore', () => {
  it('reopens only the missing tabs (same file or same-kind blank dedupes)', () => {
    const { toOpen, activateQuery } = planRestore(
      [
        tab({ id: 'live1', kind: 'docs', filePath: '/tmp/a.docx' }),
        tab({ id: 'live2', kind: 'sheets' }),
      ],
      {
        tabs: [
          { kind: 'docs', file: '/tmp/a.docx' },
          { kind: 'sheets' },
          { kind: 'pdf', file: '/tmp/c.pdf' },
        ],
        activeIndex: 2,
      },
    )
    expect(toOpen).toEqual([{ kind: 'pdf', file: '/tmp/c.pdf' }])
    expect(activateQuery).toEqual({ kind: 'pdf', file: '/tmp/c.pdf' })
  })

  it('empty or absent memory plans nothing', () => {
    expect(planRestore([], undefined)).toEqual({ toOpen: [], activateQuery: null })
    expect(planRestore([], { tabs: [] })).toEqual({ toOpen: [], activateQuery: null })
  })
})

describe('restoreDockTabs', () => {
  function fakeDock(state: DockTabSummary[]): DockApi & { calls: string[] } {
    const calls: string[] = []
    const api: DockApi & { calls: string[] } = {
      calls,
      open: async (kind, options) => {
        calls.push(`open:${kind}:${options?.file ?? ''}`)
        const fresh = tab({ id: `n${state.length}`, kind, filePath: options?.file, title: 'x' })
        state.push(fresh)
        return fresh
      },
      list: async () => state,
      activate: async (id) => {
        calls.push(`activate:${id}`)
        for (const t of state) t.active = t.id === id
      },
      close: async () => {},
      undock: async () => {},
      setRect: () => {},
      onChanged: () => () => {},
    }
    return api
  }

  it('opens the missing tab then activates the remembered active one', async () => {
    const dock = fakeDock([
      tab({ id: 'live1', kind: 'docs', filePath: '/tmp/a.docx', active: true }),
    ])
    await restoreDockTabs(dock, {
      tabs: [
        { kind: 'docs', file: '/tmp/a.docx' },
        { kind: 'pdf', file: '/tmp/c.pdf' },
      ],
      activeIndex: 1,
    })
    expect(dock.calls).toEqual(['open:pdf:/tmp/c.pdf', 'activate:n1'])
  })

  it('activates nothing when the remembered active tab vanished', async () => {
    const dock = fakeDock([tab({ id: 'live1', kind: 'sheets' })])
    await restoreDockTabs(dock, { tabs: [{ kind: 'pdf', file: '/tmp/gone.pdf' }], activeIndex: 0 })
    // the file no longer exists → open still attempted (main process decides),
    // but no activation happens when it does not land
    const dock2 = fakeDock([])
    dock2.open = async (kind, options) => {
      dock2.calls.push(`open:${kind}:${options?.file ?? ''}`)
      return null
    }
    await restoreDockTabs(dock2, { tabs: [{ kind: 'pdf', file: '/tmp/gone.pdf' }], activeIndex: 0 })
    expect(dock2.calls).toEqual(['open:pdf:/tmp/gone.pdf'])
  })
})
