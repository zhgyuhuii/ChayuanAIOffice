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

  it('lists the five editors in shell order', () => {
    expect(EDITOR_KEYS).toEqual(['docs', 'sheets', 'slides', 'pdf', 'markdown'])
  })
})
