/**
 * File menu commands (B3): the legacy file dropdown (Ribbon.tsx) routes
 * open/save/saveAs through these. Pure service delegation — no editor access,
 * no chain. Enablement mirrors the legacy disabled attributes (open always
 * available, save/saveAs need an open document).
 */
import { commandId, type AnyCommandDefinition, type CommandContext } from '@chatoffice/ribbon'
import type { DocsCommandState } from '../command-state'
import type { DocsCommandServices } from '../host-services'

type State = DocsCommandState
type Services = DocsCommandServices
type Ctx = CommandContext<State, Services>

const hasDoc = (ctx: Ctx) => ctx.state.hasDoc

export const FILE_COMMANDS: readonly AnyCommandDefinition<State, Services>[] = [
  {
    id: commandId('docs.file.open'),
    run: (ctx) => ctx.services.file.open(),
  },
  {
    id: commandId('docs.file.save'),
    isEnabled: hasDoc,
    run: (ctx) => ctx.services.file.save(),
  },
  {
    id: commandId('docs.file.saveAs'),
    isEnabled: hasDoc,
    run: (ctx) => ctx.services.file.saveAs(),
  },
]
