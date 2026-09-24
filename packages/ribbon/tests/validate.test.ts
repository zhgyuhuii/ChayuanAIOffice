import { describe, expect, it } from 'vitest'
import { commandId, createCommandRegistry } from '../src'
import type { RibbonSchema } from '../src/schema/types'
import { assertValidSchema, validateSchema } from '../src/schema/validate'

interface TestState {
  readonly canEdit: boolean
  readonly selectionKind: string
  readonly format: { readonly bold: boolean }
}

const sampleState: TestState = { canEdit: true, selectionKind: 'text', format: { bold: false } }

const registry = () =>
  createCommandRegistry<TestState, unknown>([
    { id: commandId('docs.format.bold'), run: () => {} },
    { id: commandId('docs.file.save'), run: () => {} },
  ])

const baseSchema = (): RibbonSchema<TestState, unknown> => ({
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
            { kind: 'separator', id: 'sep-1' },
            {
              kind: 'toggle',
              id: 'marks',
              command: commandId('docs.format.bold'),
              statePath: 'format.bold',
              labelKey: 'cmd.marks',
            },
          ],
        },
      ],
    },
    {
      id: 'tableDesign',
      labelKey: 'tab.tableDesign',
      kind: 'contextual',
      contextWhen: { eq: ['selectionKind', 'table'] },
      contextGroup: { id: 'table', labelKey: 'group.tableTools' },
      groups: [],
    },
    {
      id: 'file',
      labelKey: 'tab.file',
      kind: 'file',
      menu: [{ id: 'save', labelKey: 'cmd.save', command: commandId('docs.file.save') }],
      groups: [],
    },
  ],
})

describe('validateSchema', () => {
  it('accepts a well-formed schema', () => {
    const issues = validateSchema(baseSchema(), { registry: registry(), stateSample: sampleState })
    expect(issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(issues.filter((i) => i.severity === 'warning')).toEqual([])
  })

  it('flags unregistered command references with their location', () => {
    const schema = baseSchema()
    ;(schema.tabs[0].groups[0].controls[0] as { command: string }).command = 'docs.format.nope'
    const issues = validateSchema(schema, { registry: registry() })
    expect(
      issues.some(
        (i) =>
          i.severity === 'error' &&
          i.message.includes('docs.format.nope') &&
          i.path.includes('bold'),
      ),
    ).toBe(true)
    expect(() => assertValidSchema(schema, { registry: registry() })).toThrow(
      /Invalid ribbon schema "docs"/,
    )
  })

  it('rejects duplicate tab/group/control ids', () => {
    const schema = baseSchema()
    schema.tabs.push(schema.tabs[0]) // duplicate tab id
    const issues = validateSchema(schema)
    expect(issues.some((i) => i.message.includes('duplicate tab id "home"'))).toBe(true)
    // duplicate control ids are caught across tabs
    expect(issues.filter((i) => i.message.includes('duplicate control id "bold"')).length).toBe(1)
  })

  it('enforces contextual tab completeness', () => {
    const schema = baseSchema()
    ;(schema.tabs[1] as { contextWhen?: unknown }).contextWhen = undefined
    const issues = validateSchema(schema)
    expect(
      issues.some((i) => i.severity === 'error' && i.message.includes('requires contextWhen')),
    ).toBe(true)
  })

  it('warns on contextWhen attached to a regular tab', () => {
    const schema = baseSchema()
    ;(schema.tabs[0] as { contextWhen?: unknown }).contextWhen = { truthy: 'canEdit' }
    const issues = validateSchema(schema)
    expect(issues.some((i) => i.severity === 'warning' && i.message.includes('no effect'))).toBe(
      true,
    )
  })

  it('requires file tabs to carry a menu', () => {
    const schema = baseSchema()
    ;(schema.tabs[2] as { menu?: unknown }).menu = undefined
    const issues = validateSchema(schema)
    expect(
      issues.some((i) => i.severity === 'error' && i.message.includes('file tab requires')),
    ).toBe(true)
  })

  it('warns when a when path does not resolve on the sample state', () => {
    const schema = baseSchema()
    ;(schema.tabs[1] as { contextWhen: unknown }).contextWhen = { eq: ['selecionKind', 'table'] } // typo
    const issues = validateSchema(schema, { stateSample: sampleState })
    expect(issues.some((i) => i.severity === 'warning' && i.message.includes('selecionKind'))).toBe(
      true,
    )
  })

  it('validates menu item command refs and disabledWhen structure', () => {
    const schema = baseSchema()
    schema.tabs[2].menu!.push(
      { id: 'nope', labelKey: 'x', command: commandId('docs.edit.undo') },
      { id: 'bad-when', labelKey: 'y', disabledWhen: { and: [] } },
    )
    const issues = validateSchema(schema, { registry: registry() })
    expect(issues.some((i) => i.message.includes('docs.edit.undo'))).toBe(true)
    expect(issues.some((i) => i.message.includes('non-empty array'))).toBe(true)
  })
})

describe('nested row/column controls', () => {
  it('flags duplicate control ids across nesting levels', () => {
    const schema = baseSchema()
    const fontGroup = schema.tabs[0].groups[0]
    const nested: RibbonSchema<TestState, unknown> = {
      ...schema,
      tabs: [
        {
          ...schema.tabs[0],
          groups: [
            {
              ...fontGroup,
              controls: [
                ...fontGroup.controls,
                {
                  kind: 'row',
                  id: 'row1',
                  controls: [
                    {
                      kind: 'button',
                      id: 'bold',
                      command: commandId('docs.format.bold'),
                      size: 'icon',
                      labelKey: 'cmd.bold2',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    const issues = validateSchema(nested, { registry: registry() })
    expect(
      issues.some((i) => i.severity === 'error' && /duplicate control id/.test(i.message)),
    ).toBe(true)
  })

  it('checks command refs inside rows', () => {
    const schema = baseSchema()
    const nested: RibbonSchema<TestState, unknown> = {
      ...schema,
      tabs: [
        {
          ...schema.tabs[0],
          groups: [
            {
              id: 'g',
              labelKey: 'g',
              controls: [
                {
                  kind: 'column',
                  id: 'col1',
                  controls: [
                    {
                      kind: 'button',
                      id: 'x',
                      command: commandId('docs.format.nope'),
                      size: 'icon',
                      labelKey: 'x',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    const issues = validateSchema(nested, { registry: registry() })
    expect(issues.some((i) => /unregistered command "docs.format.nope"/.test(i.message))).toBe(true)
  })

  it('validates control-level disabledWhen expressions', () => {
    const schema = baseSchema()
    const nested: RibbonSchema<TestState, unknown> = {
      ...schema,
      tabs: [
        {
          ...schema.tabs[0],
          groups: [
            {
              id: 'g',
              labelKey: 'g',
              controls: [
                {
                  kind: 'button',
                  id: 'x',
                  size: 'icon',
                  labelKey: 'x',
                  disabledWhen: { bogus: true } as never,
                },
              ],
            },
          ],
        },
      ],
    }
    const issues = validateSchema(nested)
    expect(issues.some((i) => i.path.endsWith('.disabledWhen'))).toBe(true)
  })
})
