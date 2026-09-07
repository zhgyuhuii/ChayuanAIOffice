# 上游同步台账（upstream-sync）

> 本文件是 chayuan-office ← genoffice 上游同步的**唯一记账与施工手册**。
> 新会话只需读此文件即可开工或续作；每完成一批必须回写本文件的进度与裁定记录。

---

## 1. 背景与目标

| 项 | 值 |
|---|---|
| 本仓 | `/Users/zyh/work/chayuan-office`（origin `git@github.com:zhgyuhuii/chayuan-office.git`；惯例：直接 main 提交+推送，中文领域 title） |
| 上游 | `/Users/zyh/work/genoffice`（origin `git@github.com:genspark-ai/genoffice.git`） |
| 历史关系 | **无共同祖先**：本仓 `8d108c3` 为整树导入（2026-08-30），禁止一次性 merge（空树基准 → 两千个 add/add 冲突） |
| 目标 | 全部拉齐到上游 HEAD `6d16796`（2026-09-07），本地全部功能改动保持不变 |
| 状态 | **九问共识已收敛（见 §3），等待用户明确「开工」指令后才动代码** |

## 2. 基准定位（调研结论，已核实）

- **共同基准快照**：上游 `583a045`（2026-08-27）＝本仓导入提交 `8d108c3` 的上游对应点。
  证据：抽检 13 文件 blob 指纹 12 个一致；唯一差异 `apps/sheets/src/domain/chart-visual.ts`（导入时即带本地改动）。
- **待收割范围** `583a045..HEAD`：40 提交、896 文件、+178,805 / −111,405 行。
- **构成**：3 个巨型 Sync snapshot（8-30：229 文件；9-02：491 文件 ±12.9 万行＝CJK 排版引擎+内嵌字体+`i18n/ai/` 每语言 19 文件；9-06：444 文件 +3.4 万行＝docs 编辑引擎新模块+sheets 性能）＋ 37 个独立 fix/feat 小提交。
- **与本地交集**：上游 896 个改动文件中 **377 个与本地改动重叠**——其中 76 个两边 HEAD 已一致（可跳过），**301 个需审**；重叠热区 sheets 61 / docs 42 / slides 40 / shell 22 个源码文件。
- 上游新增 476 文件中约 175 个是测试；删除 18 个文件（Carlito 字体×8、slides 两测试、6 个基线脚本）。
- 已抽查确认本地**缺失**（非重复修复）的例：slides 并发保存串行化（无 `saveTail`）、ai-provider Gemini schema 消毒。
- 本地比上游多的工作区：`apps/server`、`apps/web`（8-31 `c75e292` 本地自架构收割所建，上游没有；不在收割范围内，绝不允许上游内容覆盖其行为）。

## 3. 九条共识（Q1–Q9，已签）

| # | 议题 | 定案 |
|---|---|---|
| Q1 | 范围 | 全部拉齐到上游 HEAD `6d16796`；基准 `583a045` |
| Q2 | 方式 | 加 `upstream` remote，从 `583a045` 起按上游时序逐个 cherry-pick；3 个巨件 Sync 各自单独成批；每 5-10 提交一批、批间过门禁 |
| Q3 | 冲突裁决 | 三档：①本地功能区（image-source/generate_deck/移动端/ribbon/服务端双端架构等）本地赢，上游意图**重实现进本地架构**、不硬贴 patch；②本地未动区域上游赢，完整落地（含删除）；③中间地带 hunk 级合并＝本地改动保留+上游修复叠加，文件与提交信息记 `adapted:` 并汇总供抽查 |
| Q4 | 品牌 | 随到随改 GenOffice→ChatOffice（用户可见字符串、字体文件名、font family 内部表、`@font-face` 引用、生成脚本）；**豁免**：环境变量 `GENOFFICE_*` 前缀、`genspark.ai` URL 值与 host 匹配串（改=断功能）；每批门禁加品牌 grep 闸 |
| Q5 | 例外清单 | ①`package.json`/`package-lock.json` 永不字面 pick：依赖变更记清单、批末手工合并进本地（保留 `@chatoffice/*` 命名）+`npm install` 重新生成+测试；②`README.md`/`CONTRIBUTING.md`/`CLAUDE.md`/`.github/` 跳过 pick，内容性变更（如 `TAVILY_API_KEY` 环境变量表）摘抄进本地对应文档；③其余一切（源码/测试/fixtures/字体/视觉基线）正常 pick，删除照常执行 |
| Q6 | 测试 | 随代码 pick、批门禁全量绿；上游测试红→先判模块是否在本地功能区：结构差异→改编断言到本地架构，头加 `// adapted: <上游sha> <原因>`；行为差异→**停下来单独问用户裁定**；非功能区红=收割有 bug，修代码不修测试 |
| Q7 | 删除 | 18 个删除照常执行；每批做被删路径全库引用扫描、悬空当批清零；字体链（Carlito×本地 fonts.ts 懒加载改造）预登记中间地带（保本地懒加载、采上游字体清单、加字体加载断言）；slides 被删两测试确认上游接替文件同批到达，本地独有改动按 Q3③叠进新文件标 adapted |
| Q8 | 分支 | 单分支 `sync/upstream-202609` 施工；每批门禁绿→合回 main+推送（merge 提交中文领域 title）；main 始终可发布；上游提交信息**逐字保留**不翻译不改写；并行会话纪律：只 stage 本任务文件；外来未跟踪文件 `e2e/worker-path-check.mjs` 不碰不提交不删 |
| Q9 | 记账 | 即本文件：基准/终点/改名映射（§9）/adapted 清单/裁定记录（§10）/每批进度；终点出验收报告；`upstream` remote 持久化，下次同步从上次终点续 pick |

