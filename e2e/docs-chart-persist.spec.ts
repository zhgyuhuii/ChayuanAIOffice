import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, test } from '@playwright/test'
import { parseDocx, saveDocx, type NewChart } from '../packages/docx-engine/src/index'
import { buildDocx } from '../packages/docx-engine/tests/helpers/build-docx'
import { launchShell, closeAndSaveVideo, waitForPageWithUrl } from './helpers'

const CHART: NewChart = {
  kind: 'bar',
  title: 'Persistence chart',
  categories: ['A', 'B', 'C'],
  series: [{ name: 's', values: [3, 1, 2] }],
}

async function makeChartDocx(): Promise<string> {
  const source = await buildDocx({ bodyXml: '<w:p><w:r><w:t>前言</w:t></w:r></w:p>' })
  const parsed = await parseDocx(source)
  const saved = await saveDocx(parsed, [
    { kind: 'original', docxIndex: 0 },
    { kind: 'chart', chart: CHART },
  ])
  const dir = await mkdtemp(join(tmpdir(), 'chaoffice-chart-e2e-'))
  const file = join(dir, 'chart-doc.docx')
  await writeFile(file, saved)
  return file
}

test('插入的图表打开可见，编辑保存重开后仍在', async () => {
  test.setTimeout(180_000)
  const file = await makeChartDocx()
  const launched = await launchShell({
    openFile: file,
    onboardingSeen: true,
    videoDir: 'docs-chart-persist',
  })
  try {
    const { app } = launched
    const page = await waitForPageWithUrl(app, 'mode=tab')

    // 打开即见图表 SVG
    await expect(page.locator('.doc-chart-svg, .ProseMirror svg').first()).toBeVisible({
      timeout: 30_000,
    })

    // 编辑正文触发 dirty + 重排
    await page.locator('.ProseMirror').click()
    await page.keyboard.type('编辑后保存重开回归')
    await expect(page.locator('.ProseMirror')).toContainText('编辑后保存重开回归')

    // ⌘S 就地保存（已存在文件,无对话框）
    await page.keyboard.press('Meta+s')
    await page.waitForTimeout(1500)
  } finally {
    await closeAndSaveVideo(launched, 'docs-chart-persist-first').catch(() => {})
  }

  // 重开同一文件：图表必须仍在
  const relaunched = await launchShell({
    openFile: file,
    onboardingSeen: true,
    videoDir: 'docs-chart-persist-reopen',
  })
  try {
    const reopenPage = await waitForPageWithUrl(relaunched.app, 'mode=tab')
    await expect(
      reopenPage.locator('.doc-chart-svg, .ProseMirror svg').first(),
    ).toBeVisible({ timeout: 30_000 })
  } finally {
    await closeAndSaveVideo(relaunched, 'docs-chart-persist-reopen').catch(() => {})
  }
})
