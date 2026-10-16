# chayuan-wps 功能收割：逐项实现分析与适配设计

> 源项目：`/Users/zyh/work/chayuan-wps`（WPS JSAPI 加载项，Vue3 + Vite，v4.1.2）
> 目标项目：本仓 `apps/docs`（Electron + tiptap/ProseMirror 文字编辑器）
> 本文每项 = 原项目实现逻辑（文件/算法/契约）+ 本项目适配设计。施工按此文逐项落地。

## 0. 原项目总体架构（速览）

- **提示词驱动**：全部助手集中在 `src/utils/assistantRegistry.js` 的 `CORE_BUILTIN_ASSISTANTS`（+Extra/P5/P5Plus 约 50 个内置）与 228 个领域包（4526 助手）。条目 schema：`{id,label,icon,systemPrompt,userPromptTemplate,allowedActions,defaultAction,defaultInputSource,defaultOutputFormat,...}`；执行器 `assistantTaskRunner.js`：模板渲染 `{{input}}` → chatCompletion → `applyDocumentAction` 写回（replace/insert/comment/link-comment 等 9 种）。
- **编程操作**：`src/components/ribbon.js`（4402 行）按钮 → WPS JSAPI（`Application.ActiveDocument.Tables/InlineShapes/...`）。弹窗 = `ShowDialog(url)` 打开 Vue 独立路由页。
- **右键菜单**：`public/ribbon.xml` 的 `<contextMenus>`（正文 + 表格单元格），dynamicMenu 由 ribbon.js 动态生成。
- 本仓已迁移 4576 领域助手（`tools/gen-docs-assistants.mjs` → `apps/docs/src/renderer/ai/assistants/packs/`），但**核心内置助手（拼写语法/摘要/文本分析全家/安全保密/文生图视频）不在领域包里** —— 本次收割补齐。

## 1. AI 助手类（提示词驱动 → 本项目「常用助手」核心包）

统一落点：新文件 `apps/docs/src/renderer/ai/assistants/core-builtin.ts`（由 `tools/harvest-core-assistants.mjs` 从 wps 源逐字收割生成，domain=`core`，浏览器分组「常用助手」置顶）。运行走既有 `buildAssistantInstruction` → AiPanel agent loop。

### 1.1 拼写与语法检查（spell-check）
- **wps**：registry L405-442；system=资深中文校对专家（JSON 输出）；user=11 条规则（text 必须原文连续片段/suggestion 最小改正/prefix·suffix 各≤12 字符/只报语言错误/无问题返回 `{"issues":[]}`）。独立管线：分块 6000 字 → 并发检查 → 质量分级 → 逐条锚定写 WPS 批注（`${reason}: 建议改为「${suggestion}」`）。
- **适配**：defaultAction=`comment`、outputFormat=`json`。本项目 agent 已有 `add_comment` 工具（anchorText 逐字锚定，支持表格 cell 定位），`build-instruction` 的 comment 指令升级为「逐条用 add_comment 落批注」——批注写回保真，无需独立管线（长文分块由 agent 的 read_blocks 机制覆盖）。

### 1.2 生成摘要（summary）
- **wps**：registry L443-474；一句话结论 + 3-6 条要点（背景/核心信息/风险/建议动作）+「原文未说明」标注；defaultAction=none。
- **适配**：原样收割，none 动作=对话输出。

### 1.3 文本分析 9 项（menuTextAnalysis + 右键主列表合并收割）
| 功能 | wps id | 动作 | 提示词要点（原文收割） |
|---|---|---|---|
| 换种方式重写 | analysis.rewrite | replace | 保持原意/自然流畅/结构清晰/不加新事实 |
| 扩写 | analysis.expand | insert | 补背景细节例子论据/不夸张不编造 |
| 缩写 | analysis.abbreviate | replace | 保留关键信息/删冗余/可直接使用 |
| AI 痕迹检查 | analysis.ai-trace-check | comment | 7 检查维度+保守研判+命中片段 8~40 字逐字锚定+Markdown 模板（高/中/低疑似三档） |
| 检查段落序号格式 | analysis.paragraph-numbering-check | link-comment | 序号体系统一/全半角混用/跳号重号/引用原文片段/建议统一规则 |
| 批注解释 | analysis.comment-explain | link-comment | 核心含义+歧义风险+可直接写入批注 |
| 超链接解释 | analysis.hyperlink-explain | link-comment | 概念或引用对象+建议查阅方向 |
| 提炼关键词 | analysis.extract-keywords | insert(bullet-list) | 5-12 个，主题/主体/动作/风险/时间/数字 |
| 纠正拼写和语法 | analysis.correct-spell | — | wps L1553 已过滤禁用（spell-check 管线覆盖），不收割 |

