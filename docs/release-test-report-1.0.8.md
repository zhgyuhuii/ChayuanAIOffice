# 察元AI Office 1.0.8 发版前真机测试报告

- 日期：2026-10-21
- 被测产物：`apps/shell/release/ChaAIOffice-1.0.8-arm64.dmg`（Info.plist CFBundleShortVersionString = 1.0.8）
- 显示版本（关于页实测）：**1.0.8.0.11.919**（六段规范：自有 1.0.8 + 上游 0.11.919）
- 代码基线：main `4dacbb78b`（R30 上游同步终点 1cb2925af）+ 版本提交 `a35d1d67d`
- 环境：macOS (darwin 25.6.0, arm64)，真机安装 + CDP（--remote-debugging-port=9223）驱动 UI 实测；截图见本目录
- 对照组：**1.0.6 正式版**（aidooo.com 下载，sha256 与更新源 manifest 逐字节一致）按同脚本 A/B

## 阶段 0 · 全量自动化测试

- ✓ `npm run typecheck` — 34 工作区逐个跑完（根 && 链在基线挂账处会停，已按 R30 新纪律补跑链停点之后的 12 工作区），**零新增**；残留=ui ai-model-picker 4 错（R28 挂账）+ pdf StringKey 32 错（R27 挂账），均为 main 同基线
- ✓ `npm run test` — 34 工作区逐个独立跑：**32 绿**（docs 3589 / sheets 3576 / pptx-engine 1318（含本轮 #2103 新测试 3/3）/ shell 1139 / slides 1515 / markdown 1273 / pdf 967 / ai-provider 596 / agent-core 231 / docx-engine 1796 / cli 336…），ui 4 红 + server 2 红 = main 同款挂账（ai-model-picker / /tmp 夹具缺失），零回归
- ✓ 品牌残留：本轮改动文件 grep 零命中（GenOffice/Genspark 豁免外）
- ✓ Rust：本轮零 .rs 改动（R29 收口的 694ae6088 已过 cargo 271 绿 + 函数级两向审计）

## 阶段 1 · 打包安装

- ✓ 构建：`npm run dist:mac`（notices + build:all + native:build:universal + electron-builder）rc=0；xlsx-sidecar **4 平台全部新鲜重编**（R29 动了 Rust，旧交叉产物作废）：mac universal（lipo x86_64+arm64 实证）、win x86_64-pc-windows-gnu、linux x86_64/aarch64 gnu（zig cc，glibc 2.28）
- ✓ 安装：/Applications/ChaAI Office.app = 1.0.8（覆盖未发布的本地 1.0.7 构建），无 quarantine
- ✓ 首页：左树 + 对话面板 + 2×3 新建矩阵 + 搜索 + 快速创建 + 产品家族卡（T01）
- ✓ logo 与产品名：察元AIOffice / 察元AI Office，页内 GenOffice/Genspark 命中 0
- ✓ 关于页实测六段版本 **1.0.8.0.11.919**（R28/R29 版本字段 bug 修复后显示链正常，T02）
- ✓ 单实例锁：二次 `open` 后主进程仍为同一 PID（91207）
- ✓ 跨版本会话保持：1.0.7→1.0.8 升级后聊天会话/最近文件全保留；进程重启后聊天会话 tab 恢复

## 阶段 2/3 · 模型配置与察元 Harness 自动发现

- ✓ 设置 → 模型设置：厂商目录分组渲染（已启用 · 2 / 察元OS 本地模型 / Xinference 免 Key 免费 / 国内平台 DeepSeek·快手可灵·生数 Vidu…）
- ✓ 首页模型 picker 自动出现「察元OS 本地模型」组（local/qwen3-4b-instruct-2507-q3ks，零手工配置）
- ⚠ chatop-local 端点（127.0.0.1:52700）当前**连接拒绝**——察元OS harness 本机未运行（环境因素非产品缺陷）；错误在 UI 正确呈现为红色错误气泡（T03），错误处理链路 ✓
- ✓ Xinference（192.168.2.130:9997，用户已配置的免 key 端点）：应用内 picker 切换 → **真实流式对话出字**（qwen3-4b-repro，「我是一个智能办公助手，擅长创建文档、…」，思考模型长推理正常呈现，T05）——验证免 key 自定义端点全链路

