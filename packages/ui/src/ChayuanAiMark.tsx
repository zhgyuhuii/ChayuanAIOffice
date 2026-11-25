/**
 * ChayuanAiMark — the colored 察元 AI brand mark for the ribbon entry buttons.
 *
 * Every editor's 「开始」tab leads with the same 察元AI entry (open/close the
 * AI conversation panel), and this is its glyph: the 察元 sparkle — the exact
 * geometry of the monochrome GensparkMark — laid on the app-icon's blue→violet
 * gradient inside the file-tile rounded-square idiom (saturated tile + white
 * glyph, cf. packages/ui/src/file-tiles/*.svg). Saturated fills on both light
 * and dark themes, so unlike the currentColor command glyphs it reads as a
 * brand tile rather than another toolbar command.
 */
import React from 'react'

export function ChayuanAiMark({ size = 26 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <defs>
        <linearGradient
          id="chayuan-ai-mark-tile"
          x1="1"
          y1="1"
          x2="23"
          y2="23"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#3E8BFF" />
          <stop offset="1" stopColor="#8B5CF6" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="22" height="22" rx="6.5" fill="url(#chayuan-ai-mark-tile)" />
      {/* glassy top edge, the app icon's light catch */}
      <path
        d="M2.1 8V6.9a4.8 4.8 0 0 1 4.8-4.8H17.1a4.8 4.8 0 0 1 4.8 4.8V8"
        stroke="#fff"
        strokeOpacity="0.32"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
      {/* the 察元 sparkle — same coordinates as GensparkMark */}
      <path
        d="M12 4.5l1.9 5.1 5.1 1.9-5.1 1.9L12 18.5l-1.9-5.1L5 11.5l5.1-1.9L12 4.5z"
        fill="#fff"
      />
      {/* small companion sparkle, the AI ✨ pair — tucked below the glass edge */}
      <path
        d="M19.2 5.1l.48 1.3 1.3.48-1.3.48-.48 1.3-.48-1.3-1.3-.48 1.3-.48.48-1.3z"
        fill="#fff"
        fillOpacity="0.95"
      />
    </svg>
  )
}