### 1.4 右键文本分析补充项（润色族，registry L1260-1500）
润色优化/polish(replace)、正式化改写/formalize(replace)、通俗化改写/simplify(replace)、提取行动项/action-items(insert)、提取结论与风险/risks(insert)、术语统一/term-unify(replace)、生成标题/title(insert)、段落结构优化/structure(insert)、生成会议纪要/minutes(insert)、政策公文风格改写/policy-style(replace)。全部逐字收割。

### 1.5 保密检查（analysis.security-check）
- **wps**：registry L892-1007；8 类风险（密级标识/涉军涉装/单位身份/人员联络/时间地点部署/内部编号/经营敏感/军工高频线索）+ 关键词线索表 + 三级研判（高/中/待人工复核）+ 降噪原则（公开/教材/泛指语境）+ 固定 Markdown 模板（总体结论/高中低风险项/建议处理/可疑关键词汇总）。temperature 0.15，动作 link-comment。
- **适配**：原样收割；批注类指令引导 agent 用 add_comment 把「命中片段」逐条锚定落批注。

### 1.6 涉密关键词提取（analysis.secret-keyword-extract）
- **wps**：registry L1008-1069；JSON `{keywords:[{term,category,riskLevel,reason,replacementToken}]}`，term 必须原文连续片段，占位符 `§xXXx§` 风格；供文档脱密管线消费。
- **适配**：收割为独立助手（none 动作），同时 `docops/declassify.ts` 直接复用其提示词做程序化调用。

### 1.7 文本转图像 / 文本转视频
- **wps**：registry L506-574（prompt-builder 助手）+ 顶部按钮实发预设语「请根据当前内容生成一张图片/视频…」→ 意图识别 → multimodalTaskRunner → mediaApi（OpenAI images/generations / DashScope，视频 4-30s）。图像可插入文档；视频只落文件+批注。
- **适配**：docs agent 已有 `generate_image`（云端生成+未登录回退 image_search/generate_svg）与 `insert_image`。**文本转图像**=收割助手+顶部按钮直达（agent 用 generate_image 插图）。**文本转视频**：docs 无视频生成通道——按钮发预设指令让 agent 生成「视频脚本+分镜关键帧图（generate_image 逐镜生成）」，诚实降级（不伪造视频文件），弹层/提示中说明。

## 2. 顶部新选项卡（本项目新增「察元 AI」tab，声明式 schema）

对照 wps 双 tab（察元AI助理/察元AI编审）合为本项目 docs 一个 tab，5 组：
1. **常用助手**：拼写与语法检查、生成摘要、文本分析（下拉 1.3/1.4 全量）、文本转图像、文本转视频
2. **安全保密**：保密检查、文档脱密、脱密复原
3. **文档批量**：清理未使用的样式、统计已使用的样式、删除空白行
4. **批量操作**：表格批量操作（下拉 14 项）、图像批量操作（下拉 6 项）
5. **表单辅助**：表单模式（开关）、表单内容

实现：`apps/docs/src/renderer/ribbon/schema/chayuan-tab.ts`（纯声明式，与遗留 Ribbon 绞杀迁移零冲突）+ `ribbon/commands/chayuan.ts` + `host-services.ts` 增 `chayuan` 服务组（App 注入）。

## 3. 表格批量操作（14 项 → `docops/table-ops.ts`）

wps 实现全部走 `doc.Tables` JSAPI；本项目走 ProseMirror doc 遍历（`docTable` 节点，attrs 含 `colWidthsPct/widthPct/widthPx/tblAutoFit('contents'|'window'|'fixed')/tblStyleId/tblLook`；cell=`docTableCell|docTableHeader`）。**倒序修改**是两边共同的铁律（防位置漂移）。

