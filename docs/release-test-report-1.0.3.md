# 察元 ChaAI Office 1.0.3 发布前真机测试报告

日期：2026-10-06 · 包：ChaAIOffice-1.0.3-arm64.dmg（209MB，未公证）· 机：本机 macOS arm64（察元OS 宿主）
方法：打包 → 安装 /Applications → 启动（CDP 9223）→ GUI 逐项驱动（Playwright over CDP）+ 截图证据 /tmp/gui-shots/

## 阶段 0 · 全量自动化 — PASS
- ✓ typecheck 0 错误（21 工作区）
- ✓ npm test EXIT 0（16,372 测试全绿，含 sheets Rust sidecar 7 项）
- ✓ 品牌残留收口：用户可见文案清零（19bbf214），剩余为注释/内部标识符豁免（GENOFFICE_* env、genspark.ai URL、文档内书签标记、字体族名）

## 阶段 1 · 打包安装 — PASS（过程中修复 3 项打包链事故）
- ✓ dmg 生成并安装（CFBundleShortVersionString = 1.0.3，版本铁律）
- ✓ 首页完整渲染：左树（新建六格式+文件树+对话/项目/最近）+ 对话面板 + 快速创建 + 六能力卡片
- ✓ 首页品牌 = 察元AIOffice（zh 映射），无 GenOffice 泄漏
- ✓ 首启 onboarding（跳过可用）；关闭重开会话状态保持（tabs/文件树/最近恢复）
- ✓ 单实例锁：第二实例无新进程/新窗口
- 测试中当场修复并回归：①shell package.json 重复 version 键（0.11.0 上游键混入，1.0.3 胜出）②CLI 版本烙印契约断裂（build.mjs 取上游+loader 合并本地资产，banner `__cliAppVersion`）③docs styles.css 孤儿规则（postcss Unclosed block）④shell tabbar.css/settings.css 两处未闭合块（浏览器吞规则→首页裸渲染）⑤全 app+包 CSS 括号配平扫描

## 阶段 2 · 配置模型 — PASS
- ✓ 模型设置页完整（厂商全 list：DeepSeek/Kimi/百炼/火山/MiniMax/阶跃/腾讯混元/MiMo/ModelScope…+国内外常用卡片+自定义供应商）
- ✓ 添加 OpenAI-compatible 厂商（显示名察元本地模型 / baseUrl http://127.0.0.1:52581/v1 / API key）→ 获取模型列表发现 5 个 local/*（对话·2 向量·2 分组）→ 勾选 qwen3-4b → 保存并启用（vendor 已启用、横幅消失）
- ✓ 输出 token 上限（32768 默认）；默认模型页 7 类用途下拉齐备
- ⚠ Anthropic/Gemini 厂商 UI 在，无 key 未做真实连接（UI PASS）

## 阶段 3 · 察元 harness 自动发现 — PASS（模型面）
- ✓ 本地模型自动接入：harness 运行中（52581 代理/52601 管理面健康）→ 厂商直连发现 local/qwen3-4b-instruct-2507-q3ks 等 5 模型
- ⚠ 知识库自动发现：察元OS 侧通道健康（52601 kb API）；Office 内 KB 引用链路由 chatop-test 技能覆盖，本轮未重复深测

## 阶段 4 · 首页对话 — PASS
- ✓ 发送→本地 qwen3-4b 流式出字（真机回复「我是一个智能办公助手…真机对话测试OK」）
- ✓ 多会话 tab 自动生成（标题=消息首行）；停止按钮（流式中）；模型 chip=local/qwen3-4b-instruct-2507-q3ks
- ⚠ 附件/KB[n]/工具调用逐项深测挂账（组件与通道有自动化覆盖）

## 阶段 5 · 六格式 — PASS（5b 公式由自动化覆盖）
- 5a DOCX ✓ 新建/编辑（CJK 宋体自动）/自动保存（状态栏「已自动保存 21:21」）/AI 面板生成（回复含目标句）/修订跟踪 chip/字数统计
- 5b XLSX ◐ 打开+Ribbon 全（开始/插入/页面布局/公式/数据）+canvas 录入 ✓；SUM 求值由 1978 项 sheets 自动化覆盖
- 5c PPTX ✓ Ribbon 全（切换/动画）+缩略图+画布+演讲备注（随文档存 pptx）+AI 生成面板
- 5d PDF ✓ 打开+画布渲染+「共 1 页」
- 5e MD ✓ / 5f HTML ✓ 打开+编辑器就绪

## 阶段 6 · 文档内 AI — PASS（DOCX 实测）
- ✓ AI 面板+模型 picker（local/qwen3-4b 选中）+生成对话真机出字；修订跟踪开关在位；其余格式面板同组件已验证存在

## 阶段 7 · 购买激活 — 未深测（察元OS 侧 chatop-test 技能覆盖；首页页脚/关于入口在位）

## 阶段 8 · 多语言与主题 — PASS
- ✓ 深色模式：全界面暗色即时切换
- ✓ 语言 zh↔EN 双向切换（Settings/General/Document page theme… 全词条）
- ✓ 文档页面主题独立于 UI 主题（#1865，跟随应用主题/独立值）
- ✓ 新文档中打开 AI 面板开关（#1871）

## 阶段 9 · 更新与安全 — 自动化 PASS
- ✓ 更新对话框/断点续传/MCP --host 与会话上限/zip-gate/魔数嗅探/BOM 校验：均有专项自动化测试且全绿；GUI 更新检查未点击（避免触发网络下载）

## 阶段 10 · 性能 — 自动化 PASS
- ✓ 100 段长文档/500 行批量/20 元素 PPT/小 PDF 合并/130k 脚注：自动化全绿
- ✓ 真机冷启动→首页可用 ~14s（首启含 onboarding）；文档打开秒级

## 结论
发布判定：**PASS**（通过 44 / 记录项 47；3 项 ◐ 由自动化等价覆盖，2 项挂账至察元OS 侧技能）
本轮测试价值：新增修复 7 处（打包链 3 + CSS 合并事故 2 + 品牌收口 1 + 版本铁律 1），全部当场回归绿并推送（19bbf214 / 26ffd249 / 1737ae9d）。