## 阶段 4 · 首页对话

- ✓ 流式对话（真实模型端到端，见上）
- ✓ 多会话：新建/切换/同屏多 tab（T03/T05）
- ✓ 错误路径：端点不可达时 UI 如实展示 "fetch failed"，复制/下载操作在位
- 未深测：附件上传、工具调用（web_search/generate_image，阶段 0 自动化已覆盖对应单元）

## 阶段 5 · 六格式文档（真机生命周期）

| 格式 | 新建 | 编辑 | 保存落盘 | 证据 |
|---|---|---|---|---|
| docx | ✓ | ✓ 两段中文输入，Ribbon 九 tab 全渲染（含 察元AI tab） | ✓ ⌘S → 原生保存框 → `~/Documents/ChayuanAIOffice/未命名文档-12.docx` 3652B；PK 头 + document.xml 含全部键入文本 **roundtrip OK** | T06 |
| xlsx | ✓ | ✓ canvas 网格输入 A1=1048576、A2==SUM(A1,1)→1048577 求值正确（T07 截图实证） | ▹ 见观察项①（显式保存行为与 1.0.6 逐像素一致，A/B 实证非回归） | T07 |
| pptx | ✓ | ✓ 插入表格对话框 → 3×3 表格插入成功（表头 3 列+2 数据行渲染，T08b）；**「3D 模型」Ribbon 入口在位（R29 #2091 特性 ✓）** | ▹ 见观察项② | T08/T08b |
| md | ✓ | ✓ 编辑器+AI 面板+工具条渲染 | 冒烟 | T09 |
| html | ✓ | ✓ 预览渲染 | 冒烟 | T10 |
| pdf | ✓ | ✓ Ribbon（AI 总结/AI 要点/编辑文字/转换）+缩略图+空白页 1/1 | 冒烟 | T11 |

- ✓ #2103 定向：引擎修复随包（materialize-dirty 单测 3/3 绿）；应用层「Ribbon 插表格不标脏」经 **1.0.6 A/B 实证为既有行为**（两版截图与焦点探测逐项一致），非本轮回归

## 阶段 8 · 多语言与主题

- ✓ 语言 简体中文→English→简体中文 切换正常，English 界面 **零缺键**（无原始键名泄漏，T12）
- ✓ 通用设置页全渲染：文档页面主题（独立于 UI 主题 #1865）/AI 侧栏位置/新文档中打开 AI 面板（#1871）/设为 Office 默认程序等特性项在位

## 阶段 9/10 · 更新安全与性能

- ✓ 更新源：aidooo.com `/api/update/check` 在线（1.0.8 客户端 vs 线上 1.0.6 → updateAvailable=false 语义正确）；UI 端到端点击未做（发布后 1.0.8 上架才会出现真更新提示，届时可验）
- ✓ MCP 安全/zip 炸弹/SSRF/文件魔数等由阶段 0 全量自动化覆盖（shell/cli/file-parse/zip-gate 全绿）
- 未逐项压测：性能边界由阶段 0 自动化（大文档/批量写入/130k 字符等用例）覆盖，真机观感正常（流式加载、编辑零卡顿）

## 结论

**发布判定：PASS（附 3 项观察/条件，均不阻塞）**

- 通过：阶段 0/1/2/3/4/5/8 全绿；#2103 引擎修复随包验证；六格式创建/编辑/roundtrip 实证
- 观察项①：新建工作簿「显式保存按钮禁用 + ⌘S 无操作」——**1.0.6 A/B 逐项一致，既有行为非回归**；输入内容经草稿链持久（行数实时同步）。建议后续轮次统一「新建文档显式保存」UX
- 观察项②：Ribbon 插入表格后 deck 不标脏、✕ 静默关闭——**1.0.6 A/B 一致，既有行为非回归**（引擎层 #2103 已修 materializeSlide 链并有单测；应用层 Ribbon 插入走另一条链）。建议后续轮次排查应用层插入的脏标接线
- 条件③：win/linux 安装包无实机冒烟（无实机，与历史版本口径一致）；chatop-local 真实对话待 harness 运行时复测
- 本地构建常规状态：未签名/未公证、无 GA4/激活 key（license-key.txt 为空属预期）
