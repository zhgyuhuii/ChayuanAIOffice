import { describe, expect, it } from 'vitest'
import { assertCommandId, commandId, isCommandId } from '../src/command/id'
import { CommandRegistry, createCommandRegistry } from '../src/command/registry'
import type { CommandContext, CommandDefinition } from '../src/command/types'

interface TestState {
  readonly canEdit: boolean
  readonly bold: boolean
}

interface TestServices {
  readonly log: string[]
}

type Ctx = CommandContext<TestState, TestServices>

const ctx = (state: Partial<TestState> = {}): Ctx => ({
  state: { canEdit: true, bold: false, ...state },
  services: { log: [] },
})

const cmd = (id: string, run?: (ctx: Ctx) => void): CommandDefinition<TestState, TestServices> => ({
  id: commandId(id),
  run: run ?? (() => {}),
})

describe('commandId', () => {
  it('accepts 3-4 lowercase segments', () => {
    expect(isCommandId('docs.format.bold')).toBe(true)
    expect(isCommandId('docs.format.fontSize.set')).toBe(true)
    expect(commandId('sheets.cell.merge')).toBe('sheets.cell.merge')
  })

  it('rejects malformed ids', () => {
    for (const bad of [
      '',
      'docs',
      'docs.format',
      'Docs.format.bold',
      'docs.Format.bold',
      'docs.format.Bold',
      'docs.format.bold.extra.deep',
      'docs..bold',
      'docs.format-bold',
      'docs.format.b old',
      '1docs.format.bold',
    ]) {
      expect(isCommandId(bad), bad).toBe(false)
      expect(() => assertCommandId(bad), bad).toThrow(/Invalid command id/)
    }
  })
})

describe('CommandRegistry', () => {
  it('registers and executes commands with context and args', () => {
    const registry = new CommandRegistry<TestState, TestServices>()
    registry.register(cmd('docs.format.bold', (c) => c.services.log.push('bold')))
    registry.register<string>({
      id: commandId('docs.format.fontSize.set'),
      run: (c, size) => c.services.log.push(`size:${size}`),
    })
    const c = ctx()
    registry.execute('docs.format.bold', c)
    registry.execute('docs.format.fontSize.set', c, '12')
    expect(c.services.log).toEqual(['bold', 'size:12'])
  })

  it('rejects duplicate registration with a useful error', () => {
    const registry = createCommandRegistry<TestState, TestServices>([cmd('docs.file.save')])
    expect(() => registry.register(cmd('docs.file.save'))).toThrow(/already registered.*override/)
  })

  it('override replaces an existing command; unknown id throws', () => {
    const registry = createCommandRegistry<TestState, TestServices>([
      cmd('docs.file.save', (c) => c.services.log.push('original')),
    ])
    registry.override(cmd('docs.file.save', (c) => c.services.log.push('patched')))
    const c = ctx()
    registry.execute('docs.file.save', c)
    expect(c.services.log).toEqual(['patched'])
    expect(() => registry.override(cmd('docs.file.open'))).toThrow(/no such command/)
  })

  it('executing an unknown command throws', () => {
    const registry = new CommandRegistry<TestState, TestServices>()
    expect(() => registry.execute('docs.edit.undo', ctx())).toThrow(/no such command/)
  })

  it('lists commands, optionally by prefix', () => {
    const registry = createCommandRegistry<TestState, TestServices>([
      cmd('docs.format.bold'),
      cmd('docs.format.italic'),
      cmd('sheets.cell.merge'),
    ])
    expect(registry.list()).toHaveLength(3)
    expect(registry.list('docs')).toEqual(['docs.format.bold', 'docs.format.italic'])
    expect(registry.list('docs.format')).toEqual(['docs.format.bold', 'docs.format.italic'])
    expect(registry.has('sheets.cell.merge')).toBe(true)
    expect(registry.get('sheets.cell.merge')?.id).toBe('sheets.cell.merge')
  })

  it('evaluates enablement/active/visible with defaults', () => {
    const registry = createCommandRegistry<TestState, TestServices>([
      {
        ...cmd('docs.format.bold'),
        isEnabled: (c) => c.state.canEdit,
        isActive: (c) => c.state.bold,
      },
      cmd('docs.file.open'),
      { ...cmd('docs.review.compare'), isVisible: () => false },
    ])
    expect(registry.isEnabled('docs.format.bold', ctx({ canEdit: false }))).toBe(false)
    expect(registry.isEnabled('docs.format.bold', ctx())).toBe(true)
    expect(registry.isActive('docs.format.bold', ctx({ bold: true }))).toBe(true)
    // no rules at all → enabled, inactive, visible
    expect(registry.isEnabled('docs.file.open', ctx())).toBe(true)
    expect(registry.isActive('docs.file.open', ctx())).toBe(false)
    expect(registry.isVisible('docs.file.open', ctx())).toBe(true)
    expect(registry.isVisible('docs.review.compare', ctx())).toBe(false)
    // unknown ids: disabled, but visible/active fall back to defaults
    expect(registry.isEnabled('docs.edit.nope', ctx())).toBe(false)
    expect(registry.isActive('docs.edit.nope', ctx())).toBe(false)
    expect(registry.isVisible('docs.edit.nope', ctx())).toBe(true)
  })
})
