import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  type Dirent,
} from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import JSZip from 'jszip'
import { classifySkill, parseSkillFrontmatter, type SkillRelevance } from './imported-skill'
import { getUiLang } from '@chaoffice/i18n'

/**
 * The skills a user installed into ChaAI Office — the single source both
 * forms read. The Electron main imported this logic first (it owns the
 * dialogs); the web/embedded sidecar (apps/server) calls the same functions
 * over HTTP, so the import rules (size caps, entry-name checks, scratch-then-
 * rename) cannot drift between the two.
 *
 * Only `<skillsRoot>/<name>/SKILL.md` counts. Nothing is scanned from a
 * coding agent's directories: a developer's `.claude` holds git, test and
 * deploy skills, and a word processor offering those as candidates was noise
 * for developers and an empty panel for everyone else. A skill arrives here
 * one way — the user picks a folder or a zip and presses Import.
 */

/** one SKILL.md we found, with everything the palette needs to show it */
export interface FoundSkill {
  /** the directory name, which is what `skills/<name>/` is keyed on */
  name: string
  description: string
  /** path of the SKILL.md (absolute on the desktop, root-relative on the web) */
  path: string
  /** whether it talks about a format the app opens, and on what */
  relevance: SkillRelevance
}

/** a skill ChaAI Office ships as a suggestion, with where the user stands on it */
export interface RecommendedSkill extends FoundSkill {
  version: string
  /** the frontmatter's `category`; groups the Recommended list (office, finance, ...) */
  category: string
  /** missing: not installed; installed: same version in our folder; outdated: ours is older */
  state: 'missing' | 'installed' | 'outdated'
}

/**
 * Under the app's own userData, not under the save directory: Home lists every
 * `.md` file under the save directory as a document, so a skills folder there
 * put every imported `SKILL.md` into the user's file list.
 */
export function skillsRoot(userDataDir: string): string {
  return join(userDataDir, 'skills')
}

function describe(name: string, path: string, text: string): FoundSkill | null {
  const fm = parseSkillFrontmatter(text)
  if (!fm) return null
  return {
    name,
    description: fm.description,
    path,
    relevance: classifySkill(fm.name, fm.description),
  }
}

/**
 * A permission error on one skill must not hide the others, so each is read
 * independently and a failure is just an absence. Async because this runs on
 * the main process while windows are open.
 */
export async function usableSkills(userDataDir: string): Promise<FoundSkill[]> {
  const root = skillsRoot(userDataDir)
  let entries: string[]
  try {
    entries = await readdir(root)
  } catch {
    return []
  }
  const out: FoundSkill[] = []
  for (const name of entries.sort()) {
    if (name.startsWith('.')) continue
    const path = join(root, name, 'SKILL.md')
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch {
      continue
    }
    const skill = describe(name, path, text)
    if (skill) out.push(skill)
  }
  return out
}

/** the body of a skill, for the turn that runs it */
export function readSkillBody(path: string): string {
  const fm = parseSkillFrontmatter(readFileSync(path, 'utf8'))
  return fm?.body ?? ''
}

const MAX_IMPORT_BYTES = 10 * 1024 * 1024

/**
 * A symlink is refused rather than dereferenced: `cpSync` without
 * `dereference` would carry the link across and the imported skill would keep
 * reaching back into whatever it points at, while dereferencing would copy in
 * arbitrarily much from anywhere on disk. The same walk bounds the copy.
 */
function inspectSkillDir(dir: string): void {
  let rootIsLink: boolean
  try {
    rootIsLink = lstatSync(dir).isSymbolicLink()
  } catch {
    throw new Error('the skill directory could not be read')
  }
  if (rootIsLink) throw new Error('the skill directory is a symlink, and imports refuse those')
  let total = 0
  const stack: string[] = [dir]
  while (stack.length > 0) {
    const cur = stack.pop()!
    let entries: Dirent[]
    try {
      entries = readdirSync(cur, { withFileTypes: true })
    } catch {
      throw new Error('the skill directory could not be read')
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        throw new Error('the skill contains a symlink, and imports refuse those')
      }
      const full = join(cur, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      let size: number
      try {
        size = statSync(full).size
      } catch {
        throw new Error('the skill directory could not be read')
      }
      total += size
      if (total > MAX_IMPORT_BYTES) {
        throw new Error('the skill is larger than the 10 MB import cap')
      }
    }
  }
}

