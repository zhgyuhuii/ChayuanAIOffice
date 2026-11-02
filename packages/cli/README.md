# @chaoffice/cli

`chaoffice` is the ChaAI Office command line. It exposes the suite's document engines
to scripts and AI agents without opening a window: the packaged app runs the
bundled CLI on its own Node runtime (`ELECTRON_RUN_AS_NODE`), so nothing extra
has to be installed.

```
chaoffice info report.docx
chaoffice convert scan.pdf --to docx
chaoffice convert data.csv --to xlsx --out out/data.xlsx
chaoffice open report.docx
chaoffice convert scan.pdf --to pptx --json
chaoffice guide slides                         # op groups; `chaoffice guide slides insert` for one group, `chaoffice guide slides setText` for one op
chaoffice slides read deck.pptx [--full] --json # durable ids + geometry an agent targets ops at; --full: whole text, tables, notes; text elements add `effective` (displayed style of the first run + `src` = the inheritance layer each value comes from)
chaoffice slides read deck.pptx --units in --json # box and size in inches (or cm, pt, px at 96 dpi) with `unit` named; default emu
chaoffice create --type pptx --ops deck.json --out deck.pptx
chaoffice create --type pptx --spec deck/pages --outline deck/outline.json --out deck.pptx   # one page spec file per slide (`chaoffice guide slides design|spec`)
chaoffice create --type pptx --spec deck.json --out deck.pptx --render deck/previews --audit   # plus one PNG per slide (detail.previews) and the geometry audit (detail.audit) in the same call
chaoffice slides check deck/outline.json | deck/pages/03.json   # outline rules (exit 1 on errors) / build + audit one page file
chaoffice slides replace deck.pptx --slide 2 --spec deck/pages/03.json   # rebuild one slide from its page file
chaoffice slides apply deck.pptx --ops edit.json [--dry-run] [--out copy.pptx]
chaoffice slides audit deck.pptx [--slide 0] --json            # out_of_bounds / off_slide / text_overflow / text_overflow_width / overlap / picture_distorted: typed issues with durable ids and a setTransform `suggest` where geometry fixes it
chaoffice slides render deck.pptx --out shots/ [--scale 2]     # one PNG per slide through the app's PDF export
chaoffice render report.docx|book.xlsx|page.html|file.pdf --out shots/ [--page 3] [--scale 2]   # one PNG per page of any document, to look at what was made
chaoffice render deck.pptx --out shots/ --el e_12 [--pad 16]   # plus the page cropped to that element (<stem>-NN-e_12.png)
chaoffice render deck.pptx --out shots/ --grid [--cols 4] [--tile 320]   # plus <stem>-grid.png: every page on one contact sheet
chaoffice create --type xlsx --from table.json --out book.xlsx   # 2-D array or {sheets:[{name,rows}]}; "=..." cells are formulas
chaoffice create --type xlsx --from data.csv --out data.xlsx [--header] [--decimal ,]   # ISO dates become real dates; sep= lines are honoured
chaoffice sheet read book.xlsx [--sheet Data] [--range A1:D20] [--formats] --json   # values, formulas, sheet features; --formats adds styles, widths, heights
chaoffice sheet apply book.xlsx --cells cells.json    # [{cell:"B2", value|formula, style?, sheet?}]
chaoffice sheet apply book.xlsx --ops ops.json [--dry-run]   # workbook DSL: cells, formats, charts, tables, filters, conditional formats, validation, links, notes, panes, page setup, sheets (`chaoffice guide sheets`)
chaoffice sheet check book.xlsx --json                # formula errors, missing-sheet references, broken defined names, chart ranges off the data, ### columns (suggest: set_col_width), placeholder text, existing rules; exit 0
chaoffice sheet links book.xlsx                       # external [n] links: stored path, resolved path, reachable, source sheets
chaoffice sheet links book.xlsx --update              # re-read reachable sources and write the computed values as the formulas' cached <v> (formulas untouched; unreachable links keep their cache)
chaoffice sheet links book.xlsx --break 1,2           # break links: formulas become their cached values, the links' parts are removed and surviving links renumber
chaoffice create --type docx --from report.md --out report.docx      # or --from fragment.html (restricted HTML); the new file carries Word-like docProps/core.xml + app.xml
chaoffice convert notes.md --to docx|html
chaoffice convert report.docx --to html               # the Word editor's standalone-HTML export
chaoffice convert page.html --to docx                 # html2docx, same as the HTML app's Export as Word
chaoffice convert report.docx --to md                 # GFM via the markdown editor's serializer
chaoffice convert book.xlsx --to csv [--sheet Data]   # one sheet, cell text as displayed, UTF-8 BOM, CRLF
chaoffice capabilities --json                        # which cloud features ChaAI Office has configured (no network call)
chaoffice search "electron headless export" [--images] [--max 6] --json
chaoffice image "isometric office, soft light" --aspect 16:9 --out hero.png
chaoffice media photo.jpg --ask "What text is in this picture?" --json
chaoffice docs read report.docx [--range 0-9] [--html] [--full] [--comments] [--revisions] [--header-footer] [--properties] --json   # blocks (--full: whole text; contentControls chain + inlineContentControls for w:sdt controls), comment threads, tracked changes, header/footer text, document properties (custom values plus their vt customTypes)
chaoffice docs apply report.docx --ops ops.json [--dry-run]           # apply_ops entries + insert_content / replace_blocks / insert_image / insert_chart / edit_chart / set_header_footer / reply_comment / resolve_comment / set_properties (document metadata; numeric/boolean custom values keep or take a typed vt type) / wrap_content_control / unwrap_content_control (nested tags unwrap level by level) / remove_parts (strip customXml + web-extension parts)
chaoffice docs check report.docx --json                               # fields without results, broken bookmark references, stale TOC, missing images, empty charts/headings, heading level skips, placeholder text, pending revisions, open comments; exit 0
chaoffice docs compare original.docx revised.docx --out redline.docx [--author name] [--date iso] [--granularity word|char] [--ignore formatting,case,whitespace]   # redline: the revised document with the differences marked as tracked insertions and deletions; --json reports the counts
chaoffice merge invoice-template.docx --data values.json --out invoice.docx [--force] [--strict]   # fill {{key}} placeholders in a docx/pptx/xlsx template; reports used, unused and unresolved keys (or --data '{"name":"Ada"}')
chaoffice pdf read scan.pdf [--page 3 | --range 1-5] [--full] --json     # text layer page by page (pages 1-20 by default, 4000 characters each) with page sizes and metadata; headless pdfium, no app process
chaoffice guide docs                                                   # op signatures + restricted-HTML rules (`guide <domain> --json` = the catalog with each op's schema and a fingerprint)
chaoffice selection report.docx --json   # what the user has selected in the editor showing the file
chaoffice skill list   # coding agents found on this machine and the skill version each has
chaoffice skill install --dir ./skills --force   # copy the bundled skill into a skills directory
chaoffice install-cli   # put chaoffice on the PATH
chaoffice mcp --http 3000 [--host 127.0.0.1] [--token secret]   # Streamable HTTP for clients on other machines; omit --http for stdio
chaoffice mcp --compact-schemas   # advertise ops/cells/data as plain arrays instead of the per-op schema (smaller tools/list; also GENOFFICE_MCP_COMPACT_SCHEMAS=1)
chaoffice mcp install all   # register the stdio server with every coding agent found (or one: claude-code, codex, cursor, gemini, copilot, opencode, windsurf)
chaoffice mcp list          # each agent's MCP config and whether chaoffice is registered; `mcp uninstall <agent>` removes the entry
```

