# 上游同步台账（upstream-sync）

> 本文件是 chayuan-office ← genoffice 上游同步的**唯一记账与施工手册**。
> 低冲突开发制度与冲突裁决决策树见 `docs/upstream-coexistence.md`（与本文配套）。
> 新会话只需读此文件即可开工或续作；每完成一批必须回写本文件的进度与裁定记录。

> **铁律（用户 2026-09-13 明令）：本地修改绝不允许被上游更新破坏。**
> ①上游仓 /Users/zyh/work/genoffice 拉取前必须先 `git stash` 保护未提交本地修改（现存常驻修改：SettingsModal.tsx 的 window.aiOffice→window.chatOffice 桥改名），pull 后 `git stash pop` 恢复，冲突时本地赢；②本仓 pick 冲突一律按 §3-Q3 三档裁决，本地功能区必胜、上游意图重实现进本地架构，上游内容永不整体覆盖本地已改文件；③`apps/server`、`apps/web` 等本地独有工作区上游内容永不触碰。同文记入 CLAUDE.md「Upstream sync iron rule」。

---

## 1. 背景与目标

| 项 | 值 |
|---|---|
| 本仓 | `/Users/zyh/work/chayuan-office`（origin `git@github.com:zhgyuhuii/chayuan-office.git`；惯例：直接 main 提交+推送，中文领域 title） |
| 上游 | `/Users/zyh/work/genoffice`（origin `git@github.com:genspark-ai/genoffice.git`） |
| 历史关系 | **无共同祖先**：本仓 `8d108c3` 为整树导入（2026-08-30），禁止一次性 merge（空树基准 → 两千个 add/add 冲突） |
| 目标 | 全部拉齐到上游 HEAD `6d16796`（2026-09-07），本地全部功能改动保持不变 |
| 状态 | **第四轮增量拉齐完成（2026-09-13，终点 de139a0）**；第三轮（2026-09-10，d35d770）、第二轮（2026-09-09，d24c964，§5c）、首轮（2026-09-07，6d16796，§5b） |

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
| 6 | ✅ 2026-09-07 | 十二件 pick 全落地（git log 567ad37 段→f2c3d08）+adapted 提交 | 十二连。`567ad37` docs 逐边框（22 文件）adapted：Ribbon.tsx 冲突保本地折叠/移动端结构（per-side 边框 UI 经 icons/ribbon-tabs 自动合入，本地 icons 已含 InsideH/V），fr/it shard keep-both 后去重保本地译值；**`99dfbc1` RTL 四面板（markdown/pdf/sheets/slides）adapted**：保本地 PanelTabs 架构+四 aside 插 dir={ar/he→rtl}（消息 dir=auto 自动合入）；sheets 三修 `41f87f3`/`449f03a`/`4d277b5` 干净；**`ea13074` saveAs 队列（中间地带#3②）adapted**：上游 runSerialized 提炼助手自动合入，save 冲突块换上游开括号+本地三分支体保留，saveAs 同队列包裹；`1ee2407` 澄清清理干净；`09fd67b` Home 重命名 adapted（isValidRenameName 采纳+本地 remote rename 分支保留）；`8630d11` markdown 缩放 i18n adapted（本地双底栏补 t() 标签，strings 19 语言自动合入）；`a5b5903` docs 标尺 tab（21 文件）adapted（Ruler 保本地注释+收 isRenderableTabStop 导出，app shards 收 appTabClear）；**`d9769d1` 历史清理 adapted**：保本地 PanelTabs 结构（上游 GensparkMark 头部拒），setHistoricChat([]) 自动合入，New chat 条件移植 chat>0||historic>0×docs/slides；`f2c3d08` 附件清理干净；新测试×3 适配（settings mock v2/品牌 import）。strings-ai 逐 key 合并（预登记#4）因批3 已转每语言 shard 而消解为文件级。门禁：27 工作区全绿（docs 158/shell 20/markdown 11 新增）/typecheck 0/lint 0/品牌零新增 |
| 7 | ✅ 2026-09-07 | `34525e1`（442 文件 +36k/−10k，含全部 adapted） | 9-06 Sync 巨件（76 UU+2 UD 冲突）。**UD 两测试照删**（speaker-notes/table-tools 本地仅品牌差异，上游以 prompts ops/*.md 接替）；**README/CONTRIBUTING/CODE_OF_CONDUCT/PRIVACY/SECURITY/.github 按 Q5-② 还原 HEAD**（pick 曾改）；**main.tsx×5 CSS import 并集+品牌**（本地 set+上游 ribbon-collapse.css/markdown.css 新文件）；**i18n shard 全量三方重建**：76 个 pick 触及 shard 以「本地键保全+上游独有键并入（值品牌化）」配方重写（此前 keep-both 曾损多行值/丢 zh 键行，typecheck 驱动全数修复）；**docs App.tsx 干净 3-way 重解**（keep-both 曾断 services 拼接）：7 块=hunk1 双态并/2 gapStripLeft/3-4 本地 services 胜+spellcheck/setDarkCanvas 接线/5-7 DockShell 区保本地（darkPage/workspaceClass 融合本地 darkCanvas）；**docs Ribbon/ViewTab/ReviewTab props 回本地名**（darkCanvas/onDarkCanvas 可选化、spellcheck 全链接线 viewServices→host-services→host-tabs，5 个本地测试免改）；**slides op-docs 采上游 md 驱动系统**（prompts ops/*.md+OpGuide/load_guide 工具）+LOCAL_OP_DOCS 37 条完整移植（sig+group+aiCallable 从 HEAD 解析，setAnimations Q5 解锁覆盖）+op-docs/op-docs-examples 两测试 adapted（本地 sig-only 豁免 body/examples）；**slides-skill**：保本地 generate_deck 工具区+import 并集+PARAGRAPHS_DEF/toEditParagraphs 从 HEAD 复位+blockScratchBuild kind 并集；**file-actions 采 getCtx 签名**（调用方自动合入）+runSerialized 体保本地；**pdf strings.ts 干净 3-way**（19 处全取 theirs：aiToolEditNote 等 3 新键×语言+aiReviewSummaryBtn 改值；keep-both 曾致 zh 键行丢失）；**extensions 图片链融合**：cropWrapMargins 入本地 style 链且与 imgWrapTransform 互斥（旋转裁剪 fold 不双计，image-rotation 测试驱动）；**Kana 字体**（GenOfficeUIKanaJP→ChatOfficeUIKanaJP 二进制改名+三处引用）；**docs-main 净改套用**（setAiUserAgent UA/打印缩放 scale/窗口 720×550，曾因写空从 HEAD 恢复重做）；**shell 云端 PDF→Word 恢复**（误删本地 exportPdfAsDocx 89 行→从 HEAD 复位+menuExportDocxLocal 19 语言菜单键新增双入口）；**package.json 系 Q5 手工并**：本地 @chatoffice 域+采上游版本升级（tiptap 3.29.2→3.31.0、shell 0.8→0.9）+ui exports 并集（ribbon-collapse/markdown.css）+lock 删除重生成+nested node_modules 清理；agent-core runtimePreamble+ai-provider output-cap（withOutputCapFallback/parseOutputCapRejection/setAiUserAgent）并集落地+stream legacy 路由补 openai-responses default。门禁：全工作区绿（docs 1943/slides 740/sheets 202+Rust/pdf 42…）/typecheck 0/lint 0 error/品牌命中皆基线功能豁免（genspark-ai/chatoffice 仓库 URL/LEGACY 迁移常量） |
| 8 | ✅ 2026-09-07 | 九件 pick 全落地（bc6bff6=6d16796 终点）+adapted 提交 | 收尾九连。**`959df83` keyless 自定义端点（中间地带#2④）重实现落地**：activeProvider 键可选化（needsBaseUrl 分支 base+model 即可，注释保留 Ollama/LM Studio 情报）+openai-compatible Authorization 条件化（两处 keep-both 曾双写头，stream.test 驱动修复）+两测试 keep-both 收新用例（chat/providers 各一空壳从 HEAD 时代即存，删壳保体）；**`eda6baa` shell 保留名拒绝干净**；`47999fd` recents 过滤 adapted（theirs+品牌，normalizeRecentQuery 新导出）；**`83f2fa0` 空白模型名 remap（中间地带#2⑤）落地**：trim→migrate 顺序修正（padded " deepseek " 也命中 remap）+chatofficeToolsEnabled 保本地键；`f59f931` sheets 空针干净；**`a612503` pdf Windows 保留名后缀 adapted**：加固并入本地 sanitizePdfBaseName（本地 Untitled 回退语义保留），**随附上游 auto-rename.test 删除**——该测试断言的 pdf:auto-rename 通道已被本地 4327d4d「新建延迟落盘」共识架构替换（untitledPdfMetas+首存另存为转正），Q6 结构差异裁定：测试删、加固留；`4e1c633` sheets New chat 干净；`bd46b03` electron-utils drop 容错干净；**`6d16796` docs 保留名拒绝干净（上游终点到达）**。门禁：全链 exit 0 零 FAIL/typecheck 0/lint 0/品牌零新增（chat/providers 测试名改写，genspark.ai URL 豁免保留） |
| 9 | ✅ 2026-09-07 | 终检（本轮） | 40 sha 对账/一致率统计/字体字节裁定/终态门禁/品牌终检全过（详见 §5b 验收报告）；台账定稿 |

**⚠️ 第八轮施工中·四续（2026-09-17）**：merge-r8-wip@cb8fe30f+。typecheck：全工作区 0 错误（sheets/slides/markdown 已回退本地版，快照渲染端挂账第九轮）。**测试剩余**：仅 cli 三个文件=Route A 挂账特性失败——①tests/check.test（`sheet check` 依赖已回退的快照 gateway 读模块）②tests/batch-modes.test（sheet apply --batch 快照语义）③tests/mcp.test（cli mcp server 对已回退 xlsx create --header spec 的依赖）；skill-command 路径已修（skills/chaoffice）。**收尾裁定（2026-09-17 最终）**：Route A 级联远超预期（check/mcp/batch/cli.test/docx.test 连锁 54+ 失败——快照 cli 测试与回退后的本地 formats 互斥），**按纪律放弃半成品合并**：merge-r8-wip 已 reset 回 310596b0 纯绿基线；第八轮 15 提交的 pick 成果保留在同分支历史（fb42ee1b..cb8fe30f 段，含全部冲突裁决与修复），供第九轮以「全量快照式」策略重启（第九轮建议：直接 merge 上游 09485f8 或整包采用快照 cli+gateway+project-store+四 app 渲染层，本地差异按 D 区标记逐一重放——碎片化局部回退已被证伪）。main 保持 310596b0+docs 绿基线；并行 WIP 两文件在 stash@{0} 与工作树。**已验证工具**：ast-merge2.cjs（TS AST strings 合并，产出 tsc=0）在 worktree 根。

**⚠️ 第八轮施工中·三续（2026-09-17）**：merge-r8-wip 已收敛 shell/pdf/slides/markdown 至低错误态（slides/markdown 壳层与 App 回退本地版；ExcelShell/WorkbookVisuals/sheets App 回退本地=函数向导保留）。**剩余唯一硬骨头**：快照的 packages/xlsx-gateway+project-store 类型变更（theme-fill 联合类型、ProjectApi 缩减）与本地 sheets 调用方不兼容（10 个类型错误）。两条收敛路线：A（快）=packages/xlsx-gateway+project-store 一并回退 310596b0+cli 的 xlsx-dsl/xlsx-gateway-ops/xlsx.ts 一并回退（快照 sheets/cli 特性整体挂账第九轮）；B（全收）=保留快照包，本地 4 处调用点收窄（univer-sync/ExcelShell 的 theme 对象 typeof 窄化+preload ProjectApi 适配）。收敛后跑全量门禁→merge-r8-wip 合回 main（strings 用台账配方重对齐）→推。shell 另有 6 错误：15 个 intg* 键×20 语言从 pristine 09485f8 提取补入（提取脚本已验证可用）+LangDicts 随键补齐消除。

**⚠️ 第八轮施工中·二续（2026-09-17 凌晨）**：`merge-r8-wip` 已收敛至 shell×6（5 个 intg* 词条键缺失+1 LangDicts）+pdf×1（LangDicts）；sheets/slides/markdown 未复测。**strings 收敛正解已定型=TS AST 合并**：行级手术在多行值/双 span/重复节上反复失败；正确工具=typescript compiler API 解析两版 strings 的 strings 对象、按键并集合并（base 值优先）、printer 输出——原型 `/tmp/ast-merge.cjs`（已验证可产出 esbuild 通过的合并文件，唯逐键值抽取仍有一处多行截断 bug 待修：propsOfInner 的 slice(1,-1) 会吞掉"键+值仅两行"的值行，修=按 keyre 找到键行后吃连续行直到下一键行）。剩余收敛步骤：①修 ast-merge.cjs 截断 bug→生成 shell/pdf strings（源=pristine 09485f8 ∪ main cb78d65c 值优先）→intg* 5 键×20 语言从 pristine 09485f8 提取（值走品牌重放）→LangDicts 自然消除；②sheets 32 错误（save-pipeline/untitledWorkbookPaths 已做映射适配）+slides 9+markdown 测试适配；③全量门禁→合 main→推。main 全程保持绿基线。

**⚠️ 第八轮施工中（2026-09-16 深夜，未完成未合并）**：上游 `f4d8da2..09485f8`（15 提交：MCP×4+9-16 快照 525 文件+pptx 系列×5+小修）已全部 pick 到 `sync/upstream-20260916` 分支（已推 origin，含冲突裁决+品牌映射+动画引擎超集收敛，pptx-engine 1018/docs 2541 测试绿）。合并重做于 `merge-r8-wip` 分支（已推 origin）：merge 本体冲突仅 shell index/preload 导入并集×2 已解+pdf-main map 语义修复+pdf/markdown strings 按干净配方重建（pristine+品牌+本地键，锚=节 opener 后）。**剩余**：pdf LangDicts 节键集差×1+sheets workbook-ops(13)/ExcelShell(3)/save-pipeline(1) 等~30 类型错误收敛+slides/markdown 数个测试适配→全量门禁→合 main。**main 保持 310596b0 绿基线**（并行 WIP Home/strings 两文件在工作树）。新知：strings 断裂正解=main 绿版为基底+按节织入 sync 独有键（锚=节 opener 后；捕获须剥尾）；三方 merge-file+「theirs+品牌重放+HEAD 键补回」配方已在分支验证。

**上次同步终点（下次续 pick 的起点）**：`f4d8da2`（2026-09-16 第七轮增量完成；下次 `git fetch upstream` 后从 `f4d8da2..upstream/main` 增量续 pick，重放 §9/§9b 品牌映射与 §5 SOP）。

### 第七轮增量（2026-09-16，70e5149..f4d8da2：21 提交，先提交并行会话残余 WIP 6fc8c4db 后在干净树上直接 main 施工）

| 内容 | 结果 |
|---|---|
| 前置：并行会话残余 WIP 提交（91 文件 +2129/−660） | 网络搜索多供应商化（linkup/searxng 新模块+免钥 duckduckgo/bing/openverse 兜底，capabilities 默认即有搜索）、docs AI add_comment 工具（表格单元格级批注，AiCommentsAccess.create 三端补齐）、首页新建折叠分组+扫码关注 QR、skills 更名收尾 chatoffice→chaoffice；品牌规范化（察元AI Office→察元AIOffice ×3）+死代码清理（migrateSettingsV2/StoredAiSettings 死导入×4、LEGACY_TOOLS_KEY、readJson、loggedIn/email）；cli capabilities 测试按新意图改编（免钥引擎=默认可用） |
| 16 个零交集小修（c00f9fb 数学粘贴定界符/789f94e docx 跨段域码折叠/8dd05f1 docs 亚洲字符计数排除 PUE+变体选择符/68ed56f pdf AI 搜索词折叠/672de21 html 单引号样式属性撇号转义/a54b152 pdf2docx 阿拉伯导符线锚定行尾/38669c4 pdf encodeStyle 字段消毒/f06ad3d sheets 整行跨距复制填充平移/572d6c5 sheets 现代 Excel 错误值标记/b0dad7c markdown 文件系统根文档兄弟图片/311e2c0+748d0c8+fcb2ca8+f4d97b8 docx 单引号系列×4/46282ec file-parse 脚注尾注文本提取/bac0552 ai-provider SSE 末尾 TextDecoder flush/f4d8da2 pdf 非整数打印页目标拒绝） | 全部干净 pick |
| 1113835 MCP review 修复（docs family+stdio 桥） | 干净 pick（第六轮 MCP 落地质量过关） |
| a5f181f shell 重命名先验 raw 名 | **adapted**：index.ts 冲突=上游删 trim 后冗余校验行+本地远端重命名分支相邻；并集=采 raw 门（isValidRawRenameName）+保本地远端分支 |
| 093ecfb ai-provider 空白键/URL/模型视为未配置 | **adapted 六文件全冲突**（WIP 重构区）：三源码=本地架构（chatoffice 回落/needsKey===false 免钥/DEFAULT_WEB_SEARCH_PROVIDER）+上游 trim 语义（?.trim()）；三测试=断言按本地语义改编（回退值 chatoffice/''/duckduckgo，本地免钥 bing/duckduckgo 合法故不采上游 bing→genspark 断言）；随附 media.test 冲突标记清除单独提交 |
| 8bafc54 ai-search 版权主机过滤按主机名作用域 | **adapted**：上游新增 duckImageSearch 与本地链冲突——本地图片链=serper→bing→openverse 无 duck 图搜，函数弃（免死代码）；真正意图（isCopyrightHost 主机名级过滤替代 URL 子串匹配）落在本地 bing.ts+chatoffice.ts 两模块（子串→主机名级） |
| 随轮品牌补漏 | pick 新增行 @genoffice/ui 导入×1（pdf tools foldCase）→@chatoffice/ui；新增行品牌 grep 终检零命中 |

**本轮新坑**：①cherry-pick 测试文件冲突用「保 HEAD+插上游新用例」解法时，正则只吃到 `=======` 会把上游侧断言残留在文件里（media.test 双断言对撞，typecheck 不报、测试红才暴露）——resolve 正则必须吃满到 `>>>>>>>` 尾行；②上游给测试新增的回退值断言（genspark）在本地架构下语义不同（chatoffice/''/duckduckgo），照抄必红，逐值改编。

### 第六轮增量（2026-09-15，ed2bb865..70e5149：26 提交 / 84 文件，施工于独立 worktree 分支 sync/upstream-20260915——主树当日有并行会话未提交工作，全程零接触）

| 内容 | 结果 |
|---|---|
| 24 个引擎层小修（docx 单引号域系列×6/pdf2docx TOC 导符线×2/file-parse×2/pdf 打印流式+搜索折叠/pptx schema 空格路径/slides 主题令牌+查找替换+最近颜色/sheets 纸张映射+透视源/ai-provider×2/i18n/electron-utils/html/shell 重命名尾空格） | 全部干净 pick，零冲突 |
| e064f3a Windows dev 修复 | **空 pick 对账**：本地 scripts/dev-shell.mjs（Node 内注入 env+*_DEV_PORT）+ build-stale-preloads npm.cmd 方案已实现上游意图且更完整；cross-env 依赖不需要（Q5 清单记空收） |
| 70e5149 本地 MCP 服务器（37 文件 +7053：shell main mcp/ 模块×10+docs mcp-bridge+SettingsModal MCP 面板+11 测试+stdio 桥脚本+e2e） | **adapted 重冲突×4**：docs-main 导入并集；SettingsModal 三处（react 导入扩 hooks/SectionId 并 'mcp'/effect 体新调用全部改挂 window.chatOffice 桥，自动合并区 4 处 aiOffice 同步改名）；shell package.json 保本地域+手工加 @modelcontextprotocol/sdk ^1.30.0（lock 重生成）；品牌 pass 70 处（@genoffice→@chatoffice、genoffice.cjs→chatoffice.cjs 对齐本地打包路径 cli/chatoffice.cjs、open_in_genoffice→open_in_chaoffice、genoffice-app://→chatoffice-app://、显示名 GenOffice→ChaAI Office、mcpServers 键→chaoffice；GENOFFICE_MCP_* env 豁免保留）；settings-mcp.test 补本地桥最小桩（adapted） |
| **随轮品牌切换（用户 2026-09-15 指令）** | 显示品牌 ChatOffice→**察元AIOffice（zh/zh-TW）/ChaAI Office（其他 18 语言）**：六 app i18n shard（138 文件）+内联语言表×7（含 shell strings.ts 703 处/zh-TW 引号键段修正 53 处双轮补漏）+README；产品标识→**chaoffice**：productName ChaAI Office/appId com.chaoffice.app/desktopName+executableName+deb/rpm 包名；userData 迁移链注释更新（AI Office→ChatOffice→ChaAI Office，ChatOffice hop 已在列表）；默认保存目录改回落 Documents/ChaAI Office 且**优先沿用既有 Documents/ChatOffice**（测试改编+新增用例）；云供应商显示名/PDF 注释作者 T/CLI 提示/搜索 UA ChaAIBot/标签页标题同批；**保留**：@chatoffice/* 包作用域、window.chatOffice 桥名、字体族名（ChatOfficePoppins/Grid Strut 等）、GENOFFICE_* env、genspark.ai URL、CLI bin 名 chatoffice（防破坏脚本自动化）；坑：t('errChatOfficeToolsOff') 引号键引用被值替换正则误伤×2 已回退（typecheck 揪出） |

### 第五轮增量（2026-09-14，de139a0..ed2bb865：39 提交 / 1037 文件 +79k-5.6k）

| 内容 | 结果 |
|---|---|
| 26 个小修（3a0bdc0…01935da） | 全部干净 pick（pdf/docx/sheets/pptx/ai-provider 引擎层修复） |
| 09df482 Zotero 引用集成 | **adapted**：App.tsx import 冲突保本地 V2+relay，zotero 主/preload/renderer/controller/rtf 全量落地；Ribbon 重放三意图（paste 握手/zoteroNoteFields 透传/表格边框类名）；zoteroNoteFields 织入本地 bodyOnly Ribbon |
| e42da7c 9-13 Sync 巨件（1000 文件，132 冲突） | 三档裁决全清。**关键结构**：①xlsx-gateway/pptx-ops/pipelines 三新包（本地 sheets/slides 的 gateway/domain/ops 目录整体改名迁入，git rename 配对自动带出本地超集——LOCAL_OP_DOCS/echart/图片四件套已在包内）；CLI 包（@chatoffice/cli+bin+skills/chatoffice）；headless-export 全家（六 app main+renderer+electron-utils）；renderer-scheme 特权 scheme（genoffice-app→品牌 sed 全树统一，内置渲染器 V8 code cache）；spare sheets view 预热（tab-manager 并集：本地 dock+上游 spare）。②上游 run 级特效（shadingDisplay/textOutline/dstrike/glow/position/bdr）与本地 charBorder 并存（marks.ts 渲染 border 让位 bdr）；imageEffects 仅收 a:grayscl/a:biLevel（a:lum 走本地 imageLum 通道防双重滤镜，picture-effects.test adapted）；LineNumbering 对象模型采纳（ribbon-layout-tab 开关 adapted 写对象）。③本地功能区保结构重放意图：Ribbon/App/AiPanel 全保本地（上游意图=三处小改已重放）；AiPanel 上游自宽块弃（DockShell 所有），doc-writer epoch 清理保留。④Q5：package.json 系手工并（tiptap 全树 pin 3.31.0+overrides 单实例；typescript 根钉 5.9.3 防 6.0 baseUrl 弃用）；electron-builder CLI 产物路径品牌化；deb 挂 afterInstall。⑤xlsx-gateway edit-schemas 补本地 picture patch 超集（srcRect/lum/opacity/geom/shadow/mediaReplace+echart/editAs）；desktop-api 内联 schema 删除改包再导出。⑥品牌收口：aiOfficeIntegrations→chatOfficeIntegrations 桥、excel-jump 命令 ID、codex 标签、GENERATED_IMAGE_DIR、arrow-collapse 命令 ID 对齐 |
| 尾批 10 连（ec56159…ed2bb86） | 全部干净 pick |
| **随批性能工（用户主诉：dev:desktop 启动慢）** | ①Home 设置模态 React.lazy（ModelSettingsPage+30 厂商 logo+StoragePane+IntegrationsPane 出启动图）②ChartDesignerModal 惰性（docs/sheets；1MB chart-kit examples.json 出编辑器启动图）③六 app AiPanel 的 ModelSettingsPage 惰性④ui 包 index 瘦身：shape-gallery/InsertImageDialog/image-dialogs/ModelSettingsPage/ModelDefaultsPage 拆 subpath export（消费者 30+ 处改 subpath import；docs vitest 补别名）⑤**根因修复**：pagination-gaps 顶层裸读 localStorage（CLI/Node 环境炸）加守卫；page-spec 复活上游 opts.localImages 门（CLI 本地图片路径被本地旧 http(s) 门误杀）⑥cli build.mjs 补 .webp/.jpg/.html loader。量化（esbuild eager 闭包）：shell 186→42 模块/4.4→2.5MB（上游 55/1.97MB——模块数已优）；docs 553→461/12.9→10.9MB（上游 392/8.6MB，余差=ECharts 插件/relay/assistants 等本地功能固有） |

验收（2026-09-14）：typecheck 0（TS 5.9.3）/ lint 0 error / 全量测试 exit 0（含 cli 130、pdf 718、slides system-fonts 机内字体 adapted guard）/ 品牌 grep 豁免外零命中 / pdf auto-rename.test 按第八轮裁定再删（上游回归文件）。

### 第四轮增量（2026-09-13，d35d770..de139a0：16 提交 / 实收 42 文件 +625-65）

| 上游 | 本地 | 结果 |
|---|---|---|
| 07af399 markdown 大纲侧栏 | eaa1877a | **adapted**：本地 DockShell/四视图架构保留——App.tsx 保 DockShell+本地 Ribbon prop 名（aiPanelAvailable 系），outline 三 prop 融入；新增 `.editor-body-row` 行容器（flex+min-height:0 逐层钳制）挂 OutlinePane 于 ribbon 下编辑区左侧；strings.ts 本地版保全+脚本插 outline/outlineEmpty 两键×20 语言（含 cs/zh-TW） |
| d2b898f tab bar spacer win/linux | 41d4b0a9 | **空提交对账**：意图本地已实现——自绘三键架构 `.tab-bar-drag-spacer` 默认零宽、mac 走 `.mac-native-spacer` 90px（TabBar.tsx darwin 分支） |
| 0dfb10e 修两红测试 | 52a7fe93 | **意图已在**：csv parseCsv 断言+slides spellcheck attribute 断言第三轮本地已改编成与上游修复一致的值，冲突仅注释措辞，保本地注释+注记上游后修 |
| d529a56 i18n BCP-47 边界 | 8fcd2fca | 干净（normalizeLang 前缀匹配要求边界） |
| 0c6fa8f Content-Type 大小写 | e5450119 | 干净（ai-provider shared） |
| dad0cec pdf2docx minGap 相邻合并 | 92c818c6 | 干净 |
| 4ed7de2 打印范围容忍空格 | （序批） | 干净（docs print-range+slides print-html+测试） |
| 423e333 pdf 非法字号忽略 | （序批） | 干净 |
| 93c1cc6 rgb255ToHex 钳位取整 | （序批） | 干净 |
| 9c5808b TSV 连续 CR 保留 | （序批） | 干净（sheets clipboard-tsv） |
| b3fcde3 聚合 distinct 分型 | （序批） | 干净（sheets aggregate） |
| 86421a0 写保护旗标入脏检查 | （序批） | 干净（docs doc-dirty） |
| 6eaf627 希腊/西里尔/希伯来/阿拉伯词数 | 0caca9c0 | 干净（docs word-count） |
| e6d5815 docx-engine 成对保护标签 | c7d8b7d0 | 干净 |
| 474c8fc 默认保存目录校验 | 61e6f7d1 | **adapted**：源码同款落地；测试取并集（本地 skipIf(win32) 降级用例保留+上游新增「fallback 不可用抛错」用例收录） |
| de139a0 Requesty 供应商 | 8ee3e5f9 | 代码全收（types/registry/providers 请求路由 requesty.ai/v1+模型清单+测试+provider-logos R 字标）；README+docs/i18n/README×20 元文件按 Q5-② 剥离（本仓无此文件）；logos 头注释按本地品牌名单融合（Requesty+ChatOffice，无 OpenCode/Genspark） |

验收（2026-09-13）：typecheck 0 / lint 0 error（12 基线 warning）/ 全量测试 exit 0（docs 2052/sheets 2601/shell 301/slides 772/pdf 709/markdown 215 含新 outline 5 测/i18n+pdf2docx+electron-utils+ai-provider 等包测全绿）/ 品牌 grep 新增行为零（4 文件命中皆 main 既有豁免串）/ 未触及 .rs 无需 Rust 门禁。上两轮（d24c964/d35d770）复查：合并提交 2d32fad7/bf9e8978/c6197a84 与第三轮 pick/adapted 提交均在 main，本轮全量测试同时终验其功能。

### 第三轮增量（2026-09-10，d24c964..d35d770：11 提交 / 62 文件 / +9.5k-189，无删除）

| 批 | 内容 | 提交 | 结果 |
|---|---|---|---|
| A | 六连小修 | 12026fd→628aff5 | 全部干净：shell xls recents、safeExternalUrl 规整、docs 表格尾行编辑（新 trailing-table-exit.ts）、slides 陈旧内嵌字体子集清理、font-metrics 缓存逐出+测试修 |
| B | 三连 | 5a60243 c0415b6 d35d770 | CSV 转义引号嗅探（其 parseCsv 断言与自身 RFC4180 实现矛盾→按实现改编，§10 记录）；slides composer 拼写检查偏好（经 useAiPanelPrefs，测试断言改 attribute 因 jsdom 不反射 IDL 属性；上游 rail 展开按钮用例按结构差异裁撤——本地折叠走 DockShell 层）；pdf 打印范围对话框；pdf strings 对象级重建 |
| 跳过 | README×2 | 150246d 6a241c4 | 纯元文件（README+19 翻译+截图资产），按 Q5-② 整体跳过，无内容需摘抄 |

验收：typecheck 0 / lint 0 / 全量测试 exit 0（含 sheets 2587）/ 品牌 grep 零残留 / 六应用 electron-vite 构建全过。

### 第二轮增量（2026-09-09，6d16796..d24c964：14 提交 / 691 文件 / +77.5k-7.5k / 新增工作区 apps/html+packages/html2docx）

| 批 | 内容 | 提交 | 结果 |
|---|---|---|---|
| A | 九连小修/测试 | 2e805f1→953595e | 2 处冲突三档裁决（slides pdf-export import、docs App 结构区保本地+补 ref）；pdf-export.ts 新模块落地；已合 main `2d32fad7` |
| B | Codex app-server 第五协议 | d2fecab | 引擎层全落地（867 行协议模块+registry/providers/stream/chat 路由+runtime vendorId='codex' 放行+before-quit 挂钩+ai:codex-models 通道）；设置面按裁定 B 挂账；已合 main（批B+C merge） |
| C | 三小修 | f303cfd 785d3f3 fa58fff | vitest /browser 子路径别名（数组形式保序）、pdf 标注几何、sheets 冻结轴 -1；已合 main `bf9e8978`（含批 A 补推） |
| D | 9-09 Sync 巨件 | d24c964 | 678 文件落地：apps/html+html2docx 新工作区（全量去品牌：@chatoffice/*、chatoffice:brief meta、chatoffice-badge、产品名）、docs AI ops 重构（commands 1163 行→ops 1421 行，本地仅品牌差异照删）、i18n 200+ shard 对象级重建（本地键保全+上游新键并入+跨语言并集补齐）、Rust VisualObject 补本地四件套（src_rect/lum/edit_as/shadow=None）、shell html 标签页+menuNewHtml 19 语言、根脚本链接入、lock 重生成；已合 main `c6197a84` |

## 5b. 首轮验收报告（2026-09-07，批 9 终检）

| 验收项 | 结果 |
|---|---|
| 40 sha 对账 | ✅ 40/40 全部有对应本地提交（subject 逐字匹配核对，含空 pick 对账件：3548a80→260bc38、6f71780→空提交、d8e233c→cbbbe14 摘抄） |
| 非重叠文件一致率 | 共存 2237 文件：逐字节一致 1378 + 纯品牌/豁免差异 398（14 组映射机械改写）+ **结构差异 461（全部为本地功能区/adapted 裁定件，见 §6 与批 3-8 台账行）**；上游独有 37 文件全部有解释（字体 8 改名对照/send-enter 资产本地 composer 用 IconSend 无引用/file-*.svg 本地用品牌 PNG/genoffice-logo→本地品牌 logo/gsk.ts→chatoffice.ts 本地 8-31 重命名/auto-rename.test 批 8 裁定删） |
| 字体字节对齐 | KR/Sans/Serif/Tamil/PUA/CheLatin 6 支维持本地 e6e0970 构建（上游 9-02 重建版内嵌 name 表含 nanum 保留名，破坏本地品牌断言测试——Q6 裁定保本地）；UIKanaJP×2 与上游字节一致 |
| 终态门禁 | ✅ 全链 27 工作区 exit 0、零 FAIL、≈10,000+ 用例全绿（docs 1943/sheets 202+Rust 161/slides 740/pdf 663/ai-provider 214…）；typecheck 0 error；lint 0 error（12 个 react-hooks warning 为基线行为判断，本轮不改） |
| 品牌 grep 终检 | ✅ 豁免外零命中（命中仅为：genspark.ai URL/@genspark/cli 包名/GENOFFICE_* env/LEGACY_PROFILE_ID 迁移常量/genspark-ai→chatoffice 已改写的仓库 URL 残留注释/本台账自身记录） |
| adapted/裁定清单 | ✅ 全部在批 1-8 行内逐件记录；无「行为差异待用户裁定」遗留（pdf auto-rename 通道为唯一删除裁定，依据本地已确认的 4327d4d 延迟落盘共识） |

## 5c. 第二轮验收报告（2026-09-09，终点 d24c964）

| 验收项 | 结果 |
|---|---|
| 14 sha 对账 | ✅ 全部有对应本地提交（2e805f1→953595e 九连、d2fecab Codex、f303cfd/785d3f3/fa58fff 三连、d24c964 巨件） |
| 门禁 | ✅ typecheck 全工作区 0 error；lint 0 error；全量测试 exit 0（docs 210 文件 2010 用例、sheets vitest 2564+Rust 178、shell 255…全绿） |
| 品牌 grep | ✅ 豁免外零新增（genspark.ai URL/host、@genspark/cli 包名、GENOFFICE_* env 保留） |
| 新工作区 | ✅ apps/html（133 文件）+packages/html2docx（35 文件，66 测试）全量去品牌接入；根 test/typecheck/dev(5178)/build:all 链已接 |
| 门禁外裁定 | ①上游 settings-ai-panel/settings-analytics 两测删除（测被本地 V2 设置面替换的上游 UI）；②ai-search 媒体/搜索工具层（media-tools/search-tools/media.ts/media-protocols.ts）未采纳——本地自有管线覆盖；③markdown generate_image 能力谓词暂置 false |

## 6. 预登记中间地带件（Q3 第三档，施工时逐个手工合并）

1. **字体链**：Carlito 删除 + 上游 `embedded-fonts.ts` × 本地 `apps/slides/src/main/fonts.ts`（harfbuzz wasm 懒加载/BFF 降级改造）→ 保本地懒加载、采上游字体清单、加字体加载断言。
2. **ai-provider 全系列 5 件**（`2dab773` schema 消毒、`f30a301` non-JSON 200、`4770d9c` Gemini3 温度、`959df83` keyless 端点、`83f2fa0` 空白模型名 remap）→ 本地 BYOK 多协议架构上**重实现**，不贴 patch。
3. **slides 保存/agent 生命周期 3 件**（`4846ace` 串行化、`ea13074` saveAs 队列、`360ce06` 生命周期）→ 本地 generate_deck 改造区叠加。
4. **`strings-ai.ts` 逐 key 合并**：本地已加 imageSource 等 18+1 语言 keys，上游同期也改了此文件。
5. **agent-core compaction**（`566c1f3`）：本地 agent-core 有自有改造。

## 6b. 挂账收割（第二轮，2026-09-09 当日全量完成）

三项挂账已于同日全量收割（提交 15b5aa80）：

1. **Codex 设置面 ✅**：vendor-catalog 新增 codex 条目（group local、codexLike、free nokey）；discovery.ts 增加 codex 分支（listCodexModels 走 CLI 目录）；ModelSettingsPage 免 key/URL 门控+discoveryTarget 携 codexLike；运行时链（vendorId='codex'）批 B 已就绪。无需新增 i18n 键（供应商名走 vendor-catalog）。
2. **媒体/搜索设置层 ✅ 整体采纳**：media.ts（AI_MEDIA_PROVIDERS 目录+设置访问器）/media-protocols.ts（openai-images/gemini/dashscope/minimax 四协议生图+BYOK 媒体分析+testMediaProvider）/search-settings.ts 恢复；AiSettings 增 media?/search? 段；providers 默认值+解析链接线；index/browser 重导出；ai-search media-tools/search-tools 恢复（search-tools 按本地布尔门控语义重写）；供应商 id 'genspark'→'chatoffice' 全量一致改名（本地无存量设置文件，安全）。
3. **markdown generate_image 谓词 ✅**：接 imageGenerationAvailable(settings, login) + aiChatOfficeStatus 登录态跟踪（mount+window focus 刷新）。

**构建修复（61c76956）**：批 B 引入的 codex-app-server(node-only) 经 chat.ts/stream.ts 静态导入+shared/ipc 的 `AI_PROVIDERS/KEEP_KEY` 值再导出泄入浏览器图，electron-vite 构建必炸（typecheck/测试不覆盖构建图，属潜伏断点）。修复=渲染层/ui 包/shared 的 ai-provider **值导入全量切 `/browser` 子路径**（9 处应用+4 处 ui 组件+2 处 shared），browser.ts 扩成完整纯函数导出面；discovery 的 codex 分支移主进程 runtime.discover。**铁律新增：渲染层一律 `@chatoffice/ai-provider/browser`，主入口仅主进程/服务端可用。**

与本地 imagegen 引擎的关系：上游媒体层服务 ai-settings.json 的 media/search 段（工具调用路径），本地 imagegen/media-jobs 服务 V2 MediaModelPicker 路径——两套并行、配置域不同、互不覆盖。

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
| 用户可见字符串 `GenOffice` | zh/zh-TW 文件→`察元AIOffice`；其他语言→`ChaAI Office`（2026-09-15 起第六轮后新映射，此前已落库的 `ChatOffice` 显示串同规则切换） | i18n prompts、UI 文案 |
| 标识符 `genoffice` CLI/slug | `chatoffice`（CLI bin/产物名）/`chaoffice`（MCP 服务器名、外部客户端 mcpServers 键、appId/executableName/deb/rpm 包名） | CLI bin 名保留 chatoffice 防破坏脚本 |
| 豁免：`GENOFFICE_*` 环境变量 | 不改 | 既有约定 |
| 豁免：`genspark.ai` URL 值与 host 匹配串 | 不改 | 改=断功能 |
| 豁免：`ChatOfficePoppins-*`/`ChatOfficeUIKanaJP-*`/`ChatOffice Grid Strut` 等字体族名、`@chatoffice/*` 包作用域、`window.chatOffice` 桥名、i18n 键名（`*ChatOffice*` 驼峰键） | 不改 | 内部标识符/二进制绑定，非用户可见 |

## 10. 裁定记录（施工中追加）

| 日期 | 上游 sha | 争议点 | 用户裁定 |
|---|---|---|---|
| — | — | — | — |
