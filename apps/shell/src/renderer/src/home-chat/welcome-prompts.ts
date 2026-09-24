import type { StringKey, TFunc } from '../locale'

/** landing sub-greeting, chayuan-wps style: opening × ability × action =
 * 64 combinations, one random pick per landing visit, never the same pick
 * twice in a row (module state — reseeds on app restart, no persistence) */

const OPEN_KEYS = [
  'welcomeOpen1',
  'welcomeOpen2',
  'welcomeOpen3',
  'welcomeOpen4',
] as const satisfies readonly StringKey[]

const ABILITY_KEYS = [
  'welcomeAbility1',
  'welcomeAbility2',
  'welcomeAbility3',
  'welcomeAbility4',
] as const satisfies readonly StringKey[]

const ACTION_KEYS = [
  'welcomeAction1',
  'welcomeAction2',
  'welcomeAction3',
  'welcomeAction4',
] as const satisfies readonly StringKey[]

let lastIndex = -1

export function pickWelcomePrompt(t: TFunc): string {
  const total = OPEN_KEYS.length * ABILITY_KEYS.length * ACTION_KEYS.length
  let index = Math.floor(Math.random() * total)
  if (total > 1 && index === lastIndex) index = (index + 1) % total
  lastIndex = index
  const action = ACTION_KEYS[index % ACTION_KEYS.length]!
  const ability = ABILITY_KEYS[Math.floor(index / ACTION_KEYS.length) % ABILITY_KEYS.length]!
  const opening =
    OPEN_KEYS[Math.floor(index / (ACTION_KEYS.length * ABILITY_KEYS.length)) % OPEN_KEYS.length]!
  return `${t(opening)}${t(ability)}${t(action)}`
}
