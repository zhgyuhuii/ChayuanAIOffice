/**
 * Desktop-form knowledge-base IPC (docs/kb-integration-plan.md §5.2).
 *
 * Registers the kb:* channels in an app main (shell main covers the home chat
 * and every embedded editor view; standalone editor mains register the same
 * handler set for their dev form). The service owns the four-level discovery
 * (manual override → cached → hint file → loopback probe), persists the
 * manual origin + last-good origin next to the app settings, and exposes the
 * read-only chatop-kb surface. Every app main registers identical channels —
 * the renderer facade simply talks to whichever process hosts it.
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import {
  createKbHttpClient,
  discoverHarnessKb,
  type KbDiscoveryResult,
  type KbDocRecord,
  type KbHttpClient,
  type KbHit,
  type KbStatus,
} from '@chatoffice/ai-provider'
import { KB_CHANNELS } from './kb-channels'

/** minimal handle surface so this module does not import the main index barrel;
 *  bivariant any-params slot Electron's IpcMain in (same trick as IpcMainLike) */
interface IpcRegister {
  handle(channel: string, listener: (event: any, ...args: any[]) => any): unknown
  /** LOCAL(2026-09-21, d8201ad0): 重复注册防崩——shell 启动已注册 kb 通道时,编辑器
   * 标签的 registerSharedKbIpc 再次注册改为 last-wins(Electron ipcMain 自带) */
  removeHandler?(channel: string): void
}

export interface SharedKbIpcDeps {
  ipcMain: IpcRegister
  /**
   * absolute path of the persisted source state (kb-source.json in userData).
   * A resolver is preferred: it defers the electron `app.getPath` call to
   * first handle time, so bare test harnesses can register the channels too.
   */
  statePath: string | (() => string)
  /**
   * download target directory resolver for kb:file (defers the electron
   * `app.getPath('downloads')` call the same way). Absent = the channel
   * answers kb-download-unsupported and the renderer hides the affordance.
   */
  downloadsDir?: string | (() => string)
  /** post-save reveal (shell.showItemInFolder in real mains; omitted in tests) */
  reveal?: (path: string) => void
}

export interface KbSourceState {
  /** manual override configured in settings (absent = auto discovery) */
  manualOrigin?: string
  /** last discovered origin, tried before probing on the next start */
  cachedOrigin?: string
}

export interface KbFileResult {
  ok: boolean
  reason?: string
  /** absolute path of the saved download (desktop form) */
  savedPath?: string
}

/** collision-avoiding target path: stem (1).ext / stem (2).ext, … */
function uniqueDownloadPath(dir: string, name: string): string {
  const safe =
    basename(name)
      .replace(/[\\/]+/g, '_')
      .trim() || 'document'
  const stem = safe.replace(/\.[^.]*$/, '') || safe
  const ext = extname(safe)
  let candidate = join(dir, safe)
  for (let i = 1; existsSync(candidate); i++) {
    candidate = join(dir, `${stem} (${i})${ext}`)
  }
  return candidate
}

interface KbDiscoverPayload {
  ok: boolean
  reason?: 'kb-unavailable'
  origin?: string
  source?: KbDiscoveryResult['source']
  status?: KbStatus
}

async function readState(path: string): Promise<KbSourceState> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as KbSourceState
  } catch {
    return {}
  }
}

async function writeState(path: string, state: KbSourceState): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(state, null, 2), 'utf8')
}

