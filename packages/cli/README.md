# @chatoffice/cli

`chatoffice` is the ChaAI Office command line. It exposes the suite's document engines
to scripts and AI agents without opening a window: the packaged app runs the
bundled CLI on its own Node runtime (`ELECTRON_RUN_AS_NODE`), so nothing extra
has to be installed.

```
chatoffice info report.docx
chatoffice convert scan.pdf --to docx
chatoffice convert data.csv --to xlsx --out out/data.xlsx
chatoffice open report.docx
chatoffice convert scan.pdf --to pptx --json
chatoffice guide slides                         # op groups; `chatoffice guide slides insert` for one group
chatoffice slides read deck.pptx [--full] --json # durable ids + geometry an agent targets ops at; --full: whole text, tables, notes
chatoffice create --type pptx --ops deck.json --out deck.pptx
chatoffice create --type pptx --spec deck/pages --outline deck/outline.json --out deck.pptx   # one page spec file per slide (`chatoffice guide slides design|spec`)
chatoffice slides check deck/outline.json | deck/pages/03.json   # outline rules (exit 1 on errors) / build + audit one page file
chatoffice slides replace deck.pptx --slide 2 --spec deck/pages/03.json   # rebuild one slide from its page file
chatoffice slides apply deck.pptx --ops edit.json [--dry-run] [--out copy.pptx]
chatoffice slides audit deck.pptx [--slide 0] --json            # out-of-bounds / text overflow / overlap per slide, durable ids
chatoffice slides render deck.pptx --out shots/ [--scale 2]     # one PNG per slide through the app's PDF export
chatoffice render report.docx|book.xlsx|page.html|file.pdf --out shots/ [--page 3] [--scale 2]   # one PNG per page of any document, to look at what was made
chatoffice create --type xlsx --from table.json --out book.xlsx   # 2-D array or {sheets:[{name,rows}]}; "=..." cells are formulas
chatoffice create --type xlsx --from data.csv --out data.xlsx
chatoffice sheet read book.xlsx [--sheet Data] [--range A1:D20] [--formats] --json   # values, formulas, sheet features; --formats adds styles, widths, heights
chatoffice sheet apply book.xlsx --cells cells.json    # [{cell:"B2", value|formula, style?, sheet?}]
chatoffice sheet apply book.xlsx --ops ops.json [--dry-run]   # workbook DSL: cells, formats, charts, tables, filters, conditional formats, validation, links, notes, panes, page setup, sheets (`chatoffice guide sheets`)
chatoffice create --type docx --from report.md --out report.docx      # or --from fragment.html (restricted HTML)
chatoffice convert notes.md --to docx|html
chatoffice convert report.docx --to html               # the Word editor's standalone-HTML export
chatoffice convert page.html --to docx                 # html2docx, same as the HTML app's Export as Word
chatoffice convert report.docx --to md                 # GFM via the markdown editor's serializer
chatoffice convert book.xlsx --to csv [--sheet Data]   # one sheet, cell text as displayed, UTF-8 BOM, CRLF
chatoffice capabilities --json                        # which cloud features ChatOffice has configured (no network call)
chatoffice search "electron headless export" [--images] [--max 6] --json
chatoffice image "isometric office, soft light" --aspect 16:9 --out hero.png
chatoffice media photo.jpg --ask "What text is in this picture?" --json
chatoffice docs read report.docx [--range 0-9] [--html] [--full] [--comments] [--revisions] [--header-footer] --json   # blocks (--full: whole text), comment threads, tracked changes, header/footer text
chatoffice docs apply report.docx --ops ops.json [--dry-run]           # apply_ops entries + insert_content / replace_blocks / insert_image / insert_chart / edit_chart / set_header_footer / reply_comment / resolve_comment
chatoffice guide docs                                                   # op signatures + restricted-HTML rules
chatoffice selection report.docx --json   # what the user has selected in the editor showing the file
chatoffice skill list   # coding agents found on this machine and the skill version each has
chatoffice skill install --dir ./skills --force   # copy the bundled skill into a skills directory
chatoffice install-cli   # put chatoffice on the PATH
chatoffice mcp --http 3000 [--host 127.0.0.1] [--token secret]   # Streamable HTTP for clients on other machines; omit --http for stdio

Behind a reverse proxy, set `GENOFFICE_TRUST_PROXY_HEADERS=1` so the download
URLs the server hands out use the forwarded host and scheme; by default the
`X-Forwarded-*` headers are ignored.
chatoffice render page.pdf --out shots/ --grid 3x2 --tile 900 --pad 12   # contact sheet: a grid of page thumbnails (--cols 3: columns); --el <id>: one element per shot (docx/pptx)
chatoffice create --type xlsx --from data.csv --header --decimal ,   # row 1 = header (AutoFilter + freeze); --decimal: the decimal separator the csv uses
```

