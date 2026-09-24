/**
 * Floating page arrows for the overflowing ribbon tab strip. Rendered inside
 * the `.ribbon-tabs-scroll` viewport (they position against it); each arrow
 * appears only while tabs are clipped on its side. Plate/chevron styling
 * lives in ribbon's tab-strip.css, overridable per app.
 */
import type { TabStripOverflow } from './use-tab-strip-overflow'

export interface TabStripArrowsProps {
  readonly overflow: TabStripOverflow
  /** Accessible names; hosts pass translated strings. */
  readonly leadLabel?: string
  readonly tailLabel?: string
}

export function TabStripArrows({ overflow, leadLabel, tailLabel }: TabStripArrowsProps) {
  return (
    <>
      {overflow.hiddenStart ? (
        <button
          type="button"
          className="rb-strip-arrow rb-strip-arrow-lead"
          {...(leadLabel ? { 'aria-label': leadLabel, title: leadLabel } : {})}
          onClick={() => overflow.scrollByPage(-1)}
          onPointerDown={(e) => e.preventDefault()}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M14.75 5.5 8.25 12l6.5 6.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : null}
      {overflow.hiddenEnd ? (
        <button
          type="button"
          className="rb-strip-arrow rb-strip-arrow-tail"
          {...(tailLabel ? { 'aria-label': tailLabel, title: tailLabel } : {})}
          onClick={() => overflow.scrollByPage(1)}
          onPointerDown={(e) => e.preventDefault()}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M9.25 5.5 15.75 12l-6.5 6.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : null}
    </>
  )
}
