import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'
import {
  importDirBytes,
  importMdBytes,
  importZipBytes,
  installRecommendedSkill,
  readSkillBody,
  recommendedSkills,
  removeSkill,
  usableSkills,
} from '../src/skills-store'

const dirs: string[] = []
const tempDir = (label: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `chaoffice-skills-${label}-`))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

const SKILL_MD = (name: string, version?: string): string =>
  [
    '---',
    `name: ${name}`,
    'description: Turns a raw export into a formatted report',
    ...(version ? ['metadata:', `  version: ${version}`] : []),
    ...(version ? ['category: office'] : []),
    '---',
    '',
    'Step one: read the export.',
  ].join('\n')

async function zipOf(entries: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip()
  for (const [name, text] of Object.entries(entries)) zip.file(name, text)
  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer
}

describe('importZipBytes', () => {
  it('imports a root SKILL.md, named after the archive file (desktop parity)', async () => {
    const user = tempDir('zip-root')
    const bytes = await zipOf({ 'SKILL.md': SKILL_MD('report-fixer') })
    const skill = await importZipBytes('report-fixer.zip', bytes, user)
    expect(skill.name).toBe('report-fixer')
    expect(existsSync(join(user, 'skills', 'report-fixer', 'SKILL.md'))).toBe(true)
  })

  it('imports one top-level folder, named after the folder', async () => {
    const user = tempDir('zip-folder')
    const bytes = await zipOf({
      'weekly/SKILL.md': SKILL_MD('weekly'),
      'weekly/assets/table.md': '| a |',
    })
    const skill = await importZipBytes('anything.zip', bytes, user)
    expect(skill.name).toBe('weekly')
    expect(existsSync(join(user, 'skills', 'weekly', 'assets', 'table.md'))).toBe(true)
  })

  it('refuses an unsafe entry name without writing anything', async () => {
    const user = tempDir('zip-escape')
    // JSZip's builder normalizes `../x` away, so escape via backslash (and a
    // leading slash) — both must refuse; `..` names are covered in importDirBytes
    const bytes = await zipOf({ 'SKILL.md': SKILL_MD('evil'), 'a\\b.txt': 'x', '/abs.txt': 'y' })
    await expect(importZipBytes('evil.zip', bytes, user)).rejects.toThrow(/unsafe entry name/)
    expect(existsSync(join(user, 'skills', 'evil'))).toBe(false)
  })

  it('refuses a second install of the same name', async () => {
    const user = tempDir('zip-dup')
    const bytes = await zipOf({ 'SKILL.md': SKILL_MD('dup') })
    await importZipBytes('dup.zip', bytes, user)
    await expect(importZipBytes('dup.zip', bytes, user)).rejects.toThrow(
      'a skill of that name is already there',
    )
  })

  it('rejects bytes that are not a zip', async () => {
    const user = tempDir('zip-bad')
    await expect(importZipBytes('x.zip', Buffer.from('plain text'), user)).rejects.toThrow(
      'not a zip archive',
    )
  })
})

describe('importMdBytes', () => {
  it('uses the frontmatter name when it is a folder name', () => {
    const user = tempDir('md-name')
    const skill = importMdBytes(
      'whatever.md',
      Buffer.from(SKILL_MD('front-name'), 'utf8'),
      user,
    )
    expect(skill.name).toBe('front-name')
    expect(existsSync(join(user, 'skills', 'front-name', 'SKILL.md'))).toBe(true)
  })

  it('falls back to the file stem when the frontmatter name is unusable', () => {
    const user = tempDir('md-stem')
    const skill = importMdBytes(
      'my-skill.md',
      Buffer.from(SKILL_MD('with/slash'), 'utf8'),
      user,
    )
    expect(skill.name).toBe('my-skill')
  })

  it('refuses markdown without frontmatter', () => {
    const user = tempDir('md-plain')
    expect(() =>
      importMdBytes('x.md', Buffer.from('no frontmatter here', 'utf8'), user),
    ).toThrow('SKILL.md needs name and description frontmatter')
  })
})

