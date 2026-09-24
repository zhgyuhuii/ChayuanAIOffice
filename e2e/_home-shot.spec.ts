import { test, expect } from '@playwright/test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { launchShell, closeAndSaveVideo, screenshotPath } from './helpers'

/** 一次性截图规格：新首页（新建直钮网格+文件夹树+树内联文件+搜索）视觉验证 */

async function minimalDocx(text: string): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  )
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  )
  return zip.generateAsync({ type: 'nodebuffer' })
}

test('capture new home screenshots', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'chatoffice-home-shot-')))
  mkdirSync(join(root, '项目资料', '2026 报告'), { recursive: true })
  mkdirSync(join(root, 'Clients', 'Contracts'), { recursive: true })
  writeFileSync(join(root, '项目资料', '读书笔记.md'), '# 读书笔记\n\n第一章。')
  writeFileSync(join(root, '项目资料', '2026 报告', '年度总结.docx'), await minimalDocx('年度总结内容'))
  writeFileSync(join(root, 'Clients', 'Contracts', 'agreement.html'), '<html><body><p>Agreement</p></body></html>')
  writeFileSync(join(root, 'roadmap.md'), '# Roadmap\n\n- Q3\n- Q4')
  const launched = await launchShell({
    onboardingSeen: true,
    settings: { defaultSaveDir: root },
    videoDir: 'home-shot',
  })
  const { page } = launched
  try {
    await expect(page.locator('.side-new-grid .side-new-tile')).toHaveCount(6)
    await expect(page.locator('.file-tree-pane .folder-panel')).toBeVisible()
    // 展开默认根目录：树内联出子文件夹与文件
    // 根目录挂载即自动展开：先等 3 秒让 listing 返回；未出现才点箭头展开一次
    for (let i = 0; i < 6; i++) {
      if ((await page.locator('.file-tree-pane .tree-children li').count()) > 0) break
      await page.waitForTimeout(500)
    }
    if ((await page.locator('.file-tree-pane .tree-children li').count()) === 0) {
      await page.locator('.file-tree-pane .tree-chevron').first().click()
    }
    await expect(page.locator('.file-tree-pane .tree-children li').first()).toBeVisible({
      timeout: 10_000,
    })
    // 再展开一个子文件夹（树内联文件两级验证）
    const subChevron = page.locator('.file-tree-pane .tree-children .tree-chevron').first()
    if (await subChevron.isVisible()) {
      await subChevron.click()
      await page.waitForTimeout(800)
    }
    await page.screenshot({ path: screenshotPath('home-new-tree') })
    // 搜索态：等索引出结果再截
    await page.locator('.file-search input').fill('roadmap')
    await expect(page.locator('.file-tree-pane .search-row').first()).toBeVisible({
      timeout: 30_000,
    })
    await page.screenshot({ path: screenshotPath('home-new-search') })
  } finally {
    await closeAndSaveVideo(launched, 'home-shot')
    rmSync(root, { recursive: true, force: true })
  }
})
