# README 重写工作计划 —— 察元AI Office（Chayuan AI Office）

> 状态：大纲已获项目所有者批准（8 轮决策问答共识）。**本文件是唯一执行依据**，
> 新会话按 §5 执行顺序照做即可，无需重新问答；除 §0 列明的共识外不得重开决策。
> 本文件同时镜像于 /Users/zyh/work/chayuan-ai-office/docs/README-REWRITE-PLAN.md。

## 0. 已锁定的共识（不得重开）

| # | 决策点 | 结论 |
|---|--------|------|
| 1 | 开源口径 | 如实开源：Apache-2.0 + `ee/` 企业目录例外；如实致谢上游 ChaAI Office 并说明持续上游同步（已至第十六轮）。公开仓库 `zhgyuhuii/ChayuanAIOffice` 真实存在，README 以仓库事实为准；官网营销页不挂 GitHub 链接与仓库开源不矛盾 |
| 2 | 官网 | **https://aidooo.com/** （已验证在线，察元产品家族首页）。`chaoffice.ai` 是他人产品（Pitchbar），任何指向都禁止出现 |
| 3 | 家族命名 | 严格官网口径卡（`/Users/zyh/work/website/src/config/productFacts.js`）：**察元AI OS / 察元AI Office / 察元AI工舱 / 察元AI文档助手 / 察元AI指挥调度平台（必须带「研发中」）**。旧名一律不上 README：察元AI超级智能体、察元WPS、ChaOffice、ChaAI Office。命名红线：中文产品名「察元AI+X」连写无空格；「察元AI OS」「察元AI Office」英文后缀保留空格不得连写；产品全名必须带 AI |
| 4 | 察元AI共仓 | = 察元AI工舱 = `/Users/zyh/work/chatop-os`（浏览器云桌面·数字员工工作站，GPL-2.0，Docker 镜像 `cmdbird/chatop:latest` 纯文本提及、不放未验证链接） |
| 5 | 家族章节深度 | 五产品表 + 每产品一段简介；chayuan-ex（察元AI表格助手，WPS 表格加载项）并入「察元AI文档助手」条目一句带过；chayuan-bot、chayuan-desktop-own（已归档 Tauri 单机版）不写 |
| 6 | 双语形态 | **英文主体 + 中文章节**：README.md 英文正文在前，后接「简体中文」章节，中文为同结构完整镜像（非缩水摘要），含中文关键词表 |
| 7 | docs/i18n 旧翻译 | 16 国旧品牌翻译**保留但不索引**：README 不链它们，不删不改（上游同步件）；新 README 语言行只保留 English / 简体中文锚点 |
| 8 | 关键词组织 | aidooo.com 首页 SEO 关键词**全量入一张双语总表**，加「所属产品」列归位守不失实底线（含下述待补词） |
| 9 | 品牌残留清理 | 删 "world's first"（上游 ChaAI Office 宣称）；删上游 YouTube 演示视频（B2pLdMX95v4）；删 "Mainfunc, Inc." 商标段（上游遗产）；版本号一律不写死，用 Releases 链接 |

## 1. 品牌与事实速查（写作时直接引用，全部已核实）