| # | 功能 | wps 算法 | 本项目适配 |
|---|---|---|---|
| 1 | 导出全部表格 | GetObject('Ket.Application') 逐格写 xlsx，回退 SheetJS/Blob 下载；每表一 sheet「表格N」 | 收集全部 docTable 文本矩阵 → 生成 .xlsx（复用 sheets 侧 xlsx 写入库，或 CSV 多文件兜底）→ desktop 另存为对话框 |
| 2 | 删除全部表格 | 倒序 `tables.Item(i).Delete()` | 倒序 `tr.delete(pos,pos+node.nodeSize)` |
| 3 | 根据内容自动行宽 | `AutoFitBehavior(wdAutoFitContent=1)` | 每表 `tblAutoFit='contents'`+清 widthPx（既有通道，浏览器按内容分配） |
| 4 | 根据窗口自动行宽 | `AutoFitBehavior(wdAutoFitWindow=2)` | 每表 `tblAutoFit='window'`（宽=版心 100%） |
| 5 | 根据第一表格刷新样式 | 首表 Style+4 开关+逐格角色复制（边框/底纹/字体/对齐） | 首表 tblStyleId/tblLook/borders/tblFill + 首行首列 cell 底纹字体属性 → 复制到其余表同角色 cell |
| 6 | 删除文字所在行 | 弹窗输入关键词→全表扫描命中行→确认→行号降序删 | 同算法：弹窗（DeleteTextDialog mode=row）→ doc.descendants 收集命中 `{表,行}` → 降序 deleteRow |
| 7 | 删除文字所在列 | 同上（列对称） | 同上 mode=column |
| 8 | 追加替换文字 | 弹窗（查找/替换|追加）→ 全 cell indexOf 命中才处理，替换=split.join 全局，追加=命中后插 | 同弹窗+同算法，写回经 tr.replaceWith 重建 cell 内容（保留 cell 属性） |
| 9 | 首列添加序号 | 前插列 SetWidth(28pt) 逐行写行号+居中 | 每表 `insertContent`-式 tr：新增 docTableCell（宽=28pt 换算 pct）写入行号、对齐 center |
| 10 | 手动列宽度 | 弹窗输入磅值(5-500) → 所有列 SetWidth(pt,0) | 弹窗 → 重算 colWidthsPct=均分（宽度统一按版心比例）；无 colWidthsPct 通道时回退 tblFixedLayout+widthPx |
| 11 | 第一列指定样式 | 弹窗列出 `doc.Styles` Type=1 段落样式卡片→应用到每表第一列 cell | 弹窗列出文档样式表（doc.parsed.styles 段落样式）+ 预置格式卡（加粗/底纹/居中组合）→ 设置 cell 内段落 styleId 或直接格式 |
| 12 | 第一行指定样式 | 同上（行） | 同上 |
| 13 | 添加表格题注 | 弹窗（标签默认「表」+后缀+上方/下方）；编号=`label+N+suffix` 纯计数；相邻空白段复用否则插新段+居中 | 同契约：弹窗 → 每表前后插/复用居中 docParagraph「表N 后缀」 |
| 14 | 删除表格题注 | 位置相邻段(1-80 字符 gap)+正则 `^(表|Table|附表)\s*N` 匹配，全文档回退，降序删 | 同两级识别（相邻段正则+全文回退）倒序删段 |

## 4. 图像批量操作（6 项 → `docops/image-ops.ts`）

图像模型：`docInlineImage`（attrs：dataUrl/widthPx/heightPx/border{color,widthPt}/wrap 浮动锚定）。wps 的 SaveAsPicture/EMF 导出链在本项目天然简化——**dataUrl 即源数据**。

