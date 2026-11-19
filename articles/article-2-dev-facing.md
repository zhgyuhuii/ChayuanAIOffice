# 让 Claude Code 替你改 Word：拆解一个开源 AI Office 的字节保真架构与智能体接口

> 本文面向开发者与智能体工具链玩家，约 4000 字。不聊界面好不好看，聊三件事：它怎么做到改 docx 不毁版式，怎么让 AI 的改动可审可回退，以及怎么把自己的 Office 文件交给 Claude Code / Codex / Cursor 批量处理。

## 一、从一个脏活说起：让程序"改"Office 文件

任何一个写过办公自动化脚本的人都踩过这些坑：

- 用 python-docx 打开一份 docx 再保存，样式表被重新序列化，Word 打开一看，页眉页脚、主题字体、编号定义全漂了；
- 想改 PDF 里一个错别字，发现 PDF 的内容流是压缩过的、字形是子集嵌入的，最后只能用编辑器画个文本框盖上去——上层是新的字，下层错字还在；
- 想让 GPT 帮忙处理报表，只能把数据导出成 CSV，改完再想办法弄回 xlsx，格式和公式全丢。

这些问题的共同根源是：**绝大多数工具把"打开 → 全量重建 → 保存"当成处理 Office 文件的默认路径，而 OOXML / PDF 的真实复杂度决定了全量重建必然有损。**

