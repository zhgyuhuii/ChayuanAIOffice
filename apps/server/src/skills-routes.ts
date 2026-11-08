/**
 * User-skills endpoints for the web/embedded forms — the HTTP port of the
 * desktop main's skills channels (integrations pane + composer picker), backed
 * by the same `@chaoffice/agent-core/skills-store` the Electron main calls, so
 * both forms enforce identical import rules (10 MB cap, entry-name checks,
 * scratch-then-rename installs).
 *
 * Installed skills live under `<dataDir>/skills`; the recommended catalog and
 * the bundled chaoffice agent skill ride the payload (`<root>/skills/…`,
 * resolvable relative to this file both in the repo and in the assembled
 * sidecar, overridable with CHAOFFICE_RECOMMENDED_SKILLS_DIR for deployments
 * that serve the payload read-only).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import JSZip from 'jszip'
import {
  installRecommendedSkill,
  readSkillBody,
  recommendedSkills,
  removeSkill,
  skillVersion,
  usableSkills,
  importDirBytes,
  importMdBytes,
  importZipBytes,
  type FoundSkill,
} from '@chaoffice/agent-core/skills-store'

export interface SkillsRoutesOptions {
  /** storage root (same dir as ai-settings.json); skills live at `<dataDir>/skills` */
  dataDir: string
  /** recommended catalog override (default: the payload's skills/recommended) */
  recommendedDir?: string
}

const MAX_BODY_BYTES = 12 * 1024 * 1024 // base64 upload ceiling (~9 MB binary; store cap is 10 MB)
const MAX_FILE_COUNT = 2000
/** mirrors the desktop's ai:skill-text clip (user-cli MAX_STD_CHARS) */
const MAX_TEXT_CHARS = 32_000

/** payload root skills/ dir — three ups from apps/server/src/, repo and sidecar alike */
function bundledSkillsDir(): string {
  const override = process.env.CHAOFFICE_RECOMMENDED_SKILLS_DIR
  if (override) return resolve(override)
  return fileURLToPath(new URL('../../../skills', import.meta.url))
}

function decodeB64(value: unknown, what: string): Buffer {
  if (typeof value !== 'string' || value === '') throw new Error(`${what} must be base64 text`)
  if (value.length > MAX_BODY_BYTES) throw new Error(`${what} is larger than the import cap`)
  return Buffer.from(value, 'base64')
}

