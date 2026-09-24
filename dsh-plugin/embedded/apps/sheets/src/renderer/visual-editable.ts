import type { WorkbookVisualObject } from '../shared/desktop-api'

/// Which visuals mount inside the interactive EditableShapeVisual wrapper
/// (selection frame, drag/resize handles, delete, context menu) versus the
/// inert render-only WorkbookVisual. Pure predicates so tests can pin the
/// editability contract without booting Univer.

/// Visuals created this session are fully editable in place: their whole
/// object lives in the journal, so anchor/text changes save for free.
export function isEditableShape(visual: WorkbookVisualObject): boolean {
  return visual.kind === 'shape' && visual.id.startsWith('added-shape-')
}

/// Session-added images (insert-picture, AI inserts, screenshots) carry their
/// bytes inline in the journal too — the same in-place editability as shapes.
/// Without this they render as the inert ImageVisual: clickable metal.
/// Upstream alias (09485f8 added-image-editable.test): strictly session-added
/// pictures, without the local echart extension isEditableImage carries.
export function isEditableAddedImage(visual: WorkbookVisualObject): boolean {
  return visual.kind === 'image' && visual.id.startsWith('added-image-')
}

export function isEditableImage(visual: WorkbookVisualObject): boolean {
  return (
    visual.kind === 'image' &&
    (visual.id.startsWith('added-image-') || visual.id.startsWith('added-echart-'))
  )
}

/// Images and shapes already in the file move/delete through a surgical
/// anchor edit, located by the sidecar's (drawingPath, drawingIndex) pair.
/// Charts keep their own editor; deletion routes through the same edit.
export function isEditableFileVisual(visual: WorkbookVisualObject): boolean {
  return (
    (visual.kind === 'image' || visual.kind === 'shape') &&
    !visual.id.startsWith('added-') &&
    visual.drawingPath !== undefined &&
    visual.drawingIndex !== undefined
  )
}

/// Charts move through the same anchor edit as images/shapes and delete
/// through a cascading one (the save also drops the chart part, rel, and
/// content-type override); session-added and demo charts live in memory.
export function isEditableChart(visual: WorkbookVisualObject): boolean {
  if (visual.kind !== 'chart') return false
  if (visual.id.startsWith('added-') || visual.id.startsWith('demo-')) return true
  return visual.drawingPath !== undefined && visual.drawingIndex !== undefined
}

export function isEditableVisual(visual: WorkbookVisualObject): boolean {
  return (
    isEditableShape(visual) ||
    isEditableImage(visual) ||
    isEditableFileVisual(visual) ||
    isEditableChart(visual)
  )
}
