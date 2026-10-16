/// <reference types="vite/client" />
import type { SlidesApi } from '../shared/ipc'
import type { ProjectApi } from '@chaoffice/project-store'

import type { FilesPaneApi } from '@chaoffice/ui'

declare global {
  interface Window {
    slidesApi: SlidesApi
    filesPaneApi: FilesPaneApi
    projectApi: ProjectApi
  }
}

export {}
