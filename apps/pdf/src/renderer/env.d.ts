/// <reference types="vite/client" />

import type { PdfApi } from '../shared/ipc'

import type { FilesPaneApi } from '@chatoffice/ui'

declare global {
  interface Window {
    pdfApi: PdfApi
    filesPaneApi: FilesPaneApi
  }
}

export {}
