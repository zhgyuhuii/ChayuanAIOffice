/**
 * electron-builder configuration (moved out of package.json "build" so the
 * auto-update feed URL can be injected at build time instead of living in
 * the repo).
 *
 * CHATOFFICE_UPDATE_URL — public base URL of the update channel (the generic
 * provider prefix that serves latest.yml / latest-mac.yml). Required for
 * release builds; CI provides it as a repository secret. For local release
 * builds put it in apps/shell/electron-builder.env (gitignored) — the
 * electron-builder CLI loads that file automatically.
 *
 * When the variable is unset (forks, PR smoke builds, plain local packaging)
 * the publish config is omitted: electron-builder then bakes no
 * app-update.yml into the app and in-app auto-update stays disabled.
 *
 * CHATOFFICE_GA4_MEASUREMENT_ID / CHATOFFICE_GA4_API_SECRET — GA4 Measurement
 * Protocol credentials for anonymous usage analytics, injected the same way
 * (CI secrets, or apps/shell/electron-builder.env locally). They are written
 * into the packaged app's package.json via extraMetadata and read back by
 * src/main/analytics.ts. When either is unset — every source/fork build —
 * nothing is injected and the app runs with analytics fully disabled.
 *
 * CHATOFFICE_FONT_CDN_URL — base URL for the curated downloadable-font catalog.
 * Official release jobs inject it through extraMetadata so the endpoint stays
 * out of source. Without it, font download prompts/catalog entries are hidden;
 * users can still install local font files.
 */

// electron-builder 在打包期要从 GitHub 下载 Electron zip 与 fpm/7zip 等工具，
// 国内直连 GitHub 常见超时/重置——默认走 npmmirror 镜像，让 `npm run dist:*`
// 不带任何环境变量即可工作。CI 或特殊网络可用同名环境变量覆盖（设为官方地址）。
process.env.ELECTRON_MIRROR ??= 'https://npmmirror.com/mirrors/electron/'
process.env.ELECTRON_BUILDER_BINARIES_MIRROR ??=
  'https://npmmirror.com/mirrors/electron-builder-binaries/'

const { execFileSync } = require('node:child_process')

