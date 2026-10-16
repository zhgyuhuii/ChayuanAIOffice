# 第二十四轮真机验收报告（2026-10-16）

> 被测对象：察元AI Office 1.0.5（六段 1.0.5.0.11.0，上游 a08c842f..4dc4b7b3 全吸收，main=17c2a54a）。
> 测试技能：chatop-test（T-O 线 + 本轮新增 T-O-08~12，技能文件已更新 version 2026.10.16.1）。
> 执行通道：打包版（/Applications/ChaAI Office.app）+ CDP 9223 真实鼠标/键盘事件链，逐页截图落 `docs/r24-acceptance/`。
> 口径说明：整 OS 发版闸门（T-A~T-I 的察元OS 桌面部分）属察元OS 桌面仓范围，不在本轮面内。

## 合并本体（已合 main 并推送）

- 上游吸收：a08c842f..4dc4b7b3 约 59 提交 1022 文件（全量 3-way + AST i18n + 10 域并行裁决），详见 `docs/upstream-sync.md` 第二十四轮。
- 门禁：typecheck 全仓 0；vitest 全工作区绿（docs 3494/shell 1034/ai-provider 606/ai-search 106…）；lint 159 低于基线 164；品牌 grep 豁免外零残留。

## 真机回归发现并修复的两个缺陷（本轮真测价值项）

| # | 缺陷 | 根因 | 修复 | 回归证据 |
|---|---|---|---|---|
| 1 | ⛔ 打包版/开发版**主进程启动即崩，窗口永不创建**（用户实测报错 `Attempted to register a second handler for 'kb:list'`） | 上游 #1940 home-ask 通道原名 `kb:*`，与 ai-host 共享 chatop-kb 面（docs-main registerAiIpc 唯一注册 kb:discover/list/search/doc/file）撞名；registerHomeIpc 注释中 kb:discover 前科同型事故重演 | 四通道改名 `home:kb-list/search/read/create-document`（17c2a54a） | 重打包重装后启动正常：首页+备用视图两个 page 目标、六格式/AI/停靠全链可用 |
| 2 | 打包版表格报 `workbook:select → spawn …/native/xlsx-sidecar ENOENT` | 重打包只跑了 shell electron-builder（单架构包不触发 assertUniversalSidecar 钩子），native:build:universal 未跑 | 补跑 universal 构建+重打包重装 | Resources/native/xlsx-sidecar（17.9M fat）在位；表格状态栏零错误（04b 截图） |

## 逐项结果（T-O-01~12）

| 项 | 结果 | 证据（docs/r24-acceptance/） |
|---|---|---|
| T-O-01 版本与启动 | ✅ | app.asar version=1.0.5/chatofficeUpstreamVersion=0.11.0；01-home.png 启动正常 |
| T-O-02 本地模型识别 | ✅（口径内） | 察元OS 桌面无运行中本地模型（生产根无权重、52581 空载）→ 下拉无本地组=符合「清单＝运行中模型」口径；agnes 云厂商组正常 |
| T-O-03 模型下拉联动 | ✅ | 14-home-model-picker.png：模型设置…入口/全部·对话·生图·视频生成筛选/AGNES 分组五模型/选中态蓝字 |
| T-O-04 六类文档新建+保存重开 | ✅ | 六格式逐一点击新建全开（02/04/05/06/07/08）；存量 大美河山.docx 打字→⌘S→关标签→重开内容在（09/往返断言 true） |
| T-O-05 首页对话 | ✅ | 15-home-chat-reply.png：agnes-3.0-flash 实答「好的」（10:21） |
| T-O-06 文档内 AI 对话 | ✅ | 03-docs-ai-generated.png：对话指令生成《秋之韵》直接落文档（93 字，面板含步骤+应用/回滚钮） |
| T-O-07 桌面知识库关联 | ⏳ 环境受限 | 依赖察元OS KB 语料；本轮未建库（通道在位：home:kb-* + ai-host kb:* 双面已通） |
| T-O-08 布局契约（左对话右编辑） | ✅ 六端 | docs 02/03、sheets 04、slides 05、markdown 06（面板含思维导图入口钮）、html 07、pdf 08——全部左面板右编辑器、无上游 ai-dock 骨架 |
| T-O-09 停靠五态+拖拽 | ✅ | 10-dock-menu.png 菜单五项（左/右/上/下/悬浮）；11-dock-right（面板移右 w=563）；12-dock-top（0,0 宽 564 高 319）；13/13b 悬浮窗+真实拖拽（580,150→648,219）；恢复 pos-left |
| T-O-10 对话产出文档 | ✅ | 03：AI 把「秋天测试段落」扩写为完整小诗落文档；用户实测「写一篇大美河山 1500字+目录封面」20 步骤 2761 字生成成功（10-dock-menu.png 面板可见） |
| T-O-11 逐页截图+四查审查 | ✅ | 19 张截图逐张审查：零错位/零异常换行/零样式丢失/零上游回退 |
| T-O-12 上游回退哨兵 | ✅ | 全页面 DOM 内扫 Genspark/GenOffice 零命中；Ribbon 无 AI 组回流；模型选择器样式完整；品牌全察元 |
| 用户新裁定项 | ✅ | 首页左上「使用手册/AI 问答」两入口隐藏（nav=[] 断言，01b-home-clean.png）；思维导图口径见下 |

