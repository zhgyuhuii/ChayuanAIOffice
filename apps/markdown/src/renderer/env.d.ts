/// <reference types="vite/client" />

import type { ProjectApi } from '@chatoffice/project-store'
import type { MarkdownApi } from '../shared/ipc'

import type { FilesPaneApi } from '@chatoffice/ui'

declare global {
  interface Window {
    markdownApi: MarkdownApi
    filesPaneApi: FilesPaneApi
    projectApi?: Pick<ProjectApi, 'resolveChat' | 'appendChat' | 'loadChat' | 'rebindChat'>
  }
}

export {}
