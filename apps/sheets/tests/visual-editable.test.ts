import { describe, expect, it } from 'vitest'

import {
  isEditableChart,
  isEditableFileVisual,
  isEditableImage,
  isEditableShape,
  isEditableVisual,
} from '../src/renderer/visual-editable'
import type { WorkbookVisualObject } from '../src/shared/desktop-api'

const sessionImage = (): WorkbookVisualObject => ({
  id: 'added-image-1725400000000-1',
  sheetId: 'sheet-1',
  kind: 'image',
  mediaType: 'image/png',
  mediaDataUrl: 'data:image/png;base64,AAA',
  anchor: {
    fromRow: 0,
    fromColumn: 0,
    fromRowOffset: 0,
    fromColumnOffset: 0,
    toRow: 4,
    toColumn: 4,
    toRowOffset: 0,
    toColumnOffset: 0,
  },
})

const fileImage = (): WorkbookVisualObject => ({
  ...sessionImage(),
  id: 'pic-1',
  drawingPath: 'xl/drawings/drawing1.xml',
  drawingIndex: 3,
})

describe('visual editability gates', () => {
  it('session-inserted images are editable in place (the clickable-metal regression)', () => {
    expect(isEditableImage(sessionImage())).toBe(true)
    expect(isEditableVisual(sessionImage())).toBe(true)
  })

  it('session-inserted echart posters are editable too (added-echart- prefix)', () => {
    const echart = { ...sessionImage(), id: 'added-echart-1725400000000-9' }
    expect(isEditableImage(echart)).toBe(true)
    expect(isEditableVisual(echart)).toBe(true)
  })

  it('file-loaded images stay editable through the surgical-edit path', () => {
    expect(isEditableFileVisual(fileImage())).toBe(true)
    expect(isEditableVisual(fileImage())).toBe(true)
  })

  it('file images without a sidecar location stay inert (nothing to edit against)', () => {
    const orphan = { ...fileImage(), drawingPath: undefined, drawingIndex: undefined }
    expect(isEditableFileVisual(orphan)).toBe(false)
    expect(isEditableVisual(orphan)).toBe(false)
  })

  it('shapes keep their gate; a session image is not mistaken for a shape', () => {
    expect(isEditableShape(sessionImage())).toBe(false)
    expect(isEditableShape({ ...sessionImage(), id: 'added-shape-x', kind: 'shape' })).toBe(true)
  })

  it('charts pass either path; non-chart kinds never chart-edit', () => {
    expect(isEditableChart({ ...sessionImage(), id: 'added-chart-1', kind: 'chart' })).toBe(true)
    expect(isEditableChart(sessionImage())).toBe(false)
  })
})
