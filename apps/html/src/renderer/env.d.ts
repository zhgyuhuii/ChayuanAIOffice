/// <reference types="vite/client" />

import type { ProjectApi } from '@chaoffice/project-store'
import type { HtmlApi } from '../shared/ipc'

import type { FilesPaneApi } from '@chaoffice/ui'

declare global {
  interface Window {
    htmlApi: HtmlApi
    filesPaneApi: FilesPaneApi
    projectApi?: Pick<ProjectApi, 'resolveChat' | 'appendChat' | 'loadChat' | 'rebindChat'>
  }
}

export {}
