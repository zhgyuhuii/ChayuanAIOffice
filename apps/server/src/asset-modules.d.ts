/** vite/electron-vite asset imports surfaced by shared slides modules */
declare module '*?asset' {
  const path: string
  export default path
}

/** bidi-js ships without types (slides' own tsconfig tolerates it the same way) */
declare module 'bidi-js'

/** markdown prompt docs imported as raw text (pptx-ops op-docs) */
declare module '*?raw' {
  const text: string
  export default text
}