describe('importDirBytes', () => {
  it('names the skill after the single top-level folder', () => {
    const user = tempDir('dir-top')
    const skill = importDirBytes(
      [
        { path: 'minutes/SKILL.md', bytes: Buffer.from(SKILL_MD('minutes'), 'utf8') },
        { path: 'minutes/assets/tpl.md', bytes: Buffer.from('tpl', 'utf8') },
      ],
      user,
    )
    expect(skill.name).toBe('minutes')
    expect(existsSync(join(user, 'skills', 'minutes', 'assets', 'tpl.md'))).toBe(true)
  })

  it('refuses a folder with no SKILL.md layout', () => {
    const user = tempDir('dir-empty')
    expect(() =>
      importDirBytes([{ path: 'a/notes.md', bytes: Buffer.from('x', 'utf8') }], user),
    ).toThrow(/no SKILL.md/)
  })

  it('refuses a `..` entry', () => {
    const user = tempDir('dir-escape')
    expect(() =>
      importDirBytes(
        [
          { path: '../SKILL.md', bytes: Buffer.from(SKILL_MD('x'), 'utf8') },
        ],
        user,
      ),
    ).toThrow(/unsafe entry name/)
  })
})

describe('listing, body, removal', () => {
  it('round-trips usableSkills / readSkillBody / removeSkill', async () => {
    const user = tempDir('roundtrip')
    await importZipBytes('alpha.zip', await zipOf({ 'SKILL.md': SKILL_MD('alpha') }), user)
    importMdBytes('b.md', Buffer.from(SKILL_MD('beta'), 'utf8'), user)
    const skills = await usableSkills(user)
    expect(skills.map((s) => s.name)).toEqual(['alpha', 'beta'])
    expect(readSkillBody(join(user, 'skills', 'alpha', 'SKILL.md'))).toContain('Step one')
    removeSkill('alpha', user)
    expect((await usableSkills(user)).map((s) => s.name)).toEqual(['beta'])
  })
})

describe('recommendedSkills', () => {
  it('lists the catalog with state transitions and localized descriptions', async () => {
    const user = tempDir('rec-user')
    const catalog = tempDir('rec-catalog')
    mkdirSync(join(catalog, 'kpi-dashboard'), { recursive: true })
    writeFileSync(join(catalog, 'kpi-dashboard', 'SKILL.md'), SKILL_MD('kpi-dashboard', '1.2.0'))
    mkdirSync(join(catalog, 'budget-planner'), { recursive: true })
    writeFileSync(join(catalog, 'budget-planner', 'SKILL.md'), SKILL_MD('budget-planner', '2.0.0'))
    mkdirSync(join(catalog, 'locales'), { recursive: true })
    writeFileSync(
      join(catalog, 'locales', 'zh.json'),
      JSON.stringify({ 'budget-planner': '预算规划技能' }),
    )

    // missing: not installed; zh description localized
    let list = await recommendedSkills(catalog, user, 'zh')
    expect(list.map((s) => [s.name, s.state, s.version])).toEqual([
      ['budget-planner', 'missing', '2.0.0'],
      ['kpi-dashboard', 'missing', '1.2.0'],
    ])
    expect(list.find((s) => s.name === 'budget-planner')?.description).toBe('预算规划技能')
    // 'en' keeps the frontmatter text
    list = await recommendedSkills(catalog, user, 'en')
    expect(list.find((s) => s.name === 'budget-planner')?.description).toBe(
      'Turns a raw export into a formatted report',
    )

    // install → installed; then a newer catalog → outdated
    installRecommendedSkill('kpi-dashboard', catalog, user)
    list = await recommendedSkills(catalog, user, 'zh')
    expect(list.find((s) => s.name === 'kpi-dashboard')?.state).toBe('installed')
    writeFileSync(join(catalog, 'kpi-dashboard', 'SKILL.md'), SKILL_MD('kpi-dashboard', '1.3.0'))
    list = await recommendedSkills(catalog, user, 'zh')
    expect(list.find((s) => s.name === 'kpi-dashboard')?.state).toBe('outdated')
  })

  it('answers [] when the catalog directory is absent', async () => {
    const user = tempDir('rec-absent')
    expect(await recommendedSkills(join(user, 'nope'), user, 'zh')).toEqual([])
  })
})