function readBack(dest: string): FoundSkill {
  const skill = describe(
    basename(dest),
    join(dest, 'SKILL.md'),
    readFileSync(join(dest, 'SKILL.md'), 'utf8'),
  )
  if (!skill) throw new Error('the skill could not be read back')
  return skill
}

function requireSkillMd(dir: string): void {
  let text: string
  try {
    text = readFileSync(join(dir, 'SKILL.md'), 'utf8')
  } catch {
    throw new Error('the folder has no SKILL.md')
  }
  if (!parseSkillFrontmatter(text)) {
    throw new Error('SKILL.md needs name and description frontmatter')
  }
}

/**
 * Copy a folder the user picked into our skills folder.
 *
 * The whole directory goes rather than the SKILL.md alone: a skill routinely
 * ships reference tables, templates and helper scripts next to its
 * instructions. Refuses rather than overwrites when the name is taken.
 */
export function importSkillDir(skillDir: string, userDataDir: string): FoundSkill {
  const dest = join(skillsRoot(userDataDir), basename(skillDir))
  if (existsSync(dest)) throw new Error('a skill of that name is already there')
  requireSkillMd(skillDir)
  inspectSkillDir(skillDir)
  cpSync(skillDir, dest, { recursive: true })
  return readBack(dest)
}

/**
 * Import a single markdown file as a skill.
 *
 * The file becomes `<name>/SKILL.md`; the name comes from the frontmatter and
 * falls back to the file stem when `name` cannot be a folder name. Refuses
 * rather than overwrites when the name is taken.
 */
export function importSkillMd(mdPath: string, userDataDir: string): FoundSkill {
  let text: string
  try {
    text = readFileSync(mdPath, 'utf8')
  } catch {
    throw new Error('the file could not be read')
  }
  return importMdBytes(basename(mdPath), Buffer.from(text, 'utf8'), userDataDir)
}

/**
 * The byte-level core of the markdown import — the web form uploads bytes, it
 * has no path to read. Same rules, same errors as `importSkillMd`.
 */
export function importMdBytes(fileName: string, bytes: Buffer, userDataDir: string): FoundSkill {
  if (bytes.length > MAX_IMPORT_BYTES) {
    throw new Error('the skill is larger than the 10 MB import cap')
  }
  const text = bytes.toString('utf8')
  const fm = parseSkillFrontmatter(text)
  if (!fm) throw new Error('SKILL.md needs name and description frontmatter')
  const stem = fileName.replace(/\.md$/i, '')
  const name = [fm.name.trim(), stem].find((n) => isSkillName(n))
  if (!name) throw new Error('the file name cannot be used as a skill name')
  return writeSkillFiles([{ name: 'SKILL.md', bytes }], name, userDataDir)
}

function isSkillName(name: string): boolean {
  return /^[^/\\:*?"<>|]+$/.test(name) && isListedName(name)
}

/** What `usableSkills` lists: one readdir entry, not a dot folder, not a path. */
function isListedName(name: string): boolean {
  return name.length > 0 && !/[/\\]/.test(name) && !name.startsWith('.')
}

/**
 * Inflate one entry, giving up the moment it passes `limit`. A tiny archive can
 * declare and inflate to gigabytes, so the cap has to bite during inflation,
 * not after `async('nodebuffer')` has already handed back the whole payload.
 */
function inflateWithin(entry: JSZip.JSZipObject, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const stream = entry.nodeStream('nodebuffer')
    stream
      .on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > limit) {
          stream.pause()
          stream.removeAllListeners('data')
          reject(new Error('the skill is larger than the 10 MB import cap'))
          return
        }
        chunks.push(chunk)
      })
      .on('error', reject)
      .on('end', () => resolve(Buffer.concat(chunks)))
  })
}

