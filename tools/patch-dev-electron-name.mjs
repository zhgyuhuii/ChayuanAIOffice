/**
 * Re-identify the dev-mode electron install so every OS shows the product.
 *
 * macOS: the dev bundle directory itself is renamed
 *   node_modules/electron/dist/Electron.app → 察元AIOffice.app
 * because the Dock HOVER TOOLTIP reads the .app bundle's directory name —
 * empirically it shows "Electron" even when the process name (p_comm), the
 * ASN check-in name, NSRunningApplication.localizedName and the
 * LaunchServices record all say otherwise (each verified independently).
 * CFBundleName / CFBundleDisplayName / CFBundleIdentifier are patched as
 * well (menu bar, LS, cache busting) and the stock electron.icns is replaced
 * with the brand icon for the quit-state Dock tile.
 *
 * Electron's install.js refuses to consider the install valid unless
 * path.txt equals the stock "Electron.app/Contents/MacOS/Electron", so a
 * patched path.txt makes any later `npm install` re-extract a stock dist
 * over the patch. That is accepted and closed by construction: postinstall
 * runs this patch right after install-electron, so every wipe is immediately
 * repaired; between installs nothing calls install.js (getElectronPath only
 * heals when the path.txt target is missing, and it exists).
 *
 * The main executable is HARD-LINKED as 察元AIOffice inside the bundle
 * (CFBundleExecutable points there) so the process name matches too; the
 * stock "Electron" link stays so a stale path.txt still launches. A renamed
 * executable makes Electron report app.isPackaged === true, which flips every
 * dev branch (userData path, extraResources module paths, dock icon, updater)
 * into packaged mode and blanks the editors — apps/shell/src/main/dev-identity.ts
 * pins the flag back to false and must stay the first import of the shell
 * main entry.
 *
 * Linux: the GNOME/KDE taskbar names a window by WM_CLASS = executable
 * basename ("electron" in dev) — a dev .desktop entry resolves that WM_CLASS
 * to 察元AIOffice + brand icon. The binary is not renamed (same isPackaged
 * flip).
 *
 * Editing a signed .app invalidates its code signature and arm64 macOS kills
 * the process on launch, so the bundle is re-signed ad hoc afterwards (and
 * every original restored if that fails, keeping dev launches working under
 * the old identity). The patch is idempotent; the root postinstall re-runs it
 * right after install-electron, and predev re-checks cheaply on every launch.
 */
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_NAME = '察元AIOffice'
// Fresh dev-only bundle identity: the stock "com.github.Electron" id lets the
// Dock/IconServices pin the identity (name + icon) this path had BEFORE the
// patch ran, and that ghost survives killall Dock; a brand-new id forces every
// OS cache to re-resolve. Distinct from the packaged appId com.chaoffice.app.
const DEV_BUNDLE_ID = 'app.chaoffice.dev'
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BRAND_ICON = join(REPO_ROOT, 'apps', 'shell', 'build', 'icon.icns')
const PLIST_BUDDY = '/usr/libexec/PlistBuddy'
const LSREGISTER =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'

// Dev only: Windows has no taskbar-identity mechanism to patch from here.
if (process.platform === 'win32') process.exit(0)

/**
 * Linux dev identity: the GNOME/KDE taskbar (dash) names and groups a window
 * by its WM_CLASS, which Electron takes from the executable basename — the
 * unpackaged binary is literally "electron", so a dev run shows a lowercase
 * "electron" tooltip and the stock icon. The binary itself is NOT renamed
 * (renaming flips app.isPackaged and breaks the dev module layout — see the
 * header); instead a dev .desktop entry resolves WM_CLASS electron →
 * 察元AIOffice + brand icon.
 */
