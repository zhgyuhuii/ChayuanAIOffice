// table-export — 导出全部表格 → one .xlsx with a sheet per table (表格1…表格N),
// the chayuan-wps exportAllTablesToExcel contract minus the WPS-object bridge.
// Worksheet XML comes from the shared xlsx-gateway builder; the multi-sheet
// package assembly is local (JSZip), so nothing here touches gateway internals.
import JSZip from 'jszip'
import { buildWorksheetXml } from '@chatoffice/xlsx-gateway/gateway/csv-import'

/** xlsx sheet names cap at 31 chars and forbid : \ / ? * [ ] */
function sheetName(label: string): string {
  const cleaned = label.replace(/[:\\/?*[\]]/g, ' ').trim() || 'Sheet'
  return cleaned.length > 31 ? cleaned.slice(0, 31) : cleaned
}

export async function tablesToXlsxBase64(matrices: string[][][]): Promise<string> {
  const zip = new JSZip()
  const overrides: string[] = []
  const sheets: string[] = []
  const rels: string[] = []
  matrices.forEach((rows, i) => {
    const n = i + 1
    overrides.push(
      `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    sheets.push(`<sheet name="${sheetName(`表格${n}`)}" sheetId="${n}" r:id="rId${n}"/>`)
    rels.push(
      `<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/>`,
    )
    zip.file(`xl/worksheets/sheet${n}.xml`, buildWorksheetXml(rows))
  })
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      overrides.join('') +
      '</Types>',
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>',
  )
  zip.file(
    'xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<sheets>${sheets.join('')}</sheets></workbook>`,
  )
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      rels.join('') +
      '</Relationships>',
  )
  const buffer = await zip.generateAsync({ type: 'base64', compression: 'DEFLATE' })
  return buffer
}

/** dataUrl → {fileName, base64} for the export-files IPC */
export function dataUrlToBase64File(fileName: string, dataUrl: string): {
  fileName: string
  base64: string
} | null {
  const comma = dataUrl.indexOf(',')
  if (!dataUrl.startsWith('data:') || comma < 0) return null
  return { fileName, base64: dataUrl.slice(comma + 1) }
}