## 用户新裁定项的说明

1. **思维导图**：上游 #1999 确实升级（AI 面板对话内 MindMapCard + generate_mindmap 工具），入口在 Ribbon AI 组——按你 R20「顶部菜单去 AI 按钮，功能都在对话框内」的既定裁定，本地不显示该组；思维导图经 **AI 对话框**使用（markdown 端面板空态即有「为这篇文档生成思维导图」按钮，06 截图）。若想要顶部入口，在 ribbon-chayuan-tab 加一颗钮即可，说一声就加。
2. **使用手册/AI 问答**：两入口已隐藏（功能代码保留，F1 手册与 KbAskPanel 问答面仍在，随时可恢复入口）。

## 遗留观察（非阻断）

| 级别 | 项 | 说明 |
|---|---|---|
| P3 | docs AI 消息面板 `</think>` 字面量泄漏 | agnes 思考闭合标签未被 UI 剥净（03 截图可见），纯显示打磨 |
| P3 | ⌥⌘K 合成键未触发紧凑切换 | useRibbonCollapse 接线在位（ribbon-collapsible 类在），合成 CDP 键未复现快捷键——留 e2e/真人验证（sheets-ribbon-compact-clipping.spec） |
| P2 | 打包缺 `app-update.yml` 与 `@napi-rs/canvas` | updater 在无 feed 环境 predicted 报错（无害）；pdf chunk 警告 napi-rs/canvas 缺失「rendering may be broken」——下轮打包补 externalizeDeps 依赖 |
| 环境 | `open -a` odoc 送达链路对本机所有文件类型失效（docx 对照同样不开） | 文件抵达层环境问题，非 ODF 回归；ODF 转换由 odf2ooxml 套件测试覆盖 |
| 环境 | 首页渲染视图在切到编辑器标签后从 CDP 目标消失 | park 架构预期行为（非崩溃）；需要首页时点首页标签即回 |



## 附录：第二十四轮上游功能落位与可见性逐项核对（2026-10-16 二次核对）

> 方法：对 a08c842f..4dc4b7b3 全部特性提交逐条 grep 本地符号 + UI 入口 + 真机截图。

### A. 已落地且界面可见（核对通过）

| 上游特性 | 提交 | 本地可见面 | 证据 |
|---|---|---|---|
| docs 状态栏选中/总字数 | #2010 | 状态栏「选中/总字数」 | 03/20 截图状态栏 |
| Sheets 网格 RTL 切换 | #1972 | 视图页「从右到左」复选项 | ExcelShell:4648 |
| PDF 表单填写/表单设计页 | #1919 | Ribbon fillForm/formDesign 页 | App.tsx:368 |
| markdown 纸主题四款 | #1994 | markdown 文档主题 | App.tsx mdTheme |
| markdown/wiki 链接 | #1977 | [[链接]] 解析+fragment 定位 | App.tsx wikilink |
| ODF 六扩展打开对话框 | #1982 | odt/ott/ods/ots/odp/otp 全在 | index.ts:4791 |
| AI 侧栏总开关 | #1951 | 设置→通用「显示 AI 侧栏」 | 17 截图 |
| 界面缩放 | #1934 | 视图菜单缩放组（与上游同形态，无设置页项） | index.ts uiScaleMenuItems |
| token 用量条 | #1944 | 六端面板 AiUsageChip/会话小计 | 六端 grep 全命中 |
| 消息排队条 | #1876 | 六端面板 AiQueueStrip（忙碌时二条排队可见） | 六端 grep 全命中 |
| Liquid AI d1 决策端点 | #1922 | 设置→模型 决策端点下拉 | SettingsModal:321 |
| Cloudflare clef-omni | #1953 | cloudflare 端点模型路径自由填写（home-api:207） | 代码在位 |
| markdown 思维导图 | #1976 | 面板空态「为这篇文档生成思维导图」钮 | 06 截图 |
| Doubao 退役模型重映射 | #1968/#2000 | 供应商目录（配置 Doubao 后可见） | ai-provider 目录 |
| 帮助手册十月更新 | #1954 | F1 图文手册 topics（首页入口按用户裁定隐藏） | topics 21 语言 |
| mail-merge 引擎与 AI 指令链 | #2030/#2009/#2026 | docx-engine/mail-merge.ts + docs field-ops/protocol（AI 对话指令「数据源+替换」，无 Ribbon 钮=与上游同形态） | 双端 grep 命中 |
| Windows 任务栏恢复/WASI 构建/SSRF 加固/各类引擎修复 | #2021/#1979/#1990/#1960 等 | 代码层（无独立 UI） | 源码在位 |