Word and Markdown commands run the docs and markdown editors under jsdom (installed once per process, loaded lazily). Those modules are imported from the app renderers by relative path until they move into packages of their own.

Workbook writes go through `@chaoffice/xlsx-gateway` (the app's save path). The in-memory workbook validates and applies the cell, format and structure ops; ops the snapshot cannot hold (charts, images, tables, filters, conditional formats, validation, hyperlinks, notes, panes, page setup, protection, defined names, tab order) become the gateway's declarative save payloads, as the app's edit journal does. Pivots, sparklines and edits to editor-session objects stay app-only. After writing formulas chaoffice evaluates them with the xlsx sidecar and stores the results as cached values, so `sheet read` and plain readers see numbers, not blanks.

`create`/`slides apply` take the same ops the in-app AI uses (`@chaoffice/pptx-ops`), as a JSON array or `{ "ops": [...] }`; `--ops -` reads stdin. Image ops accept a local file path in their `bytes` field. A rejected op comes back with the guided error and its usage line so the caller can fix and retry; atomic transactions leave the file untouched.

`create --type pptx --spec` is the CLI end of the app's deck generation pipeline (`@chaoffice/pipelines`): the caller's agent does the design work following `chaoffice guide slides design`, writing the style sheet, the outline and one page spec file per slide (`chaoffice guide slides spec`), and the same page builder the app uses turns them into a pptx, measuring every text box and growing it to its content. Where the app separates the stages into model calls, the CLI separates them into files: `slides check` validates the outline against the planning rules and builds and audits a single page file, then checks it against its outline entry and the style sheet's palette (both found beside the page files), `create --spec <dir>` runs the same checks on every file and refuses to assemble a deck with pages missing or disagreeing with the outline, and `slides replace` rebuilds one slide from its file. `slides audit` runs the app's deterministic layout audit; `slides render` gives the agent PNGs to look at. No model call happens inside chaoffice.

Every command prints a one-line human summary by default or a single JSON
object with `--json` (`{ status, command, summary, output_path?, detail? }`).
Exit codes: `0` ok, `1` usage, `2` file, `3` conversion failed, `4` app not
available.

## Putting chaoffice on the PATH

- **macOS**: the app tries to symlink `/usr/local/bin/chaoffice` (or `/opt/homebrew/bin/chaoffice`) on every launch until one succeeds. If neither directory is writable it stays silent; run `chaoffice install-cli` from the launcher, or `sudo mkdir -p /usr/local/bin && sudo ln -sf "/Applications/ChaOffice.app/Contents/Resources/cli/chaoffice" /usr/local/bin/chaoffice`.
- **Windows**: the installer appends `<install dir>\resources\cli` to the user PATH (`apps/shell/build/installer.nsh`, REG_EXPAND_SZ preserved, removed on uninstall) and the app re-checks once per version; new terminals see `chaoffice`. The directory holds `chaoffice.cmd` for cmd / PowerShell and the extension-less `chaoffice` for Git Bash.
- **Linux**: the deb/rpm post-install links `/usr/bin/chaoffice`; the AppImage relies on the first-launch symlink into `/usr/local/bin` when it is writable.

`chaoffice install-cli` repeats the attempt and prints the manual command when it cannot finish. jsdom (for Word/Markdown) ships beside the bundle as `Resources/cli/node_modules`, collected by `collect-deps.mjs` at build time.

Independently of the PATH, every launch of the packaged app writes the launcher directory to `~/.chaoffice/launcher` (`GENOFFICE_AUTH_DIR` overrides the directory, as for `auth.json`). The `chaoffice` agent skill (`skills/chaoffice/SKILL.md`) reads it when `chaoffice` is not on the PATH. `chaoffice --version` prints this package's version, inlined by `build.mjs`.
## Layout

- `src/cli.ts` — argv parsing, dispatch, output; `runCli()` is embeddable.
- `src/registry.ts` — `CommandDef` table (`name`, `usage`, `run`), the single
  place future entry points (in-app AI, MCP) dispatch through.
- `src/commands/` — `info`, `convert`, `create`, `render`, `slides`, `sheet`, `docs`,
  `guide`, `open`, `capabilities`, `search`, `image`, `media`, `install-cli`.
- `src/dom.ts` — the jsdom bootstrap the Word/Markdown paths need.
- `src/formats/` — thin adapters over `@chaoffice/pdf2docx`, the xlsx sidecar
  and the sheets CSV importer.
- `src/resources.ts` — locates pdfium wasm, the xlsx sidecar and the OCR
  helper in both the packaged `Resources/` layout and the dev checkout.
- `bin/chaoffice`, `bin/chaoffice.cmd` — launchers copied next to `chaoffice.cjs` in the
  packaged app.

## Path policy and audit log

- `GENOFFICE_ALLOWED_ROOTS` (PATH-style list of directories) confines every file chaoffice
  reads or writes to those trees; symlinks are resolved before the check. A path
  outside exits 2 with the roots in `detail.allowed_roots`. Unset means
  unrestricted.
- `apply --out` onto another existing file needs `--force`, like `create` / `convert`;
  editing in place never does. Unknown options are rejected instead of ignored.
- A file the running ChaOffice shell has open in a tab is not rewritten in place
  (exit 2, `detail.gui_pid`): the shell publishes its open tabs to
  `userData/open-documents.json` and chaoffice reads it (`GENOFFICE_USER_DATA`
  overrides the location). `--force` writes anyway; the editor then warns about
  the on-disk change at its next save (Word, Excel) or may overwrite it (PowerPoint).
- Every executed command appends one JSON line (`ts`, `command`, `argv`,
  `status`, `code`, `output_path`, `ms`, `cwd`) to
  `~/.chaoffice/cli-audit.jsonl`, rotated at 2 MB. `GENOFFICE_AUDIT_LOG=<path>`
  redirects it, `GENOFFICE_AUDIT_LOG=off` disables it.

## Cloud commands

`search`, `image` and `media` reuse the editors' provider routing: Genspark
when signed in (`~/.chaoffice/auth.json`) and cloud tools are on, otherwise the
Serper / Tavily or BYOK image / media provider chosen in the app's AI settings
(`ChaOffice/ai-settings.json` in the platform config directory, override with
`GENOFFICE_AI_SETTINGS`). `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` are honoured.
Search results, image bytes and analysis text come back in the JSON `detail`;
`image` also writes the file. These are the only commands that send data off
the machine.

## Build and run in a checkout

```
npm run build -w @chaoffice/cli       # esbuild → dist/chaoffice.cjs
packages/cli/bin/chaoffice info file.docx  # falls back to the system node
```

Conversions that need an app renderer (Word/PowerPoint/Excel/HTML/Markdown → PDF,
Word → HTML, HTML → Word, `create --type pdf`) run inside the ChaOffice binary
through its hidden `--headless-export` mode: chaoffice spawns it (Dock hidden, no
window), reads the JSON envelope it prints and maps its exit code. Set
`GENOFFICE_APP_BIN` to point at a specific executable; in a checkout the dev Electron
plus `apps/shell` is used, so `npm run build:all` first.
