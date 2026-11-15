# R41 上游同步真机测试报告（dev CDP 驱动 + CLI 实测，2026-11-15）

> 对象：main b29214db7（sync/41-upstream 合并+三轮审查，六段 1.0.17.0.13.18）。
> 方法：`REMOTE_DEBUG_PORT=9331` dev 全链（六端 vite 5173-5178 + shell 5199 + CDP 9331），Runtime.evaluate JS 注入双通道；CLI 侧 `packages/cli/dist/chaoffice.cjs`（缝合后含 create.ts 恢复版+deckAuditDetail 移植）真机闭环。
> 前置：阶段 0 自动化门禁（typecheck 0/lint 0/vitest 全链 exit 0/cargo 327/build:web/三轮审查）已在合并轮完成，见台账 §R41。

## 阶段 1 · dev 真机基线 — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| 版本六段桥 | ✅ | `await window.chaOffice.getAppVersion()` → **"1.0.17.0.13.18"**（150 桥键） |
| 首页品牌 | ✅ | title 察元AIOffice；GenOffice/Genspark 正文扫描 **0** |
| 六端管线 | ✅ | 5173-5178 全 LISTEN + shell 5199；GUI 新建 docx（ProseMirror editable）+ CLI open 双通道（docx/pdf/pptx/csv 四类文件全部打开进真机 tab） |
| 设置面（V2 架构） | ✅ | 10 分区真机渲染（模型设置/默认模型/生图媒体搜索/本机文件搜索/远程存储/通用/集成/MCP 管理/技能/关于）——#2591p3 restyle 拒收后的 V2 面完整在位 |

## 阶段 2 · R41 新特性逐项 — PASS（附注 4 项）