function patchLinux() {
  const distDir = [
    join(REPO_ROOT, 'node_modules', 'electron', 'dist'),
    join(REPO_ROOT, 'apps', 'shell', 'node_modules', 'electron', 'dist'),
  ].find((p) => existsSync(join(p, 'electron')))
  if (!distDir) {
    console.log('[patch-dev-electron-name] linux electron dist not present yet, skipping')
    return
  }
  // undo a pre-isPackaged-fix rename from an earlier run of this script
  const exeRenamed = join(distDir, 'chaoffice')
  const exeOriginal = join(distDir, 'electron')
  if (existsSync(exeRenamed) && !existsSync(exeOriginal)) {
    renameSync(exeRenamed, exeOriginal)
    const pathTxt = join(dirname(distDir), 'path.txt')
    if (existsSync(pathTxt) && readFileSync(pathTxt, 'utf8').trim() === 'chaoffice') {
      writeFileSync(pathTxt, 'electron')
    }
    console.log(
      '[patch-dev-electron-name] linux: executable restored to "electron" (renaming flips app.isPackaged)',
    )
  }
  const desktopDir = join(process.env.HOME ?? '', '.local', 'share', 'applications')
  const desktopFile = join(desktopDir, 'chaoffice-dev.desktop')
  const iconPng = join(REPO_ROOT, 'apps', 'shell', 'build', 'icon.png')
  const desktopSpec =
    `[Desktop Entry]\n` +
    `Type=Application\n` +
    `Name=${APP_NAME}\n` +
    `Exec=${exeOriginal}\n` +
    `Icon=${iconPng}\n` +
    `StartupWMClass=electron\n` +
    `NoDisplay=true\n`
  const desktopDone = existsSync(desktopFile) && readFileSync(desktopFile, 'utf-8') === desktopSpec
  if (desktopDone) return
  try {
    if (existsSync(iconPng)) {
      mkdirSync(desktopDir, { recursive: true })
      writeFileSync(desktopFile, desktopSpec)
      try {
        execFileSync('update-desktop-database', [desktopDir], { stdio: 'ignore' })
      } catch {
        // not installed on minimal distros — GNOME picks the file up anyway
      }
    }
  } catch (err) {
    console.error(`[patch-dev-electron-name] linux patch failed: ${err.message}`)
    process.exit(1)
  }
  console.log(
    `[patch-dev-electron-name] linux dev electron → desktop entry branding WM_CLASS "electron"`,
  )
}

if (process.platform === 'linux') {
  patchLinux()
  process.exit(0)
}

// electron may hoist to the root node_modules or stay under apps/shell; find
// whichever dist currently holds a bundle under either name.
const STOCK_APP = 'Electron.app'
const BRAND_APP = `${APP_NAME}.app`
const distDir = [
  join(REPO_ROOT, 'node_modules', 'electron', 'dist'),
  join(REPO_ROOT, 'apps', 'shell', 'node_modules', 'electron', 'dist'),
].find(
  (d) =>
    existsSync(join(d, BRAND_APP, 'Contents', 'Info.plist')) ||
    existsSync(join(d, STOCK_APP, 'Contents', 'Info.plist')),
)
if (!distDir) {
  // electron's lazy binary installer has not unpacked dist yet; postinstall
  // chains this script right after install-electron, so that pass will do it.
  console.log('[patch-dev-electron-name] electron dist not present yet, skipping')
  process.exit(0)
}

const stockBundle = join(distDir, STOCK_APP)
const appBundle = join(distDir, BRAND_APP)
const contents = join(appBundle, 'Contents')
const plist = join(contents, 'Info.plist')
const bundleIcon = join(contents, 'Resources', 'electron.icns')
const exeStock = join(contents, 'MacOS', 'Electron')
const exeBrand = join(contents, 'MacOS', APP_NAME)
const pathTxt = join(distDir, '..', 'path.txt')
const stockRelPath = `${STOCK_APP}/Contents/MacOS/Electron`
const brandRelPath = `${BRAND_APP}/Contents/MacOS/${APP_NAME}`
const sameBytes = (a, b) => readFileSync(a).equals(readFileSync(b))

function readKey(key) {
  return execFileSync(PLIST_BUDDY, ['-c', `Print :${key}`, plist], { encoding: 'utf-8' }).trim()
}