const S_IFMT = 0o170000
const S_IFLNK = 0o120000

/**
 * The entry checks both zip imports share: an absolute or `..` name, a
 * backslash, or a symlink entry refuses the whole archive.
 */
function checkEntryNames(files: JSZip.JSZipObject[]): void {
  for (const f of files) {
    const parts = f.name.split('/')
    if (isAbsolute(f.name) || f.name.includes('\\') || parts.some((p) => p === '..' || p === '')) {
      throw new Error(`the archive has an unsafe entry name: ${f.name}`)
    }
    if (f.unixPermissions != null && (Number(f.unixPermissions) & S_IFMT) === S_IFLNK) {
      throw new Error('the archive contains a symlink, and imports refuse those')
    }
  }
}

/**
 * Where the SKILL.md sits and what the skill is therefore called: at the
 * archive root (named after `fallbackName`) or under exactly one top-level
 * folder (named after the folder).
 */
function skillPrefix(files: JSZip.JSZipObject[], fallbackName: string): { prefix: string; name: string } {
  const atRoot = files.find((f) => f.name === 'SKILL.md')
  const tops = new Set(files.map((f) => f.name.split('/')[0]))
  if (atRoot) return { prefix: '', name: fallbackName }
  if (tops.size === 1 && files.some((f) => f.name === `${[...tops][0]}/SKILL.md`)) {
    return { prefix: `${[...tops][0]}/`, name: [...tops][0] }
  }
  throw new Error('the archive has no SKILL.md at its root or under one folder')
}

/** scratch dir, checked write, atomic rename into place; a refusal leaves nothing behind */
function writeSkillFiles(
  files: Array<{ name: string; bytes: Buffer }>,
  name: string,
  userDataDir: string,
): FoundSkill {
  if (!isSkillName(name)) {
    throw new Error('the archive name cannot be used as a skill name')
  }
  const dest = join(skillsRoot(userDataDir), name)
  if (existsSync(dest)) throw new Error('a skill of that name is already there')

  mkdirSync(skillsRoot(userDataDir), { recursive: true })
  const scratch = mkdtempSync(join(skillsRoot(userDataDir), '.import-'))
  try {
    let total = 0
    for (const f of files) {
      total += f.bytes.length
      if (total > MAX_IMPORT_BYTES) {
        throw new Error('the skill is larger than the 10 MB import cap')
      }
      const rel = f.name.split('/').join(sep)
      const target = join(scratch, rel)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, f.bytes)
    }
    requireSkillMd(scratch)
    renameSync(scratch, dest)
  } catch (e) {
    rmSync(scratch, { recursive: true, force: true })
    throw e
  }
  return readBack(dest)
}

/**
 * Unpack a zip the user picked into our skills folder.
 *
 * Accepts `SKILL.md` at the archive root (the skill is then named after the
 * file) or under exactly one top-level folder (named after the folder). Entry
 * names are checked before any byte is written; everything lands in a scratch
 * dir first and is renamed into place at the end, so a refusal half-way leaves
 * nothing behind.
 */
export async function importSkillZip(zipPath: string, userDataDir: string): Promise<FoundSkill> {
  let bytes: Buffer
  try {
    bytes = readFileSync(zipPath)
  } catch {
    throw new Error('the file is not a zip archive')
  }
  return importZipBytes(basename(zipPath), bytes, userDataDir)
}

/**
 * The byte-level core of the zip import — the web form uploads the archive,
 * it has no path to read. Same rules, same errors as `importSkillZip`.
 */