| # | 功能 | wps | 本项目适配 |
|---|---|---|---|
| 1 | 导出全部图像 | FileDialog 选目录→SaveAsPicture/PictureFormat.Export/EMF 回退 | 收集全部 dataUrl → desktop 选目录 IPC → 逐个解码落盘 `图片_N.png`（dataUrl 后缀感知） |
| 2 | 删除全部图像 | 嵌入式降序 Range.Delete + 浮动 Shapes 降序删 | descendants 收集 docInlineImage（含浮动）→ 降序删；空段落清理 |
| 3 | 统一图像格式 | 弹窗：宽/高(磅)/锁比/描边(线宽+5色)/亮度对比度(-100~100 映射 0~1)/对齐(段落级) | 弹窗：宽/高(px)/锁纵横比/描边(宽+色)/对齐（段落 align）；写 widthPx/heightPx/border/段落 jc |
| 4 | 清除图像格式 | wps 占位未上线（弹「暂未上线」） | **补全实现**（超越源项目）：border=null + 恢复原始宽高（清 widthPx/heightPx 显式覆盖）+ 段落对齐复位 |
| 5 | 删除图像题注 | 正则 `^(图|Figure|附图)\s*N` 同表格两级识别 | 同 3-14 算法（标签=图） |
| 6 | 添加图像题注 | 同表格题注弹窗 mode=image，按图像位置排序编号 | 同 3-13（label=图） |

## 5. 正文批量（3 项 → `docops/text-ops.ts` + `style-ops.ts`）

- **删除空白行**：wps 倒序遍历段落，跳过表格内段落，`[\r\n\t \u00A0]` 全空即删。适配：倒序遍历顶层 docParagraph（文本空且无内联非文本节点）删除。
- **统计已使用的样式**：wps 每段 style 名+起始页码（Information），弹窗分组列表+双击跳转。适配：`doc.parsed.styles`（docx-engine 真实样式注册表）× 段落 `styleId`/表格 `tblStyleId` 使用统计 + 首个使用位置（块索引）；弹窗列表+点击定位（TextSelection+scrollIntoView）；页码不可得时显示块序号。
- **清理未使用的样式**：wps 扫描已用名→未用段落样式勾选删除（内置样式删除失败容忍）。适配：未用=注册表中无任何节点引用；从样式注册表移除（保存时不再发射 styles.xml 条目）；默认样式/内置样式跳过；弹窗勾选+统计。

## 6. 文档脱密三件套（→ `docops/declassify.ts` + 两个弹窗）

- **wps 流程**：全文 → AI 提取涉密关键词（1.6 提示词，json_object）→ 本地正则兜底合并（手机/身份证/邮箱/银行卡/IP/车牌/统一社会信用代码等 `LOCAL_SENSITIVE_PATTERNS`）→ 随机占位符 `§xxxxxxxx§`（crypto.getRandomValues，去易混淆字母表）→ 弹窗预览（关键词表可增删改/风险级别/命中预览/密码两次输入 ≥8 位大小写数字特殊字符）→ 单趟扫描容忍式匹配（去全半角空格/零宽字符，字符间容忍≤3 对齐空格）→ **倒序就地替换**（保留排版）→ 备份 payload（version/createdAt/originalText/declassifiedText/keywordEntries/replacementMap/textHashes）经 **PBKDF2-SHA256(210k 迭代)+AES-256-GCM** 加密存 **doc.Variables**（随文档文件走）+ 明文状态变量驱动 ribbon 按钮状态。复原：密码解 envelope → GCM 认证失败=密码错误 → 按占位符降序就地还原（容忍脱密后编辑，找不到的 token 计 missing 不伪造）→ 清状态变量。
- **适配**：
  - 加密算法原样移植（WebCrypto 在 Electron renderer 可用，`docops/declassify-crypto.ts`）。
  - AI 提取：docs renderer 需直连模型——复用 AiPanel 的执行通道拿一次结构化补全（见 declassify.ts 的 runSecretKeywordExtract）。
  - 备份存储：本项目保存格式为 docx，无 doc.Variables 通道 → **边车文件** `<文档名>.cydeclass.json`（与文档同目录，desktop fs IPC 写入；文档未保存到磁盘时存 localStorage 按文档标识键控并提示）。状态标记（已脱密/关键词数/替换数）同存边车明文段。
  - 替换引擎：ProseMirror tr 按文本偏移倒序 replaceWith text 节点（跨节点命中按 wps 同规则：先整文档 textContent 定位，再换算 PM 位置；仅文本节点内完整命中才替换，跨节点命中降级为逐节点部分替换）。
  - 弹窗：DocumentDeclassifyDialog（关键词编辑表+命中预览+密码）与 RestoreDialog（状态卡+密码）分离，不拥挤。

