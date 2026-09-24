/** vite/electron-vite asset imports surfaced by shared slides modules */
declare module '*?asset' {
  const path: string
  export default path
}

/** bidi-js ships without types (slides' own tsconfig tolerates it the same way) */
declare module 'bidi-js'
