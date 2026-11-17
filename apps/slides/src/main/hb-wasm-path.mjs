// Bundler branch (electron-vite/vitest): the `?asset` import resolves at build
// time and exports the shipped wasm path. The node/tsx branch never sees this
// file's import succeed through its loader chain; shaped-metrics catches that
// failure and falls back to the CJS hooks in tsx-assets.cjs.
import hbWasmPath from '../../../../node_modules/harfbuzzjs/dist/harfbuzz.wasm?asset'
export default hbWasmPath
