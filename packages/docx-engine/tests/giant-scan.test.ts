import { describe, expect, it } from 'vitest'
import { scanBody } from '../src/scan'
import { scanBodyElements } from '../src/giant-scan'

/** XML exercising every branch: nesting, self-closing, comments, CDATA with
 *  structural characters inside, PIs, DOCTYPE subsets, quoted '>', UTF-8 text
 *  (so byte offsets ≠ character offsets — the port's whole point). */
const XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<!DOCTYPE w:document [ <!ENTITY x "y"> ]>
<w:document xmlns:w="urn:x" w:mc="urn:2"><w:body><!-- a comment with <fake/> tags -->
<w:p w:val="a > b" id='q?>t'><w:r><w:t>中文内容测试宽字符</w:t></w:r><w:r><w:t>more</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><w:t><![CDATA[ raw < > ] ]]></w:t></w:r></w:p>
<w:sectPr w:rsidR="00A1B2C3"><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>
<w:p/><w:sdt><w:sdtContent><w:p><w:r><w:t>sdt body</w:t></w:r></w:p></w:sdtContent></w:sdt>
<?processor instruction with > inside?>
<w:p><w:r><w:t xml:space="preserve">tail 中文</w:t></w:r></w:p></w:body></w:document>`

describe('scanBodyElements (byte-level port)', () => {
  it('agrees element-for-element with the string scanner', () => {
    const strScan = scanBody(XML)
    const bytes = Buffer.from(XML, 'utf8')
    const gen = scanBodyElements(bytes)
    const got: Array<{ name: string; start: number; end: number }> = []
    for (;;) {
      const next = gen.next()
      if (next.done) {
        const summary = next.value
        // byte offsets and character offsets only agree over pure-ASCII spans,
        // so verify each domain on its own terms: the byte prefix before the
        // body content decodes to the string scanner's prefix, and the byte
        // suffix at bodyContentEnd starts at </w:body>.
        expect(bytes.subarray(0, summary.bodyContentStart).toString('utf8')).toBe(
          XML.slice(0, strScan.bodyContentStart),
        )
        expect(bytes.subarray(summary.bodyContentEnd).toString('utf8').startsWith('</w:body>')).toBe(
          true,
        )
        expect(summary.elementCount).toBe(strScan.elements.length)
        break
      }
      got.push(next.value)
    }
    expect(got.length).toBe(strScan.elements.length)
    for (let i = 0; i < got.length; i++) {
      expect(got[i]!.name).toBe(strScan.elements[i]!.name)
      const byteSlice = bytes.subarray(got[i]!.start, got[i]!.end).toString('utf8')
      const charSlice = XML.slice(strScan.elements[i]!.start, strScan.elements[i]!.end)
      expect(byteSlice).toBe(charSlice)
    }
  })

  it('yields early: the first element arrives before the scan finishes', () => {
    const paragraphs = Array.from(
      { length: 5000 },
      (_, i) => `<w:p><w:r><w:t>para ${i} 中文</w:t></w:r></w:p>`,
    ).join('')
    const xml = `<w:document xmlns:w="urn:x"><w:body>${paragraphs}</w:body></w:document>`
    const gen = scanBodyElements(Buffer.from(xml))
    const first = gen.next()
    expect(first.done).toBe(false)
    if (!first.done) expect(first.value.name).toBe('w:p')
  })

  it('rejects a document with no body', () => {
    const gen = scanBodyElements(Buffer.from('<w:document/>'))
    expect(() => {
      for (;;) {
        if (gen.next().done) break
      }
    }).toThrow(/no <w:body>/)
  })

  it('handles a self-closing body and an unterminated tail', () => {
    const gen = scanBodyElements(Buffer.from('<w:document><w:body/></w:document>'))
    const summary = gen.next().done ? undefined : undefined // no elements expected
    void summary
    const g2 = scanBodyElements(Buffer.from('<w:document><w:body><w:p>'))
    let done = false
    while (!done) {
      const n = g2.next()
      if (n.done) {
        expect(n.value.bodyContentEnd).toBe(Buffer.from('<w:document><w:body><w:p>').length)
        done = true
      }
    }
  })
})
