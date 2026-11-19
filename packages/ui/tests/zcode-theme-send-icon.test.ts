import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// W42 gave the send/stop buttons a brand-filled circle (`.ai-send-btn` paints
// `--color-btn-primary` with `--color-btn-primary-text` ink), but every host
// stylesheet pins the glyph at the svg level (`.ai-send-btn svg { color:
// var(--text) }`) and a direct hit beats inheritance — the glyph landed
// same-tone on the circle (dark on dark in light, light on light in dark) and
// vanished (user report: 发送图标都找不到了). Keep an svg-level re-pin in this
// override layer, otherwise the icon disappears again.
const css = readFileSync(resolve(__dirname, '../src/zcode-theme.css'), 'utf8')

describe('zcode-theme send icon glyph ink', () => {
  it('re-pins the send/stop glyph ink at the svg level on both surfaces', () => {
    for (const scope of ['.home .chat-composer', '.ai-panel']) {
      const rule = new RegExp(`${escapeRe(scope)} \\.ai-send-btn svg\\s*\\{([^}]*)\\}`).exec(css)
      expect(rule, `missing ${scope} .ai-send-btn svg rule`).toBeTruthy()
      expect(rule![1]).toContain('color: var(--color-btn-primary-text)')
    }
  })

  it('keeps the circle brand-filled (the trap that hides same-tone glyphs)', () => {
    const home = /\.home \.chat-composer \.ai-send-btn\s*\{([^}]*)\}/.exec(css)
    expect(home, 'missing .home .chat-composer .ai-send-btn rule').toBeTruthy()
    expect(home![1]).toContain('background: var(--color-btn-primary)')
    expect(home![1]).toContain('color: var(--color-btn-primary-text)')
  })
})

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
