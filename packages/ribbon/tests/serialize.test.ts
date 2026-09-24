import { describe, expect, it } from 'vitest'
import { commandId } from '../src'
import { schemaFromJSON, schemaToJSON } from '../src/schema/serialize'
import type { RibbonSchema } from '../src/schema/types'

const jsonSafeSchema = (): RibbonSchema<never, never> => ({
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
          disabledWhen: { notEq: ['canEdit', true] },
          controls: [
            {
              kind: 'button',
              id: 'bold',
              command: commandId('docs.format.bold'),
              size: 'small',
              labelKey: 'cmd.bold',
              when: { truthy: 'canEdit' },
            },
            { kind: 'separator', id: 's1' },
            {
              kind: 'dropdown',
              id: 'insert-more',
              labelKey: 'cmd.more',
              menu: [
                { id: 'save', labelKey: 'cmd.save', command: commandId('docs.file.save') },
                { kind: 'separator', id: 'ms1' },
              ],
            },
          ],
        },
      ],
    },
  ],
})

describe('schemaToJSON / schemaFromJSON roundtrip', () => {
  it('roundtrips a JSON-safe schema deep-equal', () => {
    const { data, warnings } = schemaToJSON(jsonSafeSchema())
    expect(warnings).toEqual([])
    const json = JSON.parse(JSON.stringify(data))
    expect(schemaFromJSON(json, { onPlaceholder: () => {} })).toEqual(jsonSafeSchema())
  })

  it('degrades predicates and custom renders to placeholders with warnings', () => {
    const schema: RibbonSchema<never, never> = {
      ...jsonSafeSchema(),
      tabs: [
        {
          id: 'home',
          labelKey: 'tab.home',
          kind: 'regular',
          when: () => true,
          groups: [
            {
              id: 'g',
              labelKey: 'g',
              controls: [{ kind: 'custom', id: 'legacy', render: () => null }],
            },
          ],
        },
      ],
    }
    const { data, warnings } = schemaToJSON(schema)
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain('tabs[0].when')
    expect(warnings[1]).toContain('render')
    const restored = schemaFromJSON(JSON.parse(JSON.stringify(data)), { onPlaceholder: () => {} })
    expect(typeof restored.tabs[0].when).toBe('function')
    expect((restored.tabs[0].when as () => boolean)()).toBe(true)
    const custom = restored.tabs[0].groups[0].controls[0]
    expect(custom.kind).toBe('custom')
  })

  it('notifies through onPlaceholder (default console.warn)', () => {
    const schema = jsonSafeSchema()
    ;(schema.tabs[0] as { when: unknown }).when = () => true
    const { data } = schemaToJSON(schema)
    const seen: string[] = []
    schemaFromJSON(JSON.parse(JSON.stringify(data)), { onPlaceholder: (p) => seen.push(p) })
    expect(seen).toEqual(['schema.tabs[0].when'])
  })

  it('rejects unknown keys with a located error', () => {
    const data = JSON.parse(JSON.stringify(schemaToJSON(jsonSafeSchema()).data)) as {
      tabs: Array<Record<string, unknown>>
    }
    data.tabs[0].label = 'Home' // typo of labelKey
    expect(() => schemaFromJSON(data, { onPlaceholder: () => {} })).toThrow(
      /tabs\[0\].*unknown key "label"/,
    )
  })

  it('rejects invalid command ids and unknown control kinds', () => {
    const data = JSON.parse(JSON.stringify(schemaToJSON(jsonSafeSchema()).data)) as {
      tabs: Array<{ groups: Array<{ controls: Array<Record<string, unknown>> }> }>
    }
    data.tabs[0].groups[0].controls[0].command = 'Bad Id'
    expect(() => schemaFromJSON(data, { onPlaceholder: () => {} })).toThrow(/invalid command id/)
    data.tabs[0].groups[0].controls[0].command = 'docs.format.bold'
    data.tabs[0].groups[0].controls[0].kind = 'wiggly'
    expect(() => schemaFromJSON(data, { onPlaceholder: () => {} })).toThrow(
      /unknown control kind "wiggly"/,
    )
  })
})

describe('row/column and new control fields', () => {
  it('roundtrips nested rows and split renderMenu placeholder', () => {
    const schema: RibbonSchema<never, never> = {
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
              className: 'rb-font-group',
              controls: [
                {
                  kind: 'row',
                  id: 'row1',
                  controls: [
                    {
                      kind: 'split',
                      id: 'hl',
                      command: commandId('docs.format.bold'),
                      labelKey: 'cmd.hl',
                      variant: 'color',
                      menuClassName: 'hl-menu',
                      menu: [{ id: 'auto', labelKey: 'cmd.auto', args: null, shortcut: 'Ctrl+S' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    const { data, warnings } = schemaToJSON(schema)
    expect(warnings).toEqual([])
    const json = JSON.parse(JSON.stringify(data))
    expect(schemaFromJSON(json, { onPlaceholder: () => {} })).toEqual(schema)
  })

  it('rejects unknown keys inside nested row controls', () => {
    const { data } = schemaToJSON(jsonSafeSchema())
    const json = JSON.parse(JSON.stringify(data)) as any
    json.tabs[0].groups[0].controls = [
      {
        kind: 'row',
        id: 'r',
        controls: [{ kind: 'button', id: 'b', size: 'icon', labelKey: 'x', bogus: 1 }],
      },
    ]
    expect(() => schemaFromJSON(json, { onPlaceholder: () => {} })).toThrow(/unknown key "bogus"/)
  })
})
