# 发版测试报告 — ChaAI Office 1.0.16（六段 1.0.16.0.12.600）

> 2026-11-08。本地功能修复轮：**网页/dsh 形态「技能」全链路接线** + **R38 pdf 分片读取 web 桥补线**。
> 判定：**PASS**（自动化门禁全绿 + 真机两实例实测全过；外部发布项见 §5）。

## 0 · 问题定位（两个用户可见缺陷）

**缺陷 A：最新版 office 点击技能是空的**（察元AI OS 内 dsh/网页形态 1.0.15.0.12.600）——AI 面板「+」→「技能」恒「还没有安装技能」，设置 → 技能 整页空白。

根因六层（前四层为 web 形态从未接线，第五层为 R32 同步丢失，全形态受害）：

| # | 层 | 断点 | 证据 |
|---|---|---|---|
| 1 | 设置面板装配 | R32 快照合并（58dfd0b5b）把 FoundSkills 从集成 pane 迁为独立「技能」分区，但**本地合并只保住 nav 项与图标分支，丢了 `import { FoundSkills }` 与 `{section === 'skills' && <FoundSkills/>}` 渲染行** → 1.0.11 起所有形态该面板全空白（R38 报告「技能 pane 打开正常」实为开而不显） | git show 58dfd0b5b 含 `+import`/`+{section==='skills'&&...}`，本地 SettingsModal.tsx 改前两处皆无 |
| 2 | 渲染桥 | `window.chaOfficeIntegrations` 只有 Electron preload 暴露，web shell-shims 无定义 → FoundSkills `found===null` → `return null` | apps/shell/src/preload/index.ts:959；shell-shims 改前 0 处 |
| 3 | 编辑器桥 | 六编辑器 composer 走 `window.<app>Api.skillsList()`，web-bridge shim 无实现；shim-factory 安全降级白名单 `get|list|has|count|is|notify|report|set` 前缀不匹配 `skillsList` → 结构化 reject → catch 后恒空 | packages/web-bridge/src/shim-factory.ts:33 |
| 4 | 后端 | sidecar 无任何 skills HTTP 端点（`ai:skills-list` 等全是 Electron IPC） | apps/server/src 改前 grep skills 0 条 |
| 5 | 载荷 | 推荐目录 skills/recommended 只进 Electron Resources/cli/skills，dsh 载荷不含 | scripts/package-embedded.mjs 改前清单 |
| 6 | 发送注入 | 编辑器 `skillText(name)`（attach 后正文进提示词的唯一通道）web 同样无桥无端点 | 各编辑器 renderer `withSkillBodies` |

**缺陷 B：网页形态 PDF 打开失败**（「该能力尚未在网页版开放（pdf.readFileChunk）」）——R38 吸收的 #2366（8MiB 分片读取防 Windows IPC 卡死）改了渲染端加载路径（`readFileBytes` 循环调 `readFileChunk`），pdf-shim 未接 → 全部 PDF 在 web/dsh 形态打不开。经全量审计（六编辑器 renderer 调用面 vs shim 实现 vs 安全降级前缀），这是**唯一一处打开路径级缺口**；其余未实现方法均为动作时降级或 catch 守卫（如 slides `syncPrivateFonts` 自带 catch，sheets Queries/outline 为面板动作时回调）。

## 1 · 修复方案

| 缺陷 | 改动 | 文件 |
|---|---|---|
| A | imported-skills 全量逻辑迁入 `@chaoffice/agent-core/skills-store`（Electron main 与 sidecar 单源；新增字节级 `importZipBytes`/`importMdBytes`/`importDirBytes`；`recommendedSkills` 显式 lang 参数缺省 `getUiLang()` 桌面零改动）+ shell 两侧转 re-export | packages/agent-core/src/skills-store.ts（新）；apps/shell/src/main/imported-skills.ts；apps/shell/src/shared/found-skill.ts |
| A | sidecar 新增 `/ai/skills`（列表，`relevant` 扁平化）、`/ai/skills/body`（全文）、`/ai/skills/text`（32k 截断=桌面 ai:skill-text 口径）、`/ai/skills/recommended?lang=`、`/ai/skills/recommended/install`、`/ai/skills/remove`、`/ai/skills/import/{zip,markdown,folder}`、`/ai/skills/agent-skill.zip`、`/ai/skills/status`（webForm 探测）；路径 root 相对化 `<name>/SKILL.md`（服务器目录布局不出浏览器） | apps/server/src/skills-routes.ts（新）+ app.ts 装配 + deps（agent-core/jszip） |
| A | `AiHttpBridge` += `skillsList`/`skillText`——六编辑器 shim 均展开该桥，一处覆盖全端；skillText 透传 sidecar 错误文案 | packages/web-bridge/src/ai-bridge.ts |
| A | web shell-shims 新增 `window.chaOfficeIntegrations` 全量实现 + `chaOffice.skillsList/skillText/openSkillsSettings`；浏览器 `<input>`（含 webkitdirectory）选件 + base64 上传 + 剪贴板降级链 | apps/web/src/host/shell-shims.ts |
| A | SettingsModal **恢复 R32 丢失的接线**（import + 渲染分支，上游 58dfd0b5b 原样）；IntegrationsPane `webForm` 门控隐藏桌面专属件（CLI/launcher/PATH/MCP stdio/安装到其他目录），选项字母自适应；`IntegrationsStatus.webForm?` 字段 | apps/shell/src/renderer/src/SettingsModal.tsx；IntegrationsPane.tsx；shared/integrations-api.ts |
| A | package-embedded 打包 `skills/{recommended,chaoffice}`（488K）进 dsh 载荷根，服务端 `import.meta.url` 三级上跳解析，`CHAOFFICE_RECOMMENDED_SKILLS_DIR` 可覆盖 | scripts/package-embedded.mjs |
| B | pdf-shim 实现 `readFileChunk(path,start,end)`：一次 `fs.read` 全文件缓存后内存切片，`{data,fileSize}` 语义与桌面 pdf-main 逐字段对齐（EOF 空片判停/循环只拉一次桥）；`readFile` 同缓存复用 | packages/web-bridge/src/editors/pdf-shim.ts |

