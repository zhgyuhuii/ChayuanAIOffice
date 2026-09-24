/** bidi-js has no types (pptx-render sources are compiled into this project via the workspace source export; its bundled d.ts does not come along) */
declare module 'bidi-js' {
  interface BidiApi {
    getEmbeddingLevels(
      text: string,
      explicitDirection?: 'ltr' | 'rtl',
    ): { levels: Uint8Array; paragraphs: Array<{ start: number; end: number; level: number }> }
  }
  export default function bidiFactory(): BidiApi
}

/** vendored image assets (vendor logos) — bundlers emit URLs */
declare module '*.png' {
  const src: string
  export default src
}
declare module '*.webp' {
  const src: string
  export default src
}
declare module '*.svg' {
  const src: string
  export default src
}

/** side-effect stylesheets — bundled and injected by vite */
declare module '*.css'