export function registerSharedKbIpc(deps: SharedKbIpcDeps): void {
  const { ipcMain } = deps
  const resolveStatePath = (): string =>
    typeof deps.statePath === 'function' ? deps.statePath() : deps.statePath
  let client: KbHttpClient | null = null
  let clientOrigin = ''

  const getClient = async (origin: string): Promise<KbHttpClient> => {
    if (!client || clientOrigin !== origin) {
      client = createKbHttpClient({ baseUrl: origin })
      clientOrigin = origin
    }
    return client
  }

  /** discovery with cache bookkeeping; manual override wins, probe is the floor */
  const discover = async (): Promise<KbDiscoverPayload> => {
    const state = await readState(resolveStatePath())
    const found = await discoverHarnessKb({
      ...(state.manualOrigin ? { explicitOrigin: state.manualOrigin } : {}),
      ...(state.cachedOrigin ? { cachedOrigin: state.cachedOrigin } : {}),
    })
    if (!found) return { ok: false, reason: 'kb-unavailable' }
    if (found.source !== 'manual' && found.origin !== state.cachedOrigin) {
      state.cachedOrigin = found.origin
      await writeState(resolveStatePath(), state).catch(() => undefined)
    }
    return { ok: true, ...found }
  }

  ipcMain.removeHandler?.(String(KB_CHANNELS.discover))
  ipcMain.handle(KB_CHANNELS.discover, (): Promise<KbDiscoverPayload> => discover())

  ipcMain.removeHandler?.(String(KB_CHANNELS.list))
  ipcMain.handle(KB_CHANNELS.list, async (): Promise<KbDiscoverPayload> => discover())

  ipcMain.removeHandler?.(String(KB_CHANNELS.search))
  ipcMain.handle(
    KB_CHANNELS.search,
    async (
      _event,
      args: { kbIds: string[]; q: string; topK?: number },
    ): Promise<{ ok: boolean; reason?: string; groups?: KbHit[][]; origin?: string }> => {
      const found = await discover()
      if (!found.ok) return { ok: false }
      const kb = await getClient(found.origin!)
      const topK = Math.min(Math.max(args.topK ?? 6, 1), 20)
      // per-KB groups: the renderer round-robins them through mergeKbHits
      const groups = await Promise.all(
        args.kbIds.map((kbId) => kb.search(kbId, args.q, topK).catch(() => [] as KbHit[])),
      )
      return { ok: true, origin: found.origin!, groups }
    },
  )

  ipcMain.removeHandler?.(String(KB_CHANNELS.doc))
  ipcMain.handle(
    KB_CHANNELS.doc,
    async (
      _event,
      args: { kbId: string; docId: string },
    ): Promise<{ ok: boolean; reason?: string; doc?: KbDocRecord }> => {
      const found = await discover()
      if (!found.ok) return { ok: false }
      const kb = await getClient(found.origin!)
      try {
        return { ok: true, doc: await kb.doc(args.kbId, args.docId) }
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  // download the source document behind a citation: fetch bytes in main (no
  // CORS, no session download dialog), drop them in the downloads folder and
  // reveal in the OS file manager
  ipcMain.removeHandler?.(String(KB_CHANNELS.file))
  ipcMain.handle(
    KB_CHANNELS.file,
    async (_event, args: { kbId: string; docId: string }): Promise<KbFileResult> => {
      const dir = typeof deps.downloadsDir === 'function' ? deps.downloadsDir() : deps.downloadsDir
      if (!dir) return { ok: false, reason: 'kb-download-unsupported' }
      const found = await discover()
      if (!found.ok) return { ok: false, reason: 'kb-unavailable' }
      const kb = await getClient(found.origin!)
      try {
        const file = await kb.file(args.kbId, args.docId)
        const target = uniqueDownloadPath(dir, file.name)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, Buffer.from(file.bytes))
        deps.reveal?.(target)
        return { ok: true, savedPath: target }
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.removeHandler?.(String(KB_CHANNELS.getSource))
  ipcMain.handle(KB_CHANNELS.getSource, (): Promise<KbSourceState> => readState(resolveStatePath()))

  ipcMain.removeHandler?.(String(KB_CHANNELS.setOrigin))
  ipcMain.handle(
    KB_CHANNELS.setOrigin,
    async (_event, origin: string | null): Promise<KbSourceState> => {
      const state = await readState(resolveStatePath())
      const trimmed = (origin ?? '').trim()
      if (trimmed) {
        if (!/^https?:\/\//.test(trimmed)) throw new Error('origin must be http(s)')
        // only loopback targets unless explicitly pointed elsewhere by the user
        state.manualOrigin = trimmed.replace(/\/$/, '')
      } else {
        delete state.manualOrigin
      }
      await writeState(resolveStatePath(), state)
      return state
    },
  )
}
