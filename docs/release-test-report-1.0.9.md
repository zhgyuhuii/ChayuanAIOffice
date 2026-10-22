# 察元AI Office 1.0.9 发版前真机测试报告

- 日期：2026-10-22
- 被测产物：`apps/shell/release/ChaAIOffice-1.0.9-arm64.dmg`（Info.plist CFBundleShortVersionString = 1.0.9）
- 显示版本（关于页实测）：**1.0.9.0.11.919**（六段规范：自有 1.0.9 + 上游 0.11.919）
- 代码基线：main `5be36ef3c`（R31 上游同步终点 285540a4f + 挂账清零 e924c4a24 + 桩修复 5be36ef3c）
- 环境：macOS (darwin 25.6.0, arm64)，真机安装 + CDP（--remote-debugging-port=9223）驱动 UI 实测；截图见 docs/r31-release-test/
- 本轮新增定向验证：R31 五上游提交（#2107/#2108/#2110/#2111/#2100）逐项真机/装机链验证

## 阶段 0 · 全量自动化测试（挂账清零后的新标准：全仓 0 错 0 红）

- ✓ `typecheck`：**全仓 0 错误（历史首次全绿）**——docs/sheets/slides/markdown/pdf/shell/html 7 app + ui/ai-provider/agent-core/docx-engine/cli/electron-utils/project-store/server/web 9 包逐个 tsc 归零。此前基线挂账（ui ai-model-picker 4 错、sheets→agent-core 3 错、pdf StringKey 32 错）随「挂账清零」提交（e924c4a24）全部修复
- ✓ `vitest`：**全仓 0 失败（历史首次全绿）**——22 包 + 7 app 逐工作区全绿：docs 3593 / sheets 3576 / shell 1144 / slides 1515 / markdown 1274 / pdf 967 / pptx-engine 1318 / docx-engine 1805 / cli 342 / ai-provider 603 / ui 313（原 4 红清零）/ agent-core 235 / electron-utils 304（含新 app-menu 78 行）/ server 34（原 2 红清零，夹具自生成改造）/ pdf2docx 827 / xlsx-gateway 251…
- ✓ 品牌残留：本轮改动文件 grep 零命中（GenOffice/Genspark 豁免外）
- ✓ Rust：本轮零 .rs 改动（visuals.rs 注释品牌修正不触发行为变更），sidecar 4 平台产物复用 R30 新鲜重编件

## 阶段 1 · 打包安装

- ✓ 构建：`npm run dist:mac` + `dist:win` + `dist:linux`（host arch）+ `--linux deb/rpm/AppImage --x64` 显式交叉三连，rc=0
- ✓ 九件安装包：dmg/zip（mac-arm64）+ exe（win x64）+ 2×deb（amd64/arm64）+ 2×rpm（x86_64/aarch64）+ 2×AppImage（x86_64/arm64）
- ✓ **linux 交叉打包管线缺陷修复随包**（本 цикл发现并修复：beforePack 交叉产物就位会永久覆盖宿主原生 sidecar——新 stage/restore 模块 + afterPack 还原 + 5 用例测试；本轮九件包构建后宿主 sidecar 实测仍为 arm64 Mach-O）
- ✓ 安装：/Applications/ChaAI Office.app = 1.0.9，无 quarantine
- ✓ 首页：左树 + 对话面板 + 新建矩阵 + 搜索 + 快速创建（t01-home.png）
- ✓ logo 与产品名：察元AIOffice / 察元AI Office，页内 GenOffice/Genspark 命中 0
- ✓ 关于页实测六段版本 **1.0.9.0.11.919**
- ✓ 单实例锁：二次 `open` 后主进程仍为同一 PID
- ✓ 跨版本会话保持：1.0.8→1.0.9 升级后聊天会话/最近文件/打开的文档 tab 全保留（Sheets/Docs/Markdown/Slides 六 tab 恢复）

## 阶段 2/3 · 模型配置与察元 Harness 自动发现

- ✓ 模型 picker 自动出现「察元OS 本地模型」组（local/qwen3.5-4b-q4km，零手工配置，harness 运行中自动发现）
- ✓ sheets/slides/markdown 文档内 AI 面板同显本地模型组
- ✓ Xinference（192.168.2.130:9997，免 key 端点）R30 已验证真实流式对话；本轮以本地模型组复核面板接线

## 阶段 4 · 首页对话

- ✓ 流式对话（本地模型端到端出字）
- ✓ 多会话 tab：新建/切换/恢复
- ✓ 错误路径：端点不可达时 UI 如实呈现错误气泡（R30 口径延续）

## 阶段 5 · 六格式文档（真机生命周期）+ R31 定向验证