export async function importZipBytes(
  zipName: string,
  bytes: Buffer,
  userDataDir: string,
): Promise<FoundSkill> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch {
    throw new Error('the file is not a zip archive')
  }
  const listed = Object.values(zip.files).filter((f) => !f.dir && !f.name.startsWith('__MACOSX/'))
  checkEntryNames(listed)
  const { prefix, name } = skillPrefix(listed, zipName.replace(/\.zip$/i, ''))
  const dest = join(skillsRoot(userDataDir), name)
  if (existsSync(dest)) throw new Error('a skill of that name is already there')
  // the desktop import created the skills root before inflating: an archive
  // that dies mid-inflation leaves the (empty) root behind, matching that
  mkdirSync(skillsRoot(userDataDir), { recursive: true })
  const files: Array<{ name: string; bytes: Buffer }> = []
  let total = 0
  for (const f of listed) {
    const bytes = await inflateWithin(f, MAX_IMPORT_BYTES - total)
    total += bytes.length
    files.push({ name: f.name.slice(prefix.length), bytes })
  }
  return writeSkillFiles(files, name, userDataDir)
}

/**
 * Import a folder the web form picked with a directory chooser: the browser
 * hands over `{relativePath, bytes}` pairs instead of a path on disk. The same
 * layout rule applies — `SKILL.md` at the root, or under exactly one top-level
 * folder — and the same checks: no absolute or `..` names, no backslashes, no
 * dot-file entries, and the same total size cap.
 */
export function importDirBytes(
  entries: Array<{ path: string; bytes: Buffer }>,
  userDataDir: string,
): FoundSkill {
  for (const e of entries) {
    const parts = e.path.split('/')
    if (isAbsolute(e.path) || e.path.includes('\\') || parts.some((p) => p === '..' || p === '')) {
      throw new Error(`the folder has an unsafe entry name: ${e.path}`)
    }
  }
  const names = entries.map((e) => ({ name: e.path, bytes: e.bytes }))
  const atRoot = names.find((f) => f.name === 'SKILL.md')
  const tops = new Set(names.map((f) => f.name.split('/')[0]))
  let prefix = ''
  let name: string
  if (atRoot) {
    name = 'imported-skill'
  } else if (tops.size === 1 && names.some((f) => f.name === `${[...tops][0]}/SKILL.md`)) {
    prefix = `${[...tops][0]}/`
    name = [...tops][0]
  } else {
    throw new Error('the folder has no SKILL.md at its root or under one folder')
  }
  return writeSkillFiles(
    names.map((f) => ({ name: f.name.slice(prefix.length), bytes: f.bytes })),
    name,
    userDataDir,
  )
}

/**
 * Delete one of our skills. `name` must be a plain folder name that holds a
 * SKILL.md under the skills root, so the renderer can only remove what the
 * listing showed it.
 */
export function removeSkill(name: string, userDataDir: string): void {
  if (typeof name !== 'string' || !isListedName(name)) throw new Error('unknown skill')
  const dir = join(skillsRoot(userDataDir), name)
  if (!existsSync(join(dir, 'SKILL.md'))) throw new Error('unknown skill')
  rmSync(dir, { recursive: true, force: true })
}

/**
 * Whether a path is one of the SKILL.md files the listing can hand out.
 *
 * `readSkillBody` takes a path from the renderer, so on its own it reads any
 * file on disk. The name must be SKILL.md and its directory's directory must
 * be the skills root — the exact shape `usableSkills` builds, so what can be
 * read and what was listed are the same set. `dirname` never collapses `..`,
 * so an escaping path keeps its `..` and cannot match the resolved root.
 */
export function isKnownSkillPath(path: unknown, root: string): path is string {
  if (typeof path !== 'string' || path === '' || !isAbsolute(path)) return false
  const file = resolve(path)
  if (basename(file) !== 'SKILL.md') return false
  return resolve(root) === dirname(dirname(file))
}

