/**
 * Command registry: the single dispatch point for ribbon/menu/shortcut
 * actions. Registration failures are loud and immediate (duplicate id, invalid
 * id, missing id on execute) so mistakes surface at app boot — which, for
 * build-time injected patches, means at build time.
 *
 * `register` rejects duplicates; `override` replaces an existing definition
 * and is the channel through which secondary development swaps built-in
 * behavior. `override` requires the id to exist so typos fail loudly too.
 */
import { assertCommandId } from './id'
import type { AnyCommandDefinition, CommandContext, CommandDefinition, CommandId } from './types'

export class CommandRegistry<TState = unknown, TServices = unknown> {
  private readonly commands = new Map<CommandId, AnyCommandDefinition<TState, TServices>>()

  register<TArgs>(definition: CommandDefinition<TState, TServices, TArgs>): void {
    assertCommandId(definition.id)
    if (this.commands.has(definition.id)) {
      throw new Error(
        `Command "${definition.id}" is already registered; use override() to replace it`,
      )
    }
    this.commands.set(definition.id, definition)
  }

  registerAll(definitions: readonly AnyCommandDefinition<TState, TServices>[]): void {
    for (const definition of definitions) this.register(definition)
  }

  /** Replace an already-registered command (secondary development channel). */
  override<TArgs>(definition: CommandDefinition<TState, TServices, TArgs>): void {
    assertCommandId(definition.id)
    if (!this.commands.has(definition.id)) {
      throw new Error(`Cannot override "${definition.id}": no such command registered`)
    }
    this.commands.set(definition.id, definition)
  }

  has(id: string): boolean {
    return this.commands.has(id as CommandId)
  }

  get(id: string): AnyCommandDefinition<TState, TServices> | undefined {
    return this.commands.get(id as CommandId)
  }

  /** All registered ids, optionally filtered to one app/domain prefix. */
  list(prefix?: string): CommandId[] {
    const ids = [...this.commands.keys()]
    return prefix ? ids.filter((id) => id.startsWith(`${prefix}.`)) : ids
  }

  /** Args are typed at the call site (CommandDefinition.run), not in the store. */
  execute(id: string, ctx: CommandContext<TState, TServices>, args?: unknown): void {
    const command = this.commands.get(id as CommandId)
    if (!command) throw new Error(`Cannot execute "${id}": no such command registered`)
    command.run(ctx, args)
  }

  /** Enablement = global gate (renderer) ANDed with the command's own rule. */
  isEnabled(id: string, ctx: CommandContext<TState, TServices>): boolean {
    const command = this.commands.get(id as CommandId)
    if (!command) return false
    return command.isEnabled ? command.isEnabled(ctx) : true
  }

  isActive(id: string, ctx: CommandContext<TState, TServices>): boolean {
    const command = this.commands.get(id as CommandId)
    return command?.isActive ? command.isActive(ctx) : false
  }

  isVisible(id: string, ctx: CommandContext<TState, TServices>): boolean {
    const command = this.commands.get(id as CommandId)
    return command?.isVisible ? command.isVisible(ctx) : true
  }
}

/** Convenience factory: build a registry and register in one call. */
export function createCommandRegistry<TState = unknown, TServices = unknown>(
  definitions: readonly AnyCommandDefinition<TState, TServices>[] = [],
): CommandRegistry<TState, TServices> {
  const registry = new CommandRegistry<TState, TServices>()
  registry.registerAll(definitions)
  return registry
}
