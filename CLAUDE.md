# CLAUDE.md

Guidance for AI agents and human contributors working in this repo.

## Theming rules (mandatory)

The suite supports light / dark / system UI themes. The switching mechanism is a
`data-theme` attribute on `<html>` plus CSS custom properties defined once in
`packages/ui/src/tokens.css` (light defaults in `:root`, overrides in
`[data-theme='dark']`, and a `prefers-color-scheme` media-query fallback for
system mode).

1. **UI chrome colors must use semantic tokens.** Never write raw `#hex` /
   `rgb()` in renderer CSS rules or chrome-related inline styles — reference
   `var(--surface)`, `var(--text)`, `var(--hover)`, etc. from
   `packages/ui/src/tokens.css`. Raw values are allowed only on custom-property
   definition lines (`--x: #...;` — token, accent, or app-scoped variable
   definitions). CI enforces this for new/changed renderer CSS lines
   (`tools/check-theme-colors.mjs`).
2. **Every new token gets both values.** Adding a token means adding it to all
   three blocks in `tokens.css` (light, dark, system-dark fallback).
3. **Accent colors stay per-app.** Each app defines `--accent` /
   `--accent-dark` / `--accent-soft` (and its dark-adjusted values) in its own
   `styles.css`. Shared rules reference `var(--accent)` and inherit the app's
   brand color.
4. **Document content is never re-authored by the theme.** Page surfaces, cell
   fills, slide content, PDF page bitmaps, export/print stylesheets, chart
   palettes, highlight color maps, stamps, and WordArt presets are document
   data: they stay hardcoded, must not reference chrome tokens, and every
   save/export/print path must produce identical output in both themes. A
   Word/Excel-style _dark page_ (Sheets via Univer's `darkMode`, Docs via
   `apps/docs/src/renderer/editor/dark-page.ts`) is a display-time remap only:
   the authored color stays the real declaration, the remapped twin lives in
   a screen-only `--dk-*` / `.page-dark` layer, and print/export never see it.
5. **Canvas-drawn UI affordances go through a constants table.** Konva/canvas
   editing chrome (selection frames, guides, handles) reads from the app's
   canvas color table (e.g. `canvas-colors.ts`) keyed by the current theme —
   no inline hex in draw calls.

## Build gotchas

- App main-process code (`apps/*/src/main`) is compiled into the **shell**
  build. After changing it, rebuild the shell or the change silently does not
  run.
- In dev mode, preload changes require a rebuild — a stale preload leaves the
  renderer blank.
- Workspace packages listed in an app's `dependencies` must also be added to
  the `externalizeDepsPlugin` `exclude` list, or the packaged app crashes on
  launch.
- `useI18n()`'s `t` is not referentially stable; never put it in a hook
  dependency array. Store the key and translate at render time.

## Upstream coexistence rules (mandatory — read FIRST before any dev or merge)

**Every session that develops features or merges upstream code MUST read
`docs/upstream-coexistence.md` before touching code, and re-read
`docs/upstream-sync.md` (the sync ledger) before syncing.** These two docs
define the four-zone file model, the five development rules that keep local
work out of conflict-prone files, and the conflict adjudication decision tree.

Quick rules (full detail in the coexistence doc):

1. **New-file-first**: local features live in new files (B-zone, zero
   conflicts). Shell-level files (`App.tsx`, `Home.tsx`, `ExcelShell.tsx`,
   `Ribbon.tsx`, `SettingsModal.tsx`, `index.ts`, `strings.ts`, `styles.css`,
   `home.css`, `home-api.ts`) are C/D-zone — never add implementations there;
   only one-line mount-point references into local components/modules.
2. **Local i18n keys go to `i18n/local*` files** (runtime-merged), never into
   upstream shards/`strings.ts`.
3. **Local CSS goes to component-level or `local.css` files**, never appended
   to upstream `styles.css`/`home.css`.
4. **Unavoidable in-place edits must carry a four-element marker**:
   `// LOCAL(<date>, <base commit>): <intent> + <upstream movement> + <converge condition>` —
   and a line in the sync ledger.
5. **Brand strings** come from `brandName(lang)` (brand module), never
   hand-written; exemptions per ledger §9 (`GENOFFICE_*`, `genspark.ai`,
   `@chatoffice/*`, `window.chatOffice`, font family names, CLI bin name).
6. New local dependencies are appended in the marked `LOCAL deps` section of
   package.json; lock files are never literal-picked.

## Upstream sync iron rule (mandatory)

本地修改绝不允许被上游更新破坏——这是铁律,不是偏好。This repo carries heavy
local re-architecture on top of the `genoffice` upstream; every upstream sync
must preserve all local work:

- **Upstream clone** (`/Users/zyh/work/genoffice`): before pulling, protect
  uncommitted local work — `git stash` → `git pull --ff-only` →
  `git stash pop`. Never run `checkout --`/`reset --hard` over a dirty tree.
  (Known standing local mod: the `window.aiOffice`→`window.chatOffice` bridge
  rename in `apps/shell/src/renderer/src/SettingsModal.tsx`.)
- **This repo**: upstream commits are cherry-picked and resolved per the
  three-tier policy in `docs/upstream-sync.md` §3-Q3 — local functional zones
  (shell Home / self-drawn window chrome, AI-panel/DockShell architecture,
  generate_deck, `apps/server`, `apps/web`, branding) always win; upstream
  intent is re-implemented into the local architecture; upstream never
  bulk-overwrites a locally modified file. Local-only areas (`apps/server`,
  `apps/web`, brand mapping) must stay untouched by syncs.
- **Brand mapping** (`GenOffice`→`ChatOffice`, bridge `aiOffice`→`chatOffice`)
  is replayed on every pick; exemptions: `GENOFFICE_*` env vars and
  `genspark.ai` URL/host strings (changing them breaks features).
- **`docs/upstream-sync.md` is the single ledger**: read it before syncing,
  write the new endpoint sha back after. Gates before merge: full test +
  typecheck + lint + brand grep must all be green.