- **本仓（开发仓）**：`/Users/zyh/work/chayuan-office`，remote `git@github.com:zhgyuhuii/chayuan-office.git`（私有）
- **公开仓**：`zhgyuhuii/ChayuanAIOffice`（描述「察元AIOffice 察元办公套件」，公开、活跃）→ 徽章 / Release / Downloads 全指这里
- **推送检出**：`/Users/zyh/work/chayuan-ai-office`（同 remote 的另一份检出；SSH 已验证 zhgyuhuii 可推送）。**注意**：其中已有一批未提交的品牌改动（M README/PRIVACY/SECURITY/图标等，最近提交停在「品牌全面统一为 ChaOffice」）——执行时先 `git status` + `git diff` 审阅那批改动是什么，**只提交本任务相关文件**（README.md + docs/assets/readme/**），存量改动不动、不混提，除非所有者明确指示
- **上游**：ChaAI Office（`genspark-ai/chaoffice`，官网 genoffice.ai）。本仓为下游再品牌化发行版；`upstream` remote 指向 `/Users/zyh/work/genoffice`。致谢段可链上游 GitHub 仓库，**不链 genoffice.ai**
- **品牌 ↔ 代码标识对照**（LLM Quick Facts 必写）：对外品牌=察元AI Office / Chayuan AI Office；CLI=`chaoffice`；npm scope=`@chaoffice`；用户数据目录=`~/.chaoffice`；打包名历史上为 `chaoffice_<v>_amd64.deb` 等。代码标识如实保留，README 提供对照表说明
- **AI 账号叙事**：UI 已把 Genspark 品牌化为「察元AI Office 账号」（`apps/shell/src/renderer/src/strings.ts`：accountGenspark='察元AIOffice 账号'）。README 功能叙述写「内置账号登录，无需 API key」；Genspark/gsk 仅作为代码层事实出现在工程细节（`packages/ai-search`），不作为对外品牌词
- **apps 全清单**：docs / sheets / slides / pdf / markdown / html 六编辑器 + shell（套件壳）+ web（浏览器宿主）+ server（BFF）
- **packages 全清单**：agent-core, ai-host, ai-provider, ai-search, chart-kit, cli, docx-engine, electron-utils, file-parse, font-metrics, html2docx, i18n, mobile-touch, pdf2docx, pipelines, pptx-engine, pptx-ops, pptx-render, project-store, ribbon, service-core, storage-adapter, ui, web-bridge, xlsx-gateway
- **本仓独有增量（现有 README 完全没写，必须新增）**：docs 的「察元AI」功能区（声明式 schema：`apps/docs/src/renderer/ribbon/schema/chayuan-tab.ts`）——4576 领域助手包 + 核心助手（拼写语法检查/摘要/文本分析全家桶/润色族/会议纪要）+ 安全保密（保密检查 8 类风险/涉密关键词提取/文档脱密/脱密复原）+ AI 痕迹检查 + 表格批量 14 项 + 图像批量 6 项 + 表单模式 + 文本转图像。事实来源：`docs/chayuan-wps-harvest-analysis.md`、`apps/docs/tests/ribbon-chayuan-tab.test.ts`
- **部署四形态**（`docs/PLAN-DUAL-TARGET.md`）：① 自有 Electron 壳（GA，持续发版）② 浏览器 SaaS（apps/web + apps/server，service-core/storage-adapter 已落地）③ chatop 桌面内置插件 ④ dsh web 插件（`dsh-plugin/` 已验证跑通）。**执行时逐项核实再标状态**，拿不准就只写架构不标 GA；chacmd 相关措辞必带「研发中」

## 2. 截图资产（已就位 + 待补拍）

### 已就位（两仓同路径，README 直接相对路径引用）
`docs/assets/readme/screenshots/home.png`（主页，**注意：tab 标签仍是旧品牌 ChaOffice**）
`docs/assets/readme/screenshots/docs-ai-panel.png`（docs 编辑器 + AI 面板，空文档态）
`docs/assets/readme/cli-deck-in-app.webp` `cli-integrations.webp` `cli-slides-grid.webp` `mcp-deck-in-app.webp` `mcp-deck-motion.webp` `mcp-integrations.webp`（上游时期 CLI/MCP 图，**用前先看品牌是否穿帮**）

两仓均已落位：`/Users/zyh/work/chayuan-office/docs/assets/readme/` 与 `/Users/zyh/work/chayuan-ai-office/docs/assets/readme/`。

### 待补拍清单（缺失 → 必须重截，文件名固定，拍一张同步两仓同路径）
| 文件名（放 docs/assets/readme/screenshots/） | 内容要求 |
|---|---|
| `home.png`（替换） | 当前察元AIOffice 品牌 UI 的主页，左侧项目树有真实项目，不空态 |
| `docs-hero.png` | docs 打开有正文/表格/图的 .docx，显示「察元AI」功能区 tab + AI 面板（批注或修订可见） |
| `sheets-hero.png` | 表格含数据 + 图表 + 条件格式 |
| `slides-hero.png` | 演示文稿（母版/版式可见，非空白页） |
| `pdf-hero.png` | PDF 真实文本编辑态（段落选中重排，非注释覆盖） |
| `editor-tabbar.png` | 多编辑器标签页构图（参考旧图 `brand-samples/screenshots/04-editor-tabbar.png`，修复其黑屏问题） |
| `dark.png` | 暗色主题整窗（文档面保持白纸，体现「暗色 chrome + 白纸」设计） |

**拍法**：`npm run dev` 起开发环境（或 `npm run dist:mac` 出包用正式壳）；窗口 ≥1440×900、2x 导出 PNG、单张 ≤300KB（pngquant 压缩可选）；macOS `screencapture -l<windowid>` 截窗，或按 `scripts/drivers/README.md` 本地自备 Playwright 驱动（该目录默认不入库，当前不存在）。`docs/screenshots/` 与 `brand-samples/screenshots/` 的存量图多为流程中间态/黑屏/旧品牌，**只有已就位那两张可用，其余不要直接搬**。

## 3. README.md 写作规格（15 节，英文主体 + 中文章节）

### 头部
- 标题：`察元AI Office · Chayuan AI Office`；一句话定位（AI-first 办公套件，真实 OOXML/PDF 格式，本地优先）
- 徽章：License Apache-2.0 / Release / Downloads → `zhgyuhuii/ChayuanAIOffice`
- 导航行：Download · [Website](https://aidooo.com/) · Product Family · CLI · MCP · Privacy · Security
- **LLM Quick Facts 块**：这是什么仓库 / 规范名（察元AI Office = Chayuan AI Office）/ CLI `chaoffice`、npm `@chaoffice`、目录 `~/.chaoffice` 对照 / 基于 ChaAI Office 上游持续同步的下游发行版（非 ChaAI Office 官方）/ 官网 aidooo.com / 与 Genspark、chaoffice.ai 无关联
- hero 图：`docs/assets/readme/screenshots/home.png` + `<img width="49%">` 双列四宫格（docs/sheets/slides/pdf heroes）

### 正文 15 节
1. **What is Chayuan AI Office** —— 吸收现定位段（真实格式、六编辑器一引擎层、字节保真哲学），去 "world's first"
2. **Key capabilities** —— 现有功能点全保留（真实 PDF 编辑/本地 PDF→Word·PPT·Excel/扫描件 OCR/字节保真 docx/Word 级分页/Rust xlsx sidecar/自研 pptx 引擎/Markdown），**新增**：察元AI 功能区（§1 增量清单）+ chaoffice CLI + MCP server + agent skill（Claude Code/Codex/Cursor 集成）+ 账号登录与 BYOK（Claude/OpenAI/Gemini/DeepSeek/Kimi/GLM/Qwen/Doubao/MiniMax/Grok/Mistral/OpenRouter + OpenAI 兼容端点含本地模型）+ 主题
3. **Chayuan product family** —— 五产品表，列：产品（中英）/ 定位 / 形态 / 状态 / 开源 / 入口（aidooo.com 锚点）；每产品一段简介；文档助手条目带 chayuan-ex 一句；指挥调度平台带「研发中」；OS 暂未开源不暴露代码链接；工舱写 GPL-2.0 + 镜像名；本仓条目链 GitHub
4. **Architecture** —— apps/*（含 html/web/server）+ packages/* 全清单分组（文档引擎/PDF 转换/AI 层/共享基础）+ dsh-plugin + 四形态部署架构 + docx 字节保真往返 ASCII 图（保留原图）+ 「原文件是唯一事实源」哲学段
5. **Download** —— 现平台表格保留（链 ReleasesLatest），加官网下载入口 aidooo.com
6. **Command line & agent skill** —— chaoffice 命令面收紧版 + `chaoffice skill install` + 集成面板（Settings → Integrations）
7. **MCP server** —— stdio / Streamable HTTP 两种接法
8. **Development** —— 现命令保留（fixtures/test/typecheck/dev/dist:*，Rust toolchain 说明）
9. **Keywords（SEO / LLM retrieval）** —— 双语总表，列：关键词（中）/ Keyword（EN）/ 所属产品。全量收录 aidooo.com 首页词：察元AI、察元AI工舱、AI工舱云桌面、数字员工、本地AI工作台、断网可用AI、离线大模型、本地部署大模型、国产大模型、DeepSeek、RAG知识库、WPS AI助手、WPS加载项、AI文档助手、公文写作、合同审查AI、AI校对、保密检查、AI视频生成、数字人、OCR、语音转文字、Chayuan、政企私有化部署、麒麟/UOS 国产化适配 + 本仓词：AI Office 套件、开源 AI Office、字节保真 docx、PDF 转 Word、本地 Office 引擎、chaoffice CLI、MCP、桌面办公套件。旧名「察元AI超级智能体」不入表（共识 3），对应行写察元AI OS
10. **FAQ** —— 更新：是否开源（是，Apache-2.0+ee 例外）/ 离线能力 / 与 Microsoft Office、WPS 的关系（打开保存真实格式；文档助手是 WPS 加载项）/ 家族产品关系 / 数据收集（现 PRIVACY 表述保留）
11. **Security** —— 链 SECURITY.md，保留进程沙箱/IPC 校验/AI 内容威胁模型表述
12. **Upstream & Acknowledgements** —— 上游 ChaAI Office 致谢段（链 GitHub 仓，不链 genoffice.ai）+ 现 Electron/Univer/PDFium/pdf.js/Tiptap/Konva/HarfBuzz/calamine/IronCalc/字体 致谢保留
13. **License** —— Apache-2.0 + `ee/` 企业例外（ChaAI Office Enterprise License 文件名如实引用）；商标段改写：察元/Chayuan 品牌归项目所有者；ChaAI Office/GenSpark 商标归其各自所有者；删除 Mainfunc, Inc. 段
14. **Privacy** —— 链 PRIVACY.md，保留分析数据口径
15. **简体中文** —— 同结构完整镜像：定位/家族/功能/架构/下载/CLI/MCP/开发/中文关键词表/FAQ/许可；语言行仅 English · 简体中文（不索引 docs/i18n）

### 嵌入语法
全部相对路径：`![察元AI Office 主页](docs/assets/readme/screenshots/home.png)` —— 两仓同路径，GitHub 双仓皆可渲染。

## 4. 目标产物与落位

| 产物 | 路径 |
|---|---|
| 新 README（主） | `/Users/zyh/work/chayuan-office/README.md` |
| 新 README（推送检出） | `/Users/zyh/work/chayuan-ai-office/README.md`（cp 同步） |
| 截图/资产 | 两仓 `docs/assets/readme/` 同路径（已就位 + §2 补拍） |

## 5. 执行顺序（新会话照做）

1. **补拍截图**（§2 清单）：起应用 → 逐张截 → 压缩 → cp 两仓同路径；旧 `home.png` 被替换
2. **写 README.md**（§3 规格）→ 落 `/Users/zyh/work/chayuan-office/README.md`
3. `cp` README.md → `/Users/zyh/work/chayuan-ai-office/README.md`；补拍图已同步则跳过
4. **红线校验**（§6）逐项过，不过不改完
5. **chayuan-ai-office 提交推送**：先 `git status`/`git diff` 审存量改动 → 只 add 本任务文件（README.md + docs/assets/readme/**）→ commit（品牌口径写「察元AI Office README 重写」）→ push origin main。SSH 已验证可推。chayuan-office 仓是否提交推送听所有者现场指示
6. 回报：GitHub 网页渲染核验（`gh` 不在环境，用 `curl https://api.github.com/...` 或读渲染页）

## 6. 红线校验清单（写完必过）

- [ ] `chaoffice.ai`、`genoffice.ai` 链接零出现（Genspark 仅作代码层事实、不作对外品牌词）
- [ ] 旧品牌零出现：ChaAI Office / ChaOffice / 察元WPS / 察元AI超级智能体 / Mainfunc（ee/LICENSE 文件本身不动，README 不提）
- [ ] 五产品名与口径卡逐字一致（空格规则：察元AI工舱/察元AI文档助手连写；察元AI OS / 察元AI Office 留空格）
- [ ] 察元AI指挥调度平台每次出现都带「研发中」
- [ ] 关键词总表覆盖 aidooo.com 首页全量词（除禁用旧名），双语，含所属产品列
- [ ] 察元AI 功能区/CLI/MCP/四形态架构等本仓增量全部写入
- [ ] 中文章节与英文主体信息对等（非机翻缩水）
- [ ] 所有链接逐一 `curl` 验通（aidooo.com、github.com/zhgyuhuii/ChayuanAIOffice/releases、上游 GitHub 仓）；相对路径文件两仓同位置存在
- [ ] 版本号零硬编码；YouTube 链接、"world's first" 零出现
- [ ] 截图为新品牌 UI（home.png 替换后不得再出现 ChaOffice 字样）

## 7. 明确不做

- 不动 `docs/i18n/**`（保留不索引）；不动 `ee/LICENSE`；不改 website 项目
- 不重命名代码标识（chaoffice / @chaoffice / ~/.chaoffice / chaoffice_*.deb）
- 不动 chayuan-ai-office 存量未提交改动（只提交本任务文件）
- 不在本任务里改 UI 文案/代码——只写 README 与准备截图资产
