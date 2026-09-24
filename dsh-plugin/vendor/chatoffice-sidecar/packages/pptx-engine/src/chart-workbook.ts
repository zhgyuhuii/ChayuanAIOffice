/**
 * 内嵌图表工作簿(P3 标准引擎收割):与 @chatoffice/docx-engine 的
 * buildChartWorkbookXlsxBase64 同源复刻——PowerPoint/WPS 打开图表
 * "编辑数据"时解包此 xlsx。数据引用形状(Sheet1!$B$1 等)与 chart XML 的
 * strCache/numCache cx:f 保持一致。
 */
import { deflateRawSync } from 'node:zlib'
import { escapeXmlText } from './xml-utils'

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const xlsxColLetter = (i: number) => String.fromCharCode(65 + i)

export function buildChartWorkbookXlsxBase64(
  categories: string[],
  series: Array<{ name: string; values: (number | null)[] }>,
): string {
  const rows = categories.length
  const serCount = series.length

  // shared strings: all text cells collected in order
  const strings: string[] = []
  const si = (s: string): number => {
    const idx = strings.indexOf(s)
    if (idx !== -1) return idx
    strings.push(s)
    return strings.length - 1
  }

  // Build sheetData rows
  const headerCells: string[] = []
  // A1: empty label cell
  headerCells.push(`<c r="A1" t="s"><v>${si('')}</v></c>`)
  for (let j = 0; j < serCount; j++) {
    headerCells.push(`<c r="${xlsxColLetter(j + 1)}1" t="s"><v>${si(series[j].name)}</v></c>`)
  }
  const dataRows: string[] = []
  for (let i = 0; i < rows; i++) {
    const rowNum = i + 2
    const cells: string[] = []
    cells.push(`<c r="A${rowNum}" t="s"><v>${si(categories[i])}</v></c>`)
    for (let j = 0; j < serCount; j++) {
      const val = series[j].values[i]
      if (val !== null && val !== undefined) {
        cells.push(`<c r="${xlsxColLetter(j + 1)}${rowNum}"><v>${val}</v></c>`)
      }
    }
    dataRows.push(`<row r="${rowNum}">${cells.join('')}</row>`)
  }

  const sheetXml =
    XML_DECL +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetData>' +
    `<row r="1">${headerCells.join('')}</row>` +
    dataRows.join('') +
    '</sheetData>' +
    '</worksheet>'

  const sharedStringsXml =
    XML_DECL +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">` +
    strings.map((s) => `<si><t>${escapeXmlText(s)}</t></si>`).join('') +
    '</sst>'

  const workbookXml =
    XML_DECL +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>' +
    '</workbook>'

  const workbookRels =
    XML_DECL +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
    '</Relationships>'

  const topRels =
    XML_DECL +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>'

  const contentTypes =
    XML_DECL +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
    '</Types>'

  return zipToBase64([
    { path: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { path: '_rels/.rels', data: Buffer.from(topRels, 'utf8') },
    { path: 'xl/workbook.xml', data: Buffer.from(workbookXml, 'utf8') },
    { path: 'xl/_rels/workbook.xml.rels', data: Buffer.from(workbookRels, 'utf8') },
    { path: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheetXml, 'utf8') },
    { path: 'xl/sharedStrings.xml', data: Buffer.from(sharedStringsXml, 'utf8') },
  ])
}

/**
 * 同步 ZIP writer(deflate):op 执行器是同步语义,JSZip 只有 generateAsync,
 * 故手写最小实现——local header + central directory + EOCD,CRC32 查表。
 */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i])!]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function miniZipSync(files: Array<{ path: string; data: Uint8Array }>): Buffer {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  const dosTime = 0
  const dosDate = 0x21 // 1980-01-01(zip 最低合法日期)
  for (const f of files) {
    const name = Buffer.from(f.path, 'utf8')
    const crc = crc32(f.data)
    const deflated = deflateRawSync(f.data, { level: 6 })
    const useDeflate = deflated.length < f.data.length
    const payload = useDeflate ? deflated : f.data
    const method = useDeflate ? 8 : 0
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(dosTime, 10)
    local.writeUInt16LE(dosDate, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(f.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    chunks.push(local, name, Buffer.from(payload))

    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0)
    cen.writeUInt16LE(20, 4) // version made by
    cen.writeUInt16LE(20, 6) // version needed
    cen.writeUInt16LE(0, 8)
    cen.writeUInt16LE(method, 10)
    cen.writeUInt16LE(dosTime, 12)
    cen.writeUInt16LE(dosDate, 14)
    cen.writeUInt32LE(crc, 16)
    cen.writeUInt32LE(payload.length, 20)
    cen.writeUInt32LE(f.data.length, 24)
    cen.writeUInt16LE(name.length, 28)
    cen.writeUInt16LE(0, 30) // extra len
    cen.writeUInt16LE(0, 32) // comment len
    cen.writeUInt16LE(0, 34) // disk
    cen.writeUInt16LE(0, 36) // internal attrs
    cen.writeUInt32LE(0, 38) // external attrs
    cen.writeUInt32LE(offset, 42)
    central.push(cen, name)

    offset += 30 + name.length + payload.length
  }
  const centralBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...chunks, centralBuf, eocd])
}

function zipToBase64(files: Array<{ path: string; data: Uint8Array }>): string {
  return miniZipSync(files).toString('base64')
}
