/// <reference types="vite/client" />
import type { SlidesApi } from '../shared/ipc'
import type { ProjectApi } from '@chatoffice/project-store'

import type { FilesPaneApi } from '@chatoffice/ui'

declare global {
  interface Window {
    slidesApi: SlidesApi
    filesPaneApi: FilesPaneApi
    projectApi: ProjectApi
  }
}

export {}
