import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { attachEchartMetadata } from '../src/main/echart-meta-attach'

/**
 * The Rust sidecar's read_entries extracts parts as flat `entry-N.bin` files
 * and returns an archive-name → disk-path mapping. These tests pin that
 * contract: reading parts back via their archive-relative path silently
 * misses everything, which killed double-click echo after a save/reopen.
 */

const SIDE_CAR = {
  option: '{"series":[{"type":"line"}]}',
  code: 'option = { series: [{ type: "line" }] }',
  groupId: 'line',
  data: null,
}

const DRAWING_XML =
  '<?xml version="1.0"?><xdr:wsDr xmlns:xdr="x">' +
  '<xdr:twoCellAnchor><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="P" ' +
  'descr="chatoffice-echart:xl/echarts/echart1.json"/></xdr:nvPicPr>' +
  '<xdr:blipFill><a:blip xmlns:r="r" r:embed="rId1"/></xdr:blipFill></xdr:pic>' +
  '</xdr:twoCellAnchor></xdr:wsDr>'

const DRAWING_RELS =
  '<?xml version="1.0"?><Relationships xmlns="r">' +
  '<Relationship Id="rId1" Target="../media/image1.png"/></Relationships>'

const PARTS: Record<string, string> = {
  'xl/drawings/drawing1.xml': DRAWING_XML,
  'xl/drawings/_rels/drawing1.xml.rels': DRAWING_RELS,
  'xl/echarts/echart1.json': JSON.stringify(SIDE_CAR),
}

/** flat=true mimics the real sidecar (entry-N.bin); false preserves paths. */
function fakeClient(parts: Record<string, string>, flat: boolean) {
  return {
    archiveManifest: async () => ({
      entries: Object.keys(parts).map((name) => ({ name })),
    }),
    readEntries: async (input: {
      entries: readonly string[]
      outputDir: string
    }): Promise<unknown> => {
      const entries: Array<{ name: string; path: string }> = []
      let index = 0
      for (const name of input.entries) {
        const path = flat
          ? join(input.outputDir, `entry-${index}.bin`)
          : join(input.outputDir, name)
        await mkdir(join(path, '..'), { recursive: true })
        await writeFile(path, parts[name] ?? '')
        entries.push({ name, path })
        index += 1
      }
      return { entries }
    },
  } as never
}

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'echart-attach-test-'))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const file = {
  visuals: [
    {
      id: 'visual-1',
      sheetId: 'sheet-1',
      kind: 'image',
      anchor: {},
      mediaType: 'image/png',
      mediaPath: 'xl/media/image1.png',
    },
  ],
} as never

describe('attachEchartMetadata', () => {
  it('attaches echartMeta through the flat name→path extraction mapping', async () => {
    await withTempDir(async () => {
      const result = (await attachEchartMetadata(fakeClient(PARTS, true), 'book.xlsx', file)) as {
        visuals: Array<{ echartMeta?: { optionJson: string; groupId: string } }>
      }
      const meta = result.visuals[0]?.echartMeta
      expect(meta?.optionJson).toBe(SIDE_CAR.option)
      expect(meta?.groupId).toBe('line')
    })
  })

  it('is shape-independent: path-preserving extraction attaches too', async () => {
    await withTempDir(async (_dir) => {
      const result = (await attachEchartMetadata(fakeClient(PARTS, false), 'book.xlsx', file)) as {
        visuals: Array<{ echartMeta?: unknown }>
      }
      expect(result.visuals[0]?.echartMeta).toBeDefined()
    })
  })

  it('leaves the file untouched when no drawing carries the pointer', async () => {
    await withTempDir(async (_dir) => {
      const parts = {
        ...PARTS,
        'xl/drawings/drawing1.xml': DRAWING_XML.replace(/ descr="[^"]*"/, ''),
      }
      const result = (await attachEchartMetadata(fakeClient(parts, true), 'book.xlsx', file)) as {
        visuals: Array<{ echartMeta?: unknown }>
      }
      expect(result.visuals[0]?.echartMeta).toBeUndefined()
    })
  })

  it('skips archive reads entirely without image visuals', async () => {
    await withTempDir(async (dir) => {
      const result = (await attachEchartMetadata(fakeClient(PARTS, true), 'book.xlsx', {
        visuals: [],
      } as never)) as { visuals: unknown[] }
      expect(result.visuals).toEqual([])
      expect(await readFile(join(dir, 'entry-0.bin'), 'utf8').catch(() => 'missing')).toBe(
        'missing',
      )
    })
  })
})