export function attachSkillsRoutes(app: FastifyInstance, options: SkillsRoutesOptions): void {
  // the store appends `skills` itself (desktop parity: userDataDir/skills)
  const userDataDir = resolve(options.dataDir)
  const bundled = bundledSkillsDir()
  const recommendedDir = options.recommendedDir ?? join(bundled, 'recommended')
  const agentSkillDir = join(bundled, 'chaoffice')

  const langOf = (request: { query?: Record<string, unknown> }): string => {
    const lang = String((request.query as { lang?: string } | undefined)?.lang ?? 'zh').trim()
    return /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(lang) ? lang : 'zh'
  }

  /** by-name lookup over what the listing shows — a name outside it reads nothing */
  const readText = async (rawName: unknown, clip: boolean): Promise<string> => {
    const name = typeof rawName === 'string' ? rawName.trim() : ''
    if (!name) throw new Error('a skill name is required')
    const skills = await usableSkills(userDataDir)
    const skill = skills.find((s) => s.name === name)
    if (!skill) throw new Error(`no installed skill named "${name}"`)
    const body = readSkillBody(skill.path)
    return clip && body.length > MAX_TEXT_CHARS
      ? `${body.slice(0, MAX_TEXT_CHARS)}…(+${body.length - MAX_TEXT_CHARS} chars)`
      : body
  }

  /**
   * Browser-facing path shape: `<name>/SKILL.md`, root-relative — the store
   * builds absolute paths, and the server's filesystem layout is not
   * something the page needs (the pane only feeds the path back to skillBody,
   * which re-derives the name from this exact shape).
   */
  const webify = <T extends FoundSkill>(skill: T): T => ({ ...skill, path: `${skill.name}/SKILL.md` })

  app.get('/ai/skills', async () => {
    const skills = await usableSkills(userDataDir)
    // `relevant` flattened alongside `relevance` for the composer pickers
    // (desktop ai:skills-list shape) — the pane reads the FoundSkill fields
    return skills.map((s) => ({ ...webify(s), relevant: s.relevance.relevant }))
  })

  app.get<{ Querystring: { name?: string } }>(
    '/ai/skills/body',
    async (request, reply) => {
      try {
        return await readText(request.query?.name, false)
      } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) })
      }
    },
  )

  app.get<{ Querystring: { name?: string } }>(
    '/ai/skills/text',
    async (request, reply) => {
      try {
        return await readText(request.query?.name, true)
      } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) })
      }
    },
  )

  app.get<{ Querystring: { lang?: string } }>(
    '/ai/skills/recommended',
    async (request): Promise<unknown[]> => {
      const skills = await recommendedSkills(recommendedDir, userDataDir, langOf(request))
      return skills.map(webify)
    },
  )

  app.post<{ Body: { name?: unknown } }>('/ai/skills/recommended/install', async (request, reply) => {
    try {
      return webify(
        installRecommendedSkill(String(request.body?.name ?? ''), recommendedDir, userDataDir),
      )
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) })
    }
  })

  app.post<{ Body: { name?: unknown } }>('/ai/skills/remove', async (request, reply) => {
    try {
      removeSkill(String(request.body?.name ?? ''), userDataDir)
      return { ok: true }
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) })
    }
  })

  app.post<{ Body: { filename?: unknown; bytesB64?: unknown } }>(
    '/ai/skills/import/zip',
    async (request, reply) => {
      try {
        const filename = String(request.body?.filename ?? 'skill.zip')
        return webify(
          await importZipBytes(
            filename.replace(/^.*[/\\]/, ''),
            decodeB64(request.body?.bytesB64, 'the archive'),
            userDataDir,
          ),
        )
      } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) })
      }
    },
  )

  app.post<{ Body: { filename?: unknown; bytesB64?: unknown } }>(
    '/ai/skills/import/markdown',
    async (request, reply) => {
      try {
        const filename = String(request.body?.filename ?? 'SKILL.md')
        return webify(
          await importMdBytes(
            filename.replace(/^.*[/\\]/, ''),
            decodeB64(request.body?.bytesB64, 'the file'),
            userDataDir,
          ),
        )
      } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) })
      }
    },
  )

  app.post<{ Body: { files?: Array<{ path?: unknown; bytesB64?: unknown }> } }>(
    '/ai/skills/import/folder',
    async (request, reply) => {
      try {
        const files = request.body?.files
        if (!Array.isArray(files) || files.length === 0) {
          return reply.code(400).send({ error: 'the folder came through empty' })
        }
        if (files.length > MAX_FILE_COUNT) {
          return reply.code(400).send({ error: 'the skill is larger than the 10 MB import cap' })
        }
        return webify(
          importDirBytes(
            files.map((f) => ({ path: String(f?.path ?? ''), bytes: decodeB64(f?.bytesB64, 'a file') })),
            userDataDir,
          ),
        )
      } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) })
      }
    },
  )

  /** the bundled chaoffice agent skill as a zip — the integrations pane's "download" path */
  app.get('/ai/skills/agent-skill.zip', async (_request, reply) => {
    const version = skillVersion(join(agentSkillDir, 'SKILL.md'))
    const zip = new JSZip()
    let entries = 0
    const walk = (dir: string, prefix: string): void => {
      let list: string[]
      try {
        list = readdirSync(dir)
      } catch {
        return
      }
      for (const name of list.sort()) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) {
          walk(full, `${prefix}${name}/`)
          continue
        }
        zip.file(`${prefix}${name}`, readFileSync(full))
        entries += 1
      }
    }
    try {
      walk(agentSkillDir, 'chaoffice/')
    } catch {
      return reply.code(404).send({ error: 'no bundled skill in this deployment' })
    }
    if (entries === 0) return reply.code(404).send({ error: 'no bundled skill in this deployment' })
    const bytes = await zip.generateAsync({ type: 'nodebuffer' })
    return reply
      .code(200)
      .type('application/zip')
      .header('content-disposition', `attachment; filename="chaoffice-skill-${version || '1'}.zip"`)
      .send(bytes)
  })

  /**
   * The integrations pane's probe, web-form shape: no bundled CLI and no
   * detected coding agents (the launcher/PATH story is desktop-only), so the
   * pane renders its catalog/download/copy paths and skips the CLI chrome.
   */
  app.get('/ai/skills/status', async (): Promise<WebIntegrationsStatus> => ({
    webForm: true,
    skillVersion: skillVersion(join(agentSkillDir, 'SKILL.md')),
    skillNeedsCli: '',
    cli: { status: 'absent', launcherDir: '', ephemeral: false, version: '' },
    agents: [],
    legacy: [],
  }))
}

/**
 * The integrations status the web form answers with — field-compatible with
 * the desktop `IntegrationsStatus` the renderer types against, minus the
 * agent/cli rows that only exist where the bundled CLI lives (`webForm: true`
 * is the renderer's signal to skip the desktop-only chrome).
 */
interface WebIntegrationsStatus {
  webForm: true
  skillVersion: string
  skillNeedsCli: string
  cli: {
    status: string
    launcherDir: string
    ephemeral: boolean
    version: string
    location?: string
    manual?: string
    pathHint?: string
  }
  agents: never[]
  legacy: never[]
}
