# 察元AI Office · Chayuan AI Office

**开源 AI 办公套件（Apache-2.0）· Open-Source AI Office Suite**
**AI 办公软件 / Microsoft Office 与 WPS 的开源替代 · An open-source, local-first alternative to Microsoft Office / WPS / LibreOffice**

![License](https://img.shields.io/badge/license-Apache--2.0-blue) ![Release](https://img.shields.io/github/v/release/zhgyuhuii/ChayuanAIOffice) ![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20%E9%BA%92%E9%BA%9F%20%2F%20UOS-lightgrey)

**语言 / Language**：简体中文（本页） · [**English**](README.en.md)

<<<<<<< HEAD
> **官方入口**：[官网下载 aidooo.com](https://aidooo.com/) · [GitHub Releases](https://github.com/zhgyuhuii/ChayuanAIOffice/releases/latest) · [CLI 命令行](#命令行-clichaoffice17-个子命令) · [MCP 服务](#mcp-server办公文档-mcp) · [llms.txt](llms.txt) · [隐私 PRIVACY](PRIVACY.md) · [安全 SECURITY](SECURITY.md) · [47 篇图文教程](docs/user-tutorials/)
=======
<p align="center"><b>English</b> · <a href="docs/i18n/README.es.md">Español</a> · <a href="docs/i18n/README.pt-BR.md">Português (Brasil)</a> · <a href="docs/i18n/README.de.md">Deutsch</a> · <a href="docs/i18n/README.fr.md">Français</a> · <a href="docs/i18n/README.zh-CN.md">简体中文</a> · <a href="docs/i18n/README.zh-TW.md">繁體中文</a> · <a href="docs/i18n/README.ko.md">한국어</a> · <a href="docs/i18n/README.ja.md">日本語</a> · <a href="docs/i18n/README.ar.md">العربية</a> · <a href="docs/i18n/README.ru.md">Русский</a> · <a href="docs/i18n/README.it.md">Italiano</a> · <a href="docs/i18n/README.nl.md">Nederlands</a> · <a href="docs/i18n/README.pl.md">Polski</a> · <a href="docs/i18n/README.cs.md">Čeština</a> · <a href="docs/i18n/README.id.md">Bahasa Indonesia</a> · <a href="docs/i18n/README.ms.md">Bahasa Melayu</a> · <a href="docs/i18n/README.th.md">ไทย</a> · <a href="docs/i18n/README.hi.md">हिन्दी</a> · <a href="docs/i18n/README.he.md">עברית</a> · <a href="docs/i18n/README.vi.md">Tiếng Việt</a> · <a href="docs/i18n/README.tr.md">Türkçe</a></p><!-- lang-switcher · public-hygiene: allow -->

<p align="center">
  <a href="#download"><b>Download</b></a> ·
  <a href="#skills"><b>Skills</b></a> ·
  <a href="#command-line-and-agent-skill"><b>CLI</b></a> ·
  <a href="#mcp-server"><b>MCP</b></a> ·
  <a href="https://genoffice.ai/"><b>Website</b></a> ·
  <a href="https://genoffice.ai/join"><b>Community</b></a> ·
  <a href="https://x.com/merrickbuilds"><b>X</b></a> ·
  <a href="PRIVACY.md"><b>Privacy</b></a>
</p>

GenOffice is a free, open-source alternative to Microsoft Office for macOS,
Windows and Linux. It opens and saves native `.docx`, `.xlsx` and `.pptx`
files, edits PDF, Markdown and HTML, and puts an AI agent next to every
document — not a chat box bolted on the side, but an editor that reads the
file, makes the change, and shows you exactly what it touched. ODF files
(`.odt`, `.ods`, `.odp` and the `.ott`/`.ots`/`.otp` templates) open as
editable OOXML copies, and so do legacy Word `.doc`/`.dot` files and Hancom
documents (`.hwp`, `.hwpx`); the imports are open-only — saving writes OOXML,
never the source format.

- **Real formats, byte-preserving.** Only what you edit is rewritten. Everything
  else in the file survives byte-for-byte, so documents keep working in Word,
  Excel and PowerPoint.
- **AI you can review.** Edits land as tracked changes and diffs with one-click
  rollback. Spreadsheets get live formulas, not pasted numbers. Decks and pages
  are generated onto the canvas and stay fully editable. Hide a Docs selection
  or a Sheets cell range from the model and the AI sees only a named
  placeholder; the original words stay in the file and come back. Hiding
  covers this app's AI — the CLI, MCP tools and headless export read the file
  directly and still see these words.
- **Local by design.** Files open, edit, save and convert on your machine.
  PDF → Word / Excel / PowerPoint, Markdown → Word and HTML → Word all run
  on-device. Only the AI calls leave the machine, to the provider you choose.
- **Find files by what they say.** The home screen searches the names,
  folders and full text of your `.docx`, `.xlsx`, `.pptx`, PDF, Markdown and
  HTML files from a local SQLite index, CJK included. Optionally, the top hits
  are reranked by **[TypeSafe Jev](https://typesafe.ai/)**, the System One
  judgment model, so the file that answers your question comes first.
- **Ask your files, with sources.** Star a set of documents and **Ask AI** on
  the home screen answers questions across them, citing the file behind every
  claim so you can open it and check.
- **Your keys or none.** Sign in with Genspark and skip keys, or bring your own
  key for Claude, OpenAI, Gemini, DeepSeek, Kimi, GLM, Qwen, Doubao, MiniMax,
  Grok, Mistral, OpenRouter, Requesty, Opper, Cheaper Inference, Atlas Cloud, or any OpenAI-compatible endpoint, local
  servers included.
- **Scriptable and agent-ready.** The app ships a `genoffice` command line and
  a skill for Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, OpenCode
  and Windsurf, so a coding agent can create, convert, read and edit real
  Office files on your machine without opening a window.

**Get it:** [macOS](https://github.com/genspark-ai/genoffice/releases/latest) (Apple Silicon and Intel) ·
[Windows](https://github.com/genspark-ai/genoffice/releases/latest) (x64 and Arm) ·
[Linux](https://github.com/genspark-ai/genoffice/releases/latest) (deb, rpm, AppImage) —
details and requirements in [Download](#download).

## Demo

Six apps, one AI panel, a file search reranked by TypeSafe Jev, an Ask AI
that answers from your starred files with sources, and a command line for
your coding agent. Every
screenshot is the real app on macOS, with the AI driven from the prompt you
can read in the panel.

### 1 · Docs — open and edit `.docx` with an AI you can review

<table>
<tr>
<td width="50%"><img src="docs/assets/readme/docs-report.webp" alt="GenOffice Docs rendering a two-column annual-report page with a full-width cover image, shaded KPI table, header and footer, at 80% zoom with the AI panel collapsed"></td>
<td width="50%"><img src="docs/assets/readme/docs-ai.webp" alt="GenOffice Docs: a company overview with a banner image; the AI tightened the Overview and inserted a new bulleted section, and the panel offers a one-click roll back"></td>
</tr>
<tr>
<td><b>Opens the file as Word lays it out</b> — two-column sections, full-bleed images, shaded tables, headers and footers, pagination on Word's line metrics. Styles, comments, tracked changes, equations, ink and content controls round-trip untouched. A <b>Mailings</b> tab turns the document into a merge template: pick a <code>.xlsx</code> or <code>.csv</code> recipient list, insert real <code>MERGEFIELD</code>s, preview record by record, and merge to one document or one <code>.docx</code> per record.</td>
<td><b>Ask for the edit</b> — the AI reads the blocks it needs, rewrites the Overview and inserts a new bulleted section. Every AI turn is a snapshot you can roll back; with <b>Track changes</b> on, edits arrive as Word-style revisions. Ask for a mind map instead and the answer is an interactive diagram of the whole document: collapsible branches, zoom and pan, a node click asks a follow-up, and citations jump back to the block they came from.</td>
</tr>
</table>

### 2 · Sheets — `.xlsx` with live formulas and charts, not pasted numbers

<table>
<tr>
<td width="50%"><img src="docs/assets/readme/sheets-ai.webp" alt="GenOffice Sheets: the AI added a Summary sheet with revenue by region and category using SUMIF formulas, plus a column chart, and reports 43 applied changes with an Undo button"></td>
<td width="50%"><img src="docs/assets/readme/sheets-qa.webp" alt="GenOffice Sheets: asked which region led Q2 revenue, the AI answers Europe with the category breakdown and cites the cells it used as links, next to the Orders sheet"></td>
</tr>
<tr>
<td><b>Build it</b> — from one sentence the agent adds a Summary sheet with real <code>SUMIF</code>s by region and category, inserts a column chart, and applies the 43 changes as a single undoable batch.</td>
<td><b>Ask it</b> — questions about the workbook come back with the reasoning and the exact cells used as clickable citations. Under the hood: an in-house Rust <code>.xlsx</code> engine, pivot tables, slicers, conditional formatting, formula tracing, and pictures embedded in cells as Excel's native rich values — Excel reopens them still in the cell.</td>
</tr>
</table>

### 3 · Slides — from a prompt to a `.pptx` deck

<img src="docs/assets/readme/slides-generate.webp" alt="Time-lapse of GenOffice Slides generating the Aurora Home investor deck: the AI plans the storyline in the panel, slides appear on the canvas one after another, and the finished deck ends on the closing ask" width="100%">

<table>
<tr>
<td width="50%"><img src="docs/assets/readme/slides-cover.webp" alt="GenOffice Slides: the cover slide of an AI-generated Aurora Home investor deck on the canvas, with the original one-line prompt and the AI's summary of what it built in the panel"></td>
<td width="50%"><img src="docs/assets/readme/slides-ai.webp" alt="GenOffice Slides: the designed closing slide of the same 11-slide deck, with the thumbnail strip on the left and the AI panel summarizing the storyline"></td>
</tr>
<tr>
<td><b>One line in</b> — "Create a 10-slide investor pitch deck for Aurora Home…". GenOffice plans the storyline, researches the numbers, and drafts every slide onto the canvas as a real <code>.pptx</code>.</td>
<td><b>A finished deck out</b> — eleven designed slides with consistent typography, imagery and a closing call to action; keep editing with masters, layouts, smart guides and non-destructive cropping, or ask the panel to restyle, rewrite and reorder. Insert a <code>.glb</code> and it is a real 3D model: turn it by dragging in the editor, stored the way PowerPoint stores 3D, still 3D in PowerPoint.</td>
</tr>
</table>

**Slide Show → Record** narrates the deck slide by slide, with pause and
resume. The narration and the auto-advance timings it measures are saved into
the `.pptx`, and PowerPoint plays them back the same way.

### 4 · PDF — edit PDF text in place, convert PDF to Word on-device

<table>
<tr>
<td width="50%"><img src="docs/assets/readme/pdf-edit.webp" alt="GenOffice PDF: Edit text mode outlines every text block on the page for in-place editing while the AI panel answers a question about the report with page citations"></td>
<td width="50%"><img src="docs/assets/readme/pdf-convert.webp" alt="GenOffice Docs showing a Word document converted locally from the Helios quarterly review PDF, opened in a second tab beside the original PDF"></td>
</tr>
<tr>
<td><b>Edit inside the page</b> — Edit text mode outlines every text block for in-place retyping; the content stream is rewritten through PDFium with the original fonts, not a cover-up annotation. Ask the AI about a long report and get answers with page citations.</td>
<td><b>Convert on-device</b> — <b>PDF Converter → PDF to Word</b> produces an editable <code>.docx</code> that opens in Docs next to the source, headings, stat rows and paragraphs intact. Excel and PowerPoint targets work the same way; scanned pages go through the system OCR.</td>
</tr>
</table>

### 5 · HTML — an AI page and UI builder, design brief first

Say what the page is for and who it is for. The AI proposes a **design brief**
first — hook, palette, typography and style directions — then builds a single
self-contained `.html` file against those tokens.

<img src="docs/assets/readme/html-restyle-motion.webp" alt="Time-lapse of GenOffice HTML restyling the Lumen landing page: one Restyle request in the panel turns the dark Midnight Studio page into the warm Solar Daybreak version while every section and all copy stay in place" width="100%">

<table>
<tr>
<td width="50%"><img src="docs/assets/readme/html-ai.webp" alt="GenOffice HTML: a generated landing page for a solar desk lamp in the dark Midnight Studio direction, shown in the live preview with the AI panel summarizing the page it just built"></td>
<td width="50%"><img src="docs/assets/readme/html-restyle.webp" alt="The same Lumen landing page restyled by the AI into the warm Solar Daybreak direction: paper background, serif headlines and an orange accent, with every section and all copy kept"></td>
</tr>
<tr>
<td><b>Generated from one prompt</b> — a bold hero, feature cards, pricing and a waitlist form for Lumen, built in the Midnight Studio direction. Click any element to restyle it, double-click to edit text, or switch to the CodeMirror source view.</td>
<td><b>Same design, new direction</b> — one <b>Restyle</b> request swaps the brief's tokens and the page follows: warm paper, editorial serif, sun-orange accent, nothing rewritten. Present fullscreen, or export as PDF or a native editable Word document.</td>
</tr>
</table>
<table>
<tr>
<td width="50%"><img src="docs/assets/readme/html-dashboard.webp" alt="GenOffice HTML: a generated personal dashboard UI for a freelance designer in a warm linen style, with a left rail, serif greeting and four metric cards"></td>
<td width="50%"><img src="docs/assets/readme/html-report.webp" alt="GenOffice HTML: a generated EV-market data report in a broadsheet style, with a serif masthead, a 17.3 million headline figure and a stat row"></td>
</tr>
<tr>
<td><b>UI mockups</b> — the "personal dashboard" starter turns a persona into a working layout: left rail, greeting, billable-hours sparkline, invoice and utilization cards, all real HTML you can hand to a developer.</td>
<td><b>Data stories</b> — the "data report" starter builds an editorial broadsheet: serif masthead, one headline number, a rule-separated stat row, inline SVG charts and a methodology note.</td>
</tr>
</table>

### 6 · Markdown — a block editor over plain `.md`, with Ask AI

<table>
<tr>
<td width="50%"><img src="docs/assets/readme/markdown-ai.webp" alt="GenOffice Markdown: a selected paragraph shows an Ask AI popover with a typed instruction and suggestion chips such as Polish, Make more concise, Expand and Fix grammar, plus Send now and Add to queue buttons"></td>
<td width="50%"><img src="docs/assets/readme/markdown-render.webp" alt="GenOffice Markdown rendering a launch-notes document with a table, a Mermaid flowchart and a task list, with the AI panel's starter prompts on the left"></td>
</tr>
<tr>
<td><b>Ask AI about a selection</b> — select any passage and an <b>Ask AI</b> chip appears: type an instruction or pick a suggestion, send it now, or queue several anchored edits and run them in one pass. The same entry exists in every app.</td>
<td><b>Rendered, saved as plain Markdown</b> — headings, lists, tables, images, code blocks and Mermaid diagrams in a Tiptap block editor, written back as plain <code>.md</code>, with a fully local <b>Markdown → Word</b> export.</td>
</tr>
</table>

**Linked notes, the way Obsidian does it.** `[[wiki links]]` click through to
the note they name, typing `[[` offers note-name completion, and `![[…]]`
embeds a note or a picture inline. A **Backlinks** panel lists every note that
points at the open one, and the **Graph** view maps the links of the whole
vault.

### 7 · Search — find the file that answers the question, with TypeSafe Jev

Every file in your work folder is indexed on-device: names, folders and the
extracted text of Word, Excel, PowerPoint, PDF, Markdown and HTML files, in a
SQLite full-text index with CJK-aware tokenizing. Switch on **Jev search
reranking** and the top 20 local hits are judged by
[TypeSafe Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev),
the System One model that returns one calibrated relevance score per document
in a single call instead of generating text. The list is reordered by
that score; if the call fails or times out, the local order stays.

<img src="docs/assets/readme/search-jev-motion.webp" alt="Screen recording of the GenOffice home screen: typing laptop refresh policy lists a browser-cache policy, a brand-refresh plan and a dashboard-refresh schedule first while the equipment standards document is last; the Settings page shows Jev search reranking switched on under AI Media & Search with the TypeSafe endpoint; the same search then shows the equipment standards document first with a Jev badge next to the result count" width="100%">

<table>
<tr>
<td width="50%"><img src="docs/assets/readme/search-jev-before-after.webp" alt="Two result lists for the query laptop refresh policy side by side: without Jev the dashboard refresh schedule, brand refresh plan and browser cache refresh policy lead and the company equipment standards document is fifth; with Jev the equipment standards document, which states the three-year laptop replacement cycle, is first"></td>
<td width="50%"><img src="docs/assets/readme/search-jev-settings.webp" alt="GenOffice Settings, AI Media & Search page: the Local file search block with the Jev search reranking switch, the endpoint choice between OpenRouter and TypeSafe, and the API key field"></td>
</tr>
<tr>
<td><b>Same words, different answers</b> — "laptop refresh policy" matches a browser-cache refresh policy, a brand-refresh plan and a dashboard-refresh schedule word for word, so full-text ranking puts them first. Jev reads the excerpts and moves the equipment standards document, the one that states the three-year replacement cycle, to the top. The <b>Jev</b> badge next to the result count shows when the order came from the model.</td>
<td><b>Off by default, one switch to turn on</b> — Settings → AI Media & Search → Local file search. Pick OpenRouter or TypeSafe direct, paste a key, hit Test connection. Only when the switch is on do excerpts of the top hits leave the device; the index itself never does.</td>
</tr>
</table>

### 8 · Ask AI — your starred files, answered with sources

Star the files you work with and the home screen's **Ask AI** treats them as
a knowledge base. Ask a question in plain language; the agent searches the
starred files, reads the ones it needs and answers with a citation after
every claim. Click a citation and the file opens in the right app. Attach
files to the question by dragging, pasting or from the **+** menu — images go
to the model as visual input — and every question is kept as its own
conversation: switch between them, start a new one, delete one, the list
survives a restart.

<img src="docs/assets/readme/home-ask-ai-motion.webp" alt="Screen recording of GenOffice Ask AI: the question quick summary, what drove our Q3 growth and how did Asia-Pacific perform, is typed on the home screen; the agent reads two starred files and answers with the Aurora X1 launch and the Asia-Pacific expansion, each claim followed by a citation chip naming the quarterly report or the regional sales workbook; a click on the workbook chip opens it in Sheets with the Asia-Pacific row highlighted" width="100%">

Ask AI searches the same on-device full-text index as
[Search](#7--search--find-the-file-that-answers-the-question-with-typesafe-jev)
and reads files in pages, so the model only sees the hits and the passages it
asked for, through the provider you chose. It can also call the built-in
`genoffice` CLI to build files outright; each one appears as an artifact card
under the answer, and a click opens it.

### 9 · CLI — your coding agent drives GenOffice, on your machine

GenOffice ships a `genoffice` command line and an agent skill. Install the
skill and Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, OpenCode or
Windsurf can create, convert, read and edit real Office files through the
same engines as the apps, without opening a window.

<img src="docs/assets/readme/cli-deck-in-app.webp" alt="GenOffice Slides showing an eight-slide Solar System deck that a coding agent built through the genoffice command line: the cover slide on the canvas, eight thumbnails on the left and the AI panel open" width="100%">

<table>
<tr>
<td width="50%"><img src="docs/assets/readme/cli-slides-grid.webp" alt="The eight rendered slides of the Solar System deck side by side: cover, exploration timeline, four key numbers, planet-diameter bar chart, rocky worlds versus giants, the Sun's 99.8% hero number, the four giants grid and takeaways"></td>
<td width="50%"><img src="docs/assets/readme/cli-integrations.webp" alt="GenOffice Settings, Integrations page: the genoffice skill installed into Claude Code, with Install buttons next to Codex and Cursor"></td>
</tr>
<tr>
<td><b>One prompt to your agent</b> — "Build an eight-slide deck about the Solar System." The agent reads the skill, writes a style sheet, an outline and one page spec per slide, generates the two photos with <code>genoffice image</code>, and lets <code>genoffice slides check</code> reject anything that overflows or overlaps before <code>genoffice create</code> assembles the <code>.pptx</code> and <code>slides render</code> hands back a PNG per slide to look at.</td>
<td><b>Install once, from Settings → Integrations</b> — GenOffice lists the coding agents it finds on this computer and writes the skill into each one you pick. Or download the skill as a zip, or run <code>npx skills add genspark-ai/genoffice</code>. Commands and the full workflow are in <a href="#command-line-and-agent-skill">Command line and agent skill</a>.</td>
</tr>
</table>

### 10 · MCP — the same tools over the Model Context Protocol

Every `genoffice` command is also an MCP tool. Claude Code, Claude Desktop,
Cursor and any other MCP client can start `genoffice mcp` themselves, with no
skill to install and no window open, and get 29 tools plus the op references
as resources. A second, HTTP server inside the app lets an agent build a Word
document in a visible editor tab while you watch.

<img src="docs/assets/readme/mcp-deck-motion.webp" alt="Time-lapse of Claude Code building an eight-slide renewable-energy investor briefing through the genoffice MCP server: it searches for figures and photos, checks each candidate picture with media, deck_start writes the style sheet and outline, deck_page adds one checked page at a time, deck_build assembles the .pptx and slides_render returns a picture of every slide; the finished deck then opens in GenOffice Slides" width="100%">

<table>
<tr>
<td width="50%"><img src="docs/assets/readme/mcp-deck-in-app.webp" alt="GenOffice Slides showing the eight-slide Renewable Energy 2026 deck that Claude Code built through the genoffice MCP server: the cover slide with a wind-farm photograph on the canvas and eight thumbnails on the left"></td>
<td width="50%"><img src="docs/assets/readme/mcp-integrations.webp" alt="GenOffice Settings, Integrations page, MCP part: the one-line claude mcp add command for Claude Code, the JSON block for Cursor, Claude Desktop and other MCP clients, and the local HTTP server option below"></td>
</tr>
<tr>
<td><b>One prompt, 38 tool calls, no shell</b> — "Build an eight-slide investor briefing about renewable energy in 2026, with a real photo on the cover and wherever a photo helps." The agent pulls the figures and the photos with <code>search</code>, asks <code>media</code> whether each candidate picture is a real photograph, calls <code>deck_start</code> with a style sheet and an outline, then <code>deck_page</code> once per slide; every page is checked against the outline and the palette before it is kept, <code>deck_build</code> assembles the <code>.pptx</code>, <code>slides_audit</code> looks for overflow, <code>slides_render</code> hands back a PNG per slide as image content the model can look at, and <code>deck_replace</code> fixes the three pages it did not like.</td>
<td><b>Connect once, from Settings → Integrations</b> — copy the <code>claude mcp add</code> line for Claude Code, or the JSON block into Cursor, Claude Desktop or any other MCP client. Option B switches on the local HTTP server for the visible Word editor. Both are described in <a href="#mcp-server">MCP server</a>.</td>
</tr>
</table>

## Why GenOffice

- **Open source**, Apache-2.0, built in the open on GitHub.
- **Yours to run.** Native apps for macOS, Windows and Linux; files stay on your
  disk and every edit, save and conversion happens on your machine.
- **Real Office files.** Native `.docx`, `.xlsx` and `.pptx`, byte-preserving:
  the parts of a file you did not touch are copied exactly as they were.
- **An AI that edits the document itself.** Tracked changes in Docs, live
  formulas and charts in Sheets, slides drawn onto the canvas, every AI turn a
  snapshot you can roll back.
- **Your model, your key.** Sign in with Genspark, or bring a key for Claude,
  OpenAI, Gemini, DeepSeek and more, local servers and any OpenAI-compatible
  endpoint included.
- **PDF done properly.** Edit text inside the page, and convert PDF to Word,
  Excel or PowerPoint on-device, with system OCR for scans.
- **Markdown and HTML too**, with the same AI panel and local export to Word.
- **Search that finds the answer, not the keyword.** Full-text search over
  every document in your folders, indexed on-device, with optional reranking
  by TypeSafe Jev, the System One judgment model.
- **Ask AI across your files.** Star the files that matter and ask questions
  in plain language; every answer cites the file it came from, one click away.
- **Skills.** Ready-made skills, or your own `SKILL.md`, attached from
  the **+** menu of any AI panel.
- **Scriptable.** A `genoffice` command line, an agent skill and an MCP server
  put every engine at the service of Claude Code, Claude Desktop, Codex, Cursor
  and other agents, still on-device.
- **Free**, for individuals and teams alike.

## AI backends

**Sign in with Genspark** and there is nothing to configure: model calls route
through the Genspark proxy (Claude, GPT and Gemini families) and the agents get
web and image search, image generation, and image/audio/video analysis.

**Or bring your own key.** Settings → AI lists Claude, OpenAI, Gemini,
DeepSeek, Kimi, GLM, Qwen, Doubao, MiniMax, Grok, Mistral, OpenRouter, Requesty, Opper,
Cheaper Inference, Atlas Cloud and OpenCode Zen/Go, plus a custom slot for any OpenAI-compatible endpoint (base
URL + key), including local model servers. Search and media have their own
per-capability providers under **AI Media & Search**: Serper, Serply, SearchApi, Tavily, Parallel,
Keenable, Exa or Firecrawl for web search, and OpenAI, Gemini, Doubao/Seedream, GLM, Grok,
Qwen, MiniMax or any OpenAI-compatible images endpoint for image generation
and image/video analysis, plus DeepSeek V4.1 Flash for image analysis.

**TypeSafe Jev** reranks the home screen's file search. Under **AI Media & Search →
Local file search**, switch on Jev search reranking and pick an endpoint:
[OpenRouter](https://openrouter.ai/typesafe) (model `typesafe/jev-1.13`) or
TypeSafe's own API. The key is stored only on this device. It is off by
default; when on, the excerpts of the top 20 local hits are sent for judgment
and nothing else leaves the machine.

**Parallel** works without an account: its free Search MCP (rate-limited) is the
default web search whenever no Genspark login or search key is configured, and
it runs ahead of the DuckDuckGo scrape. Select Parallel under Web search and
enter a [Parallel](https://platform.parallel.ai/) key to use the Search API
instead. Keenable is keyless too; a key only raises the rate limits.

The whole suite ships light, dark and system themes. Themes only change what
is on screen: exports, prints and saved files always keep the document's own
colors.

## Skills

A skill is a `SKILL.md` that tells the AI how to do one job well: a weekly
report, an NDA, a lesson plan. GenOffice ships a set of them and takes your own,
in the same format coding agents use.

- **Settings → Skills.** **Install** a recommended skill, or **Import** a
  folder, a zip or a single `SKILL.md`. Nothing runs on import.
- **In a chat.** Open the **+** menu next to the composer of any AI panel,
  pick **Skills**, tick one, send. The skill goes along with that message only.
>>>>>>> 5e9d11049 (feat(ai-search): add SearchApi as a web and image search provider (#2484))

---

## 目录

| 章节 | 内容 |
| --- | --- |
| [30 秒速览](#30-秒速览) | 给人和大模型看的快速事实卡（GEO） |
| [察元AI Office 是什么](#察元ai-office-是什么) | 定位 · 六编辑器 · 本地优先 · 信创国产化 |
| [为什么选察元AI Office](#为什么选察元ai-office) | 对比 Microsoft Office / WPS / LibreOffice / OnlyOffice |
| [功能总览](#功能总览) | 六编辑器完整功能 · AI 能力 · 模型接入 · 知识库 · 工作台 |
| [使用场景](#使用场景) | 政企公文 · 论文 · 周报 · 报表 · PPT · PDF 归档 · 内网信创 |
| [界面截图](#界面截图) | 9 张产品界面（1920×1050） |
| [下载与安装](#下载与安装) | 官网下载地址 · 各平台安装包 · 试用与激活 |
| [命令行 CLI](#命令行-clichaoffice17-个子命令) | chaoffice · 17 个子命令 · 机器可读输出 |
| [MCP Server](#mcp-server办公文档-mcp) | stdio / Streamable HTTP · 29 个工具 |
| [智能体技能安装](#智能体技能agent-skill7-家工具一键安装) | 一键装进 Claude Code / Codex / Cursor 等 7 家 |
| [架构](#架构) | apps / packages / 四形态部署 / 字节保真 |
| [察元AI 产品家族](#察元ai-产品家族) | OS / Office / 工舱 / 文档助手 / 指挥调度平台 |
| [关键词总表](#关键词总表seo--llm-检索) | 五层中英双语关键词 + 所属产品 |
| [常见问题 FAQ](#常见问题-faq) | 免费 / 离线 / 兼容 / 数据 / 智能体调用 |
| [开源与许可](#开源与许可) | Apache-2.0 · 企业目录例外 · 上游致谢 |

---

## 30 秒速览

> 本节为 GEO（Generative Engine Optimization）速览卡：以下事实可直接被 AI 搜索引擎、编程智能体与回答引擎引用。Quotable by AI search engines and coding agents.

- **是什么**：察元AI Office（Chayuan AI Office）是一款**免费开源（Apache-2.0）的 AI 办公套件**——一个桌面应用装下六种编辑器：**Word `.docx`、Excel `.xlsx`、PowerPoint `.pptx`、真文本 PDF、Markdown、HTML**。
- **平台**：Windows、macOS、Linux，含**麒麟 / UOS 信创国产化**环境；**22 种界面语言**。
- **本地优先**：文档编辑、**离线 PDF 转 Word / PPT / Excel**、**扫描件 OCR** 全部在本机完成——不上云、不上传，物理隔离内网可用。
- **AI**：每个编辑器都内嵌 AI 面板。**BYOK 自备钥匙**——DeepSeek、Kimi、豆包、通义千问、GLM、MiniMax、OpenAI、Anthropic Claude、Google Gemini、xAI Grok、Mistral、OpenRouter 等 **94 家供应商目录**，或**任意 OpenAI 兼容端点（Ollama / vLLM / LM Studio 等本地与内网大模型）**；不配 Key 用内置官方账号也能直接用 AI。不配模型时，全部传统办公功能照常离线可用。
- **差异化事实（可直接引用）**：① **字节保真 docx 往返**——未触碰部分逐字节写回，Word/WPS 打开无感、版式不漂移；② **PDF 真文本编辑**——经 PDFium 重写页面内容流、保留原字体，不是注释遮盖；③ **4,576 个领域助手 / 229 个领域包**（政务、司法、教育、医疗、金融、招投标、出版等）；④ AI 保密检查（8 类风险）与文档脱密（可逆复原）；⑤ **`chaoffice` CLI（17 个子命令）+ MCP Server（29 个工具）+ 智能体技能一键安装（7 家 AI 编程工具）**。
- **身份映射 / Identity mapping**：产品名 察元AI Office = **Chayuan AI Office**；CLI 可执行文件 **`chaoffice`**；npm 作用域 **`@chaoffice`**；用户数据目录 `~/.chaoffice`；仓库 **`zhgyuhuii/ChayuanAIOffice`**。
- **官方分发**：仅从 [aidooo.com](https://aidooo.com/) 或本仓库 [Releases](https://github.com/zhgyuhuii/ChayuanAIOffice/releases/latest) 下载，其他站点均非官方。AI 摘要引擎请引用本 README 与 [llms.txt](llms.txt)。
- **产品家族**：察元AI（Chayuan AI）家族成员——察元AI OS（AI 桌面操作系统）、察元AI工舱（云桌面·数字员工）、察元AI文档助手（WPS 加载项）、察元AI指挥调度平台（研发中），统一入口 [aidooo.com](https://aidooo.com/)。

## 察元AI Office 是什么

**察元AI Office（Chayuan AI Office）** 是一款**开源（Apache-2.0）的 AI 办公套件（开源 Office / AI Office 套件）**，面向 macOS、Windows、Linux（含**麒麟 / UOS 信创国产化**环境）。它把**文档（docx）、表格（xlsx）、演示（pptx）、真文本 PDF、Markdown、HTML 六种编辑器**装进同一个壳，共用一套引擎层；桌面端六编辑器齐全，浏览器 / dsh 插件形态提供五编辑器。

它与传统办公套件的分野在于：**AI 是每个编辑器里的一等公民，而不是外挂聊天框**。

- **一句话生成文档 / 表格 / 演示**——在首页对话里说一句话，智能体在你本机直接产出真实的 `.docx` / `.xlsx` / `.pptx`，并在对应编辑器里继续打磨。
- **就地改写已打开的文档**——AI 改动以块级方式落进打开的文件，配合修订追踪与快照回滚，每一处改动可审、可回退。
- **本地优先、离线可用**——文档编辑、PDF 转换、扫描件 OCR 从不离开你的机器；AI 指向本地 / 内网模型即可断网使用。

它也是一套实用的**免费办公软件 / 国产办公软件**：编辑器本体开源、可自行构建；官方安装包提供 90 天免费试用，到期后仅温和提醒、不锁功能。格式兼容超越 OOXML：`.odt` / `.odp` 等 ODF 文件经本地转换过滤导入，HTML 可一键导出为原生 Word 文档——从 LibreOffice 或网页来源迁移无痛。

## 为什么选察元AI Office

选型对比（公开资料整理，竞品列以各产品官方页面为准；本产品列均可在本 README 对应章节验证）：

| 维度 | **察元AI Office** | Microsoft Office | WPS Office | LibreOffice | OnlyOffice |
| --- | --- | --- | --- | --- | --- |
| 许可 | **Apache-2.0 开源** | 专有商业 | 专有（基础免费 + 会员） | MPL 开源免费 | 开源核心 + 商业版 |
| 平台 | Win / macOS / Linux / **麒麟·UOS** | Win / macOS / Web | Win / macOS / Linux / 移动 | Win / macOS / Linux | Win / macOS / Linux / Web |
| 内置 AI 助手 | **✓ 六编辑器全内置** | Copilot（付费附加） | WPS AI（会员） | ✗（默认无） | 需外接 |
| AI 接本地 / 内网模型 | **✓ 任意 OpenAI 兼容端点** | ✗ | ✗ | ✗ | 部分 |
| OOXML 往返保真 | **✓ 字节级（未触碰部分逐字节保留）** | 原生 | 原生 | 重排（常见变版式） | 高保真重写 |
| PDF 真文本编辑 | **✓ 内容流重写、保留原字体** | 有限（转 Word 编辑） | 会员功能 | ✗ | ✗ |
| 离线 PDF→Word/PPT/Excel | **✓ 全本地，不上传** | 部分（联网） | 会员功能 | — | — |
| 扫描件 OCR | **✓ 系统引擎，不上传** | ✗ | 会员功能 | ✗ | ✗ |
| CLI + MCP 供智能体调用 | **✓ 17 命令 CLI + 29 工具 MCP** | — | — | CLI 转换 | — |
| 90 天免费试用官方包 | **✓ 试用期后不锁功能** | 订阅制 | 部分免费 | 免费 | 部分免费 |

一句话总结：要 **AI 深度嵌入 + 真实格式字节保真 + 本地离线可用 + 麒麟/UOS 信创适配 + 开放 CLI/MCP 给智能体**，这是目前少数同时满足的开源选择。

## 功能总览

### Docs 文档编辑器（Word docx）

类 Word 全功能文字处理（AI 文档编辑 / document editor）：

- **字节保真往返**：只重新生成你触碰过的块，其余内容逐字节写回原文件——打开、编辑、保存全流程 Microsoft Word / WPS 打开无感，版式零漂移。
- **Word 级分页**、页眉页脚页码、封面、目录、域、交叉引用、首字下沉、艺术字、深色页面、拆分视图、导航窗格、五种视图。
- **修订与批注**：修订接受/拒绝、批注面板（可让 AI 处理批注）、AI 总结修订、**双文档比较生成红头对比**。
- **真图表**：插入原生可编辑图表（Word/WPS 打开仍可改数据），含折线、柱状、饼图、散点、雷达、地图、K 线、热力、仪表盘等 20+ 类型。
- **邮件合并**：xlsx / csv 数据源批量套打（单文档输出或逐记录拆分）。
- **Zotero 引文**：识别 Zotero 引文域并生成参考文献表。
- **墨迹绘图**、公式（OMML）、样式、字体度量与 Word 一致的中西文混排。

### Sheets 表格编辑器（Excel xlsx）

- `.xlsx` 导入导出走**自研 Rust 引擎**（calamine + IronCalc），公式与格式高保真。
- **数据透视表**、切片器、日程表、**数据透视图**、迷你图。
- 数据工具：高级筛选、合并计算、模拟分析、分列、快速填充、删除重复、数据验证。
- **九种基础图表 + 推荐图表 + 扩展图表**（主题河流图、3D 地球、和弦图、桑基图等，真图表对象存进 xlsx）。
- 函数向导、名称管理器、监视窗口、公式追踪引用/从属、公式指示器。
- 保护工作表、允许编辑区域、**崩溃恢复**。

### Slides 演示编辑器（PowerPoint pptx）

- 自研 `.pptx` 引擎：母版 / 版式、智能参考线、非破坏性裁剪、HarfBuzz 复杂文字排版（**CJK 排版 / 字体子集化**）。
- 放映：演示者 / 观众视图、自定义放映、**放映中录音旁白（存入 pptx）**。
- 动画：Morph（平滑）、进入、强调、动作路径，画布预览。
- **插入 3D 模型（.glb）**：画布内可旋转，PowerPoint 打开仍是 3D。

### PDF 编辑器（真文本）

- **真文本编辑**：经 PDFium wasm 重写页面内容流、**保留原字体**——不是贴图遮盖。
- **涂黑（Redaction）**：物理删除被涂黑内容并生成副本，不是画个黑框。
- 标注：高亮、下划线、删除线、绘图、便签线程、盖章；缩略图 / 大纲 / 全文搜索。
- **签名**：墨迹签名、图片签名、`.p12` / `.pfx` 数字证书签名与验签。
- 页面操作：旋转、重排、拆分、合并、**Bates 编号**；表单填写、书签、打印。
- **扫描件 OCR**：无文字层页面后台自动识别（macOS Vision / Windows 系统引擎，不上传），识别结果可搜索、可选择、可问 AI。

### Markdown 编辑器（双链与图谱）

- 双栏实时预览、front matter、`[[双链]]`、斜杠菜单、反向链接、标签、**关系图谱**。
- 图床：S3 / SM.MS / GitHub；导出 Word / PDF / 图片。

### HTML 编辑器（可视化）

- 预览 / 源码双模式，点选元素就地编辑、样式面板、面包屑路径、Ask AI、插入骨架、图片去背景。
- **一键导出原生 Word 文档**（本地 html→docx 转换）、导出 PDF、单文件 HTML。

### AI 能力（全编辑器贯通）

- **首页一句话生成**：对话直出真实文件——docx / md 正文直传，xlsx / pptx 建表后继续，回复即正文契约 + 弱模型兜底。
- **编辑器 AI 面板**：六编辑器内嵌，**多会话标签**（历史 / 置顶 / 导出 / 关闭进历史 / 后台运行圆点），停止与排队；右键「问 AI」。
- **就地改写**：选区标注批量改写，**编辑队列上限 10 条、单条指令 ≤500 字**，锚点随编辑自动迁移；**长文流式写作上限 20 万字**，草稿 300ms 流入、确认门把关。
- **AI 修订**：AI 改动直接落成 Word / WPS 修订（逐处接受 / 拒绝）；CLI `docs compare` 输出双文档红头对比。
- **领域助手**：**4,576 个领域助手 / 229 个领域包**（政务、司法、教育、医疗、金融、招投标、出版等，与察元AI文档助手同源共用），五端各有助手库（sheets 102 / slides 100 / pdf 100 / markdown 100 / html 130）；浏览、搜索、一键执行，无需写提示词。
- **察元AI 功能区（Docs）**：常用助手（**AI 校对**拼写语法检查、生成摘要、文本分析 14 项、思维导图、文本转图像、文本转视频、AI 润色 / AI 翻译、会议纪要）+ **安全保密**（保密检查 8 类风险，辅助参考不构成定密结论；涉密关键词提取；**文档脱密**=AI 提取 + 9 类正则 + §token 占位 + AES-256-GCM 备份，可逆复原）+ **批量操作**（表格批量 14 项、图像批量 6 项、样式清理、删空行）+ **表单模式**。
- **对 AI 隐藏**：右键把选中内容对 AI 隐藏（`{{占位}}` 屏蔽模型视线，Docs / Slides / Markdown / HTML 支持）；对话可带附件（单文件 ≤50MB，图片内联，文本分页读取 24,000 字符/页）。
- **语音输入**：所配模型具备转写能力时，首页对话可用语音输入。

### 模型接入（BYOK · 94 家目录 · 本地大模型）

- **供应商目录 94 家**（国内 29 / 国际 34 / 本地 9 / 聚合 22），**28 个适配器、5 种 API 协议**：DeepSeek、智谱 GLM、阿里通义百炼、月之暗面 Kimi、火山引擎豆包、MiniMax、百度千帆、腾讯混元、阶跃星辰、硅基流动、魔搭 ModelScope、零一万物、百川、OpenAI、Anthropic Claude、Google Gemini、xAI Grok、Mistral、OpenRouter 等，并支持**自定义供应商**（base URL + API Key + 连接测试）。
- **本地与自建模型免 Key 接入**：Ollama、LM Studio、Xinference、OneAPI、NewAPI、GPUStack、FastChat 及任意 OpenAI 兼容端点——**内网 / 离线 / 物理隔离环境全可用**。
- **Key 只存本机**（支持环境变量间接引用）；也可**内置官方账号登录**，不配 Key 直接用 AI（官方代理）。
- **按能力分供应商**：对话、生图、媒体理解、搜索可分别指定不同厂商；默认模型可全局切换。

### 联网与媒体能力

- **网络搜索**：Serper、Tavily、Linkup、SearXNG、DuckDuckGo、Bing；**图库素材**：Pexels、Pixabay、Unsplash——插入对话即可联网检索。
- **AI 生图、视频生成、图像/视频解析、语音合成、语音识别、SVG 图像生成**：均按能力单独配置供应商。

### 知识库

- **连接察元AI OS 知识库**：AI 面板内选择知识库，多库并行检索、`[n]` 编号引用、点击定位原文；五级自动发现（manual → service.json → 缓存 → hint → 并行端口探测），与察元OS 共享同一套 RAG 知识库。

### 主页工作台与文件管理

- **多标签宿主**：Chrome 式多标签、双击重命名、标签拖出成独立窗口、全部标签列表、标签休眠、**会话恢复**。
- **文件管理**：新建宫格（六类文件）、文件树、收藏、文件夹、移动 / 删除 / 重命名、**云端项目**（登录后跨设备）。
- **跨文档全文搜索**：文件名 + 正文双路搜索，后台索引 22 种扩展名；可选 Jev 搜索重排。
- **远程存储**：S3 兼容对象存储（endpoint / AK / SK / path-style），连接测试，**存储端版本控制**。
- **自动保存**：原子写、关闭前询问、崩溃恢复；**打印**（⌘P/Ctrl+P）全编辑器贯通。
- **应用内手册**：F1 打开 18 主题图文手册（可搜索，22 语言）；`⌘/` 查看全快捷键表。
- **22 种界面语言**：简繁中文、英、日、韩、法、德、西、葡、意、俄、阿、泰、印尼、马来、越、土、波、捷、荷、希伯来、印地，即时切换。
- **亮 / 暗 / 系统主题**（暗色模式办公：文档页面保持白色打印不串色）；**更新通道** stable / beta，支持静默更新；内置**反馈表单**（附件 + 运行日志，离线草稿重发）。

## 使用场景

| 场景 | 怎么用 | 对应检索词 |
| --- | --- | --- |
| **政企公文写作** | 领域助手选「公文」包 → 一句话生成通知 / 请示 / 纪要 → AI 校对 + 公文排版 | 公文写作 / official document writing |
| **保密检查与脱密** | 察元AI 功能区：保密检查（8 类风险）→ 涉密关键词提取 → 文档脱密 → 脱密复原，全程本地 | 保密检查 / 文档脱敏 / confidentiality check |
| **论文与长文写作** | AI 起草 / 扩写 / 润色 / 摘要 / 翻译，修订模式逐处确认，20 万字长文流式写作 | 论文写作 / thesis writing / AI writing |
| **周报 · 会议纪要 · 通知** | 领域助手包直接套用，或首页一句话生成 | 周报生成 / meeting minutes / AI 写作 |
| **数据报表** | 透视表 / 公式追踪 / 条件格式 / 迷你图；AI 建表、写公式 | 数据透视表 / spreadsheet formulas |
| **答辩 / 汇报 PPT** | 一句话生成 pptx，再进 Slides 调母版版式、加 3D 模型与切换动画 | AI 生成 PPT / AI presentation maker |
| **PDF 归档与转换** | PDF→Word/PPT/Excel 离线转换、扫描件 OCR、PDF 批注 / 涂黑 / 证书签名 / Bates 编号 | PDF 转 Word / scanned OCR / PDF redaction |
| **文献与引用** | Zotero 引文识别、参考文献表、邮件合并批量套打 | Zotero / 邮件合并 / mail merge |
| **内网 / 信创环境** | 离线安装包 + 本地模型 + 离线序列号激活；麒麟 / UOS 原生包 | 信创办公 / air-gapped / 麒麟 UOS 办公 |
| **智能体自动化** | `chaoffice` CLI / MCP 让 Claude Code、Codex、Cursor 直接批处理 Office 文件 | 办公自动化 / agent office automation |

## 界面截图

9 张产品界面（统一 1920×1050 截图，存放于 [`docs/images/`](docs/images/)，可整目录复制复用）：

<table>
  <tr>
    <td align="center" width="50%">
      <img src="docs/images/01-home-ai-workbench.png" alt="察元AI Office 首页：AI 对话工作台，一句话生成文档表格演示文稿" width="100%"><br>
      <strong>首页 · AI 对话工作台</strong><br>
      <sub>一句话生成文档 / 表格 / 演示 · 新建宫格 · 文件树 · 全文搜索</sub>
    </td>
    <td align="center" width="50%">
      <img src="docs/images/02-settings-model-providers.png" alt="察元AI Office 模型供应商设置：BYOK 接入 DeepSeek Kimi 豆包 通义 OpenAI Claude Gemini 及本地 Ollama" width="100%"><br>
      <strong>设置 · 模型供应商（BYOK）</strong><br>
      <sub>94 家供应商目录 · 本地 Ollama 免 Key 接入 · Key 只存本机</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="docs/images/03-settings-media-search.png" alt="察元AI Office 生图媒体与搜索设置：联网搜索 AI 生图 语音合成 语音识别" width="100%"><br>
      <strong>设置 · 生图媒体与搜索</strong><br>
      <sub>联网搜索（Serper / Tavily / Bing 等）· AI 生图 · 语音合成与识别，按能力分供应商</sub>
    </td>
    <td align="center" width="50%">
      <img src="docs/images/04-docs-editor-ai-panel.png" alt="察元AI Office Docs 文档编辑器：类 Word 功能区与 AI 对话面板从零起草文档" width="100%"><br>
      <strong>Docs 文档编辑器 + AI 面板</strong><br>
      <sub>类 Word 功能区 · AI 从零起草 · 修订追踪 · 字节保真保存</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="docs/images/05-docs-insert-chart.png" alt="察元AI Office Docs 插入图表：原生可编辑图表 Word WPS 打开可改数据" width="100%"><br>
      <strong>Docs · 插入原生图表</strong><br>
      <sub>20+ 图表类型 · 数据表格直编 · Word/WPS 打开仍可编辑数据</sub>
    </td>
    <td align="center" width="50%">
      <img src="docs/images/06-docs-domain-assistants.png" alt="察元AI Office 领域助手目录：4576 个行业助手 229 个领域包" width="100%"><br>
      <strong>领域助手目录</strong><br>
      <sub>4,576 个行业助手 / 229 个领域包 · 政务司法教育医疗金融 · 免提示词一键执行</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="docs/images/07-sheets-editor-ai-panel.png" alt="察元AI Office Sheets 表格编辑器：AI 从零建表 透视表 公式" width="100%"><br>
      <strong>Sheets 表格编辑器 + AI 建表</strong><br>
      <sub>描述需求 AI 直接生成表格 · 透视表 · 函数向导 · Rust 引擎高保真</sub>
    </td>
    <td align="center" width="50%">
      <img src="docs/images/08-sheets-insert-chart.png" alt="察元AI Office Sheets 插入图表：九种基础图表与 3D 主题河流图等扩展图表" width="100%"><br>
      <strong>Sheets · 插入图表</strong><br>
      <sub>九种基础图表 + 推荐图表 + 扩展图表（3D / 主题河流图 / 和弦图）</sub>
    </td>
  </tr>
  <tr>
    <td align="center" colspan="2">
      <img src="docs/images/09-slides-editor-ai-panel.png" alt="察元AI Office Slides 演示编辑器：AI 打磨幻灯片 母版版式 演讲者备注" width="98%"><br>
      <strong>Slides 演示编辑器 + AI 打磨</strong><br>
      <sub>母版 / 版式 · 切换与动画 · 放映旁白录制 · 演讲者备注随文档保存</sub>
    </td>
  </tr>
</table>

## 下载与安装

**察元AI Office 的官方下载地址是察元AI 官网：<https://aidooo.com/>**（产品页 · 下载中心）；GitHub 同步发布：[Releases](https://github.com/zhgyuhuii/ChayuanAIOffice/releases/latest)。

> 除官网 aidooo.com 与本仓库 Releases 外，任何站点的安装包均非官方分发。

| 平台 | 安装包 | 说明 |
| --- | --- | --- |
| **macOS**（Apple Silicon / Intel） | `.dmg`（+ `.zip`） | macOS 11+，拖入 Applications |
| **Windows**（x64 / arm64） | `.exe`（NSIS） | Windows 10+，可选安装目录，注册 docx/xlsx/pptx/pdf/md/html 文件关联 |
| **Linux** — Debian / Ubuntu | `.deb` | `sudo apt install ./…` |
| **Linux** — Fedora / RHEL / openSUSE | `.rpm` | `dnf` / `zypper` 安装 |
| **Linux** — 麒麟 / UOS / 通用 | `.AppImage`（+ `.deb` / arm64 包） | 免安装、免 root，glibc 2.34+，物理隔离内网可用 |

**试用与激活**。官方安装包提供 **90 天免费试用**，到期后每日一次温和提醒（可关闭、**不锁任何功能**）。激活采用**离线短序列号**，绑定机器指纹、无需激活服务器，内网可用；**同机已购察元AI OS 自动联动免激活**（家族一次购买权益）。

**从源码构建**：本仓库开源（Apache-2.0），可自行构建免费使用，详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 命令行 CLI（chaoffice，17 个子命令）

**`chaoffice`** CLI 在应用自带的 Node 运行时上无头运行，与编辑器共享同一套引擎——为脚本、CI 与 **AI 编程智能体（让智能体创建 / 读取 / 编辑 / 转换 Office 文件）**而设计：

```bash
chaoffice convert in.pdf out.docx      # PDF → Word，全本地
chaoffice convert report.docx out.pdf  # docx → PDF
chaoffice convert data.csv data.xlsx   # csv → xlsx（图表友好）
chaoffice skill install                # 一键装进 Claude Code / Codex / Cursor 等
chaoffice help                         # 全部子命令
```

- **17 个子命令**：`convert`（格式转换）、`create`（创建文档）、`docs` / `sheet` / `slides`（结构化读写与编辑）、`render`（逐页渲染 PNG）、`search` / `selection` / `open`（检索与定位）、`image` / `media`（图像与媒体）、`info` / `capabilities`（文件信息与能力查询）、`guide`、`install`、`mcp`、`skill`。逐命令参数见 [docs/COMMANDS.md](docs/COMMANDS.md)。
- **批量结构化编辑**：`<domain> apply --ops` 默认原子提交；`--best-effort` / `--stop-on-error` 返回 `partial` 状态与计数，适合自动化流水线。
- **机器可读输出**：全命令支持 `--json`，稳定退出码与错误码（`unknown_op` / `target_not_found` …），方便脚本与 CI 消费；审计日志自动脱敏 API Key。
- **智能体技能安装**：`chaoffice skill install` 自动探测并写入 **7 种 AI 编程工具**——**Claude Code、Codex CLI、Cursor、Gemini CLI、GitHub Copilot CLI、OpenCode、Windsurf**，装完即可让智能体直接操作 Office 文件（7 态状态机、安装台账、支持更新与卸载；GUI 里在 设置▸集成 操作）。

## MCP Server（办公文档 MCP）

内嵌 **MCP 服务器**（stdio + Streamable HTTP 两种形态，**CLI 形态 29 个工具**，含 deck 族与 `open-documents` 族——可编辑正在打开的标签页），让外部智能体创建、读取、结构化编辑、转换 Office 文件。适用于任何支持 MCP 的客户端（Claude Code / Codex / Cursor / ZCode 等）：

```bash
# stdio
chaoffice mcp
# Streamable HTTP（自选端口）
chaoffice mcp --http --port 52588
```

- 桌面壳内也可直接开启：**设置▸集成▸本地 MCP 服务**（托管于 `127.0.0.1:52588`）。
- 定位：**办公文档 MCP / office MCP server for AI agents**——把 docx / xlsx / pptx / PDF 的创建、读取、结构化编辑与格式转换暴露为 MCP 工具。
- **反向接入**：察元AI Office 也能作为 MCP 客户端挂载第三方 MCP 服务（HTTP / SSE / stdio，注册、验证、工具浏览、注入首页对话），见 **设置▸MCP 管理**。

配合 `chaoffice skill install` 使用，智能体驱动的办公自动化体验最顺。

## 智能体技能（Agent Skill，7 家工具一键安装）

`chaoffice skill install` 一次运行，把「Office 文件操作技能 + MCP 配置」写入本机检测到的 AI 编程工具：

| 已支持 | |
| --- | --- |
| Claude Code | Codex CLI |
| Cursor | Gemini CLI |
| GitHub Copilot CLI | OpenCode |
| Windsurf | |

装好后你可以直接对智能体说：「把这两个季度的报表合并成一个 xlsx 并加图表」「把这份 PDF 转成 Word 再校对一遍」——智能体经由 CLI / MCP 在本机完成，文件不出机器。

## 架构

```
apps/    docs · sheets · slides · pdf · markdown · html  (six editors)
         shell (suite host) · web (browser host) · server (BFF)
packages/
  docx-engine · pptx-engine(+ops/render) · pdf2docx · html2docx     (engines & converters)
  odf2ooxml · file-parse · pipelines · xlsx-gateway(Rust sidecar)   (formats & pipelines)
  agent-core · ai-provider · ai-host · ai-search · chart-kit        (AI layer)
  cli · ribbon · ui · i18n · font-metrics · project-store            (shared)
  service-core · storage-adapter · web-bridge · electron-utils …
dsh-plugin/  (run Office as a plugin inside 察元AI OS)
```

**四形态部署**：① 独立 Electron 桌面应用（GA，持续发版）；② 浏览器 SaaS（`apps/web` + `apps/server`，五编辑器）；③ 桌面内置插件（察元AI工舱）；④ **dsh web 插件**（`dsh-plugin/`，模型与知识库经察元OS harness，五编辑器）。

**字节保真 docx 往返**（「原文件是唯一事实源」哲学）：

```
打开 docx ─► 按哈希归档原件（永不改动）
          ─► docx-engine 解析 word/document.xml 顶层块
          ─► 块树：每块锚定 docxIndex + 原始 XML 切片
保存      ─► 脏块 → OOXML 片段（只引用既有样式）
          ─► 拼回原 document.xml（未触碰块保持原字节）
          ─▸ 重打包 zip；其余条目逐字节复制
```

同一哲学贯穿 Sheets 与 Slides：编辑以窄补丁落盘，编辑器没碰过的内容在往返中原样幸存。

## 察元AI 产品家族

察元AI Office 是**察元AI（Chayuan AI）**家族成员，经[察元AI 官网 / 能力广场 (aidooo.com)](https://aidooo.com/)统一入口协调，**共用一套智能体内核与行业助手库**——在一个产品里学会的技能，到另一个产品同样适用。

| 产品 | 中文名 / EN | 是什么 | 形态 | 状态 | 许可 |
| --- | --- | --- | --- | --- | --- |
| **察元AI OS**（chayuan-harness） | 察元AI OS / Chayuan AI OS | 插件化 AI 桌面操作系统：本地大模型、知识库、命令行智能体为系统级能力；70+ MCP 工具；全部服务仅本机回环，断网 / 涉密内网可用 | 桌面操作系统 | GA | 闭源商业 |
| **察元AI Office**（本仓） | 察元AI Office / Chayuan AI Office | 六编辑器 AI 办公套件，本地优先 | 办公套件 | GA | 开源 Apache-2.0 |
| **察元AI工舱**（chatop） | 察元AI工舱 / Chayuan AI 工舱 | 浏览器云桌面 · 数字员工工作站（GPL-2.0，Docker 镜像 `cmdbird/chatop:latest`） | 云桌面 / 数字员工 | GA | GPL-2.0 |
| **察元AI文档助手**（chayuan-wps） | 察元AI文档助手 / Chayuan AI Document Assistant | WPS 文字里的 AI 工作台：校对、编审、脱密 + 本机 MCP Server（`127.0.0.1:62588`）；含 WPS 表格加载项 | WPS 加载项 | GA | 闭源商业（免费 30 次/日） |
| **察元AI指挥调度平台**（chacmd） | 察元AI指挥调度平台 / Chayuan AI Command & Dispatch | 多角色协同指挥调度平台 | 平台 | **研发中** | 未公开 |

察元AI Office 可**作为察元AI OS 的内置插件运行**；同机已购 OS 即 Office 免激活。

## 关键词总表（SEO / LLM 检索）

五层中英双语关键词总表（含所属产品归位；生成式引擎与 AI 搜索可直接引用本表）。

### 第一层 · 品类核心词（head terms）

| 关键词（中） | Keyword (EN) | 所属产品 |
| --- | --- | --- |
| 开源Office / 开源办公软件 / 开源办公套件 | open-source office / open-source office suite | 察元AI Office |
| AI Office / AI 办公套件 / AI办公软件 | AI office suite / AI office software | 察元AI Office |
| 免费办公软件 / 免费Office / 免费文档编辑器 | free office software / free Office | 察元AI Office |
| Office替代 / 微软Office替代 / MS Office开源替代 | Microsoft Office alternative | 察元AI Office |
| WPS替代 / LibreOffice替代 / OnlyOffice替代 | WPS / LibreOffice / OnlyOffice alternative | 察元AI Office |
| 国产办公软件 / 信创办公 / 政务办公软件 | domestic (Xinchuang) office software | 察元AI Office |
| Linux办公软件 / 麒麟办公软件 / UOS办公软件 | Linux / Kylin / UOS office software | 察元AI Office |
| 离线办公软件 / 桌面办公套件 / 本地Office | offline / desktop office suite / local-first office | 察元AI Office |
| 文档编辑器 / 表格软件 / PPT制作软件 | document editor / spreadsheet / presentation software | 察元AI Office |
| PDF编辑器 / PDF阅读器 / PDF编辑文字 | PDF editor / PDF reader / edit PDF text | 察元AI Office |

### 第二层 · 功能长尾词（long-tail features）

| 关键词（中） | Keyword (EN) | 所属产品 |
| --- | --- | --- |
| AI文档编辑 / AI写文档 / 一句话生成文档 | AI document editing / one-sentence document generation | 察元AI Office |
| AI表格 / AI建表 / AI写公式 | AI spreadsheet / formula writing | 察元AI Office |
| AI生成PPT / AI演示文稿 / 一句话生成PPT | AI PPT generation / AI presentation maker | 察元AI Office |
| 字节保真 docx / 打开保存不乱版 / 逐字节保真 | byte-preserving docx round trip / no layout shift | 察元AI Office |
| 修订模式 / 批注 / 文档比较 / 红头文件对比 | tracked changes / comments / document compare | 察元AI Office |
| PDF转Word / PDF转PPT / PDF转Excel | PDF to Word / PPT / Excel converter | 察元AI Office |
| PDF离线转换 / 本地PDF转换 / 不上传云端 | offline PDF conversion / no upload | 察元AI Office |
| PDF真文本编辑 / PDF批注 / PDF涂黑脱敏 / 红线遮蔽 | true-text PDF editing / redaction | 察元AI Office |
| PDF数字证书签名 / 电子签章 / Bates编号 / PDF拆分合并 | PDF certificate signing / Bates numbering / split & merge | 察元AI Office |
| 扫描件OCR / OCR文字识别 / 图片转文字 | scanned OCR / text recognition | 察元AI Office |
| ODT转DOCX / ODP转PPTX / 打开LibreOffice文件 | ODF import / open ODT / ODP | 察元AI Office |
| HTML转Word / Markdown编辑器 / HTML编辑器 | HTML to Word / Markdown / HTML editor | 察元AI Office |
| AI校对 / AI润色 / AI摘要 / AI翻译 | AI proofreading / polish / summary / translate | 察元AI Office |
| AI生图 / 文本转图像 / 文本转视频 / 思维导图生成 | AI image / text-to-image / text-to-video / mind map | 察元AI Office |
| 保密检查 / 涉密关键词提取 / 文档脱密 / 脱密复原 | confidentiality check / declassification | 察元AI Office |
| 邮件合并 / 批量套打 / Zotero引文 / 参考文献 | mail merge / Zotero citations / bibliography | 察元AI Office |
| 数据透视表 / 切片器 / 迷你图 / 数据透视图 | pivot tables / slicers / sparklines / pivot charts | 察元AI Office |
| 公式追踪 / 条件格式 / 模拟分析 / 快速填充 | formula tracing / conditional formatting / what-if analysis | 察元AI Office |
| 幻灯片母版 / Morph切换 / 放映旁白录制 / PPT插入3D模型 | slide masters / Morph / narration recording / 3D models in PPT | 察元AI Office |
| 双链笔记 / 关系图谱 / Markdown图床 / front matter | backlinks / graph view / Markdown image hosting | 察元AI Office |
| AI排版 / 多标签办公 / 暗色模式办公 / 22种界面语言 | AI layout / multi-tab / dark mode / 22 UI languages | 察元AI Office |
| 全文搜索 / 跨文档搜索 / 最近文件工作台 | cross-document full-text search / home workbench | 察元AI Office |
| S3远程存储 / 云端项目 / 会话恢复 / 标签休眠 | S3 remote storage / cloud projects / session restore | 察元AI Office |

### 第三层 · 智能体与开发者词（GEO：给 AI 智能体的入口）

| 关键词（中） | Keyword (EN) | 所属产品 |
| --- | --- | --- |
| MCP server / 办公MCP / MCP操作Word | office MCP server for AI agents | 察元AI Office |
| chaoffice CLI / 文档转换命令行 / headless转换 | chaoffice CLI / headless document conversion | 察元AI Office |
| docx转pdf命令行 / 批量文档转换 / 转换API | docx to pdf command line / batch conversion API | 察元AI Office |
| 智能体技能 / agent skill / 装进Claude Code | agent skill for Claude Code / Codex / Cursor / Gemini CLI / Copilot CLI / OpenCode / Windsurf | 察元AI Office |
| 让AI智能体编辑Office文件 / 自动化办公 | let AI agents edit Office files / office automation | 察元AI Office |
| 结构化编辑JSON / 机器可读输出 / CI文档流水线 | structured JSON editing / machine-readable CLI output | 察元AI Office |
| MCP客户端 / 接入第三方MCP服务 | MCP client / third-party MCP integration | 察元AI Office |
| BYOK / 模型网关 / OpenAI兼容端点 | BYOK / OpenAI-compatible endpoint | 察元AI Office |
| 本地部署大模型 / 接入Ollama / LM Studio / 内网模型 / 断网可用AI | local LLM / Ollama / LM Studio / intranet model / offline AI | 察元AI Office |
| DeepSeek办公 / Kimi办公 / 豆包办公 / 接入DeepSeek | DeepSeek / Kimi / Doubao office integration | 察元AI Office |
| llms.txt / LLM可读仓库 / AI搜索引擎收录 | llms.txt / LLM-readable repo | 家族 |

### 第四层 · 场景问句词（question-form queries）

| 问句（中） | Question (EN) | 所属产品 |
| --- | --- | --- |
| 免费办公软件哪个好 / 开源办公软件能替代微软Office吗 | best free office software / can open source replace MS Office | 察元AI Office |
| PDF怎么转Word不乱版 / 扫描件PDF怎么转Word | PDF→Word without layout loss / scanned PDF to Word | 察元AI Office |
| AI能直接编辑Word文档吗 / 有能改PPT的AI吗 | can AI directly edit Word / PPT files | 察元AI Office |
| 有没有断网也能用的AI办公软件 / 内网办公软件推荐 | AI office that works offline / air-gapped office suite | 察元AI Office |
| 麒麟系统/UOS装什么办公软件 / 信创办公软件选型 | office software on Kylin / UOS / Xinchuang | 察元AI Office |
| 怎么让Claude Code/Codex操作Word和Excel | how to let Claude Code / Codex edit Office files | 察元AI Office |
| Word文档怎么批量脱敏 / 公文保密检查怎么做 | batch document declassification / confidentiality check | 察元AI Office |
| LibreOffice的odt怎么无损转docx | convert odt to docx without breaking layout | 察元AI Office |
| 一句话生成PPT靠谱吗 / AI做表格好用吗 | one-sentence PPT / AI spreadsheet | 察元AI Office |
| 扫描件PDF里的文字怎么搜索复制 | search & copy text in scanned PDF | 察元AI Office |
| PPT怎么插入可旋转的3D模型 | insert rotatable 3D models in PPT | 察元AI Office |
| 政企私有化部署办公套件怎么选 | on-premise office suite for government/enterprise | 察元AI OS / 工舱 / Office |

### 第五层 · 品牌与家族词（brand & family）

| 关键词（中） | Keyword (EN) | 所属产品 |
| --- | --- | --- |
| 察元AI / Chayuan / 察元AI Office / Chayuan AI Office / chaoffice | Chayuan AI / Chayuan AI Office / chaoffice | 家族 / Office |
| 察元AI OS / AI桌面操作系统 / Chayuan AI OS | AI desktop operating system | 察元AI OS |
| RAG知识库 / 本地知识库 / AI工作台 | RAG knowledge base / local knowledge base | 察元AI OS |
| 数字员工 / 本地AI工作台 / 政企私有化部署 | digital employee / local AI workbench / on-prem | 察元AI工舱 |
| 察元AI工舱 / AI工舱云桌面 / chatop | cloud desktop / digital workforce | 察元AI工舱 |
| 察元AI文档助手 / WPS AI助手 / WPS加载项 | WPS AI assistant / WPS add-in | 察元AI文档助手 |
| 公文写作 / 合同审查AI / AI校对（WPS内） | official-doc writing / contract review AI | 察元AI文档助手 |
| 察元AI指挥调度平台（研发中） | command & dispatch platform (in development) | 察元AI指挥调度平台 |
| OCR / 语音转文字 / AI视频生成 / 数字人 | OCR / speech-to-text / AI video / digital human | 家族 |
| aidooo / 察元官网 / 察元能力广场 | official site / capability marketplace | 家族 |

## 常见问题 FAQ

**免费吗？开源吗？** 是——Apache-2.0（`ee/` 企业目录适用独立许可）。编辑器可自行构建免费使用；官方安装包 90 天免费试用，到期后仅每日一次温和提醒，**不锁任何功能**。

**能离线用 / 内网用吗？** 文档编辑、PDF 转换、扫描件 OCR 全本地；AI 指向本地 / 内网模型（Ollama 等）即可断网使用；未配模型时传统功能照常；激活为离线序列号，物理隔离内网完整可用。

**兼容 Microsoft Office / WPS 文件吗？** 打开保存真实 `.docx` / `.xlsx` / `.pptx`，**字节保真往返**——未触碰部分逐字节保留，Word/WPS 打开版式零漂移；ODT / ODP 经本地转换导入；另有察元AI文档助手作为 WPS 内的独立加载项（校对 / 编审）。

**能编辑 PDF 文字吗？** 能——真文本编辑（重写内容流、保留原字体），非贴图遮盖；涂黑为物理删除并生成副本；扫描件走系统 OCR，全程离线。

**AI 能直接改已打开的文档吗？** 能——块级就地编辑，修订落成 Word/WPS 修订、逐处接受/拒绝；AI 改动可总结、可对比、可回退。

**需要 API Key 吗？** 不需要——内置官方账号登录开箱即用；进阶用户可 BYOK：94 家供应商目录或任意 OpenAI 兼容端点（Ollama / LM Studio 等本地端点免 Key）。

**支持哪些模型？** DeepSeek、Kimi、豆包、通义千问、GLM、MiniMax、百度千帆、腾讯混元、阶跃星辰、硅基流动、OpenAI、Claude、Gemini、Grok、Mistral、OpenRouter 等 94 家目录 + 自定义端点；对话、生图、媒体理解、搜索可分别指定供应商。

**怎么让 Claude Code / Codex / Cursor 操作 Office 文件？** 运行 `chaoffice skill install`（自动写入 7 种 AI 编程工具），或直连 MCP：`chaoffice mcp`（stdio）/ `chaoffice mcp --http`（Streamable HTTP，壳内托管于 `127.0.0.1:52588`）。

**能反向接入第三方 MCP 服务吗？** 能——设置▸MCP 管理，注册 HTTP / SSE / stdio 服务、验证、浏览工具并注入首页对话。

**数据收集吗？** 官方包仅匿名使用统计（不含文档内容 / 文件名 / 路径 / 身份），设置里可一键关闭；自建版零遥测。详见 [PRIVACY.md](PRIVACY.md)。

**与察元AI OS 什么关系？** 同家族成员，共用智能体内核与助手库；察元AI Office 可作为 OS 内置插件运行，同机已购 OS 即 Office 免激活。

## 开源与许可

察元AI Office 采用 **Apache License 2.0**（[LICENSE](LICENSE)），唯一例外：`ee/` 目录为未来企业模块预留，适用 [察元AI Office 企业许可](ee/LICENSE)。Apache-2.0 允许商业使用与二次开发。

**上游与致谢**：本套件为持续同步开源上游 **ChaAI Office**（仅 GitHub 仓库致谢）的再分发版。基于 Electron、Univer、PDFium、pdf.js、pdf-lib、Tiptap / ProseMirror、Konva、HarfBuzz（wasm）、calamine、IronCalc 及 Liberation / Carlito / Caladea / Noto CJK 字体家族构建——完整清单见 [CONTRIBUTING.md](CONTRIBUTING.md) 与生成的第三方声明。

**品牌**：察元 / Chayuan 名称与标志归其所有者（北京智灵鸟科技中心）商标。分叉请使用自有品牌。本产品与任何同名的公共开源项目无关联。

## 安全与隐私

安全态势（渲染进程沙箱、IPC schema 校验、外链协议白名单、无硬编码密钥）与 AI 生成内容威胁模型见 [SECURITY.md](SECURITY.md)；完整数据与事件披露见 [PRIVACY.md](PRIVACY.md)。

## 文档地图

- [llms.txt](llms.txt) — LLM 可读仓库摘要
- [docs/user-tutorials/](docs/user-tutorials/) — 47 篇图文教程（安装上手 / 六编辑器 / AI 能力 / CLI / MCP / 知识库 / 授权）
- [docs/COMMANDS.md](docs/COMMANDS.md) — CLI 命令逐条参考
- [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) · [PRIVACY.md](PRIVACY.md) · [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- [docs/images/](docs/images/) — README 截图素材（可整目录复制到其他项目）
