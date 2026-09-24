import { app } from 'electron'
import { sep } from 'node:path'

// Dev-only identity shim for the taskbar patch (tools/patch-dev-electron-name.mjs).
// The patch hard-links the dev Electron binary as "察元AIOffice" so macOS shows the
// product name in the Dock hover tooltip (which reads the process name — the
// executable basename — not the bundle display name). A differently-named
// executable makes Electron report app.isPackaged === true, which flips every
// dev branch in the main process (userData path, extraResources module paths,
// dock icon, updater) into packaged mode and blanks the editors. When the
// executable still lives inside the repo's node_modules electron install we
// know we are NOT packaged — pin the flag back to false before any module-scope
// isPackaged read runs. Must stay the first import of the shell main entry.
try {
  const isDevElectronInstall = process.execPath.includes(
    `${sep}node_modules${sep}electron${sep}dist${sep}`,
  )
  if (isDevElectronInstall && app.isPackaged) {
    Object.defineProperty(app, 'isPackaged', { value: false })
  }
} catch (err) {
  console.error('[dev-identity] failed to pin app.isPackaged for the renamed dev binary:', err)
}
