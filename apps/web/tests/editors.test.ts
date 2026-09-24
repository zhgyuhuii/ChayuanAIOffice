import { describe, expect, it } from 'vitest'
import { EDITOR_KEYS, editorForFile } from '../src/editors.js'

describe('editorForFile', () => {
  it('routes each supported extension to its editor', () => {
    expect(editorForFile('报告.docx')).toBe('docs')
    expect(editorForFile('book.XLSX')).toBe('sheets')
    expect(editorForFile('deck.pptx')).toBe('slides')
    expect(editorForFile('scan.PDF')).toBe('pdf')
    expect(editorForFile('notes.md')).toBe('markdown')
    expect(editorForFile('notes.markdown')).toBe('markdown')
  })

  it('returns null for unsupported types', () => {
    expect(editorForFile('photo.png')).toBeNull()
    expect(editorForFile('archive.zip')).toBeNull()
    expect(editorForFile('plaindoc')).toBeNull()
  })

  it('lists the six editors in shell order (html joined at P1)', () => {
    expect(EDITOR_KEYS).toEqual(['docs', 'sheets', 'slides', 'pdf', 'markdown', 'html'])
  })

  it('routes html files to the html editor', () => {
    expect(editorForFile('page.html')).toBe('html')
    expect(editorForFile('page.htm')).toBe('html')
    expect(editorForFile('page.docx')).toBe('docs')
  })
})