// ── 1. bundle directory rename (the Dock hover tooltip reads the dir name) ──
if (!existsSync(join(appBundle, 'Contents', 'Info.plist'))) {
  try {
    renameSync(stockBundle, appBundle)
  } catch (err) {
    console.error(`[patch-dev-electron-name] bundle rename failed: ${err.message}`)
    process.exit(1)
  }
}

// ── 2. executable hard link (process name; stock name kept as launch alias) ──
const exeDone = existsSync(exeBrand) && existsSync(exeStock)
if (!exeDone) {
  try {
    if (existsSync(exeBrand) && !existsSync(exeStock)) {
      linkSync(exeBrand, exeStock)
    } else if (existsSync(exeStock)) {
      linkSync(exeStock, exeBrand)
    } else {
      console.error('[patch-dev-electron-name] no main executable found in the bundle')
      process.exit(1)
    }
  } catch (err) {
    console.error(`[patch-dev-electron-name] executable hard-link failed: ${err.message}`)
    process.exit(1)
  }
}

// ── 3. plist identity + brand icon + path.txt ──
const nameDone =
  readKey('CFBundleName') === APP_NAME &&
  readKey('CFBundleIdentifier') === DEV_BUNDLE_ID &&
  readKey('CFBundleExecutable') === APP_NAME
const iconDone =
  existsSync(BRAND_ICON) && existsSync(bundleIcon) && sameBytes(bundleIcon, BRAND_ICON)
const pathTxtRaw = existsSync(pathTxt) ? readFileSync(pathTxt, 'utf-8').trim() : ''
const pathTxtDone = pathTxtRaw === brandRelPath
if (nameDone && iconDone && exeDone && pathTxtDone) process.exit(0)

const plistBackup = readFileSync(plist)
const iconBackup = existsSync(bundleIcon) ? readFileSync(bundleIcon) : null
const pathTxtBackup = pathTxtRaw || null
try {
  if (!nameDone) {
    execFileSync(PLIST_BUDDY, ['-c', `Set :CFBundleIdentifier ${DEV_BUNDLE_ID}`, plist])
    execFileSync(PLIST_BUDDY, ['-c', `Set :CFBundleExecutable ${APP_NAME}`, plist])
    for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
      try {
        execFileSync(PLIST_BUDDY, ['-c', `Set :${key} ${APP_NAME}`, plist])
      } catch {
        // a future electron dist may drop the optional display name key
        execFileSync(PLIST_BUDDY, ['-c', `Add :${key} string ${APP_NAME}`, plist])
      }
    }
  }
  if (!iconDone && existsSync(BRAND_ICON)) copyFileSync(BRAND_ICON, bundleIcon)
  // shared-folder guard: never clobber a linux-style bare-basename path.txt
  // written by a VM guest building the same checkout
  if (!pathTxtDone && (!pathTxtBackup || pathTxtBackup.includes('.app/Contents/MacOS/'))) {
    writeFileSync(pathTxt, brandRelPath)
  }
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appBundle], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', appBundle])
} catch (err) {
  // Leave the bundle exactly as shipped: a half-patched unsigned app would be
  // killed by arm64 macOS on every dev launch — worse than the old identity.
  writeFileSync(plist, plistBackup)
  if (iconBackup) writeFileSync(bundleIcon, iconBackup)
  if (pathTxtBackup) writeFileSync(pathTxt, pathTxtBackup)
  console.error(`[patch-dev-electron-name] patch failed, originals restored: ${err.message}`)
  process.exit(1)
}

// LaunchServices caches the previous registration (name AND icon of the Dock
// tile after quit); force-refresh so both update without a logout, and drop
// the record of the pre-rename path so it cannot shadow the new one.
try {
  execFileSync(LSREGISTER, ['-u', stockBundle], { stdio: 'ignore' })
} catch {
  // nothing registered under the old path — harmless
}
try {
  execFileSync(LSREGISTER, ['-f', appBundle], { stdio: 'ignore' })
} catch {
  // lsregister moved in a future macOS — harmless
}

console.log(
  `[patch-dev-electron-name] dev bundle → ${BRAND_APP} "${APP_NAME}"` +
    `${iconDone ? '' : ' + brand icon'}${exeDone ? '' : ' + executable hard link'}`,
)
