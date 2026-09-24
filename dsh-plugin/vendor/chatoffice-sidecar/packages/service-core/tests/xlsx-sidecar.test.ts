import { pathToFileURL, fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createCore, xlsxSidecarService } from '../src/index.js'

const FAKE = fileURLToPath(new URL('./fixtures/fake-xlsx-sidecar.cjs', import.meta.url))
void pathToFileURL

function makeCore() {
  return createCore(
    {
      xlsx: xlsxSidecarService({
        binaryPath: process.platform === 'win32' ? `${process.execPath}|${FAKE}` : FAKE,
      }),
    },
    {
      storage: {
        defaultArea: () => {
          throw new Error('unused')
        },
      },
    },
  )
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64')

describe('xlsx sidecar service', () => {
  it('opens workbook bytes and returns the sidecar model + digest', async () => {
    const api = makeCore().api.xlsx
    const res = await api.openWorkbookBytes({ base64: b64('PK-fake-xlsx'), name: 'Book 1.xlsx' })
    expect(String(res.sessionId)).toMatch(/^sess-/)
    expect(res.snapshotDigest).toHaveLength(64)
    expect((res.opened as { sheets: unknown[] }).sheets).toHaveLength(1)
  })

  it('passes session commands through and resolves results', async () => {
    const api = makeCore().api.xlsx
    const { sessionId } = await api.openWorkbookBytes({ base64: b64('x'), name: 'a.xlsx' })
    const cells = (await api.command({
      command: 'read_range',
      sessionId,
      sheetId: 's1',
      range: {},
    })) as unknown
    expect(cells).toEqual({ cells: [['A1', 'ok']] })
    await expect(api.command({ command: 'close', sessionId })).resolves.toEqual({ closed: true })
  })

  it('surfaces sidecar errors as rejections', async () => {
    const api = makeCore().api.xlsx
    await expect(api.command({ command: 'explode' })).rejects.toThrow('boom')
  })

  it('rejects empty workbook bytes before spawning work', async () => {
    const api = makeCore().api.xlsx
    await expect(api.openWorkbookBytes({ base64: '', name: 'a.xlsx' })).rejects.toThrow('empty')
  })
})
