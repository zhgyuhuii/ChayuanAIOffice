import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { GIANT_DOCUMENT_XML_BYTES, GiantDocxSession, probeGiantDocx } from '../src/giant'

/** A real docx-shaped archive: content types + rels + styles + a body of
 *  `count` paragraphs whose text is unique per index. */
async function buildDocx(paragraphs: number): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  )
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  )
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`,
  )
  const body = Array.from(
    { length: paragraphs },
    (_, i) => `<w:p><w:r><w:t>paragraph ${i} body text</w:t></w:r></w:p>`,
  ).join('')
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`,
  )
  return zip.generateAsync({ type: 'nodebuffer' })
}

describe('GiantDocxSession', () => {
  it('production line stays where the plan put it', () => {
    expect(GIANT_DOCUMENT_XML_BYTES).toBe(200 * 1024 * 1024)
  })

  it('probes and rejects under the injected line, opens over it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'giant-test-'))
    try {
      const path = join(dir, 'doc.docx')
      await writeFile(path, await buildDocx(20))
      const under = await probeGiantDocx(path, 1024 * 1024)
      expect(under?.giant).toBe(false)
      const over = await probeGiantDocx(path, 64) // tiny line: anything is giant
      expect(over?.giant).toBe(true)
      expect(over?.docPath).toBe('word/document.xml')

      const session = await GiantDocxSession.open(path, { minGiantBytes: 64 })
      expect(session).not.toBeNull()
      expect(session!.meta.blockCount).toBe(21) // 20 paragraphs + sectPr
      const summary = session!.anchorSummary()
      expect(summary[0]!.name).toBe('w:p')
      expect(summary[20]!.name).toBe('w:sectPr')

      const w1 = await session!.window(0, 5)
      expect(w1.count).toBe(5)
      expect(w1.parsed.blocks.length).toBe(5)
      // window content comes out of the production parser with real text
      const textOf = (b: { runs?: Array<{ text?: string }> }) =>
        (b.runs ?? []).map((r) => r.text ?? '').join('')
      expect(textOf(w1.parsed.blocks[0]!)).toContain('paragraph 0 body text')
      expect(textOf(w1.parsed.blocks[4]!)).toContain('paragraph 4 body text')

      // a mid-document window keeps its own numbering (docxIndex is window-local)
      const w2 = await session!.window(10, 4)
      expect(w2.parsed.blocks.length).toBe(4)
      expect(textOf(w2.parsed.blocks[0]!)).toContain('paragraph 10 body text')
      expect(w2.first).toBe(10)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('returns null for a zip with no document part', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'giant-test-'))
    try {
      const zip = new JSZip()
      zip.file('hello.txt', 'not a docx')
      const path = join(dir, 'x.docx')
      await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }))
      expect(await probeGiantDocx(path, 64)).toBeNull()
      expect(await GiantDocxSession.open(path, { minGiantBytes: 64 })).toBeNull()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
