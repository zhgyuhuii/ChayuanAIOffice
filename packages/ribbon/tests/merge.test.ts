import { describe, expect, it } from 'vitest'
import { commandId, createCommandRegistry } from '../src'
import { applySchemaPatch, mergeSchemas, type SchemaPatch } from '../src/schema/merge'
import type { RibbonSchema } from '../src/schema/types'

type S = { readonly canEdit: boolean }
type V = { readonly log: string[] }

const baseSchema = (): RibbonSchema<S, V> => ({
  id: 'docs',
  version: 1,
  tabs: [
    {
      id: 'home',
      labelKey: 'tab.home',
      kind: 'regular',
      groups: [
        {
          id: 'font',
          labelKey: 'group.font',
          controls: [
            {
              kind: 'button',
              id: 'bold',
              command: commandId('docs.format.bold'),
              size: 'small',
              labelKey: 'cmd.bold',
            },
            {
              kind: 'button',
              id: 'italic',
              command: commandId('docs.format.italic'),
              size: 'small',
              labelKey: 'cmd.italic',
            },
          ],
        },
        { id: 'para', labelKey: 'group.para', controls: [] },
      ],
    },
    { id: 'insert', labelKey: 'tab.insert', kind: 'regular', groups: [] },
  ],
})

const registry = () =>
  createCommandRegistry<S, V>([
    { id: commandId('docs.format.bold'), run: () => {} },
    { id: commandId('docs.format.italic'), run: () => {} },
  ])

describe('applySchemaPatch', () => {
  it('adds tabs at an anchor, appends without one', () => {
    const reg = registry()
    const schema = applySchemaPatch(baseSchema(), reg, {
      id: 'ee',
      addTabs: [
        { tab: { id: 'ai', labelKey: 'tab.ai', kind: 'regular', groups: [] }, after: 'home' },
        { tab: { id: 'help', labelKey: 'tab.help', kind: 'regular', groups: [] } },
      ],
    })
    expect(schema.tabs.map((t) => t.id)).toEqual(['home', 'ai', 'insert', 'help'])
  })

  it('removes tabs; missing anchors and targets fail loudly with the patch id', () => {
    const reg = registry()
    expect(
      applySchemaPatch(baseSchema(), reg, { id: 'ee', removeTabs: ['insert'] }).tabs.map(
        (t) => t.id,
      ),
    ).toEqual(['home'])
    expect(() =>
      applySchemaPatch(baseSchema(), reg, { id: 'ee.brand', removeTabs: ['nope'] }),
    ).toThrow(/Schema patch "ee\.brand".*not found/)
    expect(() =>
      applySchemaPatch(baseSchema(), reg, {
        id: 'ee.brand',
        addTabs: [{ tab: { id: 'x', labelKey: 'x', kind: 'regular', groups: [] }, after: 'nope' }],
      }),
    ).toThrow(/ee\.brand.*anchor tab "nope"/)
  })

  it('adds and removes groups inside a tab', () => {
    const reg = registry()
    const schema = applySchemaPatch(baseSchema(), reg, {
      id: 'ee',
      addGroups: [
        { tab: 'home', group: { id: 'ai', labelKey: 'g.ai', controls: [] }, after: 'font' },
      ],
    })
    expect(schema.tabs[0].groups.map((g) => g.id)).toEqual(['font', 'ai', 'para'])
    const removed = applySchemaPatch(schema, reg, {
      id: 'ee2',
      removeGroups: [{ tab: 'home', group: 'para' }],
    })
    expect(removed.tabs[0].groups.map((g) => g.id)).toEqual(['font', 'ai'])
  })

  it('adds controls after an anchor and removes controls globally', () => {
    const reg = registry()
    const schema = applySchemaPatch(baseSchema(), reg, {
      id: 'ee',
      addControls: [
        {
          tab: 'home',
          group: 'font',
          controls: [
            {
              kind: 'button',
              id: 'underline',
              command: commandId('docs.format.bold'),
              size: 'small',
              labelKey: 'cmd.u',
            },
          ],
          after: 'bold',
        },
      ],
    })
    expect(schema.tabs[0].groups[0].controls.map((c) => c.id)).toEqual([
      'bold',
      'underline',
      'italic',
    ])
    const removed = applySchemaPatch(schema, reg, { id: 'ee2', removeControls: ['italic'] })
    expect(removed.tabs[0].groups[0].controls.map((c) => c.id)).toEqual(['bold', 'underline'])
  })

  it('patches controls partially; later patches win', () => {
    const reg = registry()
    const patch: SchemaPatch<S, V> = {
      id: 'a',
      patchControls: [{ id: 'bold', patch: { tipKey: 'tip.bold' } }],
    }
    const second: SchemaPatch<S, V> = {
      id: 'b',
      patchControls: [{ id: 'bold', patch: { tipKey: 'tip.bold.v2' } }],
    }
    const schema = mergeSchemas(baseSchema(), reg, patch, second)
    const bold = schema.tabs[0].groups[0].controls[0]
    expect(bold.tipKey).toBe('tip.bold.v2')
    expect(bold.kind).toBe('button') // untouched fields survive
  })

  it('registers new commands and overrides existing ones', () => {
    const reg = registry()
    applySchemaPatch(baseSchema(), reg, {
      id: 'ee',
      commands: [
        { id: commandId('docs.ai.polish'), run: (ctx) => ctx.services.log.push('polish') },
      ],
      overrideCommands: [
        { id: commandId('docs.format.bold'), run: (ctx) => ctx.services.log.push('bold-v2') },
      ],
    })
    const ctx = { state: { canEdit: true }, services: { log: [] as string[] } }
    reg.execute('docs.ai.polish', ctx)
    reg.execute('docs.format.bold', ctx)
    expect(ctx.services.log).toEqual(['polish', 'bold-v2'])
  })

  it('never mutates the base schema', () => {
    const reg = registry()
    const base = baseSchema()
    applySchemaPatch(base, reg, { id: 'ee', removeTabs: ['insert'], removeControls: ['bold'] })
    expect(base.tabs).toHaveLength(2)
    expect(base.tabs[0].groups[0].controls).toHaveLength(2)
  })

  it('duplicate addTabs / duplicate addGroups fail', () => {
    const reg = registry()
    expect(() =>
      applySchemaPatch(baseSchema(), reg, {
        id: 'ee',
        addTabs: [{ tab: { id: 'home', labelKey: 'dup', kind: 'regular', groups: [] } }],
      }),
    ).toThrow(/already exists/)
  })
})

