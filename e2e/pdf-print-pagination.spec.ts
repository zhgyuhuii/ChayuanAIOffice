import { test, expect, chromium } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib'

// Exercise Chromium pagination: jsdom cannot detect blank printed pages caused
// by the editor's full-height root or images overflowing the printable area.
for (const landscape of [false, true]) {
  for (const margin of ['0', '0.4in']) {
    for (const pageCount of [1, 3]) {
      test(`PDF prints ${pageCount} ${landscape ? 'landscape' : 'portrait'} pages with ${margin} margins`, async () => {
        const browser = await chromium.launch()
        try {
          const page = await browser.newPage()
          await page.setContent(
            '<div id="root"><div class="app">Editor chrome</div></div>' +
              '<div class="pdf-print-root"></div>',
          )
          await page.addStyleTag({
            content: await readFile(join(__dirname, '../apps/pdf/src/renderer/styles.css'), 'utf8'),
          })
          await page.evaluate(
            async ({ landscape, pageCount }) => {
              // Match printPdf's 200 DPI US-Letter raster images.
              const canvas = document.createElement('canvas')
              canvas.width = landscape ? 2200 : 1700
              canvas.height = landscape ? 1700 : 2200
              const context = canvas.getContext('2d')!
              for (let i = 0; i < pageCount; i++) {
                context.fillStyle = ['red', 'green', 'blue'][i]
                context.fillRect(0, 0, canvas.width, canvas.height)
                const image = new Image()
                image.src = canvas.toDataURL('image/jpeg', 0.92)
                document.querySelector('.pdf-print-root')!.appendChild(image)
                await image.decode()
              }
            },
            { landscape, pageCount },
          )

          const output = await PDFDocument.load(
            await page.pdf({
              format: 'Letter',
              landscape,
              margin: { top: margin, bottom: margin, left: margin, right: margin },
            }),
          )
          expect(output.getPageCount()).toBe(pageCount)
          for (const printedPage of output.getPages()) {
            const contents = printedPage.node.Contents()
            const streams = contents instanceof PDFArray ? contents.asArray() : [contents]
            const operators = streams
              .map((stream) => {
                const raw = output.context.lookup(stream) as PDFRawStream
                return Buffer.from(decodePDFRawStream(raw).decode()).toString('latin1')
              })
              .join('\n')
            // Every sheet must paint its page bitmap, not just be counted.
            expect(operators).toMatch(/\/\S+\s+Do\b/)
          }
        } finally {
          await browser.close()
        }
      })
    }
  }
}
