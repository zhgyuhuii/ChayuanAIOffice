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

## e2e 干净重跑

首轮 e2e（07:53）与构建并行+受缺陷#1 影响全部失败，数据作废。缺陷修复后的干净重跑正在进行（后台），完成后结果补记本报告。