/** `metadata:\n  version: x` in the frontmatter, the same shape skills/chaoffice uses */
export function skillVersion(path: string): string {
  try {
    const fm = parseSkillFrontmatter(readFileSync(path, 'utf8'))
    return /^\s*version:\s*['"]?([^'"\n]+)/m.exec(fm?.extra.metadata ?? '')?.[1]?.trim() ?? ''
  } catch {
    return ''
  }
}

/**
 * The skills we ship as suggestions, with whether the user already has each.
 *
 * Shipping them is not installing them: a recommended skill only runs after
 * the user presses Install, which copies it into our folder like any import.
 * Installed copies are the user's — they may edit them — so an update is
 * offered, never applied on its own.
 *
 * `lang` localizes the frontmatter's English descriptions from
 * `locales/<lang>.json` ('en' has no file — the frontmatter is the source);
 * the desktop passes its UI language, the web form passes the browser's.
 */
export async function recommendedSkills(
  recommendedDir: string,
  userDataDir: string,
  /** defaults to the process UI language (setUiLang), exactly as the desktop main read it */
  lang: string = getUiLang(),
): Promise<RecommendedSkill[]> {
  let entries: string[]
  try {
    entries = await readdir(recommendedDir)
  } catch {
    return []
  }
  const out: RecommendedSkill[] = []
  for (const name of entries.sort()) {
    if (name === 'locales') continue // localized descriptions, not a skill
    const path = join(recommendedDir, name, 'SKILL.md')
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch {
      continue
    }
    const skill = describe(name, path, text)
    if (!skill) continue
    const category = parseSkillFrontmatter(text)?.extra.category?.trim() || 'other'
    const version = skillVersion(path)
    const installedAt = join(skillsRoot(userDataDir), name, 'SKILL.md')
    let state: RecommendedSkill['state'] = 'missing'
    if (existsSync(installedAt)) {
      state = skillVersion(installedAt) === version ? 'installed' : 'outdated'
    }
    out.push({ ...skill, category, version, state })
  }
  // the frontmatter descriptions are English; locales/<lang>.json carries the
  // per-language ones, so the Recommended list speaks the UI's language.
  for (const [name, description] of Object.entries(recommendedDescriptions(recommendedDir, lang))) {
    const skill = out.find((s) => s.name === name)
    if (skill && typeof description === 'string' && description) skill.description = description
  }
  return out
}

/** skill name -> localized description for the UI language, when the file exists */
function recommendedDescriptions(recommendedDir: string, lang: string): Record<string, string> {
  try {
    return JSON.parse(
      readFileSync(join(recommendedDir, 'locales', `${lang}.json`), 'utf8'),
    ) as Record<string, string>
  } catch {
    return {}
  }
}

/**
 * Copy one recommended skill into our folder. `name` is matched against the
 * recommended directory's own listing, so the renderer cannot name a path.
 * An existing copy is replaced only here, because the user asked for exactly
 * that by pressing Update.
 */
export function installRecommendedSkill(
  name: string,
  recommendedDir: string,
  userDataDir: string,
): FoundSkill {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new Error('unknown skill')
  const src = join(recommendedDir, name)
  if (!existsSync(join(src, 'SKILL.md'))) throw new Error('unknown skill')
  const dest = join(skillsRoot(userDataDir), name)
  requireSkillMd(src)
  inspectSkillDir(src)
  mkdirSync(skillsRoot(userDataDir), { recursive: true })
  const scratch = mkdtempSync(join(skillsRoot(userDataDir), '.install-'))
  // the user's copy steps aside rather than being deleted, so a failed swap puts it back
  const parked = `${scratch}.previous`
  let moved = false
  try {
    cpSync(src, scratch, { recursive: true })
    if (existsSync(dest)) {
      renameSync(dest, parked)
      moved = true
    }
    renameSync(scratch, dest)
  } catch (e) {
    if (moved && !existsSync(dest)) renameSync(parked, dest)
    tryRm(scratch)
    throw e
  }
  // the swap is done; a locked leftover must not turn a finished install into a failure
  if (moved) tryRm(parked)
  return readBack(dest)
}

function tryRm(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true })
  } catch {
    /* EPERM/EBUSY under antivirus or a file lock; dot folders are skipped by usableSkills */
  }
}
