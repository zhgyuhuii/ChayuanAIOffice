/// Picture-format XML surgery shared by the drawing writer (freshly
/// synthesized pics from session adds) and the drawing editor (surgical
/// patches to pics already in the file). One implementation so a saved
/// crop/lum/border/rotation is byte-consistent with what the sidecar parses
/// back on reload.
///
/// Field semantics (mirroring WorkbookVisualEdit['picture']):
///   undefined — leave whatever the XML already has
///   null      — remove the element/attribute (重设图片)
///   value     — write it, replacing any previous one

export interface PictureSrcRect {
  readonly l: number
  readonly t: number
  readonly r: number
  readonly b: number
}

export interface PictureLum {
  readonly bright: number
  readonly contrast: number
}

export interface PictureFormatPatch {
  readonly srcRect?: PictureSrcRect | null | undefined
  readonly lum?: PictureLum | null | undefined
  /// Degrees clockwise (written as a:xfrm/@rot in 1/60000 units).
  readonly rotation?: number | null | undefined
  readonly flipH?: boolean | null | undefined
  readonly flipV?: boolean | null | undefined
  /// a:ln outline — color hex (with #) and width in points.
  readonly lineColor?: string | null | undefined
  readonly lineWidth?: number | null | undefined
  /// a:blip/a:alphaModFix amt as 0..1.
  readonly opacity?: number | null | undefined
  /// Crop-to-shape preset (a:prstGeom prst); null/'rect' restores the rectangle.
  readonly geom?: string | null | undefined
  /// Outer shadow (a:effectLst/a:outerShdw); null removes.
  readonly shadow?:
    | { blurPt: number; distPt: number; dirDeg: number; color: string; alpha: number }
    | null
    | undefined
}

/// Rewrites the attributes of an `<a:xfrm>` open tag, keeping everything
/// else (off/ext children, foreign attributes) untouched.
function rewriteXfrmTag(tag: string, overrides: Record<string, string | null | undefined>): string {
  const kept = [...tag.matchAll(/\s([\w:.-]+)="[^"]*"/g)]
    .map((match) => match[0])
    .filter((attr) => {
      const name = /([\w:.-]+)=/.exec(attr)?.[1] ?? ''
      return overrides[name] === undefined
    })
  const added = Object.entries(overrides)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([name, value]) => ` ${name}="${value as string}"`)
  return `<a:xfrm${kept.join('')}${added.join('')}>`
}

/**
 * Rewrites the format aspects of one `<xdr:pic>` body. Idempotent: every
 * writer strips its own previous element before inserting, so re-applying
 * a format never duplicates XML.
 */
