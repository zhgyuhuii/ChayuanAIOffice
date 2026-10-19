import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { realizedPath } from './fs'
import { CliError, EXIT } from './result'

/** The shell's Electron userData directory, located without Electron (GENOFFICE_USER_DATA overrides). */
export function chaofficeUserDataDir(env: NodeJS.ProcessEnv): string {
  if (env.GENOFFICE_USER_DATA) return env.GENOFFICE_USER_DATA
  // Resolve the home from the env we were given (as os.homedir() does with process.env.HOME), so
  // an in-process caller with a substituted HOME never lands in the real user directories.
  const home = env.HOME || homedir()
  const base =
    process.platform === 'darwin'
      ? join(home, 'Library', 'Application Support')
      : process.platform === 'win32'
        ? env.APPDATA || join(home, 'AppData', 'Roaming')
        : env.XDG_CONFIG_HOME || join(home, '.config')
  return join(base, 'ChaOffice')
}

/**
 * Every directory a live ChaOffice may have published its registries under: the
 * packaged profile, then the dev profiles.
 *
 * The dev profile has been spelled two ways. It was `<name> Dev` until
 * chaoffice#1879 moved the shell to `<name>-Dev` — a space breaks XDG config
 * entries, which are meant to be one token (chaoffice#1817) — and the shell
 * renames the old directory on first run after that. Both spellings are
 * scanned here, new first, because a profile that was never migrated still has
 * to be reachable: a custom `GENOFFICE_USER_DATA`, a checkout whose shell has
 * not run since the rename, or a migration that could not move a busy
 * directory.
 *
 * Both readers used to spell this list out on their own, and chaoffice#1879
 * changed the shell without either of them, so the CLI went on looking for a
 * directory nothing wrote to any more (upstream #2054).
 */
export function chaofficeUserDataDirs(env: NodeJS.ProcessEnv): string[] {
  if (env.GENOFFICE_USER_DATA) return [env.GENOFFICE_USER_DATA]
  const packaged = chaofficeUserDataDir(env)
  return [packaged, `${packaged}-Dev`, `${packaged} Dev`]
}

export interface GuiOpenDocuments {
  pid: number
  paths: string[]
}

/**
 * Files the running ChaAI Office shell has open, from the registry it publishes
 * on every tab change (apps/shell/src/main/open-documents.ts). Null when no
 * shell is running: a registry whose pid is gone is a crash leftover.
 */
export function guiOpenDocuments(env: NodeJS.ProcessEnv): GuiOpenDocuments | null {
  // dev spellings: "-Dev" (current) and " Dev" (pre-rename), plus the
  // packaged profile — see chaofficeUserDataDirs (upstream #2054)
  const dirs = chaofficeUserDataDirs(env)
  for (const dir of dirs) {
    const path = join(dir, 'open-documents.json')
    if (!existsSync(path)) continue
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<GuiOpenDocuments>
      if (typeof raw.pid !== 'number' || !Array.isArray(raw.paths)) continue
      if (!processAlive(raw.pid)) continue
      return { pid: raw.pid, paths: raw.paths.filter((p): p is string => typeof p === 'string') }
    } catch {
      continue
    }
  }
  return null
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Refuses to write a document the editor is showing; `--force` skips this. */
export function assertNotOpenInGui(abs: string, env: NodeJS.ProcessEnv): void {
  const open = guiOpenDocuments(env)
  if (!open || open.paths.length === 0) return
  const target = realizedPath(abs)
  if (!open.paths.some((p) => realizedPath(p) === target)) return
  throw new CliError(
    EXIT.file,
    `ChaOffice has this file open: ${abs}`,
    { gui_pid: open.pid },
    {
      reason: 'file_open_in_gui',
      suggestion:
        'close the tab in ChaAI Office first, or pass --force to write anyway (the editor may overwrite your change on its next save)',
    },
  )
}