| 特性 | 来源 | 真机证据 |
|---|---|---|
| **docs story view** | #2595 | GUI 实测：View tab「故事」钮点击 → `view-story` 容器类 + **story-marker ProseMirror-widget** 边距标记渲染（6 个标记节点） |
| **docs 未样式段落大纲推断** | #2667 | GUI 实测：插入无样式段落「设备巡检流程说明」→ 被推断为 **`story-heading story-h1`**（story 视图 DOM 直接证据）；大纲视图（view-outline）面板渲染 |
| **pdf 打印子系统外提** | #2589 | GUI 实测：打印钮（tip=打印 (⌘P)）→ **PrintDialog 渲染**（标题「打印」+ 8 行设置面：份数/双面/打印机等） |
| **pdf redact-find 模式下拉** | 快照 #2641 | GUI 实测：注释 tab → 「将电话、邮箱、银行卡号等标记为待涂黑」钮 → **7 项模式菜单全渲染**（电话号码/电子邮箱/信用卡号/美国社会安全号码/日期/IBAN 账号/以上全部） |
| **sheets CSV 导入进度+可停** | #2545 | GUI 实测：CLI open 50MB CSV → **「正在打开工作簿…100%取消」进度屏实渲染**（workbook-opening-bar-fill width 动画）→ 完成后自动撤除 |
| **sheets CSV 导入上限** | #2539 | GUI 实测：设置「通用」分区 **「CSV 导入上限」双入口渲染**（shell 全局+sheets 局部）；下拉 256MB→64 **主进程持久化回流验证**（getCsvImportLimit()=64） |
| **CSV 引擎上限链** | #2539/#2545 | csv-limits.ts（choices 64/128/256、默认 256）+ csv-import-limit 三件终态与上游规范化比对一致（审查②） |
| **CLI create --no-generator-fields** | #2559 | CLI 实测：app.xml **无 Application/AppVersion**（对照组 gen.docx 两字段在案）；**审查中修复**——create.ts 取上游终态+deckAuditDetail 移植后旗标接线生效 |
| **CLI revision 语义** | #2559 | fresh create → `<cp:revision>1</cp:revision>`（上游 docs-properties.test:337 同钉；vitest 16/16 绿） |
| **CLI set_header_footer 分节寻址** | #2565 | CLI 实测：insert_section_break 后 `section:0`/`section:1` 双节各自写入页眉，`docs read --header-footer` 回读 **multiSection:true 两节文案分命中** |
| **CLI remove_parts 守卫** | #2558 | CLI 实测：remove word/document.xml → **"remove_parts refuses parts the package depends on"** 精确拒绝；非依赖 part 正常面（单测覆盖） |
| **ODF 引擎真机转换链**（25 项修复批） | #2691-2714 | CLI convert **odt→docx（4 blocks：斜体 `<w:i/><w:iCs/>` 保留 ✓、列表 numPr 保留 ✓）/ ods→xlsx（float 42/7.5 保留 ✓）/ odp→pptx（1 页+无几何 frame 守卫 drop）** 全通 |
| **convert 宽文件面** | #2587 | `chaoffice convert --help` 契约表全量（doc/dot/xls/xlsb/ods/ots/odt/ott/hwp/hwpx/odp/otp/ppt/md/html→ 六向）真机在案 |
| **DeepSeek thinking 阶梯** | #2550 | GUI renderer 实测：动态 import thinkingShapeFor('deepseek') → **`{kind:'openai-effort', levels:[none,low,medium,high,xhigh,max]}`** |
| **AI 选择浮窗开关（prefs 面）** | #2602 | GUI 实测：`getAiPanelPrefs()` → **`showAiAskTrigger:true`** 键活（开关行渲染在模型设置分区深层，prefs 持久化链通） |
| **add_chart 列命名** | #2547 | CLI 实测：columns=["B","C"] schema 校验通过（列字母契约）+ chart1.xml 产出；系列引用细节由 add-chart 套件钉 |
| **slides 视频导出** | mp4-muxer | video-export 五模块（encoder/frames/timeline/transitions/export-video）在位；主进程菜单 `menuExportVideo→send('export-video')` 接线（slides-main:5742）；导出器单测绿（GUI 对话框为原生菜单触发，见附注 1） |
| **MCP read_blocks** | #2664 | in-app MCP server 注册（document-tools.ts）+ mcp-http-surface/document-tools 测试 177/177 绿 |
| **win-clipboard-helper（EMF 剪贴板）** | #2588 | 新 crate main.rs/Cargo.toml 与上游逐字节一致（审查③c）；electron-builder Windows 候选块并入；mac 侧静默降级（平台特性） |
| **file-parse 修复批 ×14** | #2608-2714 | 套件全绿（阶段 0）；严格 PPTX 注释/包级关系跟随/混合格式月-分钟等随引擎覆盖 |
| **退出登录确认** | #2690 | ConfirmDialog 组件+触发链真机在案（Home.tsx onLogout→setConfirmSignOut；confirm-dialog.test 绿）；**未登录环境不可达全程**（见附注 3） |
| **品牌终检（真机态）** | — | strings.ts 新增 44 处 Genspark 全为 #2690 账号文案族（与 main 基线 loginGenspark 同族同风格，如实指称 Genspark 账号体系）——判定基线一致 |

## 附注

1. **slides 视频导出 GUI 对话框**：入口在应用原生菜单（Electron Menu），CDP 事件面不可达（R38 附注 1 同口径）；菜单接线+对话框组件+导出器单测三面覆盖，装机冒烟时人工点一次。
2. **Flash Fill 全列 (#2630)**：xlsx-gateway flash-fill 引擎级修复，套件绿覆盖；GUI 交互链（CDP 合成事件面限制）留装机冒烟。
3. **退出确认 (#2690)/trash 启动器 (#2597)/Windows 控制台解码 (#2607)/Linux 字体扫描 (#2698)**：平台或登录态前置，真机面由接线+单测覆盖（trash.test/launch-paths.test 等），装机冒烟补人工项。
4. **create --force 场景 revision=2 观察**：fresh create=1（上游钉值）；--force 覆盖场景观察到 2，非本轮回归（上游同代码），装机冒烟可复核。

## 审查驱动修复（本轮测试前已闭环，真机复验通过）

1. `picture-paste.ts` #2599 终态遗留（审查②兜出，ce132274a）——真机验证走单测 18/18（Office 命名空间图片认领三用例）。
2. `cli create.ts` + `deckAuditDetail`（真机 CLI 测试兜出）——上游终态恢复+函数移植后 `--no-generator-fields`/revision 语义实测通过。
3. 根 package.json 4 个 `check:*` 脚本接线（审查③d）。

## 判定

**PASS**（阶段 1/2 全过；附注 4 项均有明确平台/环境归因+替代覆盖，留装机冒烟清单）。