Word and Markdown commands run the docs and markdown editors under jsdom (installed once per process, loaded lazily). Those modules are imported from the app renderers by relative path until they move into packages of their own.

Workbook writes go through `@chatoffice/xlsx-gateway` (the app's save path). The in-memory workbook validates and applies the cell, format and structure ops; ops the snapshot cannot hold (charts, images, tables, filters, conditional formats, validation, hyperlinks, notes, panes, page setup, protection, defined names, tab order) become the gateway's declarative save payloads, as the app's edit journal does. Pivots, sparklines and edits to editor-session objects stay app-only. After writing formulas chatoffice evaluates them with the xlsx sidecar and stores the results as cached values, so `sheet read` and plain readers see numbers, not blanks.

`create`/`slides apply` take the same ops the in-app AI uses (`@chatoffice/pptx-ops`), as a JSON array or `{ "ops": [...] }`; `--ops -` reads stdin. Image ops accept a local file path in their `bytes` field. A rejected op comes back with the guided error and its usage line so the caller can fix and retry; atomic transactions leave the file untouched.

`create --type pptx --spec` is the CLI end of the app's deck generation pipeline (`@chatoffice/pipelines`): the caller's agent does the design work following `chatoffice guide slides design`, writing the style sheet, the outline and one page spec file per slide (`chatoffice guide slides spec`), and the same page builder the app uses turns them into a pptx, measuring every text box and growing it to its content. Where the app separates the stages into model calls, the CLI separates them into files: `slides check` validates the outline against the planning rules and builds and audits a single page file, then checks it against its outline entry and the style sheet's palette (both found beside the page files), `create --spec <dir>` runs the same checks on every file and refuses to assemble a deck with pages missing or disagreeing with the outline, and `slides replace` rebuilds one slide from its file. `slides audit` runs the app's deterministic layout audit; `slides render` gives the agent PNGs to look at. No model call happens inside chatoffice.

Every command prints a one-line human summary by default or a single JSON
object with `--json` (`{ status, command, summary, output_path?, detail? }`).
Exit codes: `0` ok, `1` usage, `2` file, `3` conversion failed, `4` app not
available.

## Putting chatoffice on the PATH

- **macOS**: the app tries to symlink `/usr/local/bin/chatoffice` (or `/opt/homebrew/bin/chatoffice`) on every launch until one succeeds. If neither directory is writable it stays silent; run `chatoffice install-cli` from the launcher, or `sudo mkdir -p /usr/local/bin && sudo ln -sf "/Applications/ChatOffice.app/Contents/Resources/cli/chatoffice" /usr/local/bin/chatoffice`.
- **Windows**: the installer appends `<install dir>\resources\cli` to the user PATH (`apps/shell/build/installer.nsh`, REG_EXPAND_SZ preserved, removed on uninstall) and the app re-checks once per version; new terminals see `chatoffice`. The directory holds `chatoffice.cmd` for cmd / PowerShell and the extension-less `chatoffice` for Git Bash.
- **Linux**: the deb/rpm post-install links `/usr/bin/chatoffice`; the AppImage relies on the first-launch symlink into `/usr/local/bin` when it is writable.

`chatoffice install-cli` repeats the attempt and prints the manual command when it cannot finish. jsdom (for Word/Markdown) ships beside the bundle as `Resources/cli/node_modules`, collected by `collect-deps.mjs` at build time.

Independently of the PATH, every launch of the packaged app writes the launcher directory to `~/.chatoffice/launcher` (`GENOFFICE_AUTH_DIR` overrides the directory, as for `auth.json`). The `chatoffice` agent skill (`skills/chatoffice/SKILL.md`) reads it when `chatoffice` is not on the PATH. `chatoffice --version` prints this package's version, inlined by `build.mjs`.
## Layout

- `src/cli.ts` — argv parsing, dispatch, output; `runCli()` is embeddable.
- `src/registry.ts` — `CommandDef` table (`name`, `usage`, `run`), the single
  place future entry points (in-app AI, MCP) dispatch through.
- `src/commands/` — `info`, `convert`, `create`, `render`, `slides`, `sheet`, `docs`,
  `guide`, `open`, `capabilities`, `search`, `image`, `media`, `install-cli`.
- `src/dom.ts` — the jsdom bootstrap the Word/Markdown paths need.
- `src/formats/` — thin adapters over `@chatoffice/pdf2docx`, the xlsx sidecar
  and the sheets CSV importer.
- `src/resources.ts` — locates pdfium wasm, the xlsx sidecar and the OCR
  helper in both the packaged `Resources/` layout and the dev checkout.
- `bin/chatoffice`, `bin/chatoffice.cmd` — launchers copied next to `chaoffice.cjs` in the
  packaged app.

## Path policy and audit log

- `GENOFFICE_ALLOWED_ROOTS` (PATH-style list of directories) confines every file chatoffice
  reads or writes to those trees; symlinks are resolved before the check. A path
  outside exits 2 with the roots in `detail.allowed_roots`. Unset means
  unrestricted.
- `apply --out` onto another existing file needs `--force`, like `create` / `convert`;
  editing in place never does. Unknown options are rejected instead of ignored.
- A file the running ChatOffice shell has open in a tab is not rewritten in place
  (exit 2, `detail.gui_pid`): the shell publishes its open tabs to
  `userData/open-documents.json` and chatoffice reads it (`GENOFFICE_USER_DATA`
  overrides the location). `--force` writes anyway; the editor then warns about
  the on-disk change at its next save (Word, Excel) or may overwrite it (PowerPoint).
- Every executed command appends one JSON line (`ts`, `command`, `argv`,
  `status`, `code`, `output_path`, `ms`, `cwd`) to
  `~/.chatoffice/cli-audit.jsonl`, rotated at 2 MB. `GENOFFICE_AUDIT_LOG=<path>`
  redirects it, `GENOFFICE_AUDIT_LOG=off` disables it.

## Cloud commands

`search`, `image` and `media` reuse the editors' provider routing: Genspark
when signed in (`~/.chatoffice/auth.json`) and cloud tools are on, otherwise the
Serper / Tavily or BYOK image / media provider chosen in the app's AI settings
(`ChatOffice/ai-settings.json` in the platform config directory, override with
`GENOFFICE_AI_SETTINGS`). `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` are honoured.
Search results, image bytes and analysis text come back in the JSON `detail`;
`image` also writes the file. These are the only commands that send data off
the machine.

## Build and run in a checkout

```
npm run build -w @chatoffice/cli       # esbuild → dist/chaoffice.cjs
packages/cli/bin/chatoffice info file.docx  # falls back to the system node
```

Conversions that need an app renderer (Word/PowerPoint/Excel/HTML/Markdown → PDF,
Word → HTML, HTML → Word, `create --type pdf`) run inside the ChatOffice binary
through its hidden `--headless-export` mode: chatoffice spawns it (Dock hidden, no
window), reads the JSON envelope it prints and maps its exit code. Set
`GENOFFICE_APP_BIN` to point at a specific executable; in a checkout the dev Electron
plus `apps/shell` is used, so `npm run build:all` first.
