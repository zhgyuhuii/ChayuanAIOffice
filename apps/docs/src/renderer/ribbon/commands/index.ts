/**
 * All docs command sets registered so far, in one array for the host registry
 * (App wires the live registry at C2; tests build their own).
 */
import type { AnyCommandDefinition } from '@chatoffice/ribbon'
import type { DocsCommandState } from '../command-state'
import type { DocsCommandServices } from '../host-services'
import { FILE_COMMANDS } from './file'
import { HOME_COMMANDS } from './home'

export const DOCS_COMMANDS: readonly AnyCommandDefinition<DocsCommandState, DocsCommandServices>[] =
  [...FILE_COMMANDS, ...HOME_COMMANDS]
