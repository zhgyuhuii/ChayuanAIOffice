/// <reference types="vite/client" />

import type { ProjectApi } from '@chaoffice/project-store'
import type { MarkdownApi } from '../shared/ipc'

import type { FilesPaneApi } from '@chaoffice/ui'

declare global {
  interface Window {
    markdownApi: MarkdownApi
    filesPaneApi: FilesPaneApi
    projectApi?: Pick<ProjectApi, 'resolveChat' | 'appendChat' | 'loadChat' | 'rebindChat'>
  }
}

export {}
