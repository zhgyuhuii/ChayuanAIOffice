declare module '*.md?raw' {
  const content: string
  export default content
}

import type { DesktopApi } from '../shared/desktop-api'
import type { ProjectApi } from '@chatoffice/project-store'

import type { FilesPaneApi } from '@chatoffice/ui'

declare global {
  interface Window {
    readonly desktopApi: DesktopApi
    readonly filesPaneApi: FilesPaneApi
    readonly projectApi: ProjectApi
  }
}

export {}