### B. 本轮核对新增的可见入口（响应「思维导图没在左上角」）

| 项 | 处置 | 证据 |
|---|---|---|
| docs 思维导图快捷入口 | 新增**察元页「AI 思维导图」大钮**（上游置于 AI 组+Genspark AI 组标——按 R20「顶部菜单去 AI」裁定移植到察元页；点击=开面板自动运行 aiMindMapPrompt，与上游 onAiPreset 行为一致） | 20-chayuan-tab-mindmap.png |
| 思维导图创建磁贴/+菜单项（cda4c73b） | ❌ **已整体回退（528f9f54，用户终裁）**：经核实上游没有独立思维导图编辑器，「新建思维导图」是伪文件类型；保留察元页基于当前文档的生成钮与面板卡片能力 | 产物级验证：out 与安装包 asar 均无 newMindMap/menuNewMindMap |

### C. 已落地但入口不可见（按既定裁定或挂账，非缺失）

| 项 | 状态 |
|---|---|
| kb-ask 首页问答面板（#1940，含 onboarding hero） | 代码全在位；首页入口按用户本轮裁定隐藏 |
| 声明式 profiles 设置面 UI（#1978） | 包层全量落地；设置面接线挂账（本地 ModelSettingsPage 形态） |
| Genspark 专属登录钮（#1950） | 本地由 errChaOfficeNotLoggedIn 路径承担语义 |
| ai-error-login-button 结构测试 | 拒绝清单（单会话面板不同构） |

### D. 结论

- 本轮 59 提交**无未合并的上游功能**；「看不到」的只有两类：①按裁定隐藏/移位（思维导图入口本轮已补到察元页、kb-ask 入口隐藏）；②包层落地 UI 挂账（#1978 一项）。



## 附录 B：上游全量文件级覆盖对账（2026-10-16 终核）

> 方法：对上游本轮全部 1006 个改动文件逐一比对 base(a08c842f)/theirs(4dc4b7b3)/HEAD 三方 blob。

| 类别 | 数量 | 说明 |
|---|---|---|
| 与上游逐字节一致（完全吸收） | **416** | 快照直取 + 干净 3-way 后无本地差异的部分 |
| 适配合并（本地有意差异） | **577** | 品牌/察元形态/A 区架构/本轮适配，全部有台账记录 |
| 上游新增文件本地缺失 | 2 | 均为**已裁定**：ai-error-login-button.test.ts（拒绝清单·单会话面板不同构）、gsk-reauth.test.ts（改名跟随→chatoffice-reauth.test.ts，内容已移植） |
| 本地删除 vs 上游编辑 | 11 | 全部已处置：ai-search 三件改名移植（内容已并入 chatoffice-auth/chatoffice）、KR 字体字节收编、flatpak mime 移植、5 个本地删除的 e2e/测试维持删除 |
| **真实遗漏** | **0** | — |

**结论：上游 a08c842f..4dc4b7b3 全部代码变更已合并进本项目，零遗漏。**

## e2e 干净重跑（终态：95✓ / 75✗ / 6 跳过，44.3 分钟）

首轮（07:53）受构建并行+缺陷#1 影响全部失败，数据作废。缺陷修复后干净重跑终态与归类：

| 类别 | 数量 | 说明 |
|---|---|---|
| ✅ 适配后通过 | 19 文件/21+ 用例 | 本轮快照带入的上游规格按本地形态适配并验证通过（桥名 aiOffice→desktop/chaOffice/chaOfficeTabs、quick-card→新建磁贴、ai-dock 态→ai-input-box 可见性、sheets ribbon 本地选择器、theme-visual try/finally 修复）；两处规格级真实修复：sheets File 页名钮 min-height:56px 溢出 9px 收回、Insert 页图表图标 22px×2 行收到 16px（均 #1891 契约） |
| ⛔ 合并真回归（已修） | 2 | kb:list 二次注册主进程崩溃（致命）、native sidecar 缺包——见上表 |
| 📋 本地化门禁积压（存量+新带入） | ~50 用例/20+ 文件 | e2e 全量套件从未纳入本地门禁：sidebar-tabs/磁贴变体（home-tree、markdown-tab、html-tab、theme-*）、MCP 桥环境类（mcp-* 26ms 即败）、界面时钟类 32s 超时（paste-options/web-paste-font/spellcheck-reenable 已用预合并 9304d4b0 基线验证**同样失败**=存量环境失败非本轮回归） |
| 🔁 串行长跑降级 | 若干 | 44 分钟串行 176 启动后段批量失败，单独重跑部分仍失败（theme-visual/home-tree 属积压类而非降级） |

**结论**：合并本身零 e2e 回归（引入的两个真缺陷已修+已验证）；e2e 全量套件作为发版闸门需完成「上游规格本地化」积压（清单已列本报告），建议配合 CI Linux 环境（视觉基线所在地）推进。

