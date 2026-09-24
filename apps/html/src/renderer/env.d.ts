/// <reference types="vite/client" />

import type { ProjectApi } from '@chatoffice/project-store'
import type { HtmlApi } from '../shared/ipc'

import type { FilesPaneApi } from '@chatoffice/ui'

declare global {
  interface Window {
    htmlApi: HtmlApi
    filesPaneApi: FilesPaneApi
    projectApi?: Pick<ProjectApi, 'resolveChat' | 'appendChat' | 'loadChat' | 'rebindChat'>
  }
}

export {}
