/**
 * Ribbon-wide module-scope data and helpers shared between the legacy
 * Ribbon shell and extracted/hosted tab components (HomeTab today; more as
 * the schema migration proceeds). Lives outside Ribbon.tsx so extracted tabs
 * can import it without a cycle.
 */
import type { ChainedCommands } from '@tiptap/core'
import { ColorPicker } from '@chatoffice/ui'
import type { CustomNumberingLevel } from '@chatoffice/docx-engine'
import { formatNumber } from '../editor/numbering'
import { useI18n, type StringKey } from '../i18n/locale'

export const NOOP_CHAIN = new Proxy(
  {},
  { get: (_t, prop) => (prop === 'run' ? () => false : () => NOOP_CHAIN) },
) as ChainedCommands

export const FONT_SIZES = [
  5, 5.5, 6.5, 7.5, 8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72,
]

export const THEME_COLORS: Array<{ nameKey: StringKey; hex: string }> = [
  { nameKey: 'ribbonColorWhite', hex: 'FFFFFF' },
  { nameKey: 'ribbonColorBlack', hex: '000000' },
  { nameKey: 'ribbonColorLightGray', hex: 'E7E6E6' },
  { nameKey: 'ribbonColorBlueGray', hex: '0E2841' },
  { nameKey: 'ribbonColorBlue', hex: '156082' },
  { nameKey: 'ribbonColorOrange', hex: 'E97132' },
  { nameKey: 'ribbonColorGreen', hex: '196B24' },
  { nameKey: 'ribbonColorSkyBlue', hex: '0F9ED5' },
  { nameKey: 'ribbonColorPurple', hex: 'A02B93' },
  { nameKey: 'ribbonColorLightGreenAlt', hex: '4EA72E' },
]

export const COLORS: Array<{ nameKey: StringKey; hex: string }> = [
  { nameKey: 'ribbonColorDarkRed', hex: 'C00000' },
  { nameKey: 'ribbonColorRed', hex: 'FF0000' },
  { nameKey: 'ribbonColorOrange', hex: 'FFC000' },
  { nameKey: 'ribbonColorYellow', hex: 'FFFF00' },
  { nameKey: 'ribbonColorLightGreen', hex: '92D050' },
  { nameKey: 'ribbonColorGreen', hex: '00B050' },
  { nameKey: 'ribbonColorLightBlue', hex: '00B0F0' },
  { nameKey: 'ribbonColorBlue', hex: '0070C0' },
  { nameKey: 'ribbonColorDarkBlue', hex: '002060' },
  { nameKey: 'ribbonColorPurple', hex: '7030A0' },
]

/** Translated tooltip names for the shared picker's named swatches */
export const COLOR_NAME_KEYS: Record<string, StringKey> = Object.fromEntries(
  [...THEME_COLORS, ...COLORS].map((c) => [c.hex, c.nameKey]),
)

/** Word-style theme + standard color palette (shared panel, docs anchor positioning) */
export function ShapeColorPalette({
  current,
  noneLabel,
  onPick,
}: {
  current: string | null
  noneLabel: string
  onPick: (hex: string | null) => void
}) {
  const { t } = useI18n()
  // data-rb-panel marks the picker as "inside" for the unified dismissal
  // guard; display:contents keeps the wrapper out of layout so the panel's
  // anchor positioning still resolves against the trigger wrap.
  return (
    <div data-rb-panel="" style={{ display: 'contents' }}>
      <ColorPicker
        className="docs-color-pop"
        value={current ? `#${current}` : null}
        strings={{
          auto: noneLabel,
          themeColors: t('ribbonThemeColorsSection'),
          standardColors: t('ribbonStandardColors'),
          moreColors: t('ribbonMoreColors'),
          shadeTip: (r, c) => t('ribbonThemeColorShadeTip', { r, c }),
          colorName: (s) => {
            const key = COLOR_NAME_KEYS[s.hex]
            return key ? t(key) : s.name
          },
        }}
        onPick={(hex) => onPick(hex ? hex.slice(1) : null)}
      />
    </div>
  )
}

/** Word text highlight colors (OOXML named values) */
export const HIGHLIGHTS = [
  'yellow',
  'green',
  'cyan',
  'magenta',
  'blue',
  'red',
  'darkBlue',
  'darkCyan',
  'darkGreen',
  'darkMagenta',
  'darkRed',
  'darkYellow',
  'darkGray',
  'lightGray',
  'black',
]

export const LINE_SPACINGS = [1, 1.15, 1.5, 2, 2.5, 3]

// ---- List library presets (bullets/numbering/multilevel): picking one creates a numbering definition ----

/** Bullet library: the chosen symbol is level 1; deeper levels rotate through ○/■ */
export function bulletPresetLevels(glyph: string): CustomNumberingLevel[] {
  const rotation = [glyph, '○', '■']
  return Array.from({ length: 9 }, (_, i) => ({
    numFmt: 'bullet',
    lvlText: rotation[i % 3],
    indentLeft: 720 * (i + 1),
    hanging: 360,
  }))
}

/** Numbering library: the same format continues per level (%1 in the pattern becomes each level's counter) */
export function numberPresetLevels(numFmt: string, pattern: string): CustomNumberingLevel[] {
  return Array.from({ length: 9 }, (_, i) => ({
    numFmt,
    lvlText: pattern.replace('%1', `%${i + 1}`),
    indentLeft: 720 * (i + 1),
    hanging: 360,
  }))
}

export const BULLET_LIBRARY = ['•', '○', '■', '◆', '➢', '✦']

export const NUMBER_LIBRARY: Array<{ numFmt: string; pattern: string }> = [
  { numFmt: 'decimal', pattern: '%1.' },
  { numFmt: 'decimal', pattern: '%1)' },
  { numFmt: 'upperRoman', pattern: '%1.' },
  { numFmt: 'upperLetter', pattern: '%1.' },
  { numFmt: 'lowerLetter', pattern: '%1)' },
  { numFmt: 'chineseCountingThousand', pattern: '%1、' },
]

export const MULTILEVEL_LIBRARY: CustomNumberingLevel[][] = [
  // 1. / 1.1. / 1.1.1.
  Array.from({ length: 9 }, (_, i) => ({
    numFmt: 'decimal',
    lvlText: `${Array.from({ length: i + 1 }, (_, k) => `%${k + 1}`).join('.')}.`,
    indentLeft: 720 * (i + 1),
    hanging: 432,
  })),
  // Chinese official-document hierarchy: numeral + comma / parenthesized numeral / 1.
  Array.from({ length: 9 }, (_, i): CustomNumberingLevel => {
    if (i === 0)
      return { numFmt: 'chineseCountingThousand', lvlText: '%1、', indentLeft: 720, hanging: 425 }
    if (i === 1)
      return { numFmt: 'chineseCountingThousand', lvlText: '(%2)', indentLeft: 1440, hanging: 425 }
    return { numFmt: 'decimal', lvlText: `%${i + 1}.`, indentLeft: 720 * (i + 1), hanging: 360 }
  }),
  // • / ○ / ■
  bulletPresetLevels('•'),
]

/** The level's number text when every level counter is 1 (gallery/dialog preview) */
export function previewLevelText(levels: CustomNumberingLevel[], ilvl: number): string {
  const l = levels[ilvl]
  if (!l) return ''
  if (l.numFmt === 'bullet') return l.lvlText
  return l.lvlText.replace(/%(\d)/g, (_, n: string) =>
    formatNumber(1, levels[Number(n) - 1]?.numFmt ?? 'decimal'),
  )
}