export function applyPictureFormat(picXml: string, format: PictureFormatPatch): string {
  let xml = picXml

  // a:xfrm rotation/flips — attribute-level rewrite keeps <a:off>/<a:ext>.
  const touchesXfrm =
    format.rotation !== undefined || format.flipH !== undefined || format.flipV !== undefined
  if (touchesXfrm) {
    const xfrm = /<a:xfrm\b[^>]*>/.exec(xml)
    if (!xfrm) {
      // A pic without spPr/a:xfrm cannot carry rotation — fail closed
      // instead of silently dropping the user's edit.
      throw new Error('The picture has no a:xfrm — rotation is not supported for it.')
    }
    xml =
      xml.slice(0, xfrm.index) +
      rewriteXfrmTag(xfrm[0], {
        rot:
          format.rotation === undefined
            ? undefined
            : format.rotation === null || format.rotation === 0
              ? null
              : String(Math.round(format.rotation * 60_000)),
        flipH: format.flipH === undefined ? undefined : format.flipH ? '1' : null,
        flipV: format.flipV === undefined ? undefined : format.flipV ? '1' : null,
      }) +
      xml.slice(xfrm.index + xfrm[0].length)
  }

  // a:blip children: alphaModFix (opacity) and lum, in ECMA effect order,
  // inserted before a trailing a:tint when one exists. Each aspect strips
  // its own previous element only when the patch mentions it — an untouched
  // aspect must survive.
  const touchesOpacity = format.opacity !== undefined
  const touchesLum = format.lum !== undefined
  if (touchesOpacity || touchesLum) {
    const open = /<a:blip\b[^>]*?(\/?)>/.exec(xml)
    if (open) {
      const start = open.index
      const selfClosed = open[1] === '/'
      const additions: string[] = []
      if (touchesOpacity && format.opacity !== null && format.opacity !== undefined) {
        additions.push(`<a:alphaModFix amt="${Math.round(format.opacity * 100_000)}"/>`)
      }
      if (touchesLum && format.lum !== null && format.lum !== undefined) {
        additions.push(`<a:lum bright="${format.lum.bright}" contrast="${format.lum.contrast}"/>`)
      }
      if (selfClosed) {
        if (additions.length > 0) {
          const openTag = open[0].slice(0, -2) + '>'
          xml =
            xml.slice(0, start) +
            openTag +
            additions.join('') +
            '</a:blip>' +
            xml.slice(start + open[0].length)
        }
      } else {
        const closeAt = xml.indexOf('</a:blip>', start)
        if (closeAt >= 0) {
          let children = xml.slice(start + open[0].length, closeAt)
          if (touchesOpacity) children = children.replace(/<a:alphaModFix\b[^>]*\/>/g, '')
          if (touchesLum) children = children.replace(/<a:lum\b[^>]*\/>/g, '')
          const tintAt = children.indexOf('<a:tint')
          const insertAt = tintAt >= 0 ? tintAt : children.length
          children = children.slice(0, insertAt) + additions.join('') + children.slice(insertAt)
          xml = xml.slice(0, start) + open[0] + children + xml.slice(closeAt)
        }
      }
    }
  }

  // a:srcRect — non-destructive crop; sits right after a:blip inside the
  // blipFill, before a:stretch/a:tile.
  if (format.srcRect !== undefined) {
    xml = xml.replace(/<a:srcRect\b[^>]*\/>/g, '')
    if (format.srcRect !== null) {
      const { l, t, r, b } = format.srcRect
      const element = `<a:srcRect l="${l}" t="${t}" r="${r}" b="${b}"/>`
      const blipClose = /<\/a:blip>/.exec(xml)
      const blipSelfClosed = /<a:blip\b[^>]*\/>/.exec(xml)
      const after =
        blipClose ??
        (blipSelfClosed ? { index: blipSelfClosed.index, 0: blipSelfClosed[0] } : undefined)
      if (after) {
        const at = after.index + after[0].length
        xml = xml.slice(0, at) + element + xml.slice(at)
      }
    }
  }

  // a:prstGeom — crop-to-shape; rewrite the preset in place (insert a
  // default geometry after the xfrm when the pic carries none).
  if (format.geom !== undefined) {
    const target = format.geom && format.geom !== 'rect' ? format.geom : 'rect'
    const existing = /(<xdr:spPr\b[^>]*>[\s\S]*?)<a:prstGeom\b[^>]*\bprst="([^"]+)"/.exec(xml)
    if (existing) {
      const head = existing[1] ?? ''
      xml =
        xml.slice(0, existing.index) +
        head +
        existing[0].slice(head.length).replace(/prst="([^"]+)"/, `prst="${target}"`) +
        xml.slice(existing.index + existing[0].length)
    } else {
      const xfrmClose = /<xdr:spPr\b[^>]*>[\s\S]*?<\/a:xfrm>/.exec(xml)
      if (xfrmClose) {
        const at = xfrmClose.index + xfrmClose[0].length
        xml =
          xml.slice(0, at) + `<a:prstGeom prst="${target}"><a:avLst/></a:prstGeom>` + xml.slice(at)
      }
    }
  }

  // a:effectLst/a:outerShdw — the outer shadow; replaces our previous effect.
  if (format.shadow !== undefined) {
    xml = xml.replace(
      /<a:effectLst\b[^>]*>\s*<a:outerShdw\b[^>]*\/>\s*<\/a:effectLst>|<a:effectLst\b[^>]*>\s*<a:outerShdw\b[^>]*>[\s\S]*?<\/a:outerShdw>\s*<\/a:effectLst>/,
      '',
    )
    xml = xml.replace(/<a:outerShdw\b[^>]*\/>|<a:outerShdw\b[^>]*>[\s\S]*?<\/a:outerShdw>/, '')
    if (format.shadow) {
      const sh = format.shadow
      const el =
        `<a:effectLst><a:outerShdw blurRad="${Math.round(sh.blurPt * 12700)}" distRad="${Math.round(sh.distPt * 12700)}" dir="${Math.round(sh.dirDeg * 60000)}" sx="0" sy="0">` +
        `<a:srgbClr val="${sh.color.toUpperCase()}"><a:alpha val="${Math.round(sh.alpha * 100000)}"/></a:srgbClr></a:outerShdw></a:effectLst>`
      const lnClose = /<a:ln\b[^>]*\/>|<a:ln\b[^>]*>[\s\S]*?<\/a:ln>/.exec(xml)
      const geomClose = /<a:prstGeom\b[^>]*\/>|<a:prstGeom\b[^>]*>[\s\S]*?<\/a:prstGeom>/.exec(xml)
      const after = lnClose ?? geomClose
      if (after) {
        const at = after.index + after[0].length
        xml = xml.slice(0, at) + el + xml.slice(at)
      }
    }
  }

  // a:ln — the outline; replaces the whole element (or drops it on clear).
  if (format.lineColor !== undefined || format.lineWidth !== undefined) {
    xml = xml.replace(/<a:ln\b[^>]*\/>/g, '').replace(/<a:ln\b[^>]*>[\s\S]*?<\/a:ln>/g, '')
    if (format.lineColor && format.lineWidth) {
      const element =
        `<a:ln w="${Math.round(format.lineWidth * 12_700)}">` +
        `<a:solidFill><a:srgbClr val="${format.lineColor.replace('#', '').toUpperCase()}"/></a:solidFill>` +
        '</a:ln>'
      // spPr child order: geometry, then ln.
      const anchor =
        /<\/a:prstGeom>/.exec(xml) ?? /<\/a:custGeom>/.exec(xml) ?? /<\/a:xfrm>/.exec(xml)
      if (anchor) {
        const at = anchor.index + anchor[0].length
        xml = xml.slice(0, at) + element + xml.slice(at)
      }
    }
  }

  return xml
}