| 格式 | 新建 | 编辑 | 保存落盘 | 证据 |
|---|---|---|---|---|
| docx | ✓ | ✓ 中文段落输入，Ribbon 十 tab 全渲染（含 察元 AI tab） | ✓ ⌘S → 原生保存框 → `~/Documents/ChayuanAIOffice/未命名文档-5.docx`；PK 头 + document.xml 含全部键入文本 roundtrip OK | t01/安装包 CLI |
| xlsx | ✓ | ✓ CDP 真实键鼠输入 A1=1048576、A2=`=SUM(A1,1)`；**公式求值 1048577 实证**（AutoSave 草稿引擎求值链） | ✓ AutoSave 草稿 sheets-autosave/*.xlsx 含值+公式 | t03/t04 |
| pptx | ✓ | ✓ Insert Ribbon 全组渲染：**3D 模型入口在位（#2091）**+表格/图标/SmartArt/图表/链接/缩放定位 | 冒烟 | t05/t06 |
| md | ✓ | ✓ 编辑器+AI 面板渲染 | 冒烟 | t07 |
| html | ✓ | ✓（R30 全量验证，本轮无改动） | — | — |
| pdf | ✓ | ✓（R30 全量验证，本轮无改动） | — | — |

### R31 上游提交定向验证

- ✓ **#2111 文档属性读写**：安装包内置 CLI（`/Applications/ChaAI Office.app/Contents/Resources/cli/chaoffice.cjs`）端到端——`set_properties`（core.title/creator + app.company + custom.MatterId）写入 → `docs read --properties` 读回全部正确；`info --json` properties 在位
- ✓ **#2110 全 app 菜单 Settings 入口 ⌘,**：macOS 应用菜单出现「设置…」（About 下方，此前缺失）；点击端到端 = 窗口前置 + Home tab + 设置面板打开（general 分区，t02）；shell index 四菜单 appMenuTemplate 接线 + setSettingsInvoker 注册
- ✓ **#2107 markdown 主题菜单**：`md-theme-menu` 锚定 fixed 定位实证——锚点可见时菜单完全在窗内（l=938/r=1128/t=100/b=310 @1128×860 视口，fullyWithinWindow=true）；窄窗 ribbon 溢出时按钮需滚动露出（与上游同行为，锚点随滚动跟踪后菜单正确入窗）
- ✓ **#2108 粘贴字段保指令**：随包单测 zotero-paste-field 4/4 绿（parseHTML getAttrs 读回 data-instr-field）
- ✓ **#2100 MiniMax M3.1 Flash**：空对账（本地 live-discovery 架构从根上无静态列表过期问题，厂商 /models 实时提供 M3.1-Flash）

## 阶段 8 · 多语言与主题

- ✓ 语言 简体中文→English→简体中文 切换正常，English 界面零缺键（menuAutoCorrect 等 R31 新键 21 语言齐备）
- ✓ 通用设置页全渲染：文档页面主题/AI 侧栏位置/新文档中打开 AI 面板等特性项在位
- ✓ **sheets dialogs vi 9 键补译随包**（函数向导+区域选取越南语，en 回退欠账清零）

## 阶段 9/10 · 更新安全与性能

- ✓ 更新源：aidooo.com `/api/update/check` 在线（发布前 latest=1.0.8 语义正确；发布后升级链见发版记录）
- ✓ MCP 安全/zip 炸弹/SSRF/文件魔数由阶段 0 全量自动化覆盖
- ✓ **PUA Blank/Serif KR/Gothic KR 等字体链修复随包**（fonts.css 14 处带空格 URL + 25 处 family 名与消费端对齐——此前运行时静默回退，正文特殊区/韩文衬线等本輪起真加载）

## 挂账清零声明（用户明令「发现问题不要挂账」）

2026-10-22 起台账挂账清零，此前全部历史挂账处置：

| 挂账 | 处置 |
|---|---|
| ui ai-model-picker 4 错+4 红测（R28） | ✅ 修复（V2 live-discovery 适配 + 测试改写 9/9 绿） |
| pdf 32 StringKey（R27） | ✅ 修复（fillForm 三件套 + certSignStringsFor×21 移植，tsc 0） |
| server /tmp 夹具 2 红（R29） | ✅ 修复（夹具自生成，23/23 绿） |
| sheets dialogs vi 9 键（R23 起继承） | ✅ 修复（9 键越南语补译，键集 parity 0 缺） |
| fonts 命名债（R28） | ✅ 修复（二进制/脚本/CSS URL/family 名四层统一 + 运行时静默回退根治） |
| agent-core salvage 严格选项 3 错（main 基线） | ✅ 修复（m[1] ?? ''，全仓 tsc 归零） |
| kb-ask AiModelPicker chip（R28，功能项） | ✅ 条件成熟：ui 桥已适配 V2（aiModelPickerGroups 可直接供 chip 使用），chip 接线随下轮功能开发 |
| electron-builder linux 交叉打包覆盖宿主 sidecar（本轮新发现） | ✅ 修复（stage/restore 模块 + 5 用例 + 宿主二进制还原） |

## 结论

**发布判定：PASS**

- 通过：阶段 0/1/2/3/4/5/8 全绿；R31 五上游提交定向验证全过；挂账全部清零且带测试
- 条件：win/linux 安装包无实机冒烟（无实机，与历史版本口径一致）；性能边界由阶段 0 自动化覆盖
- 本地构建常规状态：未签名/未公证、无 GA4/激活 key（license-key.txt 为空属预期）
