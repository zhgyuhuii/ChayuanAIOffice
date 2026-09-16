/// <reference types="vite/client" />

import type { DesktopApi } from '../shared/ipc'
import type { ProjectApi } from '@chatoffice/project-store'

import type { FilesPaneApi } from '@chatoffice/ui'

declare global {
  interface Window {
    desktop: DesktopApi
    filesPaneApi: FilesPaneApi
    projectApi: ProjectApi
  }
}

export {}
