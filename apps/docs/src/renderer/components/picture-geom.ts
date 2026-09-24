/** Crop-to-shape presets (OOXML prst names) and their CSS approximations. */

export const PICTURE_GEOMS = [
  'rect',
  'roundRect',
  'ellipse',
  'triangle',
  'diamond',
  'pentagon',
  'hexagon',
  'star5',
] as const

export type PictureGeom = (typeof PICTURE_GEOMS)[number]

/** clip-path polygons in percent; ellipse/roundRect use border-radius instead */
const CLIP_POLYGON: Partial<Record<PictureGeom, string>> = {
  triangle: 'polygon(50% 0%, 100% 100%, 0% 100%)',
  diamond: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
  pentagon: 'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)',
  hexagon: 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)',
  star5:
    'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
}

/** CSS for one preset: border-radius for curved shapes, clip-path otherwise */
export function geomCss(prst: string | null | undefined): {
  borderRadius?: string
  clipPath?: string
} {
  if (!prst || prst === 'rect') return {}
  if (prst === 'ellipse') return { borderRadius: '50%' }
  if (prst === 'roundRect') return { borderRadius: '12%' }
  const polygon = CLIP_POLYGON[prst as PictureGeom]
  return polygon ? { clipPath: polygon } : {}
}