[察元AI Office（Chayuan AI Office）](https://github.com/zhgyuhuii/ChayuanAIOffice)是一个 Apache-2.0 的开源 AI 办公套件（docx / xlsx / pptx / 真文本 PDF / Markdown / HTML 六编辑器，Electron 桌面应用，支持 Windows / macOS / Linux / 麒麟 UOS），它在架构上正面回答了上面三个问题。下面按"文件引擎 → AI 层 → 智能体接口"三层拆。

## 二、项目全景

仓库是一个 npm workspaces monorepo，TypeScript 为主、Rust 做文件引擎重活：

```
apps/          docs · sheets · slides · pdf · markdown · html   (六编辑器)
               shell (Electron 宿主) · web (浏览器宿主) · server (BFF)

packages/      引擎与转换器：docx-engine · pptx-engine(+ops/render) ·
                 pdf2docx · html2docx · odf2ooxml · ppt2pptx · doc2docx ·
                 hwp2docx · compound-file · zip-gate · file-parse · pipelines
               表格：xlsx-gateway (Rust sidecar, calamine + IronCalc)
               AI 层：agent-core · ai-provider · ai-host · ai-search · chart-kit
               共享件：cli · ribbon · ui · i18n · font-metrics · project-store ·
                 service-core · storage-adapter · web-bridge · electron-utils …
```

9 个应用、31 个共享包。同一套编辑器引擎有**四种部署形态**：① 独立 Electron 桌面应用；② 浏览器 SaaS（web 宿主 + Fastify BFF，Docker 一键起）；③ 云桌面内置插件；④ dsh web 插件（模型与知识库经宿主 harness 提供）。仓库门禁跑着约 1.96 万条 vitest 用例与 326 项 Rust 测试，另有 Playwright e2e。

## 三、核心设计：字节保真 docx 往返

这是整个项目最值得学的部分，README 里称为"**原文件是唯一事实源**"哲学。流程如下：

```
打开 docx ─► 按哈希归档原件（永不改动）
          ─► docx-engine 解析 word/document.xml 顶层块
          ─► 块树：每块锚定 docxIndex + 原始 XML 切片
保存      ─► 脏块 → OOXML 片段（只引用既有样式）
          ─► 拼回原 document.xml（未触碰块保持原字节）
          ─▸ 重打包 zip；其余条目逐字节复制
```

关键决策有三个：

1. **归档原件，永不重写**。打开文件时先按哈希把原件存档，之后所有操作都基于"原件 + 补丁"的模型，而不是"内存模型 + 序列化"。
2. **块树锚定原始字节**。解析 `word/document.xml` 时按顶层块切树，每个块同时持有逻辑位置（docxIndex）和物理字节（原始 XML 切片）。编辑只标记块为"脏"。
3. **保存即拼装**。脏块重新生成 OOXML 片段（并且只引用文件里既有的样式，不引入新样式定义），未触碰的块直接用原始切片回填，zip 里其他条目（样式表、主题、页眉页脚、媒体、字体）逐字节复制。

效果是可验证的：编辑保存后用 Word / WPS 打开，未触碰部分的版式逐字节一致。这个思路同样贯穿 Sheets 和 Slides——编辑以窄补丁落盘，往返中"没碰过的东西原样幸存"。

对做文档处理的开发者来说，这套模型还有一个隐性红利：**块级的 docxIndex 天然就是可寻址的编辑坐标**。后面 AI 层的"就地改写"、CLI 的结构化编辑 ops，全都架在这个坐标系统上——文件引擎和上层能力是同构的，不是两套各改各的体系。

## 四、真文本 PDF 与 Rust 引擎族

### PDF：重写内容流，不是贴图

PDF 编辑器经 **PDFium（wasm）**重写页面内容流、保留原字体——改的是真文字，不是注释遮盖。配套能力也按"物理操作"的思路做：涂黑（Redaction）是物理删除被涂黑内容并生成副本，不是画黑框；扫描页 OCR 走系统引擎（macOS Vision / Windows OCR）后台识别，结果成为可搜索可选择的真文本层；`.p12` / `.pfx` 证书签名与验签、Bates 编号、拆分合并都是本机完成。

### 表格：Rust sidecar

`.xlsx` 导入导出走独立的 Rust 引擎（`xlsx-gateway`，基于 calamine + IronCalc），公式与格式高保真，以 sidecar 形态与 TS 层通信。

### 转换器族

`packages/` 下的转换器覆盖了常见迁移路径，**全部本地执行**：

- `pdf2docx`：PDF → Word，字符级提取 + 几何版面分析重建版式；
- `html2docx`：HTML → 原生 Word 文档；
- `odf2ooxml`：`.odt` / `.odp` 等 LibreOffice 文件本地转换导入；
- `ppt2pptx` / `doc2docx` / `hwp2docx`：老格式与韩文 HWP 的迁移；
- `compound-file`：OLE 复合文档（老 Office 二进制格式）的处理；
- `zip-gate`：zip 重打包的字节级把关。

另有一个容易被忽略的硬核包：`font-metrics`——字体度量与 Word 一致，配合 HarfBuzz（wasm）做 CJK 复杂文字排版与字体子集化。跨套件排版不漂移，靠的就是这类"基础设施层"的对齐。

## 五、AI 层：BYOK 网关 + 可审计的就地改写

AI 相关拆成四个包：`agent-core`（智能体内核）、`ai-provider`（供应商接入）、`ai-host`（宿主服务）、`ai-search`（联网检索）。

**供应商网关**：94 家供应商目录（国内 29 / 国际 34 / 本地 9 / 聚合 22），28 个适配器、5 种 API 协议，支持自定义 OpenAI 兼容端点。设计上按**能力维度**路由——对话、生图、媒体理解、搜索可以分别指定不同厂商。Ollama / LM Studio / vLLM 等本地端点免 Key 直连，内网/离线环境可用；Key 只存本机，支持环境变量间接引用。

**就地改写的工程化**是 AI 层最值得细看的部分。"AI 编辑打开的文档"要可用，难点不在调用模型，在于：

- **锚点迁移**：AI 的编辑指令基于文本锚点定位，但文档会变——用户一边改、AI 一边写时，锚点必须跟随编辑自动迁移，否则改错位置。项目为此做了锚点跟随机制；
- **队列与限流**：编辑队列上限 10 条、单条指令 ≤500 字，防止模型输出冲垮文档状态机；
- **确认门**：长文流式写作（上限 20 万字）草稿以 300ms 节奏流入草稿区，用户确认后才落正文；
- **落成修订**：AI 的改动可以直接落成 Word/WPS 标准修订（Track Changes），逐处接受/拒绝——可审计性直接复用了 OOXML 原生机制，而不是发明一套私有标记。

还有两个安全相关的细节：右键"对 AI 隐藏"用 `{{占位}}` 语法把选中内容屏蔽出模型视线（Docs / Slides / Markdown / HTML 均支持）；文档脱密用"AI 提取 + 9 类正则 + §token 占位 + AES-256-GCM 备份"做可逆脱敏。内置 4576 个领域助手 / 229 个领域包，本质上是结构化的提示词资产库，与五端助手库（sheets 102 / slides 100 / pdf 100 / markdown 100 / html 130）同源。

## 六、智能体接口层：CLI + MCP + Skill Installer

这是对 AI 编程工具用户最实用的部分。项目把引擎能力无头化，暴露了三层接口：

### 1. `chaoffice` CLI（17 个子命令）

在应用自带的 Node 运行时上无头运行，与编辑器共享同一套引擎：

```bash
chaoffice convert in.pdf out.docx      # PDF → Word，全本地
chaoffice convert report.docx out.pdf
chaoffice convert data.csv data.xlsx   # csv → xlsx（图表友好）
chaoffice docs apply report.docx --ops '[...]'   # 结构化批量编辑
chaoffice render deck.pptx --out pages/          # 逐页渲染 PNG
chaoffice info report.docx --json                # 文件信息，机器可读
```

面向自动化的设计点：全命令支持 `--json`，稳定退出码与错误码（`unknown_op` / `target_not_found` 等）；`apply --ops` 默认原子提交，`--best-effort` / `--stop-on-error` 返回 `partial` 状态与计数——这些是为 CI 流水线和智能体重试逻辑准备的语义。审计日志自动脱敏 API Key。

### 2. MCP Server（29 个工具）

```bash
chaoffice mcp                     # stdio
chaoffice mcp --http --port 52588 # Streamable HTTP
```

桌面壳内也可直接开：设置▸集成▸本地 MCP 服务（托管于 `127.0.0.1:52588`）。工具集覆盖创建、读取、结构化编辑、格式转换，含 deck 族和 `open-documents` 族——**能编辑正在打开的标签页**，这点在"人机同屏协作"场景里很关键。它还能反向作为 MCP 客户端挂载第三方 MCP 服务（HTTP / SSE / stdio，注册、验证、注入首页对话）。

### 3. Agent Skill 一键安装

```bash
chaoffice skill install
```

自动探测并写入 7 种 AI 编程工具：**Claude Code、Codex CLI、Cursor、Gemini CLI、GitHub Copilot CLI、OpenCode、Windsurf**（7 态状态机、安装台账、支持更新与卸载）。装完直接对智能体说"把这两个季度的报表合并成一个 xlsx 并加图表""把这份 PDF 转成 Word 再校对一遍"——智能体经 CLI / MCP 在本机完成，文件不出机器。

三层接口的关系：Skill 是给智能体的"说明书"，MCP 是结构化工具协议，CLI 是底层执行器。共享同一引擎意味着智能体看到的行为和人在编辑器里看到的一致。

## 七、工程质量与安全姿态

几个可验证的工程细节：

- **测试规模**：全仓门禁含约 1.96 万条 vitest 用例、326 项 Rust 测试、Playwright e2e；
- **i18n**：22 种界面语言即时切换，且有专门的工具链校验（帮助文档多语言一致性检查等）；
- **安全**：渲染进程沙箱、IPC schema 校验、外链协议白名单、无硬编码密钥，AI 生成内容的威胁模型单独成文（`SECURITY.md`）；
- **隐私**：官方包仅匿名使用统计（不含文档内容/文件名/路径/身份），可一键关闭；自建版零遥测（`PRIVACY.md`）；
- **可靠性**：自动保存原子写、崩溃恢复、会话恢复。

## 八、跑起来 & 参与

```bash
git clone https://github.com/zhgyuhuii/ChayuanAIOffice
cd ChayuanAIOffice && npm install
npm run dev          # 六编辑器 + Electron 壳
npm run build:all    # 全量构建
npm run dist:mac     # / dist:win / dist:linux 打安装包
npm run dev:web      # 浏览器形态（BFF + Web 宿主 + 五编辑器）
```

许可为 Apache-2.0，唯一例外是 `ee/` 目录（未来企业模块，独立许可）。上游基于 Electron、Univer、PDFium、pdf.js、pdf-lib、Tiptap / ProseMirror、Konva、HarfBuzz（wasm）、calamine、IronCalc 等开源组件构建，仓库内有完整致谢清单。应用内 F1 有 47 篇图文教程，`docs/COMMANDS.md` 是 CLI 逐条参考。

## 结语：办公软件的"智能体就绪"

大多数人评价 Office 套件看的是编辑器完成度，但这个项目让我觉得有意思的地方在另一条线上：**它把 Office 文件变成了一种智能体可以可靠操作的"API 表面"**——

- 文件引擎提供字节级的可寻址坐标（块树），AI 的编辑因此可以精确、可审计、可回退；
- CLI / MCP 把同一套引擎暴露成机器接口，人类编辑器和智能体跑在同一个引擎上，所见即所得；
- 本地优先的执行模型（转换、OCR、脱密全在端侧），让"让 AI 碰我的文件"这件事有了不联网的选项。

如果你在做办公自动化、智能体工具链，或者只是想给 Claude Code 配一套能真改 Office 文件的工具，`chaoffice mcp` + `chaoffice skill install` 这条链路值得直接上手试。仓库地址：<https://github.com/zhgyuhuii/ChayuanAIOffice>，官网下载：<https://aidooo.com/>。
