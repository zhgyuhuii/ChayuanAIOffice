// The 察元 AI tab schema: structure, menu sizes (the wps 14/6 contracts) and
// that every referenced command exists in the registry.
import { describe, expect, it } from 'vitest'
import { DOCS_SCHEMA } from '../src/renderer/ribbon/schema/view-tab'
import { DOCS_COMMANDS } from '../src/renderer/ribbon/commands'
import { CHAYUAN_TAB } from '../src/renderer/ribbon/schema/chayuan-tab'

const commandIds = new Set(DOCS_COMMANDS.map((c) => c.id))

function menuItemsOf(controlId: string): number {
  for (const group of CHAYUAN_TAB.groups) {
    for (const control of group.controls) {
      if ('id' in control && control.id === controlId && 'menu' in control) {
        return control.menu?.filter((m) => m.kind !== 'separator').length ?? 0
      }
    }
  }
  return 0
}

function collectCommands(controls: readonly unknown[], acc: Set<string> = new Set()): Set<string> {
  for (const c of controls as Array<Record<string, unknown>>) {
    if (typeof c.command === 'string') acc.add(c.command)
    if (Array.isArray(c.menu)) {
      for (const m of c.menu as Array<Record<string, unknown>>) {
        if (typeof m.command === 'string') acc.add(m.command)
        if (Array.isArray(m.children)) collectCommands(m.children as never, acc)
      }
    }
  }
  return acc
}

describe('察元 AI tab schema', () => {
  it('is registered in DOCS_SCHEMA after the View tab', () => {
    expect(DOCS_SCHEMA.tabs.map((t) => t.id)).toContain('chayuan')
    expect(DOCS_SCHEMA.tabs[DOCS_SCHEMA.tabs.length - 1]!.id).toBe('chayuan')
  })

  it('carries the five wps groups', () => {
    expect(CHAYUAN_TAB.groups.map((g) => g.id)).toEqual([
      'chayuan.assist',
      'chayuan.security',
      'chayuan.docBatch',
      'chayuan.batch',
      'chayuan.form',
    ])
  })

  it('表格批量操作 dropdown holds all 14 items; 图像批量操作 holds 6', () => {
    expect(menuItemsOf('chayuan.tableBatch')).toBe(14)
    expect(menuItemsOf('chayuan.imageBatch')).toBe(6)
  })

  it('文本分析 dropdown covers the harvested analysis family', () => {
    expect(menuItemsOf('chayuan.textAnalysis')).toBeGreaterThanOrEqual(14)
  })

  it('every referenced command is registered', () => {
    const referenced = new Set<string>()
    for (const group of CHAYUAN_TAB.groups) collectCommands(group.controls, referenced)
    expect(referenced.size).toBeGreaterThan(0)
    const missing = [...referenced].filter((id) => !commandIds.has(id as never))
    expect(missing).toEqual([])
  })

  it('menu args carry the assistant ids / op ids / dialog kinds', () => {
    const batch = CHAYUAN_TAB.groups.find((g) => g.id === 'chayuan.batch')!
    const tableMenu = (batch.controls.find((c) => 'id' in c && c.id === 'chayuan.tableBatch') as unknown as {
      menu: Array<{ id: string; args?: Record<string, unknown> }>
    }).menu
    expect(tableMenu.find((m) => m.id === 'chayuan.tb.export')!.args).toEqual({ what: 'tables' })
    expect(tableMenu.find((m) => m.id === 'chayuan.tb.deleteAll')!.args).toEqual({
      op: 'tables.deleteAll',
    })
    expect(tableMenu.find((m) => m.id === 'chayuan.tb.deleteTextRow')!.args).toEqual({
      kind: 'deleteTextRow',
    })
    const imageMenu = (batch.controls.find((c) => 'id' in c && c.id === 'chayuan.imageBatch') as unknown as {
      menu: Array<{ id: string; args?: Record<string, unknown> }>
    }).menu
    expect(imageMenu.find((m) => m.id === 'chayuan.ib.export')!.args).toEqual({ what: 'images' })
  })
})
