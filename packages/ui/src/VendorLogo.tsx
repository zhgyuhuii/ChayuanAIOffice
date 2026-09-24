/**
 * VendorLogo — the harvested chatop vendor icon with a letter-avatar
 * fallback (chatoffice and any catalog row without an icon file).
 */
import React from 'react'
import { VENDOR_BY_ID } from '@chatoffice/ai-provider/browser'
import { VENDOR_LOGOS } from './vendor-logos'

export interface VendorLogoProps {
  /** vendor catalog id; unknown/absent falls back to the initial avatar */
  vendorId?: string | undefined
  size?: number
  /** avatar fallback letter (defaults to the vendor's initial) */
  fallback?: string
}

export function VendorLogo({ vendorId, size = 18, fallback }: VendorLogoProps): React.JSX.Element {
  const src = vendorId ? VENDOR_LOGOS[vendorId] : undefined
  if (src) {
    return <img className="msp-logo" src={src} alt="" aria-hidden width={size} height={size} />
  }
  const letter = (fallback ?? VENDOR_BY_ID.get(vendorId ?? '')?.name ?? vendorId ?? '?')
    .slice(0, 1)
    .toUpperCase()
  return (
    <span
      className="msp-avatar"
      style={{ width: size, height: size, fontSize: Math.round(size / 2) }}
      aria-hidden
    >
      {letter}
    </span>
  )
}