describe('row/column nesting', () => {
  const nestedSchema = (): RibbonSchema<S, V> => ({
    id: 'docs',
    version: 1,
    tabs: [
      {
        id: 'home',
        labelKey: 'tab.home',
        kind: 'regular',
        groups: [
          {
            id: 'font',
            labelKey: 'group.font',
            controls: [
              {
                kind: 'row',
                id: 'row1',
                controls: [
                  {
                    kind: 'button',
                    id: 'bold',
                    command: commandId('docs.format.bold'),
                    size: 'icon',
                    labelKey: 'cmd.bold',
                  },
                  {
                    kind: 'button',
                    id: 'italic',
                    command: commandId('docs.format.italic'),
                    size: 'icon',
                    labelKey: 'cmd.italic',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  })

  it('removeControls finds controls nested inside rows', () => {
    const reg = registry()
    const schema = applySchemaPatch(nestedSchema(), reg, { id: 'ee', removeControls: ['italic'] })
    const row = schema.tabs[0].groups[0].controls[0]
    expect(row.kind).toBe('row')
    expect(row.kind === 'row' && row.controls.map((c) => c.id)).toEqual(['bold'])
  })

  it('removeControls targeting a row itself drops the whole subtree', () => {
    const reg = registry()
    const schema = applySchemaPatch(nestedSchema(), reg, { id: 'ee', removeControls: ['row1'] })
    expect(schema.tabs[0].groups[0].controls).toHaveLength(0)
  })

  it('patchControls reaches nested controls', () => {
    const reg = registry()
    const schema = applySchemaPatch(nestedSchema(), reg, {
      id: 'ee',
      patchControls: [{ id: 'bold', patch: { tipKey: 'tip.bold' } }],
    })
    const row = schema.tabs[0].groups[0].controls[0]
    expect(row.kind === 'row' && row.controls[0].tipKey).toBe('tip.bold')
  })

  it('addControls anchors on a nested control id', () => {
    const reg = registry()
    const schema = applySchemaPatch(nestedSchema(), reg, {
      id: 'ee',
      addControls: [
        {
          tab: 'home',
          group: 'font',
          after: 'bold',
          controls: [{ kind: 'button', id: 'underline', size: 'icon', labelKey: 'cmd.u' }],
        },
      ],
    })
    const row = schema.tabs[0].groups[0].controls[0]
    expect(row.kind === 'row' && row.controls.map((c) => c.id)).toEqual([
      'bold',
      'underline',
      'italic',
    ])
  })

  it('addControls with a missing nested anchor fails loudly', () => {
    const reg = registry()
    expect(() =>
      applySchemaPatch(nestedSchema(), reg, {
        id: 'ee',
        addControls: [{ tab: 'home', group: 'font', after: 'nope', controls: [] }],
      }),
    ).toThrow(/anchor control "nope" not found/)
  })
})