## 7. 表单模式 / 表单内容（→ `docops/form-mode.ts` + 弹窗）

- **wps**：书签（`名称_id_序号`）+ 内容控件包裹 + `Protect(wdAllowOnlyFormFields)`；表单内容弹窗列书签值可改/定位；规则系统（TEMPLATE_FIELDS_SPEC）支撑校验。
- **本项目现实**：编辑器无书签/内容控件/文档保护 API。
- **适配设计（诚实降级，保住两功能的核心价值）**：
  - **表单域 = 下划线空位**（`___`/`＿＿＿` ≥3 连续，或「标签：」后跟空位），扫描器产出 `{标签文本, 范围, 当前值}` 列表。
  - **表单模式**：开启后 `editor.setEditable(false)` + 用 decoration 把表单域 range 标记为可编辑（编辑器既有 filterTransaction 机制拦截域外修改）——「仅表单可编辑」语义成立；tab 键在域间跳转。按钮为开关态。
  - **表单内容**：弹窗列出全部表单域（标签/当前值/填写框），就地填写写回对应 range（倒序），支持点击定位；无表单域时给出制作指引。
  - 书签命名规则/校验规则系统不迁（依赖 docx 书签持久化，本项目无对应通道）——在弹窗内做轻校验（必填提示）。

## 8. 右键菜单（ContextMenu.tsx）

- **wps**：正文/表格两个 contextMenu：「添加到察元」（选区快照进助手）+ 动态「察元AI文本分析」（主 8 项：重写/润色/正式化/通俗化/扩写/缩写/关键词/行动项）+「更多文本分析」（11 项）+ 翻译 + 知识库。
- **适配**：既有 同义词/翻译 AI 项之后加「AI 文本助手」子菜单（复用 `.ctx-submenu` 模式）：重写/润色/扩写/缩写/提炼关键词/AI 痕迹检查/批注解释/超链接解释/正式化/通俗化/术语统一/生成标题 → `onAiAssistant(coreId)` → App 开 AI 面板并按 core 助手运行（选区文本内嵌）。有选区才可用（disabled 随 hasSelection）。

## 9. 品牌 / 链接 / skill（全仓修正）

- **开源地址**：`GITHUB_REPO_URL`（packages/electron-utils/src/github-menu.ts）与 stars fetch（shell/main/index.ts L603）、updater releases（updater.ts L346）、package.json repository/homepage（根+shell）、README badges（19 语言）、`NPX_INSTALL_COMMAND`（IntegrationsPane）全部从 `zhgyuhuii/ChayuanAIOffice`/`zhgyuhuii/ChayuanAIOffice` 改为 **`zhgyuhuii/ChayuanAIOffice`**。
- **skill**：`skills/chaoffice` → 更名 `chaoffice`，SKILL.md 重写为与实际可执行命令一致（headless CLI 名、用法、参数），设置页 IntegrationsPane 文案/命令同步，安装/卸载/导出链路回归。
- **headless CLI**：无头导出与 MCP 通道引用的 CLI 名称同步修正。

## 10. DeepSeek harness 运行态

`npm run dist:chatop` 产物（`dist/chatop-chaoffice-<ver>/`）部署到 `/Users/zyh/work/chayuan-harness` desktop 的 app resource 槽位（`host-side.cjs start({pluginDir,...})`），拉起 BFF sidecar + 编辑器 web，做一轮运行态冒烟（打开 docs、AI 面板可用、新 tab 可见）。

## 11. 与上游隔离策略（铁律）

1. 新代码全部落**新文件**（docops/、core-builtin.ts、chayuan-tab.ts、harvest 工具、测试）；对既有文件的修改点收敛到：assistants/index.ts（合并 core）、AssistantBrowser.tsx（分组源）、build-instruction.ts（comment 指令）、ContextMenu.tsx（一个子菜单+一个 prop）、App.tsx（挂载+services 注入）、host-services.ts/commands/index.ts（注册）、DOCS_SCHEMA（一行 tabs 数组）、i18n（新增键）。
2. 上游同步冲突时这些文件按「本地必胜」三档裁决（既有铁律）。
3. 生成物（core-builtin.ts）由本仓工具产出，`--check` 纳入测试，漂移即红。
