/**
 * Command id convention: `app.domain.action[.sub]` — 3 or 4 segments, each
 * starting lowercase (camelCase allowed inside, e.g. docs.format.fontSize.set).
 * Segment 1 is the app (docs / sheets / slides / pdf / markdown); segment 2 a
 * domain (file / edit / format / insert / table / view / review / ...); the
 * rest a verb. Only the shape is enforced here, not the segment vocabulary,
 * so secondary development can introduce new apps and domains.
 */
import type { CommandId } from './types'

const COMMAND_ID_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*){2,3}$/

export function isCommandId(value: string): value is CommandId {
  return COMMAND_ID_PATTERN.test(value)
}

export function assertCommandId(value: string): asserts value is CommandId {
  if (!isCommandId(value)) {
    throw new Error(
      `Invalid command id "${value}": expected app.domain.action[.sub], 3-4 lowercase segments (e.g. docs.format.bold)`,
    )
  }
}

/** Validating constructor for command ids. */
export function commandId(value: string): CommandId {
  assertCommandId(value)
  return value
}