安全沿用：10MB 导入帽、zip 条目名检查（绝对/`..`/反斜杠/符号链接拒收）、scratch+原子改名、名字白名单、按列表命名查找——共享内核同时约束两形态。

## 2 · 自动化门禁 — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| typecheck 全仓 | ✅ 0 | 34 工作区（含新文件） |
| lint | ✅ 0 error | 基线 warnings 不变 |
| vitest 全工作区 | ✅ 绿 | 全量跑两轮：首轮 3 失败=shell packaged-cli-version（已知 linux ELF 暂存条件项，暂存后 5/5 复绿）；补跑 slides/pdf/markdown/web-bridge/server/web 全 0 退出 |
| 新增测试 | ✅ 24 用例 | agent-core skills-store 14（zip/md/dir 字节导入·安全拒收·目录状态机·locale）；server /ai/skills 路由 4（含磁盘单层布局锁）；web-bridge ai-skills 3 + pdf-chunked-read 3（分片循环/一次 fs.read/桌面语义） |
| 接线防回归 | ✅ | found-skills-pane 新增源码断言（SettingsModal 必须含 import+渲染分支——本次事故逃逸路径的 tripwire），12/12 |
| 行为保真对账 | ✅ | 迁移首轮跑出两处漂移当场修正：①zip 超帽须在膨胀前建 skills 根（旧测试锁死）；②recommendedSkills 缺省语言走 getUiLang()（旧测试 setUiLang 依赖）；shell imported-skills 45 全绿 |
| 依赖/版本 | ✅ | lock +6 行（agent-core jszip/i18n）；版本 Z+1 1.0.15→1.0.16（root/shell/dsh-plugin+lock 四处）；electron 二进制重装（npmmirror）+ dev 名补丁 |

## 3 · 真机验证（察元AI OS dsh 形态）— PASS

部署链：office 仓 build:web → package-embedded → dsh-plugin build → `/Applications/察元AI OS.app/Contents/Resources/chatoffice` 原位覆盖 + harness 仓 desktop/resources/chatoffice 同步 → staged 清除 → 桌面重启按内容签名重铺（两实例均验：生产 chatop-data 与 dev harness chatop-dev-data）。

| 项 | 结果 | 证据 |
|---|---|---|
| 载荷/版本 | ✅ | staged package.json=1.0.16；skills/{recommended,chaoffice} 在载荷；sidecar 起、`/ai/skills/status` webForm:true |
| HTTP 面 | ✅ | `/ai/skills`（装后即列）、`/ai/skills/recommended?lang=zh` 42 条中文描述、install/remove/状态翻转全通 |
| 设置→技能面板 | ✅ | 「技能」分区渲染（R32 断线修复实证）；「我的技能 (N)/推荐」双段实时刷新；导入提示「已导入 …」；「已安装」态标签 |
| 推荐目录 | ✅ | 42 技能、分类 tab 全部/办公/商务/数据/财务/人力资源/法务/市场/教育、「全部」默认激活、41 安装钮+1 已安装 |
| UI 安装流 | ✅ | budget-planner、meeting-minutes 各经面板安装 → 已安装 → composer 即见 |
| 编辑器桥 | ✅ | docs 内 `desktop.skillsList()` 即时列新装技能；`skillText` 2827 字符全文；`skillText('ghost')` 透传「no installed skill named "ghost"」 |
| composer 菜单 | ✅ | 「+」→技能列出 brand-copy/budget-planner；勾选后 plus 按钮 has-skills 态；「管理技能」入口在 |
| 发送注入 | ✅（链路） | 带技能消息发出进入流式（本地 qwen3.5-4b-q4km 思考中）；skillText/withAttachedSkills 数据源已实测 |
| 缺陷 B 复验 | ✅ | 新建空白 PDF 在网页形态打开成功：无「文件打开失败/尚未开放」、canvas 渲染、完整工具栏、「共 1 页」、零 JS 错误（readFileChunk 分片链实证） |
| 测试残留 | ✅ | 验证用安装技能已移除，两侧 storages 恢复空白初始态 |

## 4 · Electron 独立形态回归 — PASS（测试面）

- imported-skills 45 用例（含 zip 帽/scratch/locale 旧行为）经 re-export 全绿；integrations IPC 面（integrations-ipc）未改；found-skills-pane 12/12；SettingsModal 仅增回上游原接线——Electron 行为面与 1.0.15 等价。

## 5 · 发版清单

| 项 | 状态 |
|---|---|
| dsh 载荷（本报告主体） | ✅ dist/chaoffice-1.0.16.tgz（171MB）+ app/harness resources 原位覆盖 + staged 重铺实测 |
| 九件安装包/GitHub Release/tag 三仓/aidooo 十槽位 | ⏳ 待执行（沿 R37 §850 流程；Electron 形态功能与 1.0.15 等价，外部发布可随下一轮合并） |
| 报告 | ✅ 本文件 |
