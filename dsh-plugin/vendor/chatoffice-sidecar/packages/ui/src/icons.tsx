import type { ReactNode } from 'react'

export interface IconProps {
  size?: number
}

function Svg({ size = 16, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

export function IconSend(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.2 8 13.8 2.6 11 13.4 7.6 9.6z" strokeLinejoin="round" />
      <path d="M7.6 9.6 13.8 2.6" />
    </Svg>
  )
}

export function IconStop(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" stroke="none" />
    </Svg>
  )
}