## 4. 分批施工计划（批内按上游时序）

| 批 | 内容 | 提交（按序） | 要点 |
|---|---|---|---|
| 0 | 准备 | — | `git remote add upstream /Users/zyh/work/genoffice && git fetch upstream`；建分支 `sync/upstream-202609`；本文件即为台账骨架 |
| 1 | 8-30 Sync | `2239cce` | 229 文件；sheets ai/create-document+retry-prune、cf-formula-fold、formula-bar-autosize、shell 文件类型图标、ai-provider overload-error、docs justify-shrink/page-break |
| 2 | 三个小修 | `3548a80` `566c1f3` `93b8938` | slides 旋转表格双击编辑；agent-core stale compaction（本地有改造，中间地带候选）；docs 分节页边距/pct 表宽 |
| 3 | 9-02 Sync 巨件 | `9f971ed` | 491 文件 ±12.9 万行：CJK 标点挤压/两端对齐收缩/分栏/分页、内嵌字体（Poppins 子集+日文假名）、`i18n/ai/` 19 语言×3 app、docx-engine 大改；⚠️含 16 个 Rust 源文件，本地 wasm/字体工具链可复现性是全任务最大风险 |
| 4 | 六连修 | `99d376b` `f105f36` `e833fff` `2dab773` `6f71780` `f30a301` | markdown/pdf 截断回复；每回合输出 token 上限设置；slides 竖排文本跳过宽度检查；**ai-provider 两件重实现**（Gemini schema 消毒、non-JSON 200）；stopReason 转发 |
| 5 | 七连 | `eec2737` `4846ace` `4770d9c` `2910486` `d8e233c` `9439d3e` `360ce06` | ai-panels 预览标记；**slides 保存串行化**（generate_deck 区，中间地带）；Gemini3 温度；**Tavily 兜底（依赖变更，批末手工进 package.json）**；`d8e233c` 为元文件跳过+摘抄；docs RTL 面板；slides agent 生命周期（中间地带） |
| 6 | 十二连 | `567ad37` `99dfbc1` `41f87f3` `449f03a` `4d277b5` `ea13074` `1ee2407` `09fd67b` `8630d11` `a5b5903` `d9769d1` `f2c3d08` | docs 表格逐边框（22 文件）、RTL AI 面板×其余 app、sheets 四修、slides saveAs 队列+澄清清理、shell Home 重命名校验、markdown 缩放 i18n、docs 标尺 tab（21 文件）、ai-panels 历史清理、docs 附件清理；`strings-ai.ts` 逐 key 合并（本地 imageSource keys+上游改动） |
| 7 | 9-06 Sync 巨件 | `69b4ce0` | 444 文件：docs 编辑引擎新模块（暗色页/图片旋转/底纹/粘贴/打印缩放/settled-measure）、sheets 长文本/加载性能/CF 重复值、slides prompts ops/*.md、JP Kana 字体 |
| 8 | 收尾九连 | `959df83` `eda6baa` `47999fd` `83f2fa0` `f59f931` `a612503` `4e1c633` `bd46b03` `6d16796` | ai-provider keyless 端点/空白模型名 remap（重实现候选）；shell 重命名拒绝保留字/recents 过滤；sheets replaceOccurrences 空针；pdf/docs/electron-utils Windows 保留名与 drop 容错；sheets New chat 清附件 |
| 9 | 终检 | — | 全库品牌 grep 终检；lock 终态核对；40 sha 对账表+非重叠文件与上游 HEAD 逐字节一致率报告；adapted/裁定清单汇总；台账定稿（终点 sha 写入 §5）；合 main |

批 1/3/7 三个巨件是主要开销；小修批推进快。预算参考：全部拉齐 ≈ 12–20M tokens；退路（需用户明示）＝批 3/7 中纯特性增量退 P3 分期 ≈ 6–10M。

## 5. 每批作业 SOP（逐批照做）

1. 确认在 `sync/upstream-202609` 分支、工作树干净（`git status` 只允许 `e2e/worker-path-check.mjs` 这个外来未跟踪文件存在）。
2. `git cherry-pick <sha>`（按 §4 顺序逐个；巨件批只有一个 sha）。
3. 冲突按 §3-Q3 三档裁决；「行为差异裁定」场景**停下问用户**，把问题与结论记入 §10。
4. 去品牌 pass（§9 映射表；豁免 `GENOFFICE_*`、`genspark.ai` URL/host 串）。
5. 若本批涉及依赖变更：手工并 `package.json` → `npm install` 重生成 lock → 冒烟。
6. 门禁（全部绿才算过）：
   ```bash
   npm run test        # 全工作区 vitest
   npm run typecheck
   npm run lint
   ```
   外加品牌 grep 闸（对 `genspark|GenOffice` 全库扫描，豁免清单外必须零命中）。
7. 汇总本批 `adapted:` 清单 → 回写本文件 §6/§10。
8. `git checkout main && git merge --no-ff sync/upstream-202609 && git push`（merge 提交中文领域 title，如 `上游同步 批4：ai-provider 重实现×2+六连修`）。
9. 在本文件 §5 下追加一行批进度（见下方进度表），push。

### 批进度表（施工中逐批追加）

| 批 | 状态 | 完成 commit | 备注 |
|---|---|---|---|
| 0 | ✅ 2026-09-07 | — | upstream remote（本地路径 /Users/zyh/work/genoffice）+fetch+分支已建 |
| 1 | ✅ 2026-09-07 | `ec34ea3`（pick）+`be7a46a`（门禁基线修复） | 42 冲突（27 UU+15 AA）全三档裁决：**本地 HEAD 已含 2239cce 全部意图，pick 净效果仅 agent-core electron-transport +20 行（2 个 overload errorCode→busy 消息测试用例）**。AA 15 件=本地品牌版胜（测试×3/cf-formula-fold/overload-error×2/图标 8 件/gen 脚本）；UU 27 件逐 hunk 核验后 keep-ours（品牌引用×7；本地架构区 ai-ipc·markdown AiPanel·sheets-main·docs-main 均已实现上游意图；本地超集 pptx-engine·agent-core·slide-ops；slides App.tsx 解冲突后 diff HEAD=空）。无 adapted: 件。门禁基线修复（皆先于本任务即红）：pptx-render tsconfig 补 DOM lib、lint error 39 处清零+eslint 忽略 .tmp/dsh-plugin vendor、docs ai-generate-image 补 imageSearch 桩；12 个 react-hooks warning 为基线行为判断保留。test 1417+1996+642+564…全绿/typecheck/lint/品牌 grep 四闸过 |
| 2 | ✅ 2026-09-07 | `260bc38`(空)/`0e48502`/`7a1cc17`+adapted 提交（见 git log） | `3548a80` table-hit 与本地仅品牌 import 差异→**空 pick 补空提交保对账**（提交在 566c1f3 之后，时序注记）；`566c1f3` agent-core generation 守卫干净叠加（本地 409 行已有第一处守卫，上游补 maybeCompact 第二路径，中间地带#5 无需改写）；`93b8938` 分节页边距/pct 表宽 pick +142/-13，pagination.ts dx 公式本地「最宽纸居中」超集胜，**adapted：pagination-gaps.ts alignGapHfStrips 融合**（本地 per-section secLeftPx+上游 --gap-ml own-inset 优先级 own→data-sec→shared；自动合并曾残留上游变量名致 typecheck 红，已重写修复）。门禁：docs 1421 全绿/全链 exit 0/typecheck/lint 0 error/品牌零新增 |
| 3 | ✅ 2026-09-07 | `67b6df0`（490 文件 +131k/−110k） | 9-02 Sync 巨件。**i18n 重构落地：上游每语言文件结构整体采纳**（ai/app/dialogs/panes/ribbon 10 域×19 语言 195 shard），写三方合并脚本（本地 HEAD/baseline 583a045/上游 shard；规则=上游键值胜、本地改值胜、本地独有键追加），本地键入 shard 计 docs-ai 18/docs-ribbon 48/sheets-ai 18/sheets-app 121/slides-ai 43/slides-panes 1/slides-ribbon 132（每语言），both_changed=0；strings-*.ts 换上游薄 import 版（@chatoffice 品牌）。**pagination 单体→barrel 重构采纳**（上游拆 pagination-{types,sections,slices,hf,measure,lines}，本地 export 面为子集零移植，BlockBox 本地字段已在上游 types 中）。**Rust xlsx-engine 模块化重构采纳**（上游拆 visuals/{charts,colors,drawing,styles,tests}+workbook/worksheet/xml_util +11.8k 行；本地四件套 PictureSrcRect/PictureLum/editAs/PictureShadow 移植进上游结构体+drawing.rs 四构造点接线；上游 crop 0..1 模型并存——desktop-api zod 双收 crop+srcRect，preload 白名单补 6 组本地字段+crop 解析器防 tripwire 字段吞噬）。**字体链（中间地带#1）落定**：Carlito 三处同构建（f3737360）统一入 packages/ui/fonts（exports ./fonts/*），slides main/fonts.ts 改 @chatoffice/ui 引用+assetFsPath 规范化（vitest `/@fs/...?asset` URL→真实路径，内置字体测试环境可读）；fonts.css 整体采上游（本地对它零改动）含 Poppins 子集（GenOfficePoppins→ChatOfficePoppins 二进制+引用改名）；docs/fonts.css 契约测试驱动发现本地 W6 Hiragino Mincho 为基线遗留非本地特改→从上游（weight-normal+合成粗体）。**ai-provider gemini 端点情报采纳**：上游注释「gemini 端点 2026-08-31 服务端 405 已移除」→registry.ts/settings-v2.ts 双处路由改 claude→anthropic、其余含 gemini→openai-compatible，测试×3 adapted。其余：shell missing-recents 件融合进本地三栏 Home（confirmMissing 状态+missing 类名+chatOffice 桥名）；Home recent-files 保 remote 分支+采上游 missing:true catch 语义；sheets WorkbookVisuals 保本地渲染超集+采上游 OLE 件（ole-visual/VisualDeleteButton import 并集，本地裸✕钮淘汰）；删除 18 文件照常（Carlito×8 移动语义/verify-slide-copy-across-decks UD 本地仅品牌差异→删）；README/CONTRIBUTING/CLAUDE 按 Q5-② 还原跳过；pdf-lib 依赖入 sheets package.json+npm install；全树品牌 pass 183 文件（@genoffice→@chatoffice 等 14 组映射，豁免保护 genspark.ai URL/@genspark/cli/GENOFFICE_* env/LEGACY_PROFILE_ID）。门禁：29 工作区全绿（docs 1599/sheets 2285+Rust 161/slides 670/shell 240/pdf 564…）/typecheck 0/lint 0 error（12 react-hooks warning 基线）/品牌 grep 全树零命中（豁免外） |
| 4 | ✅ 2026-09-07 | `15efb7f`/`732aa91`+adapted/`dc78f0e`/`4669f3f`/`6f71780`空提交/`f30a301` pick+adapted 提交 | 六连修。`99d376b` 干净；**`f105f36` 每回合 token 上限重实现进本地 v2 架构**（中间地带风格）：AiSettingsV2 根 maxOutputTokens（读/迁移/归一四处 clamp）+runtime runStream 用户上限中间优先级（request→用户全局→每厂商 maxOutputTokensFor）+ui ModelDefaultsPage 数字控件（draft/blur 提交）+shell strings 19 语言（keep-both 后去重：本地已有云工具串只收 maxTokens 新键）+legacy AiSettings 同步字段；`e833fff` 竖排文本干净；**`2dab773` Gemini schema 消毒（中间地带#2①）本地 gemini 协议干净落地**（sanitizeGeminiSchema+toGeminiParameters 接线在 252 行调用点，无需改写）；**`6f71780` stopReason 转发=空 pick**（本地 runtime runStream 已有 onStopReason→done 转发，上游意图已实现，补空提交对账）；`f30a301` non-JSON 200 干净。门禁：全工作区绿（ai-provider 186/ui 79 新增含 adapted 断言）/typecheck 0/lint 0/品牌零新增 |
| 5 | ✅ 2026-09-07 | `…`（七件 pick，见 git log 2e83d32→360ce06 段）+adapted 提交 | 七连。`eec2737` 预览标记干净；**`4846ace` 保存串行化（中间地带#3①）adapted**：上游 saveTail promise 链外壳包住本地三分支保存处理（ok/error/首存对话框取消），随附 save-serialization.test；`4770d9c` Gemini3 温度干净（中间地带#2③ 无需改写）；**`2910486` Tavily 兜底干净落地**（原生 fetch+TAVILY_API_KEY，无 npm 依赖变更，Q5 依赖清单空收）；注释冲突按本地品牌术语融合；**`d8e233c` 元文件按 Q5-② 处理**：CONTRIBUTING 保留本地版+摘抄 TAVILY_API_KEY 入 env 表+空提交对账（cbbbe14）；`9439d3e` docs RTL 面板 adapted（isRtl/dir=auto 融合本地 tabs+模型徽标，去上游 asideRef/resizing 残迹）；**`360ce06` slides agent 生命周期（中间地带#3③）干净落地+测试 adapted×4**（settings mock 换 defaultSettingsV2、importActual/品牌、aiChatOfficeStatus 桩、run 断言补本地音视频第三参）。门禁：27 工作区全绿（slides 675）/typecheck 0/lint 0/品牌零新增 |

**上次同步终点（下次续 pick 的起点）**：未记录（首轮进行中）。

## 6. 预登记中间地带件（Q3 第三档，施工时逐个手工合并）

1. **字体链**：Carlito 删除 + 上游 `embedded-fonts.ts` × 本地 `apps/slides/src/main/fonts.ts`（harfbuzz wasm 懒加载/BFF 降级改造）→ 保本地懒加载、采上游字体清单、加字体加载断言。
2. **ai-provider 全系列 5 件**（`2dab773` schema 消毒、`f30a301` non-JSON 200、`4770d9c` Gemini3 温度、`959df83` keyless 端点、`83f2fa0` 空白模型名 remap）→ 本地 BYOK 多协议架构上**重实现**，不贴 patch。
3. **slides 保存/agent 生命周期 3 件**（`4846ace` 串行化、`ea13074` saveAs 队列、`360ce06` 生命周期）→ 本地 generate_deck 改造区叠加。
4. **`strings-ai.ts` 逐 key 合并**：本地已加 imageSource 等 18+1 语言 keys，上游同期也改了此文件。
5. **agent-core compaction**（`566c1f3`）：本地 agent-core 有自有改造。

## 7. 风险登记

- **Rust/wasm 工具链**：9-02 Sync 含 16 个 `.rs` 与字体构建脚本（`tools/build-poppins-font.py`、`build-meiryo-ui-kana-font.py`），本地若无法复现 wasm 构建，相关测试处置走 Q6 规则并记 §10。
- **巨件冲突密度未知**：批 1/3/7 动手前只能估，实际冲突超预期时按批暂停、向用户报告再继续。
- **上下文预算**：多会话作业，每批合回 main 即安全存档点；新会话从本文件恢复上下文。

## 8. 验收口径（批 9 完成=全部拉齐）

1. 40 个上游 sha 全部有对应本地 pick 提交（对账表入台账）。
2. 非重叠上游文件与本地上游 HEAD 逐字节一致率统计（预期 100%，差异逐个解释：去品牌映射或裁定件）。
3. 终态门禁全绿 + 品牌 grep 零命中（豁免除外）。
4. adapted/裁定清单完整、可抽查。
5. 本文件写入终点 sha，下次同步可增量续作。

## 9. 品牌改名映射表（施工中维护，后续同步机械重放）

| 上游 | 本地 | 说明 |
|---|---|---|
| `GenOfficePoppins-*`（字体文件名+family 表+引用） | `ChatOfficePoppins-*` | 含 `apps/docs/src/renderer/fonts/`、`embedded-fonts.ts`、`tools/build-poppins-font.py` |
| `GenOfficeUIKanaJP-*` | `ChatOfficeUIKanaJP-*` | 同上，`tools/build-meiryo-ui-kana-font.py` |
| 用户可见字符串 `GenOffice` | `ChatOffice` | i18n prompts、UI 文案 |
| 豁免：`GENOFFICE_*` 环境变量 | 不改 | 既有约定 |
| 豁免：`genspark.ai` URL 值与 host 匹配串 | 不改 | 改=断功能 |

## 10. 裁定记录（施工中追加）

| 日期 | 上游 sha | 争议点 | 用户裁定 |
|---|---|---|---|
| — | — | — | — |
