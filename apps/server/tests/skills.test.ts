import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildServer } from '../src/app.ts'

const dirs: string[] = []
const envBefore = process.env.CHAOFFICE_RECOMMENDED_SKILLS_DIR

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
  if (envBefore === undefined) delete process.env.CHAOFFICE_RECOMMENDED_SKILLS_DIR
  else process.env.CHAOFFICE_RECOMMENDED_SKILLS_DIR = envBefore
})

function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `chaoffice-skills-api-${label}-`))
  dirs.push(dir)
  return dir
}

/** a catalog fixture the routes pick up through the env override */
function catalogFixture(): string {
  const root = tempDir('catalog')
  mkdirSync(join(root, 'recommended', 'invoice-helper'), { recursive: true })
  writeFileSync(
    join(root, 'recommended', 'invoice-helper', 'SKILL.md'),
    [
      '---',
      'name: invoice-helper',
      'description: Checks an invoice against the contract terms',
      'metadata:',
      '  version: 1.0.0',
      'category: finance',
      '---',
      '',
      'Compare the invoice line by line.',
    ].join('\n'),
    'utf8',
  )
  mkdirSync(join(root, 'recommended', 'locales'), { recursive: true })
  writeFileSync(
    join(root, 'recommended', 'locales', 'zh.json'),
    JSON.stringify({ 'invoice-helper': '发票核对技能' }),
    'utf8',
  )
  mkdirSync(join(root, 'chaoffice'), { recursive: true })
  writeFileSync(
    join(root, 'chaoffice', 'SKILL.md'),
    [
      '---',
      'name: chaoffice',
      'description: Drives the office command line',
      'metadata:',
      '  version: 3.2.0',
      '---',
      '',
      'Run chaoffice --help first.',
    ].join('\n'),
    'utf8',
  )
  process.env.CHAOFFICE_RECOMMENDED_SKILLS_DIR = root
  return root
}

describe('/ai/skills', () => {
  it('starts empty, imports markdown, lists with the web path shape, reads text, removes', async () => {
    catalogFixture()
    const dataDir = tempDir('data')
    const { app } = buildServer({ dataDir })

    expect((await app.inject({ method: 'GET', url: '/ai/skills' })).json()).toEqual([])

    const md = [
      '---',
      'name: meeting-notes',
      'description: Formats raw minutes into action items',
      '---',
      '',
      'Extract decisions first.',
    ].join('\n')
    const imported = await app.inject({
      method: 'POST',
      url: '/ai/skills/import/markdown',
      payload: { filename: 'meeting-notes.md', bytesB64: Buffer.from(md, 'utf8').toString('base64') },
    })
    expect(imported.statusCode).toBe(200)
    expect(imported.json()).toMatchObject({ name: 'meeting-notes', path: 'meeting-notes/SKILL.md' })

    const list = (await app.inject({ method: 'GET', url: '/ai/skills' })).json()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      name: 'meeting-notes',
      description: 'Formats raw minutes into action items',
      path: 'meeting-notes/SKILL.md',
      relevant: false,
    })

    const text = await app.inject({
      method: 'GET',
      url: '/ai/skills/text?name=meeting-notes',
    })
    expect(text.statusCode).toBe(200)
    expect(text.body).toContain('Extract decisions first.')

    const body = await app.inject({
      method: 'GET',
      url: '/ai/skills/body?name=meeting-notes',
    })
    expect(body.body).toContain('Extract decisions first.')

    const unknown = await app.inject({ method: 'GET', url: '/ai/skills/text?name=ghost' })
    expect(unknown.statusCode).toBe(400)

    const removed = await app.inject({
      method: 'POST',
      url: '/ai/skills/remove',
      payload: { name: 'meeting-notes' },
    })
    expect(removed.json()).toEqual({ ok: true })
    expect((await app.inject({ method: 'GET', url: '/ai/skills' })).json()).toEqual([])

    // disk layout: exactly one `skills` level under the data dir (the store
    // appends it — the routes must pass the data dir, not a pre-joined one)
    expect(existsSync(join(dataDir, 'skills', 'meeting-notes'))).toBe(false)
    // re-import once to probe the on-disk shape
    await app.inject({
      method: 'POST',
      url: '/ai/skills/import/markdown',
      payload: { filename: 'meeting-notes.md', bytesB64: Buffer.from(md, 'utf8').toString('base64') },
    })
    expect(existsSync(join(dataDir, 'skills', 'meeting-notes', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(dataDir, 'skills', 'skills'))).toBe(false)
  })

  it('lists the recommended catalog localized and installs from it', async () => {
    catalogFixture()
    const dataDir = tempDir('data2')
    const { app } = buildServer({ dataDir })

    const zh = (await app.inject({ method: 'GET', url: '/ai/skills/recommended?lang=zh' })).json()
    expect(zh).toHaveLength(1)
    expect(zh[0]).toMatchObject({
      name: 'invoice-helper',
      category: 'finance',
      version: '1.0.0',
      state: 'missing',
      description: '发票核对技能',
      path: 'invoice-helper/SKILL.md',
    })

    const installed = await app.inject({
      method: 'POST',
      url: '/ai/skills/recommended/install',
      payload: { name: 'invoice-helper' },
    })
    expect(installed.statusCode).toBe(200)
    expect(installed.json()).toMatchObject({ name: 'invoice-helper' })

    const after = (await app.inject({ method: 'GET', url: '/ai/skills/recommended?lang=zh' })).json()
    expect(after[0]).toMatchObject({ state: 'installed' })

    const rejected = await app.inject({
      method: 'POST',
      url: '/ai/skills/recommended/install',
      payload: { name: '../escape' },
    })
    expect(rejected.statusCode).toBe(400)
  })

  it('answers the web-form integrations status and the agent-skill zip', async () => {
    catalogFixture()
    const dataDir = tempDir('data3')
    const { app } = buildServer({ dataDir })

    const status = (await app.inject({ method: 'GET', url: '/ai/skills/status' })).json()
    expect(status).toMatchObject({
      webForm: true,
      skillVersion: '3.2.0',
      skillNeedsCli: '',
    })
    expect(status.agents).toEqual([])
    expect(status.cli).toMatchObject({ status: 'absent' })

    const zip = await app.inject({ method: 'GET', url: '/ai/skills/agent-skill.zip' })
    expect(zip.statusCode).toBe(200)
    expect(zip.headers['content-type']).toContain('application/zip')
    expect(zip.body.length).toBeGreaterThan(0)

    // a deployment without the bundled skill answers 404
    process.env.CHAOFFICE_RECOMMENDED_SKILLS_DIR = join(dataDir, 'no-such-skills')
    const app2 = buildServer({ dataDir }).app
    const gone = await app2.inject({ method: 'GET', url: '/ai/skills/agent-skill.zip' })
    expect(gone.statusCode).toBe(404)
  })

  it('refuses an unsafe zip entry without importing', async () => {
    catalogFixture()
    const dataDir = tempDir('data4')
    const { app } = buildServer({ dataDir })
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()
    zip.file('SKILL.md', '---\nname: x\ndescription: y\n---\nbody')
    // JSZip's builder normalizes `../x` away; a backslash entry survives and must refuse
    zip.file('a\\b.txt', 'boom')
    const bytes = (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer
    const res = await app.inject({
      method: 'POST',
      url: '/ai/skills/import/zip',
      payload: { filename: 'x.zip', bytesB64: bytes.toString('base64') },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/unsafe entry name/)
    expect((await app.inject({ method: 'GET', url: '/ai/skills' })).json()).toEqual([])
  })
})
