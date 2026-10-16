import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, test } from '@playwright/test'
import { parseDocx, saveDocx } from '../packages/docx-engine/src/index'
import { buildDocx } from '../packages/docx-engine/tests/helpers/build-docx'
import { launchShell, closeAndSaveVideo, waitForPageWithUrl } from './helpers'

/**
 * Right-clicking a selected image must open the context menu and keep the
 * editor editable. Regression gate for the 2026-10-11 freeze: a merge had
 * dropped docs-main's `docs:context-menu-claim`/`-arm` registration, so the
 * renderer's claim sendSync had no listener and the right-click path spun
 * into a renderer↔main sync feedback loop (≈3800 sendSync/s, tab frozen).
 */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAWklEQVR4nO3PQQ2AMAwF0LcJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmLABa1wEg7QD2Dm1AAAAAElFTkSuQmCC'

test('图片右键：菜单弹出、不冻结、编辑器仍可编辑', async () => {
  test.setTimeout(180_000)
  const source = await buildDocx({ bodyXml: '<w:p><w:r><w:t>右键回归</w:t></w:r></w:p>' })
  const parsed = await parseDocx(source)
  const saved = await saveDocx(parsed, [{ kind: 'original', docxIndex: 0 }])
  const dir = await mkdtemp(join(tmpdir(), 'chaoffice-rc-gate-'))
  const file = join(dir, 'gate.docx')
  const pngFile = join(dir, 'test.png')
  await writeFile(file, saved)
  await writeFile(pngFile, Buffer.from(PNG, 'base64'))

  const launched = await launchShell({ openFile: file, onboardingSeen: true, videoDir: 'docs-img-rightclick', lang: 'zh' })
  try {
    const page = await waitForPageWithUrl(launched.app, 'mode=tab')
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 30_000 })

    await page.locator('.ribbon-tab', { hasText: '插入' }).click()
    await page.locator('.rb-big', { hasText: '图片' }).first().click()
    await page.waitForTimeout(800)
    await page.locator('input[type="file"]').first().setInputFiles(pngFile)
    await page.waitForTimeout(800)
    await page.locator('button', { hasText: /^插入/ }).last().click()
    await expect(page.locator('.ProseMirror img').first()).toBeVisible({ timeout: 15_000 })

    const box = await page.locator('.ProseMirror img').first().boundingBox()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(400)
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })

    // 菜单弹出（图片右键项）
    await expect(page.locator('.ctx-menu')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.ctx-menu .ctx-item').first()).toContainText(/查看图片|另存为/)

    // 不冻结 + 可编辑
    await page.keyboard.press('Escape')
    await page.locator('.ProseMirror').click()
    await page.keyboard.type('AFTER_RIGHT_CLICK')
    await expect(page.locator('.ProseMirror')).toContainText('AFTER_RIGHT_CLICK', { timeout: 10_000 })
  } finally {
    await closeAndSaveVideo(launched, 'docs-img-rightclick').catch(() => {})
  }
})