// rpm 目标需要宿主装 rpmbuild（mac/多数 Linux 缺省没有）——缺席时自动跳过
// rpm 目标而不是让整条 dist:linux 失败（AppImage/deb 不依赖它）
function hasRpmbuild() {
  try {
    execFileSync('rpmbuild', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
const { copyFileSync, existsSync, rmSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

function normalizeHttpsBaseUrl(name, value) {
  if (!value || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('invalid')
    }
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    throw new Error(`${name} must be an HTTPS base URL without credentials, query, or fragment`)
  }
}

const updateUrl = process.env.CHATOFFICE_UPDATE_URL
const ga4MeasurementId = process.env.CHATOFFICE_GA4_MEASUREMENT_ID
const ga4ApiSecret = process.env.CHATOFFICE_GA4_API_SECRET
const fontCdnUrl = normalizeHttpsBaseUrl(
  'CHATOFFICE_FONT_CDN_URL',
  process.env.CHATOFFICE_FONT_CDN_URL,
)

// CHATOFFICE_MAC_X64=1 — opt into packaging the Intel (x64) dmg/zip alongside
// arm64. Off by default: Intel packages must only ever ship signed with the
// company certificate (planned dual-track pipeline), so the current release
// pipeline stays arm64-only and never produces a personally-signed Intel
// artifact. The downstream layout (feed archive name, ChatOffice-intel.dmg
// alias) keys off which dmgs exist, so flipping this flag is the single
// switch.
const includeMacX64 = process.env.CHATOFFICE_MAC_X64 === '1'

// GENOFFICE_WIN_ARM64=1 — package the Windows ARM64 installer instead of x64.
// CI runs it as a second electron-builder pass (own BUILD_DIR) after the
// unchanged x64 pass, so the two never share an output dir or a sidecar path:
// the sidecar comes from the matching cargo target dir and is checked to
// exist at beforePack because electron-builder exits 0 on a missing
// extraResources source (Sheets would ship dead on every ARM install).
const winArm64 = process.env.GENOFFICE_WIN_ARM64 === '1'
// 7-Zip packs ARM64 executables with its ARM64 branch filter, which the NSIS
// install-time extractor (Nsis7z) cannot decode: it silently skips
// ChatOffice.exe and every dll (electron-builder#9983). BCJ it can decode.
if (winArm64 && !process.env.ELECTRON_BUILDER_7Z_FILTER) {
  process.env.ELECTRON_BUILDER_7Z_FILTER = 'BCJ'
}
const winArch = winArm64 ? 'arm64' : 'x64'
const winSidecarTarget = winArm64 ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-gnu'
const WIN_SIDECAR = `../sheets/native/xlsx-engine/target/${winSidecarTarget}/release/xlsx-sidecar.exe`

// LICENSES.chromium.html only exists after the Electron binary download —
// since Electron 42 that no longer happens during `npm ci` (the postinstall
// script was replaced by the lazy `install-electron` bin), and electron-builder
// exits 0 on a missing extraResources source, so without this check the
// installer would silently ship without the Chromium license.
// (the @genspark/cli gsk runtime was dropped from dependencies when the AI
// stack moved to the V2 shared ai:* channels; its extraResources entries went
// with it, so this list no longer checks for it)
for (const rel of [
  '../../node_modules/electron/dist/LICENSES.chromium.html',
  '../../node_modules/@embedpdf/pdfium/dist/pdfium.wasm',
  '../pdf/node_modules/harfbuzzjs/hb-subset.wasm',
]) {
  if (!existsSync(join(__dirname, rel))) {
    throw new Error(
      `electron-builder extraResources source missing: ${rel} (npm hoisting changed?)`,
    )
  }
}

// macOS local-OCR helper (scanned-page text recovery): a swiftc output, not
// an npm artifact — compiled here on demand so CI runners and fresh checkouts
// need no manual step. Universal (arm64 + x86_64) when both targets compile,
// host-arch otherwise; mac installers must not silently ship without it.
const VISION_OCR_HELPER = '../../packages/pdf2docx/ocr-helper/vision-ocr'

// Compile the helper. universalOnly=true has NO host-arch fallback: dual-arch
// packaging must fail loudly rather than ship a host-arch binary to both dmgs.
function compileVisionOcr({ universalOnly } = { universalOnly: false }) {
  const src = join(__dirname, `${VISION_OCR_HELPER}.swift`)
  const out = join(__dirname, VISION_OCR_HELPER)
  try {
    try {
      const slices = ['arm64', 'x86_64'].map((arch) => {
        const slice = `${out}.${arch}`
        execFileSync('swiftc', ['-O', src, '-target', `${arch}-apple-macos12`, '-o', slice], {
          stdio: 'inherit',
        })
        return slice
      })
      execFileSync('lipo', ['-create', ...slices, '-output', out], { stdio: 'inherit' })
      for (const slice of slices) rmSync(slice, { force: true })
    } catch (err) {
      if (universalOnly) throw err
      // cross-target SDK unavailable — a host-arch helper still serves this build
      execFileSync('swiftc', ['-O', src, '-o', out], { stdio: 'inherit' })
    }
  } catch (err) {
    throw new Error(`vision-ocr helper compile failed: ${err}`, { cause: err })
  }
}

if (process.platform === 'darwin' && !existsSync(join(__dirname, VISION_OCR_HELPER))) {
  compileVisionOcr()
}

// Windows local-OCR helper (Windows.Media.Ocr): compiled by the in-box .NET
// Framework csc via build-win.mjs — same on-demand policy as the mac helper,
// and Windows installers must not silently ship without it.
const WIN_OCR_HELPER = '../../packages/pdf2docx/ocr-helper/win-ocr.exe'
if (process.platform === 'win32' && !existsSync(join(__dirname, WIN_OCR_HELPER))) {
  try {
    execFileSync(
      process.execPath,
      [join(__dirname, '../../packages/pdf2docx/ocr-helper/build-win.mjs')],
      { stdio: 'inherit' },
    )
  } catch (err) {
    throw new Error(`win-ocr helper compile failed: ${err}`, { cause: err })
  }
}

// Dual-arch packs share one extraResources path, so the shipped helper must be
// a lipo fat binary. A stale host-arch build (dev path above) is rebuilt in
// place; if a universal build cannot be produced, packaging aborts — otherwise
// the other arch's OCR silently fails and every scanned page ships as bitmap.
function assertUniversalVisionOcr() {
  const helper = join(__dirname, VISION_OCR_HELPER)
  const wanted = ['x86_64', 'arm64']
  const archsOf = () =>
    existsSync(helper)
      ? execFileSync('lipo', ['-archs', helper], { encoding: 'utf8' }).trim().split(/\s+/)
      : []
  if (!wanted.every((w) => archsOf().includes(w))) {
    rmSync(helper, { force: true })
    compileVisionOcr({ universalOnly: true })
  }
  const archs = archsOf()
  for (const want of wanted) {
    if (!archs.includes(want)) {
      throw new Error(
        `vision-ocr helper is [${archs.join(', ')}] but both mac arch packages ship it`,
      )
    }
  }
}

// The module trees are electron-vite outputs produced by build:all; a missing
// one means that module's build did not run or failed. electron-builder only
// logs "file source doesn't exist" for an absent extraResources source and
// still exits 0, so without this the installer launches normally and is simply
// missing that editor — it surfaces only when a user opens the tab.
//
// Runs from the beforePack hook, not at module load: gen-third-party-notices
// requires this config to read extraResources, and the dist:* scripts run
// notices before build:all, when the out dirs legitimately don't exist yet.
// When the mac build packages BOTH arches (CHATOFFICE_MAC_X64=1) its
// extraResources entry is a single path shared by the two packs, so the
// sidecar there must be a lipo fat binary — a host-arch-only build (the plain
// `native:build` dev path) would silently ship an arm64 sidecar inside the
// Intel dmg, where every workbook open fails. Runs from beforePack, dual-arch
// mac packs only.
// Offline purchase signing key (LOCAL purchase feature): materialize
// build/license-key.txt from CHATOP_LICENSE_HMAC_KEY so the extraResources
// entry above always finds its source (electron-builder silently skips
// missing sources and still exits 0). No env -> empty file -> the client's
// activation entry stays disabled while reminders keep their schedule. The
// key itself never enters git.
function writeLicenseKeyMaterial() {
  const key = (process.env.CHATOP_LICENSE_HMAC_KEY || '').trim()
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    console.log('[builder] CHATOP_LICENSE_HMAC_KEY unset/invalid — shipping empty license-key.txt (activation disabled)')
  }
  writeFileSync(join(__dirname, 'build', 'license-key.txt'), key, 'utf8')
}

function assertUniversalSidecar() {
  const sidecar = join(__dirname, '../sheets/native/xlsx-engine/target/release/xlsx-sidecar')
  if (!existsSync(sidecar)) {
    throw new Error(
      `mac extraResources source missing: ${sidecar} (run "npm run native:build:universal -w @chatoffice/sheets" first)`,
    )
  }
  const archs = execFileSync('lipo', ['-archs', sidecar], { encoding: 'utf8' }).trim().split(/\s+/)
  for (const want of ['x86_64', 'arm64']) {
    if (!archs.includes(want)) {
      throw new Error(
        `xlsx-sidecar is [${archs.join(', ')}] but both mac arch packages ship it — ` +
          'run "npm run native:build:universal -w @chatoffice/sheets" before packaging mac',
      )
    }
  }
}

function assertModuleTreesPresent() {
  for (const rel of [
    '../docs/out',
    '../sheets/out',
    '../slides/out',
    '../pdf/out',
    '../markdown/out',
    '../html/out',
    '../../packages/cli/dist/chaoffice.cjs',
    '../../packages/cli/dist/node_modules/jsdom',
  ]) {
    if (!existsSync(join(__dirname, rel))) {
      throw new Error(
        `electron-builder extraResources source missing: ${rel} (run npm run build:all first)`,
      )
    }
  }
}

/** @type {import('electron-builder').Configuration} */
const config = {
  appId: 'com.chaoffice.app',
  productName: 'ChaAI Office',
  // Resolved from the installed electron package so dependency bumps can
  // never leave a stale hard-coded pin behind (packaging would silently ship
  // the old runtime).
  electronVersion: require('electron/package.json').version,
  directories: {
    output: process.env.BUILD_DIR || 'release',
  },
  files: ['out/**'],
  extraResources: [
    {
      from: 'build/THIRD-PARTY-NOTICES.txt',
      to: 'THIRD-PARTY-NOTICES.txt',
    },
    {
      // Offline purchase signing key (main/purchase.ts). beforePack materializes
      // this file from CHATOP_LICENSE_HMAC_KEY; without the env it ships empty
      // and the client's activation entry stays disabled (reminders unaffected).
      // The key itself never enters git.
      from: 'build/license-key.txt',
      to: 'license-key.txt',
    },
    {
      from: '../../node_modules/electron/dist/LICENSES.chromium.html',
      to: 'LICENSES.chromium.html',
    },
    {
      from: '../docs/out',
      to: 'modules/docs',
    },
    {
      from: '../sheets/out',
      to: 'modules/sheets',
    },
    {
      from: '../slides/out',
      to: 'modules/slides',
    },
    {
      from: '../pdf/out',
      to: 'modules/pdf',
    },
    {
      from: '../markdown/out',
      to: 'modules/markdown',
    },
    {
      from: '../html/out',
      to: 'modules/html',
    },
    // PDF text editing engines: the bundled main resolves these under
    // Resources/wasm when node_modules is absent (apps/pdf/src/main/wasm-path.ts)
    {
      from: '../../node_modules/@embedpdf/pdfium/dist/pdfium.wasm',
      to: 'wasm/pdfium.wasm',
    },
    {
      from: '../pdf/node_modules/harfbuzzjs/hb-subset.wasm',
      to: 'wasm/hb-subset.wasm',
    },
    // platform system-OCR helpers for scanned-page recovery (each exists only
    // on its own build platform; electron-builder skips absent sources and the
    // engine resolver degrades to the bitmap fallback when missing)
    {
      from: '../../packages/pdf2docx/ocr-helper/vision-ocr',
      to: 'ocr/vision-ocr',
    },
    {
      from: '../../packages/pdf2docx/ocr-helper/win-ocr.exe',
      to: 'ocr/win-ocr.exe',
    },
    // chaoffice 命令行 (headless ChaAI Office CLI): runs on the app binary
    // with ELECTRON_RUN_AS_NODE (as the gsk CLI above already does), so the
    // RunAsNode fuse must stay enabled. Layout (Resources/cli next to wasm/,
    // native/, ocr/) is what packages/cli/src/resources.ts expects. The
    // chatoffice files are the pre-rename compatibility shims.
    {
      from: '../../packages/cli/dist/chaoffice.cjs',
      to: 'cli/chaoffice.cjs',
    },
    {
      from: '../../packages/cli/bin/chaoffice',
      to: 'cli/chaoffice',
    },
    {
      from: '../../packages/cli/bin/chaoffice.cmd',
      to: 'cli/chaoffice.cmd',
    },
    {
      from: '../../packages/cli/bin/chatoffice',
      to: 'cli/chatoffice',
    },
    {
      from: '../../packages/cli/bin/chatoffice.cmd',
      to: 'cli/chatoffice.cmd',
    },
    // the CLI's version (Settings → Integrations shows it) and the agent skill
    // the same pane installs into Claude Code / Codex / …; bytes identical to the repo file
    {
      from: '../../packages/cli/package.json',
      to: 'cli/package.json',
    },
    {
      from: '../../skills/chaoffice/SKILL.md',
      to: 'cli/skills/chaoffice/SKILL.md',
    },
    // runtime deps the chatoffice bundle leaves external (jsdom for the Word/Markdown
    // paths); collected by packages/cli/collect-deps.mjs during its build
    {
      from: '../../packages/cli/dist/node_modules',
      to: 'cli/node_modules',
    },
    {
      from: '../../node_modules/ws',
      to: 'gsk/node_modules/ws',
    },
  ],
  // `mimeType` is read only by the Linux target, where it becomes the
  // desktop entry's MimeType= list; associations without it are dropped
  // there. macOS and Windows ignore the field and key off `ext`.
  //
  // `icon` is extension-less on purpose: electron-builder resolves it against
  // build/ as <icon>.icns for the mac CFBundleDocumentTypes entry and
  // <icon>.ico for the NSIS DefaultIcon registry value. Without it both
  // platforms fall back to the app icon, so every associated file shows the
  // bare ChatOffice logo instead of a per-type document icon. The icns/ico
  // pairs are generated from the shell renderer's file-type tiles by
  // tools/gen-file-association-icons.mjs.
  fileAssociations: [
    {
      ext: 'docx',
      name: 'Word Document',
      description: 'Word Document',
      role: 'Editor',
      icon: 'docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
    {
      ext: 'xlsx',
      name: 'Excel Workbook',
      description: 'Excel Workbook',
      role: 'Editor',
      icon: 'xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
    {
      ext: 'xlsm',
      name: 'Excel Macro-Enabled Workbook',
      role: 'Editor',
      icon: 'xlsx',
      mimeType: 'application/vnd.ms-excel.sheet.macroEnabled.12',
    },
    {
      ext: 'pptx',
      name: 'PowerPoint Presentation',
      description: 'PowerPoint Presentation',
      role: 'Editor',
      icon: 'pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    },
    {
      ext: 'xls',
      name: 'Excel 97-2003 Workbook',
      role: 'Editor',
      icon: 'xlsx',
      mimeType: 'application/vnd.ms-excel',
    },
    {
      ext: 'csv',
      name: 'CSV Document',
      role: 'Editor',
      icon: 'xlsx',
      mimeType: 'text/csv',
    },
    {
      ext: 'pdf',
      name: 'PDF Document',
      role: 'Editor',
      icon: 'pdf',
      mimeType: 'application/pdf',
    },
    {
      ext: 'md',
      name: 'Markdown Document',
      role: 'Editor',
      icon: 'md',
      mimeType: 'text/markdown',
    },
    {
      ext: 'markdown',
      name: 'Markdown Document',
      role: 'Editor',
      icon: 'md',
      mimeType: 'text/markdown',
    },
    {
      ext: 'html',
      name: 'HTML Document',
      role: 'Editor',
      icon: 'html',
      mimeType: 'text/html',
    },
    {
      ext: 'htm',
      name: 'HTML Document',
      role: 'Editor',
      icon: 'html',
      mimeType: 'text/html',
    },
  ],
  npmRebuild: false,
  mac: {
    // Two separate arch packages (NOT universal): arm64 keeps the exact
    // artifact names and update-feed entries it always had, x64 (opt-in via
    // CHATOFFICE_MAC_X64=1, see includeMacX64 above) adds Intel support with
    // electron-builder's default arch-less names (ChatOffice-<v>.dmg /
    // ChatOffice-<v>-mac.zip). Both zips land in one latest-mac.yml and
    // electron-updater picks by process.arch. Dual-arch packs ship the same
    // lipo fat xlsx-sidecar (see assertUniversalSidecar above).
    target: [
      { target: 'dmg', arch: includeMacX64 ? ['arm64', 'x64'] : ['arm64'] },
      { target: 'zip', arch: includeMacX64 ? ['arm64', 'x64'] : ['arm64'] },
    ],
    category: 'public.app-category.productivity',
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    notarize: true,
    artifactName: 'ChaAIOffice-${version}-${arch}.${ext}',
    extraResources: [
      {
        from: '../sheets/native/xlsx-engine/target/release/xlsx-sidecar',
        to: 'native/xlsx-sidecar',
      },
    ],
  },
  win: {
    target: [
      {
        target: 'nsis',
        arch: [winArch],
      },
    ],
    extraResources: [
      {
        from: WIN_SIDECAR,
        to: 'native/xlsx-sidecar.exe',
      },
      {
        from: 'build/shell-new',
        to: 'shell-new',
        filter: ['*.docx', '*.xlsx', '*.pptx'],
      },
    ],
  },
  // Unlike win (which cross-compiles the sidecar to an explicit target
  // triple), linux takes it from cargo's host-native target/release/ — the
  // same source mac uses. So no `arch` is pinned here: electron-builder
  // defaults to the build host's architecture, which is the only one the
  // sidecar was actually built for. Packaging arm64 on an x64 host, or the
  // reverse, needs a matching `cargo build --target` first.
  linux: {
    // artifactName pins the AppImage name (deb/rpm override with their own);
  // all target names are space-free per user rule (2026-09-23).
  // 目标架构取宿主架构（electron-builder 缺省恒为 x64，arm64 宿主会出跑不起来的
  // x64 包——2026-09-23 UOS ARM 虚机实测踩中）；CLI --x64/--arm64 仍可覆盖
  artifactName: 'ChaAIOffice-${version}-${arch}.${ext}',

    // GTK/NSS runtime deps) + rpm (dnf/zypper install on Fedora / RHEL /
    // openSUSE). Default artifact names are kept on purpose —
    // ChatOffice-<v>.AppImage / chatoffice_<v>_amd64.deb — because the public
    // README download links and the already-published linux-v0.5.149 release
    // use them.
    target: [
      { target: 'AppImage', arch: [process.arch === 'arm64' ? 'arm64' : 'x64'] },
      { target: 'deb', arch: [process.arch === 'arm64' ? 'arm64' : 'x64'] },
      ...(hasRpmbuild() ? [{ target: 'rpm', arch: [process.arch === 'arm64' ? 'arm64' : 'x64'] }] : []),
    ],
    // deb control metadata; values match the manually published 0.5.149 deb
    // so apt sees the new packages as the same lineage. Homepage comes from
    // package.json "homepage"; the Package field is pinned in the deb block
    // below (packageName is a per-target option, rejected here by the schema).
    maintainer: 'Mainfunc, Inc. <team@genspark.ai>',
    vendor: 'Mainfunc, Inc. <team@genspark.ai>',
    category: 'Office',
    // Icon SET directory, not the single 1024px png: electron-builder does
    // not resize a lone png, so deb/rpm would install only
    // hicolor/1024x1024/apps/chatoffice.png — a size absent from the hicolor
    // theme index, leaving GNOME/KDE launchers on the generic fallback icon
    // (chatoffice-ai/chatoffice#90). The set ships every standard raster size.
    icon: 'build/icons',
    // mac and win name the binary from productName; linux instead derives it
    // from package.json "name", and "@chatoffice/shell" sanitizes to the
    // invalid "@chatofficeshell". Setting it explicitly also makes the
    // generated chatoffice.desktop match the WM_CLASS Electron reports (it
    // takes that from the executable basename), so the running window links
    // back to its launcher entry.
    executableName: 'chaoffice',
    // Electron takes its X11 app_id from package.json "desktopName"
    // (chatoffice.desktop); syncDesktopName makes electron-builder name the
    // .desktop file and its StartupWMClass from the same value. Without it
    // StartupWMClass falls back to productName ("ChaAI Office"), which does not
    // match the "chatoffice" WM_CLASS the window actually reports — and X11
    // compares case-sensitively, so the taskbar shows an unlinked window.
    syncDesktopName: true,
    extraResources: [
      {
        from: '../sheets/native/xlsx-engine/target/release/xlsx-sidecar',
        to: 'native/xlsx-sidecar',
      },
    ],
  },
  // Same "@chatoffice/shell" problem as executableName above: the default deb
  // artifact name derives from package.json "name", and the scope's "/" makes
  // fpm treat "@chatoffice" as a directory. Spell the published name out
  // (chatoffice_<version>_amd64.deb, matching the linux-v0.5.149 release).
  // packageName pins the control Package field to the same value the 0.5.149
  // deb shipped with — apt treats a different Package name as an unrelated
  // install, breaking upgrades. Without it, fpm receives productName
  // "ChatOffice" and only happens to downcase it to the right value.
  deb: {
    // 2026-09-23 用户明令：包名对齐 mac 侧「ChaAI Office-版本号」；control 里的
    // Package 仍为 chaoffice，apt 升级链不受影响
    artifactName: 'ChaAIOffice-${version}-${arch}.deb',
    packageName: 'chaoffice',
    // expose the chatoffice command line shipped inside the app
    afterInstall: 'build/linux-after-install.sh',
    afterRemove: 'build/linux-after-remove.sh',
  },
  // Same "@chatoffice/shell" naming problem as deb: spell the artifact name
  // out (${arch} expands to the rpm arch string, x86_64) and pin the rpm
  // Package name so dnf/zypper treat successive releases as upgrades of the
  // same package. Like deb, rpm installs run no in-app updater — users
  // upgrade with `dnf install ./<new>.rpm`. Packaging needs rpmbuild on the
  // build host (the `rpm` apt package on Ubuntu; CI installs it).
  //
  // publish: null (explicit) keeps the rpm out of the electron-updater feed
  // and off the CDN entirely: the rpm is a GitHub-Release download only, so
  // latest-linux.yml keeps listing exactly what the CDN pipeline uploads
  // (AppImage + deb) and the promote workflow needs no rpm alias.
  rpm: {
    artifactName: 'ChaAIOffice-${version}-${arch}.rpm',
    packageName: 'chaoffice',
    publish: null,
    afterInstall: 'build/linux-after-install.sh',
    afterRemove: 'build/linux-after-remove.sh',
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    artifactName: 'ChaAIOffice-Setup-${version}.${ext}',
  },
  beforePack: async (context) => {
    assertModuleTreesPresent()
    // 交叉打包（mac 宿主出三平台包）：按目标架构把 zigbuild/mingw 产物就位到
    // extraResources 读取的 target/release 路径；原生架构（宿主=目标）则直接
    // 校验 cargo 产物在位。任一缺席即抛错——绝不让宿主平台的二进制静默混进
    // 别的系统的包（2026-09-23 实测踩中）。
    if (context.electronPlatformName === 'linux') {
      // context.arch 是枚举数值（electron-builder Arch：1=x64，3=arm64）
      const archName = { 1: 'x64', 3: 'arm64' }[context.arch]
      const triple =
        archName === 'arm64'
          ? 'aarch64-unknown-linux-gnu'
          : archName === 'x64'
            ? 'x86_64-unknown-linux-gnu'
            : null
      if (!triple) throw new Error(`unsupported linux arch: ${String(context.arch)}`)
      const staged = join(
        __dirname,
        '../sheets/native/xlsx-engine/target/release/xlsx-sidecar',
      )
      const native = process.arch === archName
      if (native) {
        // 原生构建（linux 宿主）：cargo build --release 的产物已在此路径
        if (!existsSync(staged)) {
          throw new Error(`linux sidecar missing: ${staged} (cargo build --release first on this host)`)
        }
      } else {
        const cross = join(
          __dirname,
          `../sheets/native/xlsx-engine/target/${triple}/release/xlsx-sidecar`,
        )
        if (!existsSync(cross)) {
          throw new Error(
            `linux sidecar missing for ${triple}: ${cross} (cargo zigbuild --release --target ${triple}.2.28 first)`,
          )
        }
        copyFileSync(cross, staged)
      }
    }
    writeLicenseKeyMaterial()
    if (context.electronPlatformName === 'darwin' && includeMacX64) {
      assertUniversalSidecar()
      assertUniversalVisionOcr()
    }
    if (context.electronPlatformName === 'win32' && !existsSync(join(__dirname, WIN_SIDECAR))) {
      throw new Error(
        `win extraResources source missing: ${WIN_SIDECAR} (cargo build --target ${winSidecarTarget} first)`,
      )
    }
  },
  dmg: {
    sign: true,
  },
  afterAllArtifactBuild: 'build/notarize-dmg.js',
}

// Windows in-package code signing. Security features that judge every PE
// individually (Smart App Control, WDAC/AppLocker, AV heuristics) block
// unsigned child processes — the unsigned xlsx-sidecar.exe died with
// "spawn UNKNOWN" on such machines even though the installer itself was
// signed. When CI exports CHATOFFICE_WIN_SIGN_MODE ("test" = alpha
// self-signed PFX, "production" = DigiCert KeyLocker — the two modes of
// scripts/win-sign.cjs, whose env-var contract applies here too), every
// binary electron-builder signs for win (ChatOffice.exe, the NSIS
// uninstaller, and the installer) goes through that script. The static
// extraResources binaries (xlsx-sidecar.exe, win-ocr.exe) are signed by the
// workflow before packaging since electron-builder does not sign
// extraResources. Unset (local / fork builds) keeps the old behavior:
// electron-builder has no signing config and packages everything unsigned.
const winSignMode = process.env.CHATOFFICE_WIN_SIGN_MODE
if (winSignMode) {
  if (winSignMode !== 'test' && winSignMode !== 'production') {
    throw new Error(`CHATOFFICE_WIN_SIGN_MODE must be "test" or "production", got "${winSignMode}"`)
  }
  config.win.signtoolOptions = {
    // Single pass per file: the sha1+sha256 dual-signing default is a
    // pre-Win8 relic and would invoke the hook twice per binary.
    signingHashAlgorithms: ['sha256'],
    sign: (configuration) => {
      execFileSync(
        process.execPath,
        [join(__dirname, '../../scripts/win-sign.cjs'), winSignMode, configuration.path],
        { stdio: 'inherit' },
      )
      return Promise.resolve()
    },
  }
}

if (updateUrl) {
  config.publish = [
    {
      provider: 'generic',
      url: updateUrl.replace(/\/+$/, ''),
      channel: 'latest',
    },
  ]
}

// CI's "-c.extraMetadata.version=..." CLI override deep-merges with this block,
// so the version and all injected feature settings survive together.
const extraMetadata = {}
if (ga4MeasurementId && ga4ApiSecret) {
  extraMetadata.chatofficeAnalytics = {
    measurementId: ga4MeasurementId,
    apiSecret: ga4ApiSecret,
  }
}
if (fontCdnUrl) extraMetadata.chatofficeFontCdn = { baseUrl: fontCdnUrl }
if (Object.keys(extraMetadata).length) config.extraMetadata = extraMetadata

module.exports = config
