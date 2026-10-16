/// <reference types="vite/client" />

import type { DesktopApi } from '../shared/ipc'
import type { ProjectApi } from '@chaoffice/project-store'

import type { FilesPaneApi } from '@chaoffice/ui'

declare global {
  interface Window {
    desktop: DesktopApi
    filesPaneApi: FilesPaneApi
    projectApi: ProjectApi
  }
}

export {}
