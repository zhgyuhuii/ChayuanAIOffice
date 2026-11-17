// Bundler branch for the fonts.ts asset paths (electron-vite resolves the
// `?asset` imports at build time). The node/tsx chain answers through the CJS
// hooks in tsx-assets.cjs; this twin is the dynamic-import fallback.
import carlitoRegular from '@chaoffice/ui/fonts/Carlito-Regular.ttf?asset'
import carlitoBold from '@chaoffice/ui/fonts/Carlito-Bold.ttf?asset'
import carlitoItalic from '@chaoffice/ui/fonts/Carlito-Italic.ttf?asset'
import carlitoBoldItalic from '@chaoffice/ui/fonts/Carlito-BoldItalic.ttf?asset'
export const bundledFontPaths = { carlitoRegular, carlitoBold, carlitoItalic, carlitoBoldItalic }
