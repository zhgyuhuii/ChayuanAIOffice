# 上游同步台账（upstream-sync）

> 本文件是 chayuan-office ← genoffice 上游同步的**唯一记账与施工手册**。
> 低冲突开发制度与冲突裁决决策树见 `docs/upstream-coexistence.md`（与本文配套）。
> 新会话只需读此文件即可开工或续作；每完成一批必须回写本文件的进度与裁定记录。

> **铁律（用户 2026-09-13 明令）：本地修改绝不允许被上游更新破坏。**
> ①上游仓 /Users/zyh/work/genoffice 拉取前必须先 `git stash` 保护未提交本地修改（现存常驻修改：SettingsModal.tsx 的 window.aiOffice→window.chaOffice 桥改名），pull 后 `git stash pop` 恢复，冲突时本地赢；②本仓 pick 冲突一律按 §3-Q3 三档裁决，本地功能区必胜、上游意图重实现进本地架构，上游内容永不整体覆盖本地已改文件；③`apps/server`、`apps/web` 等本地独有工作区上游内容永不触碰。同文记入 CLAUDE.md「Upstream sync iron rule」。

---

## 1. 背景与目标

| 项 | 值 |
|---|---|
| 本仓 | `/Users/zyh/work/chayuan-office`（origin `git@github.com:zhgyuhuii/ChayuanAIOffice.git`；惯例：直接 main 提交+推送，中文领域 title） |
| 上游 | `/Users/zyh/work/genoffice`（origin `git@github.com:genspark-ai/chaoffice.git`） |
| 历史关系 | **无共同祖先**：本仓 `8d108c3` 为整树导入（2026-08-30），禁止一次性 merge（空树基准 → 两千个 add/add 冲突） |
| 目标 | 全部拉齐到上游 HEAD `6d16796`（2026-09-07），本地全部功能改动保持不变 |
| 状态 | **第二十九轮完成（2026-10-20，终点 04f145717，分支 sync/29-upstream）**；历史轮次见 §5 进度表与各轮小节 |

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
| Q4 | 品牌 | 随到随改 ChaAI Office→ChaOffice（用户可见字符串、字体文件名、font family 内部表、`@font-face` 引用、生成脚本）；**豁免**：环境变量 `GENOFFICE_*` 前缀、`genspark.ai` URL 值与 host 匹配串（改=断功能）；每批门禁加品牌 grep 闸 |
| Q5 | 例外清单 | ①`package.json`/`package-lock.json` 永不字面 pick：依赖变更记清单、批末手工合并进本地（保留 `@chaoffice/*` 命名）+`npm install` 重新生成+测试；②`README.md`/`CONTRIBUTING.md`/`CLAUDE.md`/`.github/` 跳过 pick，内容性变更（如 `TAVILY_API_KEY` 环境变量表）摘抄进本地对应文档；③其余一切（源码/测试/fixtures/字体/视觉基线）正常 pick，删除照常执行 |
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
   外加品牌 grep 闸（对 `genspark|ChaAI Office` 全库扫描，豁免清单外必须零命中）。
7. 汇总本批 `adapted:` 清单 → 回写本文件 §6/§10。
8. `git checkout main && git merge --no-ff sync/upstream-202609 && git push`（merge 提交中文领域 title，如 `上游同步 批4：ai-provider 重实现×2+六连修`）。
9. 在本文件 §5 下追加一行批进度（见下方进度表），push。

### 批进度表（施工中逐批追加）

| 批 | 状态 | 完成 commit | 备注 |
|---|---|---|---|
| 0 | ✅ 2026-09-07 | — | upstream remote（本地路径 /Users/zyh/work/genoffice）+fetch+分支已建 |
| 1 | ✅ 2026-09-07 | `ec34ea3`（pick）+`be7a46a`（门禁基线修复） | 42 冲突（27 UU+15 AA）全三档裁决：**本地 HEAD 已含 2239cce 全部意图，pick 净效果仅 agent-core electron-transport +20 行（2 个 overload errorCode→busy 消息测试用例）**。AA 15 件=本地品牌版胜（测试×3/cf-formula-fold/overload-error×2/图标 8 件/gen 脚本）；UU 27 件逐 hunk 核验后 keep-ours（品牌引用×7；本地架构区 ai-ipc·markdown AiPanel·sheets-main·docs-main 均已实现上游意图；本地超集 pptx-engine·agent-core·slide-ops；slides App.tsx 解冲突后 diff HEAD=空）。无 adapted: 件。门禁基线修复（皆先于本任务即红）：pptx-render tsconfig 补 DOM lib、lint error 39 处清零+eslint 忽略 .tmp/dsh-plugin vendor、docs ai-generate-image 补 imageSearch 桩；12 个 react-hooks warning 为基线行为判断保留。test 1417+1996+642+564…全绿/typecheck/lint/品牌 grep 四闸过 |
| 2 | ✅ 2026-09-07 | `260bc38`(空)/`0e48502`/`7a1cc17`+adapted 提交（见 git log） | `3548a80` table-hit 与本地仅品牌 import 差异→**空 pick 补空提交保对账**（提交在 566c1f3 之后，时序注记）；`566c1f3` agent-core generation 守卫干净叠加（本地 409 行已有第一处守卫，上游补 maybeCompact 第二路径，中间地带#5 无需改写）；`93b8938` 分节页边距/pct 表宽 pick +142/-13，pagination.ts dx 公式本地「最宽纸居中」超集胜，**adapted：pagination-gaps.ts alignGapHfStrips 融合**（本地 per-section secLeftPx+上游 --gap-ml own-inset 优先级 own→data-sec→shared；自动合并曾残留上游变量名致 typecheck 红，已重写修复）。门禁：docs 1421 全绿/全链 exit 0/typecheck/lint 0 error/品牌零新增 |
| 3 | ✅ 2026-09-07 | `67b6df0`（490 文件 +131k/−110k） | 9-02 Sync 巨件。**i18n 重构落地：上游每语言文件结构整体采纳**（ai/app/dialogs/panes/ribbon 10 域×19 语言 195 shard），写三方合并脚本（本地 HEAD/baseline 583a045/上游 shard；规则=上游键值胜、本地改值胜、本地独有键追加），本地键入 shard 计 docs-ai 18/docs-ribbon 48/sheets-ai 18/sheets-app 121/slides-ai 43/slides-panes 1/slides-ribbon 132（每语言），both_changed=0；strings-*.ts 换上游薄 import 版（@chaoffice 品牌）。**pagination 单体→barrel 重构采纳**（上游拆 pagination-{types,sections,slices,hf,measure,lines}，本地 export 面为子集零移植，BlockBox 本地字段已在上游 types 中）。**Rust xlsx-engine 模块化重构采纳**（上游拆 visuals/{charts,colors,drawing,styles,tests}+workbook/worksheet/xml_util +11.8k 行；本地四件套 PictureSrcRect/PictureLum/editAs/PictureShadow 移植进上游结构体+drawing.rs 四构造点接线；上游 crop 0..1 模型并存——desktop-api zod 双收 crop+srcRect，preload 白名单补 6 组本地字段+crop 解析器防 tripwire 字段吞噬）。**字体链（中间地带#1）落定**：Carlito 三处同构建（f3737360）统一入 packages/ui/fonts（exports ./fonts/*），slides main/fonts.ts 改 @chaoffice/ui 引用+assetFsPath 规范化（vitest `/@fs/...?asset` URL→真实路径，内置字体测试环境可读）；fonts.css 整体采上游（本地对它零改动）含 Poppins 子集（ChaOfficePoppins→ChaOfficePoppins 二进制+引用改名）；docs/fonts.css 契约测试驱动发现本地 W6 Hiragino Mincho 为基线遗留非本地特改→从上游（weight-normal+合成粗体）。**ai-provider gemini 端点情报采纳**：上游注释「gemini 端点 2026-08-31 服务端 405 已移除」→registry.ts/settings-v2.ts 双处路由改 claude→anthropic、其余含 gemini→openai-compatible，测试×3 adapted。其余：shell missing-recents 件融合进本地三栏 Home（confirmMissing 状态+missing 类名+chaOffice 桥名）；Home recent-files 保 remote 分支+采上游 missing:true catch 语义；sheets WorkbookVisuals 保本地渲染超集+采上游 OLE 件（ole-visual/VisualDeleteButton import 并集，本地裸✕钮淘汰）；删除 18 文件照常（Carlito×8 移动语义/verify-slide-copy-across-decks UD 本地仅品牌差异→删）；README/CONTRIBUTING/CLAUDE 按 Q5-② 还原跳过；pdf-lib 依赖入 sheets package.json+npm install；全树品牌 pass 183 文件（@genoffice→@chaoffice 等 14 组映射，豁免保护 genspark.ai URL/@genspark/cli/GENOFFICE_* env/LEGACY_PROFILE_ID）。门禁：29 工作区全绿（docs 1599/sheets 2285+Rust 161/slides 670/shell 240/pdf 564…）/typecheck 0/lint 0 error（12 react-hooks warning 基线）/品牌 grep 全树零命中（豁免外） |
| 4 | ✅ 2026-09-07 | `15efb7f`/`732aa91`+adapted/`dc78f0e`/`4669f3f`/`6f71780`空提交/`f30a301` pick+adapted 提交 | 六连修。`99d376b` 干净；**`f105f36` 每回合 token 上限重实现进本地 v2 架构**（中间地带风格）：AiSettingsV2 根 maxOutputTokens（读/迁移/归一四处 clamp）+runtime runStream 用户上限中间优先级（request→用户全局→每厂商 maxOutputTokensFor）+ui ModelDefaultsPage 数字控件（draft/blur 提交）+shell strings 19 语言（keep-both 后去重：本地已有云工具串只收 maxTokens 新键）+legacy AiSettings 同步字段；`e833fff` 竖排文本干净；**`2dab773` Gemini schema 消毒（中间地带#2①）本地 gemini 协议干净落地**（sanitizeGeminiSchema+toGeminiParameters 接线在 252 行调用点，无需改写）；**`6f71780` stopReason 转发=空 pick**（本地 runtime runStream 已有 onStopReason→done 转发，上游意图已实现，补空提交对账）；`f30a301` non-JSON 200 干净。门禁：全工作区绿（ai-provider 186/ui 79 新增含 adapted 断言）/typecheck 0/lint 0/品牌零新增 |
| 5 | ✅ 2026-09-07 | `…`（七件 pick，见 git log 2e83d32→360ce06 段）+adapted 提交 | 七连。`eec2737` 预览标记干净；**`4846ace` 保存串行化（中间地带#3①）adapted**：上游 saveTail promise 链外壳包住本地三分支保存处理（ok/error/首存对话框取消），随附 save-serialization.test；`4770d9c` Gemini3 温度干净（中间地带#2③ 无需改写）；**`2910486` Tavily 兜底干净落地**（原生 fetch+TAVILY_API_KEY，无 npm 依赖变更，Q5 依赖清单空收）；注释冲突按本地品牌术语融合；**`d8e233c` 元文件按 Q5-② 处理**：CONTRIBUTING 保留本地版+摘抄 TAVILY_API_KEY 入 env 表+空提交对账（cbbbe14）；`9439d3e` docs RTL 面板 adapted（isRtl/dir=auto 融合本地 tabs+模型徽标，去上游 asideRef/resizing 残迹）；**`360ce06` slides agent 生命周期（中间地带#3③）干净落地+测试 adapted×4**（settings mock 换 defaultSettingsV2、importActual/品牌、aiChaOfficeStatus 桩、run 断言补本地音视频第三参）。门禁：27 工作区全绿（slides 675）/typecheck 0/lint 0/品牌零新增 |
| 6 | ✅ 2026-09-07 | 十二件 pick 全落地（git log 567ad37 段→f2c3d08）+adapted 提交 | 十二连。`567ad37` docs 逐边框（22 文件）adapted：Ribbon.tsx 冲突保本地折叠/移动端结构（per-side 边框 UI 经 icons/ribbon-tabs 自动合入，本地 icons 已含 InsideH/V），fr/it shard keep-both 后去重保本地译值；**`99dfbc1` RTL 四面板（markdown/pdf/sheets/slides）adapted**：保本地 PanelTabs 架构+四 aside 插 dir={ar/he→rtl}（消息 dir=auto 自动合入）；sheets 三修 `41f87f3`/`449f03a`/`4d277b5` 干净；**`ea13074` saveAs 队列（中间地带#3②）adapted**：上游 runSerialized 提炼助手自动合入，save 冲突块换上游开括号+本地三分支体保留，saveAs 同队列包裹；`1ee2407` 澄清清理干净；`09fd67b` Home 重命名 adapted（isValidRenameName 采纳+本地 remote rename 分支保留）；`8630d11` markdown 缩放 i18n adapted（本地双底栏补 t() 标签，strings 19 语言自动合入）；`a5b5903` docs 标尺 tab（21 文件）adapted（Ruler 保本地注释+收 isRenderableTabStop 导出，app shards 收 appTabClear）；**`d9769d1` 历史清理 adapted**：保本地 PanelTabs 结构（上游 GensparkMark 头部拒），setHistoricChat([]) 自动合入，New chat 条件移植 chat>0||historic>0×docs/slides；`f2c3d08` 附件清理干净；新测试×3 适配（settings mock v2/品牌 import）。strings-ai 逐 key 合并（预登记#4）因批3 已转每语言 shard 而消解为文件级。门禁：27 工作区全绿（docs 158/shell 20/markdown 11 新增）/typecheck 0/lint 0/品牌零新增 |
| 7 | ✅ 2026-09-07 | `34525e1`（442 文件 +36k/−10k，含全部 adapted） | 9-06 Sync 巨件（76 UU+2 UD 冲突）。**UD 两测试照删**（speaker-notes/table-tools 本地仅品牌差异，上游以 prompts ops/*.md 接替）；**README/CONTRIBUTING/CODE_OF_CONDUCT/PRIVACY/SECURITY/.github 按 Q5-② 还原 HEAD**（pick 曾改）；**main.tsx×5 CSS import 并集+品牌**（本地 set+上游 ribbon-collapse.css/markdown.css 新文件）；**i18n shard 全量三方重建**：76 个 pick 触及 shard 以「本地键保全+上游独有键并入（值品牌化）」配方重写（此前 keep-both 曾损多行值/丢 zh 键行，typecheck 驱动全数修复）；**docs App.tsx 干净 3-way 重解**（keep-both 曾断 services 拼接）：7 块=hunk1 双态并/2 gapStripLeft/3-4 本地 services 胜+spellcheck/setDarkCanvas 接线/5-7 DockShell 区保本地（darkPage/workspaceClass 融合本地 darkCanvas）；**docs Ribbon/ViewTab/ReviewTab props 回本地名**（darkCanvas/onDarkCanvas 可选化、spellcheck 全链接线 viewServices→host-services→host-tabs，5 个本地测试免改）；**slides op-docs 采上游 md 驱动系统**（prompts ops/*.md+OpGuide/load_guide 工具）+LOCAL_OP_DOCS 37 条完整移植（sig+group+aiCallable 从 HEAD 解析，setAnimations Q5 解锁覆盖）+op-docs/op-docs-examples 两测试 adapted（本地 sig-only 豁免 body/examples）；**slides-skill**：保本地 generate_deck 工具区+import 并集+PARAGRAPHS_DEF/toEditParagraphs 从 HEAD 复位+blockScratchBuild kind 并集；**file-actions 采 getCtx 签名**（调用方自动合入）+runSerialized 体保本地；**pdf strings.ts 干净 3-way**（19 处全取 theirs：aiToolEditNote 等 3 新键×语言+aiReviewSummaryBtn 改值；keep-both 曾致 zh 键行丢失）；**extensions 图片链融合**：cropWrapMargins 入本地 style 链且与 imgWrapTransform 互斥（旋转裁剪 fold 不双计，image-rotation 测试驱动）；**Kana 字体**（ChaOfficeUIKanaJP→ChaOfficeUIKanaJP 二进制改名+三处引用）；**docs-main 净改套用**（setAiUserAgent UA/打印缩放 scale/窗口 720×550，曾因写空从 HEAD 恢复重做）；**shell 云端 PDF→Word 恢复**（误删本地 exportPdfAsDocx 89 行→从 HEAD 复位+menuExportDocxLocal 19 语言菜单键新增双入口）；**package.json 系 Q5 手工并**：本地 @chaoffice 域+采上游版本升级（tiptap 3.29.2→3.31.0、shell 0.8→0.9）+ui exports 并集（ribbon-collapse/markdown.css）+lock 删除重生成+nested node_modules 清理；agent-core runtimePreamble+ai-provider output-cap（withOutputCapFallback/parseOutputCapRejection/setAiUserAgent）并集落地+stream legacy 路由补 openai-responses default。门禁：全工作区绿（docs 1943/slides 740/sheets 202+Rust/pdf 42…）/typecheck 0/lint 0 error/品牌命中皆基线功能豁免（genspark-ai/chaoffice 仓库 URL/LEGACY 迁移常量） |
| 8 | ✅ 2026-09-07 | 九件 pick 全落地（bc6bff6=6d16796 终点）+adapted 提交 | 收尾九连。**`959df83` keyless 自定义端点（中间地带#2④）重实现落地**：activeProvider 键可选化（needsBaseUrl 分支 base+model 即可，注释保留 Ollama/LM Studio 情报）+openai-compatible Authorization 条件化（两处 keep-both 曾双写头，stream.test 驱动修复）+两测试 keep-both 收新用例（chat/providers 各一空壳从 HEAD 时代即存，删壳保体）；**`eda6baa` shell 保留名拒绝干净**；`47999fd` recents 过滤 adapted（theirs+品牌，normalizeRecentQuery 新导出）；**`83f2fa0` 空白模型名 remap（中间地带#2⑤）落地**：trim→migrate 顺序修正（padded " deepseek " 也命中 remap）+chaofficeToolsEnabled 保本地键；`f59f931` sheets 空针干净；**`a612503` pdf Windows 保留名后缀 adapted**：加固并入本地 sanitizePdfBaseName（本地 Untitled 回退语义保留），**随附上游 auto-rename.test 删除**——该测试断言的 pdf:auto-rename 通道已被本地 4327d4d「新建延迟落盘」共识架构替换（untitledPdfMetas+首存另存为转正），Q6 结构差异裁定：测试删、加固留；`4e1c633` sheets New chat 干净；`bd46b03` electron-utils drop 容错干净；**`6d16796` docs 保留名拒绝干净（上游终点到达）**。门禁：全链 exit 0 零 FAIL/typecheck 0/lint 0/品牌零新增（chat/providers 测试名改写，genspark.ai URL 豁免保留） |
| 9 | ✅ 2026-09-07 | 终检（本轮） | 40 sha 对账/一致率统计/字体字节裁定/终态门禁/品牌终检全过（详见 §5b 验收报告）；台账定稿 |

**✅ 第八轮完成（2026-09-17，Route B full 整包快照式收敛+合 main）**：merge-r8-wip 以六提交走完 Route B 收敛——fb2b681c（cli 42 失败清零：docs 三件套取快照+品牌重放+补 docx-sections.ts+executeTool 形参位；本地 add_comment 表格批注重放为上游 case 的扩展契约；品牌缺口=install.ts 取 main 版（快照重放曾造非法 PowerShell 命名空间 ChaAI OfficePath）/userData 目录名恢复 ChaOffice/skills 路径 chaoffice/NOTE_AUTHOR；agent-skills 重放 removeLegacySkillDir；mcp resolveTool 恢复抛错+resolveTools 工具粒度降级）、3a5ebabc（shell 9 失败：测试桥双 stub 去重/chaoffice-editor 键/CLI bundle 主名 chaoffice.cjs/引号断言/app-mcp 补 createPdfTools 注册（上游 #440 在 09485f8 自己丢了展开）；slides 12 失败：pptx-ops 重放 addWordArt+svgText 双部件/setPictureLum/echart-ops/Q5 守卫，动画测试改用真未建模 presetID 35（合并超集已建模 5）；markdown 补另存为快捷钮）、e2a2dbc6（recalc.rs 恢复上游 is_error——xlsx 回退链丢字段致 sidecar 公式错误类型全断，sidecar 重建）、86753cc1（sheets 层 isError schema/转发/断言贯通）、643f2e37（shell strings intg 区 40 处品牌残留清洗）。**合并 main=315b5b2f**：strings.ts 冲突按 A/B 区架构重建（TS AST 脚本：分支合并表剔除 B 区 5600 本地键→重建 upstreamStrings+保留尾部 spread，shell 531 测试绿+tsc 0）；台账取 main 版。**门禁**：全工作区 test exit 0/typecheck 0/品牌 grep 归零（lint 存量红 main 基线 70>分支 41，非本轮引入，挂账）。**下次起点**：`09485f8`。

**⚠️ 第八轮施工中·四续（2026-09-17）**：merge-r8-wip@cb8fe30f+。typecheck：全工作区 0 错误（sheets/slides/markdown 已回退本地版，快照渲染端挂账第九轮）。**测试剩余**：仅 cli 三个文件=Route A 挂账特性失败——①tests/check.test（`sheet check` 依赖已回退的快照 gateway 读模块）②tests/batch-modes.test（sheet apply --batch 快照语义）③tests/mcp.test（cli mcp server 对已回退 xlsx create --header spec 的依赖）；skill-command 路径已修（skills/chaoffice）。**⚠️ 五续（2026-09-17，context 耗尽前最终快照）**：merge-r8-wip@HEAD=Route B 执行中——cli/src 整包=09485f8+品牌（cloud/capabilities/formats-docx/commands-docs+guide 保留本地=docs AI 接缝），mcp tools resolveTool 已改优雅跳过；sheets Route B 收窄完成（typecheck 0）；shell typecheck 0。**剩余=cli 约 40 个测试**：batch-modes/check/docs-apply 的结构化 batch detail 接线（快照 commands/docs.ts 的 applyDocOpsWithModes 与本地 formats 的对接验证）+cli.test/errors/limits 若干——均为机械对接非架构问题。**下一步**：接线上验证 detail.batch 输出→全量门禁→merge-r8-wip 合 main（docs/upstream-sync.md 取并）→恢复 stash WIP→推。

**补充确诊（同日）**：clean f4ac99f8 实测 cli 57 测试失败（check/cli/docx/errors/guide/limits/skill/xlsx-gateway-ops/xlsx-mixed-batch 九文件）——根因=Route A 的 gateway+project-store 回退使快照 cli 特性运行时全断。**Route A-full（cli 整包回退 310596b0）不可行**：shell MCP 管理面（IntegrationsPane/integrations-ipc）依赖快照 cli/agent-skills 导出，回退即破坏已发布功能。**第九轮唯一可行路径=整包快照式（Route B full）**：gateway/project-store/cli 全取 09485f8 快照+品牌重放，apps/sheets 取 09ad8b3e 合并态+~13 处调用点类型收窄（清单已列），shell MCP 面板对 cli 缺失命令的引用做存在性守卫；函数向导(c692aafe/936609f3)以此法重放。

**收尾裁定（2026-09-17 最终）**：Route A 级联远超预期（check/mcp/batch/cli.test/docx.test 连锁 54+ 失败——快照 cli 测试与回退后的本地 formats 互斥），**按纪律放弃半成品合并**：merge-r8-wip 已 reset 回 310596b0 纯绿基线；第八轮 15 提交的 pick 成果保留在同分支历史（fb42ee1b..cb8fe30f 段，含全部冲突裁决与修复），供第九轮以「全量快照式」策略重启（第九轮建议：直接 merge 上游 09485f8 或整包采用快照 cli+gateway+project-store+四 app 渲染层，本地差异按 D 区标记逐一重放——碎片化局部回退已被证伪）。main 保持 310596b0+docs 绿基线；并行 WIP 两文件在 stash@{0} 与工作树。**已验证工具**：ast-merge2.cjs（TS AST strings 合并，产出 tsc=0）在 worktree 根。

**⚠️ 第八轮施工中·三续（2026-09-17）**：merge-r8-wip 已收敛 shell/pdf/slides/markdown 至低错误态（slides/markdown 壳层与 App 回退本地版；ExcelShell/WorkbookVisuals/sheets App 回退本地=函数向导保留）。**剩余唯一硬骨头**：快照的 packages/xlsx-gateway+project-store 类型变更（theme-fill 联合类型、ProjectApi 缩减）与本地 sheets 调用方不兼容（10 个类型错误）。两条收敛路线：A（快）=packages/xlsx-gateway+project-store 一并回退 310596b0+cli 的 xlsx-dsl/xlsx-gateway-ops/xlsx.ts 一并回退（快照 sheets/cli 特性整体挂账第九轮）；B（全收）=保留快照包，本地 4 处调用点收窄（univer-sync/ExcelShell 的 theme 对象 typeof 窄化+preload ProjectApi 适配）。收敛后跑全量门禁→merge-r8-wip 合回 main（strings 用台账配方重对齐）→推。shell 另有 6 错误：15 个 intg* 键×20 语言从 pristine 09485f8 提取补入（提取脚本已验证可用）+LangDicts 随键补齐消除。

**⚠️ 第八轮施工中·二续（2026-09-17 凌晨）**：`merge-r8-wip` 已收敛至 shell×6（5 个 intg* 词条键缺失+1 LangDicts）+pdf×1（LangDicts）；sheets/slides/markdown 未复测。**strings 收敛正解已定型=TS AST 合并**：行级手术在多行值/双 span/重复节上反复失败；正确工具=typescript compiler API 解析两版 strings 的 strings 对象、按键并集合并（base 值优先）、printer 输出——原型 `/tmp/ast-merge.cjs`（已验证可产出 esbuild 通过的合并文件，唯逐键值抽取仍有一处多行截断 bug 待修：propsOfInner 的 slice(1,-1) 会吞掉"键+值仅两行"的值行，修=按 keyre 找到键行后吃连续行直到下一键行）。剩余收敛步骤：①修 ast-merge.cjs 截断 bug→生成 shell/pdf strings（源=pristine 09485f8 ∪ main cb78d65c 值优先）→intg* 5 键×20 语言从 pristine 09485f8 提取（值走品牌重放）→LangDicts 自然消除；②sheets 32 错误（save-pipeline/untitledWorkbookPaths 已做映射适配）+slides 9+markdown 测试适配；③全量门禁→合 main→推。main 全程保持绿基线。

**⚠️ 第八轮施工中（2026-09-16 深夜，未完成未合并）**：上游 `f4d8da2..09485f8`（15 提交：MCP×4+9-16 快照 525 文件+pptx 系列×5+小修）已全部 pick 到 `sync/upstream-20260916` 分支（已推 origin，含冲突裁决+品牌映射+动画引擎超集收敛，pptx-engine 1018/docs 2541 测试绿）。合并重做于 `merge-r8-wip` 分支（已推 origin）：merge 本体冲突仅 shell index/preload 导入并集×2 已解+pdf-main map 语义修复+pdf/markdown strings 按干净配方重建（pristine+品牌+本地键，锚=节 opener 后）。**剩余**：pdf LangDicts 节键集差×1+sheets workbook-ops(13)/ExcelShell(3)/save-pipeline(1) 等~30 类型错误收敛+slides/markdown 数个测试适配→全量门禁→合 main。**main 保持 310596b0 绿基线**（并行 WIP Home/strings 两文件在工作树）。新知：strings 断裂正解=main 绿版为基底+按节织入 sync 独有键（锚=节 opener 后；捕获须剥尾）；三方 merge-file+「theirs+品牌重放+HEAD 键补回」配方已在分支验证。

### 第十八轮 A+B（2026-09-30，施工于 sync/18-engine：14 提交 72ddda0f..收口提交；上游区间 3f9d07d..upstream/main 共 234 提交，本轮吸收约 90 提交当量的引擎域+shell 域+vi 特性批；本地 shell 版本 1.0.3 自主线不跟随上游）

**概况**：三次中止后按批准的四轮拆分重整。A=引擎 12 域（3way apply 直落，已验证），B=shell/pdf/slides/html 域 + vi 全仓接线 + i18n 键级补齐。r3 泄漏进分支的撕裂文件（shell index/tab-manager/TabBar/Home/SettingsModal/strings、pdf App/strings、slides slides-skill/App/AiPanel/Ribbon、html App/strings-ai）全部以 3-way（base=3f9d07d，ours=91db06fc，theirs=upstream/main）重做并逐冲突拷问裁定。C=docs 渲染域（挂账）、D=剩余快照尾批（挂账）。

| 域 | 落位 |
|---|---|
| 引擎 12 域（A） | docx-engine/pptx-engine/pptx-render/pptx-ops/xlsx-gateway/pdf2docx/file-parse/html2docx/pipelines/agent-core/project-store/electron-utils 3way apply+残留修复（mergeStyleXml 导入、styleUpserts 双循环、pptx-render index 孤儿导出、loop 三元链、context-menu Symbols、project-store 附件 32 帽恢复、pPrChangeInfo）。#813 对比未保存编辑器内容、#929 原子导出等落地 |
| shell 域（B） | 上游 vi 语言包全量接入+菜单/心跳 vi 键；default-app（认领 Office 默认程序）+aiPanel openInNewDocs 设置面（ai-panel-prefs 增 openInNewDocs 全链）；detach/attach/canDetachTab/describeWebContents detached-window API 移植进本地 TabManager（trackHtmlFullScreen 保本地 (id,view) 签名）；atomicWriteFile+atomicCopyFile viaTemp 重试骨架；tab-drag-geometry/file-events 支撑模块随 TabBar tear-off 拖拽几何落地；collectLaunchPaths/writeAppSettingThen/newFileDir 新文件流导入（上游 sheets「首存落盘」注册表挂账：sheetsSuggestedPathTaken/pendingUnsavedNewRecoveries 未采，本地延迟落盘共识胜） |
| pdf 域（B） | strings.ts 重建（每语言并集上游新键+vi 节+334 本地键 zh 拷贝）；ocr-layer/keyNav(shouldHandleDocumentUndo)/image-rewrites 式补件；ribbon-collapse 选项参=上游新 API 未采（本地单参 hook 胜）；搜索标题/渲染空态=上游新特性挂账 Round-C |
| slides 域（B） | 四 i18n 域 vi shard 安装+键级对账（ai+107/app+6/panes+1/ribbon+133 zh 拷贝）；slides-skill cloudActive/cloudFallbackReason 云中失败回退本地管线 union 落地（本地 SVG/资产门保留）；printSlidesHtml 接线；undo-routing/slide-selection/use-visible-thumbs 支撑模块已在位（App 保本地 A 区版本） |
| html 域（B） | 工作区 vi 全套（app/ai shard 键级对账+locale+html-main+strings-ai/strings-app/strings.ts）；image-rewrites 模块移植+保存时采纳链路；ribbonPin 键；find-target 去重 |
| vi 语言（B） | packages/i18n Lang 增 'vi'（union/LANGS/HTML_LANGS=vi-VN）→ 全仓 defineStrings/Record<Lang,..> 补 vi：上游 vi shard 直采（docs app/ribbon/ai、slides 四域、html app/ai、sheets dialogs 高频子集+en 回退），其余字典按「本地键 zh 拷贝+上游 vi 值品牌化」配方补齐；locale 指令（越南语回复指令）+DATE_LOCALES+LANG_OPTIONS 设置项；shell main/updater、docs main/updater、sheets/sheets-main、markdown/markdown-main、html/html-main、pdf/pdf-main 进程字典补 vi |
| sheets i18n 键级（B） | dlgFr 30+dlgZoom 5 键×20 语言、appOpeningWorkbook、KEY_NUMPAD_ADD/SUBTRACT 常量+_shortcutInternals 导出、vi 陈旧键清洗（aiGensparkAccount→aiChaOfficeAccount 等命名对齐）+app 域 358+ai 域 18 键 zh 拷贝 |
| 测试对齐（B） | ai-field-ops/image-wrap 两测试换上游版本（PAGEREF 折叠进可编辑行内域/EMU→px 精度 — 源码已随上游，旧断言为 9-16/9-17 快照态）；numbering/pretty-ppr/raw-ppr/zotero 四文件源码侧 pPr 语义挂账（见下） |

**拷问裁定记录**：①shell index 「新表格首存落盘」上游注册表 API（sheetsSuggestedPathTaken/pendingUnsavedNewRecoveries/markSheetsUnsavedNew）不采——本地「新建延迟落盘+隐藏草稿」共识架构胜，挂账上游实现；②pdf/slides/html 的 aiPanelInitiallyOpen/rememberAiPanelOpen 双参 hook 与 RibbonCollapseLabels 选项参不采——本地单参 API+localStorage 形态胜，跨应用统一改造挂账；③slides App 保本地 A 区版（上游 currentAfterHistory/thumbBox 占位缩略图微精化挂账）；④pdf Home/ribbon 搜索标题（renderSearchHeading 系）未采——上游搜索特性跨文件织入未完成，挂账 Round-C；⑤sheets dialogs/vi 保留 en 回退模式，ai/app vi 升级全量翻译；⑥menuTable*/menuGoTo/menuZoom 等 34 键上游 vi 词条弃用（本地菜单架构无此键）。

**挂账（Round-C/D）**：①docs 渲染域同步（convert.ts 距上游 447 行/extensions.ts 847 行——normalizeZoteroFieldParts/saveBlockIndexByDocx/rawPPr 传递链未采）→ 5 红挂账：raw-ppr（格式命令合并丢 keepNext）、pretty-printed-ppr-save（模式顺序丢 keepNext/keepLines/widowControl）、zotero-rich-roundtrip（段前 rPr caps small 丢）、numbering×2（段落标记字号/tab-stop 装饰）——四文件测试已换上游版本、源码待 Round-C；②上游 shell 新文件注册表；③pdf/slides 搜索标题特性；④跨应用 aiPanel helpers 统一。

**版本**：本地 shell 1.0.3 自主线（不跟随上游 0.10.x，激活/购买为本地 B 区）。

**门禁**：全仓 typecheck 0（21 工作区）；全量测试 2742 绿 / 5 挂账红（docs 渲染层 skew=Round-C 范围，非回归——main 上四文件 41/41 绿佐证）；品牌 grep 零新增（豁免外）。

### 更新内容汇总（第十八轮 A+B，面向产品视角）

**引擎/文档内核**：docx 保存链 pPr/revision 健壮性（pPrChange 保留、样式 upsert 单引号场景）、字段语义更新（PAGEREF 折叠进可编辑行内域并携带 dirty 标记）、EMF/WMF 元文件 zip 炸弹防护贯穿、图片非破坏裁剪/亮度/不透明度/阴影补丁链与 pipelines 页面规格对齐、#813 对比未保存编辑器内容、#929 选中文件原子发布。
**桌面壳**：Windows「设为默认 Office 文档程序」认领流（含 manualOnly 回读）、AI 面板「新文档中打开」开关、标签页 tear-off 拖拽几何+停靠指示、原子写复制（大文件零内存拷贝）、启动路径收集；vi 越南语全量界面语言。
**表格**：查找和替换面板（dlgFr 全套词条×20 语言）、缩放对话框词条、numpad 快捷键、合并工作簿等既有功能词条补齐。
**演示/文档/HTML**：云页面生成中途失败自动回退本地管线（cloudActive 跟踪+失败原因写回工具输出）、HTML 打印窗口链路、HTML 应用 vi+图片改写采纳。
**AI/代理**：agent-core 工具调用错误消息三路重写（截断/解析失败/缺参）、本地模型命名 aiChaOffice 全局对齐、媒体/搜索设置层与 vi 词典补全。

### 第十八轮 C（2026-09-30，施工于 sync/18c-docs 分支；docs 编辑器域同步 + A+B 残留失衡全收敛，全量测试首次全绿）

| 域 | 落位 |
|---|---|
| docs 编辑器域 | convert/compare/comments/numbering-actions/extensions（上游严格 math tokenizer/字段代码/链接动作等 15+ 新 editor 模块连带安装）、line-metrics（main 版+上游 6 导出 graft：cssExactLineCap/hangulSpaceOffsets/cssLeadTop/runsLineFactor/autoLineMultOf/setEmbeddedLineMetrics+latinRunsFactor/embeddedLineBoxes 状态）、pagination-hf 整文件取上游（HfSet/PageHf/pageHfStrips/HfResolve）、pagination-measure/lines/sections/slices/types、25 个新组件按需安插（PaginationPreview 等）；i18n app/ribbon/ai shard×20 语言按「本地键保全+上游独有键并入」重建+vi 键级对账+聚合器重 entries 去重 |
| 拷问裁定 | ①App/Ribbon/Ruler 三件套 UI 骨架不采上游（本地 DockShell 布局互斥+tabStrip 溢出+批量工具条为 A 区架构，上游 props 互锁混入即 r2-r4 式断裂）——App 保持本地版+services 修复（referencesServices/reviewServices/viewServices 重建、fileCtx 补 hfLinks/mirrorMargins/setMirrorMarginsDirty/onRevisionsLoaded 等价 stub、sectionHfOverride→resolveHf 适配）；②shell 新文件注册表（sheetsSuggestedPathTaken/pendingUnsavedNewRecoveries）改判采纳——A+B 时以「本地延迟落盘共识胜」弃用，但 A+B 已提交的 home-duplicate-atomic 测试即该行为契约，反转前裁定并移植注册表四导出+临时背书原子流；③Ruler 保本地（双独立 margin 实现，上游 indent-ruler 挂账 Round-D） |
| sheets | xlsx-sidecar-client 重启语义、numfmt-dialog Accounting 归一（ACCOUNTING_SECTION 提取+canonical 转义）、GoToDialog/SubtotalDialog useModalDialog 焦点管理 |
| shell | tab-manager did-finish-load spare-view 触发恢复（824643da 截断测试还原 1129 行）+DetachedTab 导出；electron-builder graft：CLI 版本一致块（chaoffice.cjs banner 校验+GENOFFICE_APP_VERSION 重建）+THIRD-PARTY 挂账块（ensureThirdPartyNotices）；rpm 探针改 spawnSync 通道（不污染 CLI 重建计数）；linux after-install/remove 脚本重建（#893 防护语义+/opt/ChaAI Office 空格 glob 引号+upgrade 保留链接） |
| html/markdown | inspector-protocol KNOWN_FROM_INSPECTOR 伪造消息加固；math.ts 严格 tokenizer+markdownEscape（\$ 重转义）+boundedTokenizers 上游对齐；孤儿 export-image 测试删除（模块本地 docx-engine 无 svg NewImage，挂账 Round-D） |
| 工具链 | tools/license-text.mjs 从 notices 生成器拆分（上游 test 契约）；docs vitest alias 补 electron-utils/atomic-write 子路径 |

**门禁**：typecheck 0（全仓 21 工作区）；全量测试 15325 全绿 0 失败（A+B 收口时 5 红 + sheets 批 7 红 + shell 批 35 红 全部收敛， EXIT 0）。

### 第十八轮 C 更新内容汇总

- **文档**：AI 字段/页眉页脚解析域对齐（PAGEREF 行内域折叠、HF 镜像边距/逐节 HF 解析器）、严格行内公式分词器（转义美元/拒绝数字后缀闭合）、保存时 \$ 重转义、表格原生转换 run 模型对齐、Zotero 引文归一（跨段域部件重算）、修订视图/拼写替换/选择条/导航大纲等 15 个编辑器子系统随上游落地
- **表格**：Sidecar 崩溃自动重启（新进程惰性拉起）、Format Cells Accounting 格式归一识别、Go To/Subtotal 对话框焦点管理（aria-modal+焦点返还）、新建工作簿临时文件原子发布+崩溃恢复索引
- **桌面壳**：/usr/bin/chaoffice 链接脚本防外来程序覆盖（#893 防护）、升级保留链接/卸载才删除、CLI 与应用版本一致性构建期校验、第三方声明 PDFium 条款挂账
- **HTML 预览**：inspector 消息伪造防护（已知消息标签白名单+数值版本校验）

### 第十八轮 D（2026-09-30，施工于 sync/18d-upstream 分支；用户指令「尽量与上游保持一致」——docs UI 骨架上游化 + ui 包上游化 + 消费端适配）

| 域 | 落位 |
|---|---|
| packages/ui | ribbon-collapse 上游「选中 tab 即折叠控件」模型整采（tabClass/tabTip/onTabPress/onTabsDoubleClick/RibbonCollapseButton+RibbonExpandButton）；ai-panel-prefs-store 增 aiPanelInitiallyOpen/rememberAiPanelOpen（openInNewDocs 门控）；shape-gallery 新模块；image-dialogs/modal-keys/strings-crop-edges 上游版；index.ts=main 全量+上游独有导出并集 |
| docs UI 骨架 | App.tsx/Ribbon/ribbon-tabs/Ruler 四件套整采上游（ribbonActions 命令服务对象、ai-dock 布局、页眉页脚 strip 编辑器、缩放对话框、字段对话框、表格/段落/纸张/样式对话框全家 45+ 组件）；wheel-zoom/review-actions/shortcuts/main.tsx/fonts.css 对齐；settings 管线升 AiSettingsV2（defaultSettingsV2 初值）；AiPanelProps 增 onExpand/onCollapse（上游折叠钮回调）；fileCtx 补 styleDeletes |
| 消费端 | markdown/html/slides Ribbon 适配新 collapse API（labels collapse/expand，RibbonCollapseButton 单 label）；察元 ribbon strangler 架构（host-services/host-tabs/commands/ribbon-chayuan-tab 等）由上游 Ribbon 接管后移除+8 测试文件随之退役；上游 RibbonProps export 采纳（VRuler 分页同步保本地） |
| 测试 | 12 文件取上游版（wheel-zoom/page-margins/ui-guards/style-shortcut/meiryo-alias（字体名 ChaOffice 映射）/fonts-css-contract（ChaAI Office Mincho）/context-menu/direction（A-zone 面板体 AiConversationBody 计入 dir=auto 契约）/embedded-fonts/shortcuts-dialog/ribbon-collapse/doc-dirty）+helpers/ribbon-props 上游版 |

**门禁**：typecheck 0（全仓）；全量 15248 测试全绿 EXIT 0。

### 第十八轮 D 更新内容汇总（产品视角）

- **文档**：Ribbon 全面重构为上游折叠模型（选中 tab 即折叠、双击/⌥⌘R 切换）、页眉页脚页内 strip 编辑（双击页眉/页脚直接改）、缩放对话框+捏合缩放吸附、字段对话框（PAGE/NUMPAGES/DATE 等插入）、表格/段落/纸张/样式/列表对话框全套、图片查看器（另存/关闭）、拼写检查 kick-respell 硬化、AI 面板「新文档中打开」设置生效
- **ui 包**：折叠 Ribbon 新交互模型、AI 面板初始态受「新文档打开 AI 面板」设置门控、形状画廊（ShapePreview/SHAPE_GALLERY_GROUPS）
- **markdown/html/slides**：折叠 Ribbon 新模型同步适配

### 第十八轮 E·收官评估（2026-09-30，施工于 sync/18e-remaining 分支；「尽量与上游保持一致」指令的残余差异逐域裁决——结论：剩余差异全部为上游没有的本地 A 区功能，非落后）

| 域 | 评估结论 | 裁定 |
|---|---|---|
| pdf App/AiPanel（565 行差异） | 上游 #1169 defer-annotation-scan（注解扫描延至首次 AI 使用）等上游特性**已在位**（annotation-catalog/AiContext load 装配核对）；剩余差异=本地多会话 AiPanel（c2b045ec 会话池，上游 234 提交内无多会话实现）+DockShell 布局（P1 契约）+ai tools 本地超集（hasImageModel 语义链+generate_image 失败引导 image_search） | **保持本地**；上游 AiPanel 单会话模型与本地会话池不兼容，上游原生多会话落地时按收敛条件重评 |
| slides Ribbon（1484 行差异） | ~180 行=动画面板/切换音效/演示器等本地特性（AnimVariantPicker/TransEffectOptions/TransSoundSelect/SOUND_VOLUME_KEY）；collapse 新模型字段（rootClass/tabClass/onTabPress/onTabsDoubleClick）本地已用=API 兼容；上游侧无本地缺失特性 | **保持本地**（动画面板为产品功能） |
| markdown App/Ribbon（427/169 行差异） | 差异=DockShell docked-boot（panel=0 P1 契约）+dockedEditor 生命周期+多会话面板体 | **保持本地**（同 pdf 理由） |
| shell tab-manager | spare-view did-finish-load/注册表在位 | 收敛完成 |
| docs | App/Ribbon/ribbon-tabs/Ruler+45 组件+25 editor 模块+i18n 三域+tests helpers 均上游结构（Round C/D） | 已收敛 |

**区间吸收总账**：3f9d07d..upstream/main 234 提交——A 引擎 12 域+B shell/pdf/slides/html+vi+C docs 编辑器域+D docs UI 骨架/ui 包，功能级全部落位；仅存的源码差异=本地功能超集（多会话/DockShell/动画面板/ai tools 引导语），无落后项。

**门禁**：typecheck 0；全量 15248 测试全绿 EXIT 0。

### 第十八轮 E 更新内容汇总（产品视角）

- 本轮无新功能落地——为收官裁决轮：确认 pdf「注解扫描延至 AI 首用」等上游特性已在位，四应用剩余差异均为本地功能超集
- 产品口径：上游后续若实现多会话对话栏（会话池/会话列表），需重评四端 AiPanel 收敛（收敛条件已记录于源码注释）

### 第十八轮 F·收口（2026-09-30，施工于 sync/18f-export-image 分支；上游 fetch 复核无新提交（仍 968d7d23），最后一项挂账「markdown 图片 DOCX 导出」清零）

| 项 | 落位 |
|---|---|
| markdown 图片导出 | exportImage.ts+export-image.test 取上游（docx-engine 上游化后 NewImage 契约已兼容）；shared/ipc ImageData.mime 升 ExportImageMime（保留 A-zone onDockedState/AiPanelPrefs dock 契约成员）；App loadImage 切换上游 decodeImageDataUrl→toDocxImage 流（SVG/WebP/BMP/AVIF 画布重编码为 PNG，引擎 save 路径只收 PNG/JPEG/GIF） |
| 收官确认 | upstream fetch 复核=无新提交；四应用残余差异（多会话面板/DockShell/动画面板）确认为本地功能超集，收敛条件已记录 |

**门禁**：typecheck 0（全仓）；全量 15,248 测试全绿（一次 web watch teardown flake 复跑确认 EXIT 0）。

### 第十八轮 F 更新内容汇总（产品视角）

- **markdown**：插入图片导出 DOCX 时 SVG/WebP/BMP/AVIF 自动按 192 DPI 高清重编码为 PNG（超宽图按 4096px 上限等比缩放），data:URL 内联图免主进程往返；上游全链测试回归通过。至此第十八轮（A–F）234 个上游提交全部吸收完毕，无剩余挂账。

### 第二十轮（2026-10-06，上游 968d7d23..db347087 19 提交 + db347087..5e0fd69f 65 提交，共 84 提交 327 文件；施工分支 sync/19-upstream 已并 main，收口修复直接落 main）

| 域 | 落位 |
|---|---|
| agent-core | settleTurn（回调抛错防运行卡死）、invalidArgumentFields/schemaViolation schema 校验、TYPE_CHECKS/MAX_SCHEMA_DEPTH 深度守卫（#1790/#1798/#1818）；未知 IPC chunk 类型忽略不炸 run（#1831）；非有限 seq 跳过（project-store #1830） |
| 场景套件 | 六格式全生命周期 197 用例（docs 56/sheets 54/slides 20/markdown 26/pdf 23/html 18）全部通过 |
| DocTheme 文档页主题 | docs/sheets/markdown 三端 renderer+preload+shared ipc（#1865，文档纸张主题独立于 UI 主题）；收口补齐 shell 主进程后端（currentDocTheme 缓存+HOME_CHANNELS/`app:get-document-theme`/`app:document-theme-changed` 全 webContents 广播）与 markdown preload 桥（merge 中 shell index.ts 走 ours 时被削掉，typecheck 兜出） |
| markdown | 源码视图（@codemirror/lang-json）、DocTheme 接线、图片导出保持 18F 版 |
| html | 资产 GC（extractHtmlAssetReferences）、File>Print 接线（#1807）、Insert 骨架命令（#1825） |
| slides | LayoutSkeleton 样式模板布局骨架（#1849）、AnimationItem.direction 方向保留（#1707 wipe entr:22:4 读回 top；收口补 ipc 字段+slides-main 映射）、相关图片搜索去小图（#1850） |
| 安全加固 | zip-gate 独立工作区、SSRF 守卫（slide 下载/本地媒体读取/恢复扫描/登录轮询 #1796）、file-parse 魔数嗅探拒扩展伪装（#1711）、pdf /XFA 分隔符（#1731）、xlsx sparkline sqref 转义（#1843）、decodeDataUrl base64 精确匹配（#1739）、pdf rect 非有限坐标拒绝（#1828） |
| 引擎修复 | docx-engine rels 单遍查找（#1855）、页面颜色保存残留 w:background（#1852）、documentProtection 成对清除（#1841）、SDT 单引号 alias/tag（#1836）、页眉页脚引用单引号 w:type（#1835）；xlsx-gateway 负值轴从数据最小值起（#1854）、结构化引用不进 A1 重写（#1648）、整列/小写图表引用（#1853）、DV 双引号字面量（#1703）、打开可取消不漏临时目录（#1793）；html2docx runText 非字符串强制转换、CJK meta 检测；pdf2docx footnotes V8 参数上限（#1802） |
| 新厂商 | Ling/Spark/LongCat 模型（#1780）、MiniMax-M3 视觉（#1814）、MiMo/Hunyuan 真标（#1856）、DeepSeek reasoning 往返（#1761）、SSE 跨 data: 行拼接（#1328）、429/503/529 过载文案（#1625） |
| sheets | 网格增长超前视口（#1824）、sidecar 崩溃恢复+图表 undo 注册表封顶（#1797）、右键单菜单（#1840）、headless 静默导出（#1837）、ribbon dropdown 浮层（#1839） |
| docs | 形状 Arrange 组+wrap/stacking 持久化（#1822）、导航窗格子视图记忆（#1770）、暗页选择记忆（#1590）、pending byte-handoff 封顶（#1847）、脚注乱序/chart spread RangeError/标尺焦点（#1788）、新文档尊重 AI 面板默认（#1871） |
| shell/打包 | 更新对话框最小化+设置更新入口（#1779）、.part 断点续传（#1777）、关窗防抖（#1643）、txt/json 路由修复（#1848）、Docker headless PDF 镜像+Flatpak/NixOS 路线（#1868/#1866）、翻译菜单 7→21 语言对齐（#1860）、ru 补译（#1620） |
| 冲突裁定 | A 区（多会话 AiPanel/DockShell/动画面板）保持本地；上游单会话面板不引入；shell index.ts 大文件以函数粒度抽取织入；pagebg-restore 需 Playwright Chrome（环境限制，main 同样跳过） |

**门禁**：typecheck 0（全仓 21 工作区，收口后复核）；全量测试绿（后台跑批确认中）；品牌零新增违例；本地 shell 版本 1.0.3 自主线不跟随上游。

### 第二十轮·收口复核（2026-10-06，上游差异全量对账 + 3-way 补漏）

首轮合并（6af69ea5）后有 5 处 typecheck 残留 + 全量对账发现多处「本地相对 676bf4d5 基点的删除/落后被 3-way 语义保留」的漏点。处理：

| 类别 | 明细 |
|---|---|
| typecheck 残留 | slides AnimationItem.direction 字段+主进程映射（#1707 收尾）；shell 主进程 DocTheme 后端整体回植（cachedDocTheme+get/setDocumentTheme 双通道广播，merge 走 ours 时被削）；markdown preload DocTheme 桥+通道常量 |
| html2docx | convert.ts 取上游（#1805 spacer px 校验+stamped-children 恢复）——pagebg-restore 由挂账「需 Chrome」转为真通过（此前 Chrome 已装但断言失败） |
| pdf2docx | analyze/blocks+index+table、rebuild/index、8 个测试文件取上游+品牌注释修复（#1747 连字符复合词/#1804 弹点列+双行合并/#1802 越界块/#1746 跨页编号）；上游测试此前也在旧版（断言旧行为）——两侧同步 |
| 引擎 | docx-engine generate/parse/section/parse-drawing-geometry/patch、pptx-engine chart/table-edit/animation、xlsx-gateway pivot-grouping、pipelines layout-audit、file-parse、electron-utils、i18n font-names、ui 全组件（AiComposer/dropdown/color-picker/screentip/image-viewer/Markdown 等）——以 676bf4d5 为 base 全量 3-way 补漏（291 文件 clean merge，10 冲突手工裁定） |
| ai-provider | media.ts deepseek 媒体条目+DEEPSEEK_MEDIA_BASE_URL 回植；activeMediaConfig 对内置回退返回 null（对齐 #1744 语义）；capabilityAvailable 空模型判 false；registry normalizeBaseUrl 凭据拒绝+fragment 剥离；openai-compatible/custom-models 走 endpointUrl；media-protocols 取上游+pollinations 协议本地实现（免费生图从死代码变可用）；codex-app-server 取上游（bounded stdout #1416）+品牌字面量；ai-settings-guard 取上游去 gskToolsEnabled 适配 |
| ai-search | index.ts filterUsableImages 小图过滤（#1850 等价移植，含 tier 落穿语义）+上游 usable-images 测试；media-tools SSRF/扩展名白名单确认为本地等价（#1796），保持本地架构 |
| cli | image-source data-url 上限取上游（#1439）+data-url-cap 测试过；15 个测上游独有模块（mcp-launch/op-schemas/app-install-dir 等）的测试不适用删除，台账挂账 |
| 测试回植 | 35 个上游独有测试文件品牌适配后加入（ai-provider 9/docx-engine 3/ui 7/pptx-render 1/cli 1+15 删/ui dropdown 等测试随源码取上游） |
| 冲突裁定 | ai-search index/media-tools 保持本地 chaoffice 函数 API（既有裁定）；ui dropdown 保留本地 icon 行+onDisabledClick 特性叠加在 upstream a11y 之上；popover-dismiss/chaoffice-popover-open 类名本地保留 |

**门禁**：typecheck 0（全仓）；全量测试套件见跑批结果；upstream-only 残留=仅品牌注释与已裁定架构差。

### 第二十轮·合并事故排查与修复（2026-10-06，外部智能体检出 run() 断链后全面核查）

| 事故 | 根因 | 修复 |
|---|---|---|
| **agent-core run() 断链（严重）** | 已提交 main（f42e0b31）的 loop.ts run() 构造完 userMsg 后函数直接结束——`beginRun(userMsg)` 调用缺失，整个对话循环空操作（首轮 6af69ea5 合并时 run() 区域结构损伤） | 工作区重织 run()：上游 #1798 try/catch 结构（buildContext 抛错走 failRun 不再卡死）+ `void this.beginRun(userMsg)` + 本地 media audio/video 字段保留；孤儿 tool_calls 配对（#1727）与降级模式 tool_calls 剥离（#1742 语义）核实均在位；agent-core 138/138 绿（含上游 loop.test.ts）。并行会话独立以 144b1340 为基底+降级补丁重放（87cfae3，在另一克隆）——两线修同一事故，合流时取其一即可 |
| **sheets Rust sidecar 编译失败** | 216b31a1 给 xlsx-engine 加了 CacheDirectory 守卫结构（Drop 回收/commit 转正），但 open 调用点仍是旧内联 PathBuf 写法——`cache_directory.path()/.commit()` 对 PathBuf 不存在，native:test 挂 | 调用点改回 `create_cache_directory(&session_id, cancelled)?`（对齐上游 402 行），前缀统一 chaoffice-ai-excel；cargo check+test 过 |

**教训（写入合并纪律）**：大文件函数粒度织入后必须跑「编译 + 该包全测试」再提交；本轮两处事故均属「新结构进场、旧调用点未跟上」——后续每轮同步对新增 struct/fn 与其 call site 做成对检查。

### 第二十轮·apps 层补漏（2026-10-06，同因排查延伸到 apps/shell）

packages 层 3-way 补漏后全量测试暴露 apps/shell 同样落后于上游（此前 3-way 只扫了 packages/*）：

| 文件 | 处置 |
|---|---|
| detached-windows / file-targets / integrations-ipc / recent-files | 3-way clean merge（#1643 关窗防抖/#1848 文件路由/#1796 技能目录版本门/侧栏过滤族） |
| src/main/index.ts | 3-way 杂合体被弃（六 app 模块 import 块被上游侧重写吞掉）——改从 HEAD 重建 + 定向回植：DocTheme 后端（get/set 双通道+缓存）+ #1848 filterMarkdown 21 语言文案 + menuNewMarkdown 统一 'AI Markdown'（21 处）；上游 #1848 的 fileTargetSources/rename 接线挂账下轮手工织入（A 区大文件） |
| updater.ts | vi 语言块补入（#1779 更新对话框 21 语言文案） |
| update-window.ts | 本地窗口图标特性改 namespace 安全访问（测试 mock 无 nativeImage 不再炸） |
| preload / home-api / SettingsModal / settings.css | #1779 接线：update:get-state / openUpdateDialog / onUpdateStateChanged 桥（aiOffice→chaOffice 改名重放）+ About 行更新入口 + DocTheme 下拉（applyDocumentTheme） |
| strings.ts | 重建：6 个新键（documentTheme/docThemeFollowApp/setUpdate×4）× 21 语言从上游成套移植（含引号块 'zh-TW'） |
| launch-paths.test | 品牌差异保留本地 |

### 第二十轮·界面还原排查（2026-10-06，用户反馈「文档编辑界面对话栏改造被还原」）

| 项 | 核查结论 |
|---|---|
| D13 多会话对话栏 | **未受损**——docs AiPanel.tsx 自 c2b045ec（D10/D11/D13 改造）后零结构漂移（18D/19/20 三轮仅 +6 行），真机截图确认 新对话/助手 tab、🕘 历史、修订跟踪 chip 全在 |
| **docs AI 面板 DockShell 被删（实锤还原）** | 十八轮 D「上游结构采纳」把共享 DockShell 包裹（任意停靠左/右/底/悬浮+最大化/收起+头部 chrome，与 sheets 一致的整体要求）替换成上游 `ai-dock` div 固定骨架。**修复（2f7e2d78）**：App.tsx 恢复 `<DockShell storageKey="aidocs.dock">`（aiDock* 词条在位、dockChrome 接线），真机验证停靠菜单四项+chrome 五钮（s11/s12）；markdown DockShell 完好未动 |
| **模型选择器裸按钮（实锤还原）** | ui 上游化轮把 `.ai-model-picker-*`/`msp-*` 基础样式块从源码删掉（仅剩 scoped 残段）。**修复（8acd90e4）**：从 1.0.2 构建产物提取完整规则回植 dock.css + docs/shell main 补 import，真机验证胶囊/星标/弹层分组恢复（s8/s9/s10） |
| 实际被还原项（品牌） | **上游品牌侵入**：18D「docs App/Ribbon 上游结构采纳」+ Round 20 把 Ribbon 第一入口写成上游品牌——docs Ribbon 按钮+组标签 'Genspark AI'、markdown Ribbon 同、GensparkMark 上游 logo、3 个小语言 aiPanelTitle='Genspark'（1.0.2 时代本地 Ribbon 无任何 Genspark 字样） |
| 修复（7d18d79d） | docs/markdown Ribbon 入口→「察元AI」、GensparkMark SVG→本地星标（保留导出名防调用点churn）、小语言标题→ChaAI Office；docs 2891/markdown 657 回归全绿；重新打包真机核对（26-docx-restored.png）Genspark 残留=false、察元AI=true |
| 纪律 | 「上游结构采纳」类提交必须同步过一遍**用户可见字符串品牌表**与**本地 A 区骨架清单（DockShell/PanelTabs/dock.css）**——结构可以跟上游，皮和骨架必须是察元的；每轮同步后跑「DockShell grep 六端 + 品牌 grep Ribbon/面板标题/aria-label」 |

### 第二十轮·降级模式 tool_calls 剥离补丁（2026-10-07，外部智能体差异报告核实）

| 项 | 结论 |
|---|---|
| 问题核实 | **属实**——loop.ts 结算路径 `history.push({role:'assistant', toolCalls:...})` 无条件写入,而降级分支的结果折叠为 user 文本消息(1251 行,无 role:'tool' 跟随);降级第二轮起 `messages:[...history]` 原样上报,assistant.tool_calls 无配对 tool 结果 → 无 FC 模型 API 直接拒绝。源码注释已写明该设计意图("Degraded mode keeps tool calls OUT")但实现缺失 |
| 依赖核查(先查依赖) | turnSig/verifyResponse/executedCalls 均用回合局部变量不受影响;messageSize 仅估算尺寸;restore 孤儿配对(无 toolCalls 即无孤儿)不受影响;机械摘要跳过带 toolCalls 消息的逻辑不反向依赖 |
| 修复(73ba42bc) | history 写入按 degraded/degradedProbe 分支:降级回合不附 toolCalls(JSON 调用文本保留为 assistant text,执行记录留 executedCalls);FC 回合维持 tool_calls+role:'tool' 配对原样 |
| 回归 | degraded-mode.test 新增多轮降级用例(断言全历史 assistant 无 toolCalls+全程无 role:'tool'),agent-core 139/139 绿;typecheck 0 |
| 同步策略说明 | 采用「fork 版整体为基底+仅重放此补丁」——fork loop.ts 经本会话恢复(beginRun 链+降级补丁+孤儿配对),与并行会话 87cfae3(144b1340 基底)为同一目标的两种实现;fork 版已有真机验证链,故以 fork 为准 |
| 纪律 | 降级模式相关改动必须同时检查:①assistant 历史消息的 wire 形状 ②结果折叠路径 ③restore 配对——三处一体,任何一处只改注释不改代码即事故(本次即为「注释已写、代码未做」) |

### 第二十轮·助手库手风琴展开失效根治（2026-10-08，用户 npm run dev 实测反馈「助手无法展开+面板布局不正确」）

| 项 | 结论 |
|---|---|
| 深度分析过程 | ①定位用户 dev 实例(dev-shell→vite 5173-5178+shell 5199),vite 直供当前源码(排除旧包)②headless Chrome 复现:点组头 items=0——**展开失效实锤**③对比合并前三次(ba1904be):面板结构/classes/CSS 零漂移(排除面板布局丢失),真正坏点是**我上一轮引入的展开 bug** |
| 根因(双 bug) | ①`expand` 折进 useMemo 却漏 `openDomains` 依赖:点组头 setState 正常但 memo 不重算,渲染读的永远是旧快照→永不展开;②toggle 初值语义反转:`openDomains[key] === false` 对 undefined(未点过)求值为 false,首次点击仍收起 |
| 修复(af43edaa) | expand 移出 memo、open 直接读 live state(`q!=='' \|\| openDomains[key]===true`);toggle 改 `!(prev[key]===true)`。顺带:sheets onRunPrompt conversations 判空、slides 会话助手实例改外层 routeRun(runWithRef 是内层作用域,TS 报错即暴露) |
| 验证(dev 实测) | vite 直连:sheets 点组头展开 12 条/搜索自动展开;dev electron 应用(REMOTE_DEBUG_PORT=9331):docs 手风琴 230 组展开 257 条+面板 0,0 全高 564×860、sheets 11 组/12 条、slides 10/10、md 10/10、html 13/10(截图 devapp-*) |
| 纪律 | 新增交互状态必须过「点击→DOM 变化」最小闭环测试,不能只看渲染存在;useMemo 里引用 state 必查依赖数组(ESLint exhaustive-deps 会抓,CI 应开启) |

### 第二十轮·助手 Tab 统一交互（2026-10-07，用户验收反馈：点击无反应/树展开不合理/布局不一致）

| 项 | 根因与修复 |
|---|---|
| 点击助手无反应(全端) | 点击库内助手条目后提示词送入了后台会话,但视图停在助手列表——缺「切回对话」步骤。修复:五端 onRunPrompt 补切回(sheets=conversations.onTabChange(第一个会话)、markdown/slides 会话实例=conv.setActiveTab(open[0])、pdf/html 独立面板=selectTab('chat')) |
| html/pdf 会话模式助手 Tab 点击无内容 | 会话模式本就无助手实例(仅 Tab 占位)。补 `<AssistantLibraryBrowser>` 会话级实例(html/pdf) |
| docs 树展开不合理 | 钻取式(进域→返回→再进)体验割裂。改手风琴:域行原位展开懒加载条目(getDomainAssistants),可多组同开,Fragment 修复 |
| 助手库默认全展开 | 共享库改默认收起+点组头展开+搜索自动展开匹配 |
| sheets 上下布局不一致 | 快捷项卡片样式(边框+大内边距)与库紧凑行不一致——去卡片化,统一 dock.css 紧凑行样式(六端同一视觉语言) |
| 门禁 | typecheck 0;docs 2891/sheets 3110 回归全绿;真机:docs 手风琴 230 域可展开(257 条可见)、sheets 点条目自动切回新对话 Tab(截图 u1/u2) |

### 第二十轮·助手库扩容（2026-10-07，用户要求每类文档 ≥100 助手）

| 项 | 处置 |
|---|---|
| 盘点 | docs=4576 助手(229 领域包,完好)；sheets/slides/pdf/markdown/html 仅 2-4 个快捷项(历史上限即如此,非本轮合并丢失) |
| 新建 | packages/ui/assistant-library(跨端 types+数据+分组浏览器)：sheets 102(11 域)/slides 100(10 域)/pdf 100(10 域)/markdown 100(10 域)/html 130(13 域)——共 532 个新助手,提示词针对各端工具语义自包含 |
| 接线 | 五端 AssistantTab 内嵌 AssistantLibraryBrowser(libraryApp+onRunPrompt props)；搜索+领域折叠分组+点击送入对话 |
| 模式修复 | sheets conversations 模式 PanelTabs 路由修复(走 effective handler,助手 tab 可切换)；markdown/slides conversations 助手 tab 补 libraryApp 接线；html/pdf conversations 模式助手 tab 挂账(独立面板已覆盖) |
| 门禁 | typecheck 0；六端回归全绿；真机验证 sheets 102/102(11 组)、markdown 100/100(10 组)、slides 100/100(10 组) |

### 第二十轮·界面恢复二阶段（2026-10-06，用户逐项验收反馈驱动）

| 项 | 处置 |
|---|---|
| **docs 对话框布局** | 用户验收指出:对话框应在**整个编辑器左侧、与顶部菜单同级**(全窗高)，且**上下左右**停靠。修复:①Ribbon 移入 DockShell body 的 editor-col（markdown 同构，面板全窗高、Ribbon 在面板右侧顶部对齐）②DockShell 新增 **top 停靠**（DockPosition/topHeight 状态+夹紧+边缘吸附+菜单项+图标+pos-top CSS），菜单五项=左/右/上/下/悬浮 |
| **顶部菜单去 AI 按钮** | 用户验收指出:顶部菜单不应有察元AI/助手相关按钮（功能都在对话框内）。修复:docs Ribbon AI 组整体删除（察元AI 入口+AI 总结/润色/排版 8 钮）、markdown Ribbon 同（4 钮）；面板开关走 DockShell 头部 💬 |
| **模型选择弹层** | 触发器胶囊修复后弹层仍裸——`.ai-picker-*` 弹层样式块同样被删，从 1.0.2 产物原样回植 27 规则；真机验证弹层（模型设置…胶囊/全部对话分组 Tab/察元本地模型组/选中行蓝字+对话 badge） |
| **aiDockTop 词条** | 21 语言×6 端（docs/sheets/slides/html 每语言一文件 84 + markdown/pdf 合并文件 42 块）；RTL/双引号/组合行三类插入事故修复；pdf zh-TW 走 strings-local 补键 |
| **html 残留** | printHtml 通道 'html:print-html'+主进程 handler+print-window import+Insert 骨架 props(onInsertSkeleton/canInsertSkeleton) 补接（上游测试为契约） |
| 门禁 | typecheck 0；docs 2891/markdown 657/html 251/sheets 3110/slides 1355/pdf 872 回归全绿；真机 f1-docs-final.png：Ribbon 零 AI 钮+全高面板+停靠五钮+弹层完整 |

### 第二十轮·apps/markdown 补漏（2026-10-06，全量跑批暴露后同法处置）

| 文件 | 处置 |
|---|---|
| src/main/markdown-main.ts | 对话框 locale 表整体取上游（#1848 文字档过滤文案，21 语言）；vi 块重复合并事故修复；本地媒体桥保留 |
| src/renderer/components/Ribbon.tsx | 取上游（#1785 源码视图门控 + #1848 .txt/.json 隐藏块控件）；@chaoffice/ui→@chaoffice/ui；GensparkMark 本地品牌星标实现（AiPanel 新增导出） |
| src/renderer/App.tsx | Ribbon 调用点按上游 Props 重接：onFind=openFind、aiOpen/onToggleAi/onAiPreset(askSendNow)、sourceViewOpen 状态+sourceMode=\.txt/.json$ |
| i18n/strings.ts | 从 HEAD 重建 + 上游 237 键按 20 语言块移植（renameNeedsSave/sourceView 系）+ de 多行值补裁；zh-TW 导出行恢复 |
| shared/ipc.ts | DocTheme 重复声明去重 |

### 第二十轮更新内容汇总（产品视角）

- **新功能**：文档页主题（纸张深浅色独立于界面主题，文档/表格/Markdown 三端生效）、Markdown 源码视图、幻灯片样式模板布局骨架（页式一致）、HTML 插入骨架、形状 Arrange 排列组、导航窗格记忆、21 语言翻译菜单、Ling/Spark/LongCat 新模型、DeepSeek 思维链往返
- **安全加固**：文件魔数嗅探（防扩展名伪装）、SSRF 多点守卫、zip 炸弹守卫独立包、PDF/XLSX/数据边界校验十余项
- **稳定性**：agent-core 卡死自救（settleTurn）、PDF 合并内存封顶、表格崩溃恢复、断点续传下载、关窗防抖
- **工程**：Docker 无头 PDF 转换镜像、Flatpak/NixOS 打包路线、197 个六格式场景用例套件

### 第十八轮 G·新增量（2026-10-01，施工于 sync/18g-remaining 分支；上游 fetch 到新提交 968d7d23..676bf4d5 共 150 提交、340 文件 +11713）

| 域 | 落位 |
|---|---|
| 新工作区 zip-gate | zip 炸弹守卫（assertZipWithinLimits/InflatesWithinLimits）从 docx-engine 抽出独立成包，file-parse/pptx.ts+xlsx.ts 改走新断言 |
| 引擎 | docx-engine：单元格对角框线（w:tl2br/w:tr2bl）、域字符平衡防平方扫描、rels 引号风格、settings 标志成对；pptx-engine：图表点数上限、颜色缺失 val、rels 替换模式、连接线方向/翻转旋转、媒体插入 ensureDefaultContentType 导出；xlsx-gateway：CF 阈值有限性、DV sqref 替换、超链接重编号正则、非有限单元格值；pdf2docx spread 管线；html2docx 书签载体（表格/卡片/色条）、文档 meta 语言、word-utils 间隔/制表位、有序表采纳项目符号标记、行内图 run 尺寸下限 1px |
| cli 安全 | --host 空串拒绝（防绑全接口跳过回环守卫）、MCP 会话 100 上限 FIFO 淘汰、布尔 flag 拒绝 =value（--force=false 不再当 --force）、Host 头缺失/畸形拒绝、检查项按级编号（无 E/W/I 跳号）、data-url 上限 |
| ai-provider | 新厂商 MiMo/Hunyuan/CheaperInference（OpenAI-compatible）、Exa/Firecrawl 搜索后端、ai-settings-guard 主进程 schema 校验（slides 同款 twins）、gskToolsEnabled 兼容别名 |
| pdf | merge 走 readMergeInputs：先 stat 合计超 1GiB 即拒（不读文件）、逐个顺序读（峰值内存单份）、io seam 可注入测试；export-images 独立主进程模块 |
| docs/slides/sheets | docs：流式分页不重采样未变 flow、Word 式列框线拖拽实时预览、斜线表头、表格列拖拽；slides：stop 信号接通云页生成（#1638 防中止后继续计费）、AI settings 主进程 schema 校验；sheets：save-scheduler 统一 AutoSave/崩溃恢复节拍（一次只一份在存）、close-guard 关窗前提交挂起单元格编辑器、CF x14 sqref/定义名作用域/打印标题列/重算范围边界/公式括号平衡 |
| ui/i18n | popover teardown 幂等（refcount 不再僵死）、a[href] 纳入模态 Tab 焦点环、CJK 衬线下载字体清单（font-names.ts）、i18n 缺键回退 zh 不抛错（#1628） |

**冲突裁定要点**：i18n ribbon shard 20 语言=并集（本地边框键+上游斜线键）；ai-search 保持本地 chaoffice 函数 API（上游 gsk 对象 API 需重写五端调用点，Exa/Firecrawl 挂账）；ai-provider types 本地超集+上游增量（mimo/hunyuan/cheaperinference/genspark 数据兼容 id、serply 搜索位）；cli mcp.ts 本地版保留（上游 --host 空串守卫已在本地 http.ts LOOPBACK 校验内实现，独立测试待挂账）；shell atomic-write 上游 fsync-before-rename 版本。

**门禁**：typecheck 0（全仓 21 工作区）；全量 15,560 测试全绿 EXIT 0。

### 第十八轮 G 更新内容汇总（产品视角）

- **安全加固**：CLI MCP --host 空串/Host 头/会话上限三重防护、zip 炸弹守卫独立包化、file-parse 文本 BOM 解码+拒绝不可解码编码
- **稳定性**：PDF 合并改 stat-先行+顺序读（防主进程 OOM）、docs 流式分页性能（不再每遍重采样）、popover 引用计数僵死修复、i18n 缺键不再白屏
- **新功能**：文档表格斜线表头与对角框线、列框线拖拽实时预览、幻灯片中止即停云生成（不再继续计费）、MiMo/Hunyuan/CheaperInference 模型、Exa/Firecrawl 搜索后端（待接线）、CJK 衬线字体下载清单
- **表格**：统一保存节拍（AutoSave 与崩溃恢复互斥）、关窗自动提交单元格编辑、条件格式/定义名/打印标题多场景修复

### 第十七轮增量（2026-09-25，0d90149..3f9d07d：18 提交，施工于 sync/upstream-20260922b 分支；本地 shell 版本 1.0.3 自主线，上游 0.10.0 不跟随——激活 UI/购买体系为本地 B 区，版本号本地为准）

| 内容 | 结果 |
|---|---|
| ①版本 | 本地 shell 1.0.3（并行会话随 OS 授权联动打包）；上游 0.10.0——分叉自研发，本地号为准不合并 |
| ②更新内容 | 17 修+快照 efb9247a（115 文件 +8537）：安全加固（zip 越界/MHT 帽/EMZ 炸弹/路径 bbox）、a11y（breadcrumb/箭头/查找框）、修复（词统计/xlsx 小写公式引用/--max-chars 帽/print-titles 钳制）、快照=file-index 全家桶+folder-roots+Home 树重构 |
| ③落位明细 | **13 实 pick**（#753 上游 MAX_EMU 超集/#746 isLiveRecord webContents 存活/#761 zip 越界/#762 bbox 循环/#770/#775 零冲突/#777/#778/#776/#780 env 隔离改编 GENOFFICE_* 豁免保留+#756 pdf 脱敏工作副本+#752+#795?——见 git log）；**5 空对账**（#741/#743/#748/#749/#755 均有 SAME-AS-UPSTREAM 文件佐证） |
| ③a 拷问#752 MHT 帽 | **上游自己回退了 #752**（快照 #757 删 MAX_MHT_PARTS/BYTES 帽）。初裁恢复帽子，**用户终裁：与上游源码保持一致**——alt-chunk.ts/test 逐字节取 upstream/main（无帽），2f90d5ac 反转落地，1456 测试绿 |
| ③b 拷问#756 pdf 脱敏工作副本 | 双机制并集：本地 untitled 转正+上游授权重绑（allowedByWc/redactionPathByWc/savedHook）；App 层 redactionRequestInFlight 门+apply 后 loadDoc 重载净化副本+根节点 inert/aria-busy 织入本地 DockShell；**ipc.ts/#756 净 delta 仅 1 行注释**——--theirs 误用曾削掉本地 V2 AI surface（AiSettingsV2/5 通道）/SavePdfResult.canceled/writeRecovery 通道/suggestedName，全量以 main 为基底回植+注释更新；strings 4 组 redact 文案重放 |
| ③c 拷问快照四域 | **Home.tsx/SettingsModal.tsx/home.css/e2e×4 全保本地**——并行会话 a5518899 已把快照树逻辑（file-index/folder-roots/FileTreePane）原样移植+按用户明令重构（胶囊 Tab），快照侧是上游主区表格旧形态。快照独有的 file-index 新模块（indexer/store/jev/rerank/scan/snippet/tokenize/extract-worker 8 件 IDENTICAL+folder-roots 补入+extract 品牌修复）；shell index 织入 setDocsFileOpenedHook（⌘O 立即同步 tab 标题）；file-parse pptx/xlsx @genoffice 残留补洗 |
| 施工事故与修复 | ①空 pick 卡死序列（--allow-empty 不适用 skip 状态）→ 改「探测+手动对账空提交」流水线；②`grep -c && python` 短路两度致带标记文件被提交（slides attachments 前轮/cli 780 本轮）→ 全部靠 esbuild 语法报错揪出 amend 修复；③shell index 织入过程结构性损伤（6 函数被腰斩）→ 逐函数从 main 抽取重构（applyMenuFor/registerHomeIpc/openAiDockTab/openMarkdownDockTab/openUntitled×3/abandonBlankTabForMcp/refreshTitleBarOverlay/createShellWindow）+pendingProjectSaveDir 缺 `}` 补齐——织入多冲突大文件必须以函数为粒度抽取而非行级拼接 |
| 门禁 | 对账 18/18（4 件有 SAME-AS-UPSTREAM 佐证）；typecheck 全工作区 0 错误；lint 改动文件 0 error；品牌零新增（GENOFFICE_* env 豁免）；全量测试见下；lock 重生成（tsx 平台矩阵） |

## 第十七轮挂账登记（2026-09-23 冲突分析问答，逐条销账）

| # | 挂账项 | 状态 | 说明 |
|---|---|---|---|
| 1 | Jev 全文搜索重排设置 UI | ✅ 已落地（问答拍板「补」） | 设置页新增「本机文件搜索」分区：开关/端点/分端点密钥即时持久化 + testFileSearchRerank 判定就地回显（commit 9bd2b946） |
| 2 | e2e settings-media-search.spec.ts | ✅ 已恢复 | 随 #1 恢复，按本地结构改编（独立分区 + 即时持久化断言） |
| 3 | 上游主区文件表格形态（面包屑/quick-cards/过滤 pills） | 维持弃用 | 已被首页改版共识（树内联文件）替代，行菜单/移动/拖拽等价能力齐备 |

## 合并门禁规则 v2（2026-09-23 用户明令，替代 §5 SOP 中与此冲突的部分）

1. **每次合并前**，先产出《上游更新分析》：上游本轮改了什么、逐条列出；非冲突部分直接合并；**冲突部分逐条问答人工定夺——每次只问一个问题、必须附建议答案、未达成共识不合并代码**。
2. 合并完成后须产出《冲突与裁决清单》（上游意图/本地状态/裁决结果三栏），供用户事后审计「去与留」；用户可推翻任何裁决，推翻即开新一轮问答。
3. 拒收/挂账项必须在本文件「拒绝清单」或「挂账」段登记，不得静默丢弃。

## 版本号规范（2026-09-23 用户明令，铁律）

格式：`自有版本.上游版本` 共六段 `X.Y.Z.A.B.C`。规则：
1. **每次更新合并上游代码后**，改后三位 `A.B.C` ＝ 本次合并到的上游版本号（例：合并到上游 tag v0.10.1038 → 后三位 `0.10.1038`）。前三位为自有版本线，仅在本地功能线升级时人工推进（当前 `1.0` 线，第三位 Z 为打包序号）。
2. **每次打包前**，第三位 `Z` 加一（例：合并后版本 `1.0.1.0.10.1038` → 打包版本 `1.0.2.0.10.1038`），作为打包纪律。
3. 版本号落点：`apps/shell/package.json` 的 `version` 字段只能存**前三段**（electron-builder 的 normalizePackageData 按 semver 校验，六段直接报 Invalid version——2026-09-23 实测）；**后三位**存同文件 `chaofficeUpstreamVersion` 字段。显示层由 `packages/electron-utils/src/display-version.ts` 的 `displayVersion()` 拼接为六段（设置页 getAppVersion IPC 与菜单关于已接）；更新器/遥测等 semver 管线继续消费三段 `version`，不受影响。
4. 合并改后三位与打包加第三位均在**合 main 前后各一次提交**内完成，与台账轮次记录绑定。

### 第十七轮增量（2026-09-23，0d90149..efb9247：9 提交（8 加固/小修 + 9-22 快照 115 文件 +8537/−783），施工于 sync/upstream-20260923 分支；施工前 stash 并行 WIP（home.css 窄落地+两 fixture 删除））

| 内容 | 结果 |
|---|---|
| #741 slides/#749 html 无障碍箭头标签（各 22 文件 i18n shard） | #741 冲突=slides ai/cs.ts 整文件三方断裂，按第十五轮 stage 重建配方（上游为基+本地独有键追加 115 键）；⚠️ 上游 8 键为多行格式，单行正则漏判致重复键 TS1117，删追加副本修正——**键提取必须兼容多行条目**。#749 干净 |
| #743 sheets 打印标题 21 行钳制/#748 html 面包屑/#753 docx 图像几何有限性/#755 metafile EMZ zip 炸弹/#746 shell 死内容守卫/#752 docx MHT 上限 | 全部干净 pick |
| **9-22 快照 efb9247**（Home 全文搜索+Parallel 搜索供应商+图表轴/图例/3D 斜角+ink 回退等） | 22 冲突文件全清。**未采纳（挂账后本轮已采纳，见下）**：Home.tsx/home.css/SettingsModal 初版保本地——用户随后明令首页改版，上游树/搜索后端（file-index 九件+folder-roots+home-api 搜索通道）全量落地，UI 经 home-files/FileTreePane.tsx 移植接入（见 feat home 提交）；ai-search/index.ts 多供应商链保本地（上游 useGsk/normalizeOptions 旧结构不采纳，normalizeSearchArgs 补 fallback=6）；cli image/image-source/xlsx-gateway-ops/html-main/docs-main/slides-main/ai-ipc 导入并集+MAX_REMOTE_IMAGE_BYTES/readBodyCapped 封顶符号跟进；docs App.tsx 结构区保本地 DockShell+织入上游 focusFindNonce（FindPanel 新 prop，顺手清掉 main 存量 findFocusInput 未用告警）；slides ChartBody/NodeBody/export-svg 采上游 3D extrusion/displayFontFamily 并去品牌；shell index.ts 四冲突=applyPendingProject 保本地+openPath 织入 fileIndexer.refresh+parked 前缀保品牌+启动时序并集（4s 首扫）；tab-manager activate=本地 layout()+上游 focusActiveView() 并集（漏改后补）；electron.vite.config=node:sqlite external+本地 MCP 别名并集；strings.ts 10 处纯上游新增键取 theirs；**files-pane 兼容**：上游 #757 删旧单根 folderRoot 通道，六端 files-pane-bridge 仍硬编码旧名——主进程恢复注册 home:folder-root（describeRoot(defaultSaveDir) 语义）保 Files pane 不断；其 e2e home-search/settings-media-search 初版删除，home-search 随 UI 落地恢复（去品牌+窄栏断言），settings-media-search 维持删除（Jev 设置 UI 挂账） |
| 首页改版（用户 2026-09-23 六轮问答共识，方向 A） | 见 feat(home) a5518899：树内联文件+2×3 新建直钮（落点=树选中文件夹）+搜索框+对话｜项目双 Tab 接回；e2e home-folders 按树内联形态与延迟落盘架构改编（3 用例）、home-search 窄栏断言改编、新增 _home-shot 截图规格；修 FileTreePane 文件行菜单 dismiss 缺 inside 根真 bug |
| 门禁 | 对账 9/9；品牌 grep 全量改动文件零残留（测试 tmpdir 前缀/__genofficeDebug→__chaofficeDebug/注释旧名清理）；typecheck 全工作区 0；shell 702 测试全绿；lint 回 main 基线（新增项清零）；home 系 e2e 5 用例全绿（截图 e2e/artifacts/screenshots/home-new-*.png） |

**本轮新坑**：①上游 i18n 键存在多行格式（键名单独一行），键级合并正则必须兼容，否则漏判重复；②上游删除通道时其旧名可能仍被本地 B 区桥硬编码（files-pane-bridge ⇄ folderRoots 改名）——删通道先全库 grep 旧通道字符串；③e2e 规格断言的写盘行为可能与本仓「延迟落盘」共识冲突（新建即内存文档），改编前先核架构归属。

### 第十六轮增量（2026-09-22，476e5023..0d90149：37 提交，施工于 sync/upstream-20260921 分支；上游安全加固批量周+两特性）

| 内容 | 结果 |
|---|---|
| 引擎/壳层加固×33（docs 页码/EQ 列/脚注展开/print-pdf-buffer 校验/HTML hex 越界/AI 长度解析×3/cm i18n、docx colSpan/formatNumber/EP 列、xlsx-gateway 排序确定性+IronCalc 跨表引号+cli styles 重复写、pptx chartEx/flattenSvg、slides Custom Show/起始页/墨迹 payload/metafile 字幅/粘贴图 5MB、pdf 标注颜色四边形、pdf2docx 间距有限性、sheets 打印几何/默认阈值、html2docx 零面积图、ai-provider 媒体设置容错+自定义端点 URL 校验、ai-search 钳制、electron-utils SSRF 重定向/生成图字节、pipelines 大纲 JSON、shell CLI 输出缓冲、cli JPEG 标记） | 31 件干净 pick；**#590** 冲突=品牌导入行+maxRelationshipId 并入；**#594** 测试冲突=保 chaoffice 登录命名+收新校验用例；**#610** docs-main 两块=有限性 printScale+print-pdf-buffer 校验/scale 接线（pdfScale 复活）+print-args.ts 新件；**#672** attachments-ipc=上游 error 形状+本地 chaoffice-pasted 目录（⚠️ 曾因 grep -c 短路致带标记文件被提交，amend 修复）；**#623** image-loader 测试=品牌+MAX_METAFILE_BASE64_CHARS 导入 |
| #586 自定义端点模型发现（feat） | **空 pick 对账**：custom-models.ts 与本地 discovery.ts openAiStyleModels 同构（GET {base}/models+Bearer+多 URL 回退），本地 aiDiscoverModels 已覆盖；SettingsModal UI 不采纳（本地 V2 页自有发现） |
| #602 ai-search 钳制 | **接通遗留**：normalizeSearchArgs 定义在而调用缺（第十五轮快照半接线），本轮全层接线+测试驱动发现 tavily max_results 漏改 |
| #656 Parallel 搜索供应商（feat，14 文件冲突） | **adapted 重实现进本地多供应商链**（沿第九轮 Opper 并集先例）：parallel-mcp.ts 新件（匿名 Search MCP，brand chaoffice）+index.ts parallel 层（有键 REST api.parallel.ai；无键且 prefer=parallel 启用免费 MCP；插 searxng/duckduckgo 之间）+types AiSearchProviderId+search-settings 注册表（needsKey:false）+search-tools parallelKey 透传+ai-search 依赖 @modelcontextprotocol/sdk ^1.30.0（根已有，lock 更新）；README/CONTRIBUTING/SettingsModal 按 Q5/本地 V2 不采纳；测试 2 例改编（REST mock+无键门控） |
| 门禁 | 对账 37/37；品牌 scan 改动文件零残留；typecheck 全工作区 0；lint 改动源文件 0 error；全量测试见末行；ai-search 80 绿 |

**本轮新坑**：①**`grep -c ... && python` 短路陷阱**——grep 零匹配退出码 1 会让 && 后的修复脚本不执行，带冲突标记的文件被直接 add+commit（靠 esbuild 报 `Unexpected "<<"` 揪出，amend 补救）——冲突解决脚本必须独立执行或用 `;` 连接；②cherry-pick 连发遇空 pick 会中断整个序列（"nothing to commit"），剩余件需先探测再补 pick；③上游安全加固批量周（30+ 件）与本地快照重叠度高，`git cherry-pick --no-commit` 探测（APPLIES-CLEAN/CONFLICTS 二分）比逐个撞冲突高效得多。

### 第十五轮增量（2026-09-22，f5247d3..476e5023：31 提交（30 小修+特性 + 9-21 快照巨件 509 文件），施工于 sync/upstream-20260922 分支；施工前先提交并行 WIP 两笔（c2b045ec 多会话 D12/D13 + e4d5f2b2 并行会话快照））

| 内容 | 结果 |
|---|---|
| 30 个加固小修（pdf 链接矩形/大纲深度/脱敏区域上限、docx 字号/墨迹几何/惰性媒体 hash、pptx 连接线/字体/坐标、sheets CSV 上限、ai-provider 流式工具封顶、ai-search 结果封顶、electron-utils 投喂/query 封顶、cli 文件名/typo 钳制、markdown 图表键盘可达、slides 打印陈旧索引、xlsx-gateway CSV 解析上限、shell openPath 守卫、file-parse xlsx 界限、html 面包屑、project-store timeline 钳制+项目名上限+pending flush、docs/sheets/slides chat IPC 载荷校验 #550/#551/#552） | 除 openPath（D 区并集：上游长度守卫并入本地 remote 物化+dock 结构）与 project-store store.ts createProject（本地 rootPath 校验+上游名称钳制并集）外全部干净 pick |
| #544 docs analyze_media 特性 | **并集+通道统一**：docs-skill/tools/protocol/main/i18n 全收；本地媒体技能（agent-core createMediaSkill）已提供同名 analyze_media——docs 媒体技能加 `skip:['analyze_media']` 防双注册；上游 `ai:analyze-media` 专用通道不接线（Genspark/BYOK 提供方），tools.ts 的 blockIndex 读文档内嵌图改走本地 `ai:media-understand` 统一通道；ai-host registerMediaIpc 新增 `resolveSource` 扩展点（docs 传 lazy→data: URL 物化器，保留上游 handler 内的惰性图片解析能力）；可用性门=本地能力旗标（mediaCapabilities imageUnderstanding/videoUnderstanding，mount+focus 刷新）替代上游 gskLoggedIn 判定；docs-skill 的 mediaToolsOff 去除 imageGenAvailable 引用（本地无此参数）；ai-search media-tools 的 data: URL 支持照收 |
| **9-21 Sync 快照 476e5023**（509 文件 ±2.8 万行） | ~110 冲突分桶全清。**slides i18n 60 shard 以 stage 重建配方统一重建**（上游为基+本地独有键追加；zh 源文件裸 `}` 结尾、其余 `} satisfies`，键集对齐 `Record<keyof typeof zh>`）；**pdf strings 程序化对账**（上游新增键仅 outlineGenerated×20 语言织入 local 尾 spread 架构）；**slides 特性波并集**（edit-points/export-svg/ShowMediaLayer/ZoomDialog/双击集中分发/媒体投放重构/演示者视图/媒体动画键——本地 DockShell 布局、动画引擎超集、多会话 AiPanel、ZoomControls 超集全保）；**docs 特性波**（byte-handoff/lazy-media-inline/本地编辑流/分页快路径/流式尾卫/离线解析/大文档/滚轮缩放+ImageViewer 并入；Ribbon 双字体本地链保结构；CSP 并集 media-src 保留+connect-src 增 chaoffice-docx-media:）；**shell 分离窗口**（detached-windows+detachTab+watchApiKey——本地 dock 架构 hand-off 适配，TabBar 双 onContextMenu 收敛回本地 showTabContextMenu+home 守卫）；**sheets**（statusbar-file-stats/wheel-zoom 并入，上游单会话 chat 区块弃=本地会话池替代）；**pdf**（paper-sample/文本擦除实时预览织入本地 DockShell+RedactionLayer 结构，autoRename 维持拒收裁定）；**parse.ts SVG blip 中间地带**：本地双部件模型胜（mediaRef=raster+svgMediaRef=svg，渲染层矢量优先可见结果等价+保留栅格兜底），上游 blipMediaRef 单字段模型留用于 shape-fill 路径，随附测试按本地语义改编 |
| 门禁 | typecheck 全工作区 0；lint 改动文件 error 清零（余 4 处 main 存量基线：docs App wordRangeAtCaret/findFocusInput/stripGeomSig+shell newFileDir，前轮行号实证）；品牌 grep 豁免外零命中（顺手清洗 slides i18n 5 处存量复合词形 Genspark-Konto/-account/Gensparku）；全量测试全绿（见本轮验收记录） |

**本轮新坑**：①**两仓库历史无关联 ⇒ merge-base 全部失效**——`git diff <上游终点>...HEAD` 三点 diff 恒为空，冲突分类必须用 pick 基点（84d5b8fb）显式双向 diff；②上游 i18n shard 的 zh 源文件以裸 `}` 结尾、其余语言带 `} satisfies Record<keyof typeof zh>`——stage 重建脚本必须按文件类型取尾部，且本地键提取时必须剥掉每文件末尾的闭合行（会被键正则当成长块误追加）；③cherry-pick 自动合并会造出**双 onContextMenu 属性**（TS17001）与**同函数双 closer**（TS1128）——tsc 逐文件扫才可靠；④上游给测试文件新增用例时符号名跟随重命名（gsk→chaoffice）已是第三次，本轮 `parseGskWebSearch`→`parseChaOfficeWebSearch`+`watchGskApiKey`→`watchChaofficeApiKey` 两处。

### 第十四轮增量（2026-09-20 深夜，ba123b3..f5247d3：3 提交，施工于 sync/upstream-20260920c 分支；本地并行会话同期已推进 9 提交+85 文件 WIP）

| 内容 | 结果 |
|---|---|
| #537 shell tab activate/close IPC id 校验/#538 pptx-ops setTableStyle borderWidthPt 非有限与超界拒绝/#540 ai-provider 共享流解析器 SSE 行缓冲封顶 | **三件全部零冲突干净 pick**（shell index.ts 本地重架构区但 #537 改点独立；随附三测试全收） |
| 门禁 | 对账 3/3；品牌 grep 零新增；typecheck 三受影响工作区 0 错误（全链 exit 2 系并行会话未跟踪 WIP 文件（六端 media-skill.ts 引用未接线 agent-core 导出）所致，与本轮 pick 无关——本轮未触 docs）；pptx-ops 37/ai-provider 370/shell tabs 3 全绿；lint 零新增（newFileDir 未用为 main 存量同行号实证） |

**本轮新坑**：**全链 typecheck 门禁在并行会话活跃期会误报**——stash 只保护已跟踪文件，未跟踪新文件（如 media-skill.ts 系列）留在树里被 tsc 的 include 捕获；收敛口径=按本轮 pick 触及的工作区逐个 tsc 验证（并记录并行 WIP 状态为豁免依据）。

### 第十三轮增量（2026-09-20 晚，229fbb8..ba123b3：8 提交，施工于 sync/upstream-20260920b 分支）

| 内容 | 结果 |
|---|---|
| #535 markdown roundtrip browser spec 去重/#528 pptx-ops insert 非有限/负矩形拒绝/#530 file-parse xlsx rel 目标规范化/#531 pdf2docx 空帧位图尺寸钳制 | 全部干净 pick |
| #529 shell tab 查找走 canonical 路径比较 | **adapted**：本地 tab-manager 方法布局分叉——上游 canonical 版 findTabByPath 落在冲突块，解法=保 HEAD closeOtherTabs+把本地 345 行旧版（字符串比较）替换为 canonical 版（realpathSync.native，path 可选）+findTabOfKindByPath 抽取自动合入+文件尾 canonicalPath 函数收上游；66 测试绿 |
| #532 ai-search gsk 图片版权过滤走共享主机检查 | **空源码 pick**：意图（isCopyrightHost 替代 URL includes）第七轮 8bafc54 已在本地 chaoffice.ts:255 落地；随附测试跟随 gsk→chaoffice 改名进 chaoffice-search.test.ts+parseGskImageSearch→parseChaOfficeImageSearch 符号名跟进；75 测试绿 |
| #534 slides 陈旧当前页索引重置保存状态 | 干净 pick（file-actions 本地保存串行化架构兼容） |
| #533 ai-provider 流式工具参数按工具封顶 | 干净 pick（anthropic/openai-compatible/shared 三协议+stream 测试 355 绿） |
| 门禁 | 对账 8/8；typecheck 全工作区 0；pptx-ops 34/file-parse 60/pdf2docx 760/ai-provider 355/ai-search 75/slides 保存 6/shell 66 全绿；lint 改动文件 0 error；品牌 grep 零新增（genspark.ai URL 豁免基线） |

**本轮新坑**：上游改本地已重命名文件（gsk.ts→chaoffice.ts）时**测试新增用例的函数名也要跟着改名**（parseGskImageSearch→parseChaOfficeImageSearch）——与第十二轮坑②同型，重命名跟随 pick 后必须 grep 上游符号名。

### 第十二轮增量（2026-09-20，316ded6..229fbb8：38 提交，施工于 sync/upstream-20260920 分支）

| 内容 | 结果 |
|---|---|
| 引擎小修×8：#521 html2docx shotId 谓词（convert.ts 保上游）/#504 DV 日期/#506 slide id 扫描界/#507 pdf2docx median 非有限/#508 file-parse pptx 反斜杠目标/#509 docx base-26 图表列/#510 html2docx 页背景 hex/#519 style color hex | 全部干净 pick |
| #505 agent-core streamText 守卫/#515 docx-engine zip 句柄+中央目录校验/#518 ai-provider watchdog 归一/#517 electron-utils 渲染文件解析加固 | 干净 pick；**#517 测试品牌重放**（genoffice-app→chaoffice-app scheme+join(rootDir) 结构） |
| #511 docs touched-blocks 测试/#512 cli MCP http host 加固/#513 markdown 图表栅格化守卫（diagrams 本地十轮已收）/#514 sheets MCP sheet 寻址（十一轮 mcp-sheet-refs 续改） | 干净 pick；**#512 随附测试 helper tmp 前缀品牌化**（chaoffice-mcp-http→chaoffice-mcp-http 对齐本地服务端，全量测试揪出） |
| #520 pdf toasts/大纲空态 | **adapted**：App.tsx 保本地 DockShell 布局，OutlinePanel 织入 label/emptyLabel props+两处 toast 补 role="status"（本地 i18n 键 searchNoResults 复用） |
| #522 slides 选中元素复制为剪贴板图片（10 文件） | **adapted**：element-clipboard.ts/selection-image.tsx 新件品牌重放（ELEMENT_CLIPBOARD_FORMAT=data-chaoffice-slides-elements→data-chaoffice-slides-elements、io.chaoffice→io.chaoffice、@genoffice→@chaoffice、e2e tmpdir 前缀）；slides-main 四冲突=导入去重（i18n/ProjectStore 本地已有）+三处 marker 检查 token 化取上游 |
| #494/#495/#496 三测试件 | 干净 pick |
| #497 cli help/registry/README/skill 同步测试 | **重改编**：help-sync.test.ts 按本地架构改编（bin 名 chaoffice 断言/skill 路径 skills/chaoffice/SKILL.md/skill 正文检查用 chaoffice 前缀——skill 教的是 chaoffice 启动器）；**上游"补文档行"意图重放进本地文档**：cli README 补 selection/skill×2/install-cli/mcp 五行+render 网格/create csv 两围栏例（覆盖 --grid/--tile/--pad/--cols/--el/--header/--decimal）；chaoffice SKILL.md 表格行升级选项语法（info --password、xlsx --header/--decimal、slides --layouts/--max-chars、render --el/--pad/--grid/--tile、sheet --cols/--max-rows/--where/--stats、docs --sections/--fields/--notes/--styles/--track/--author、guide --index/--fingerprint、image --model、open --block 等）+selection/skill 两新行+mcp stdio/http prose；版本 2.7.1→2.7.2；skills/genoffice 目录复活即删（DU 解） |
| #498 a11y 硬编码 aria 标签 i18n 化（13 文件） | **adapted**：五 app AiPanel 保本地 PanelTabs 架构（本地无 Gensmark/Genspark aria 残留，上游改点不存在）；ExcelShell 保本地 DockShell 块+`aria-label="Workbook commands"`→`t('appScopeWorkbook')` 织入；html 四件+slides PrintDialog+sheets 两件自动合入 |
| #501 project-store 遍历 id 拒绝+chat limit 钳制 | 干净 pick（本地保留的 P1 API 与上游加固正交，80 测试绿） |
| #502 pptx-render 视口守卫/#468 docx spinCount 钳制/#467 xlsx-gateway 单元格地址加固 | 干净 pick |
| #487 CI 接线 xlsx-gateway/pptx-ops 测试 | **adapted**：.github/ci.yml 按 Q5-② 保本地；root package.json 保本地 @chaoffice 链+test 链补两个工作区（typecheck 链本地已有）；pptx-ops vitest.config 保本地品牌+收上游注释；两包 package.json 加 test 脚本/vitest devDep 自动合入 |
| #465 ai-search gsk 输出解析 | **adapted**：gsk.ts→chaoffice.ts 重命名跟随，函数体自动合入+注释块取本地命名语义；**随附测试 parseGskOutput→parseChaOfficeOutput+行粘连修复**（typecheck 揪出） |
| #523 docs 大纲样式级标题 | 干净 pick+**品牌补漏**（headings.ts @genoffice→@chaoffice import——Pick<StyleInfo> 类型不对称炸出）；dual-font/headings 测试件 import 同修 |
| #476 markdown 分页 PNG 导出（21 文件） | **分域采纳**：image-export.ts/print-pdf.ts 新件全收（print-pdf tmpdir 品牌化 chaoffice-md-print）；markdown-main 采纳 printMarkdownPdf 模块调用替换本地内联打印窗口（语义等价提取）+自动合并重复行修复；App.tsx 保本地 DockShell+imageExportStatus 织入本地底栏 status-left；strings.ts 20 语言块"本地键保全+4 新键并入"配方；shell 菜单 menuExportImages 自动合入（sendMarkdownExportRequest 'png' 走本地 tabManager）；ci.yml Q5 还原；pdfjs-dist 依赖进 markdown package.json |
| #492 markdown 公式粘贴保纯文本 | 干净 pick（sheet-focus.ts 新件+sheets App 导入并集） |
| #491 Windows 资源管理器新建菜单 | 干净 pick+品牌：shell-new.test.ts @genoffice→@chaoffice；installer.nsh ChaAI Office* NSIS 内部宏名沿文件既有约定保留（内部标识符豁免）；blank 模板三件+生成工具照收 |
| #472 markdown 行内代码周围格式化 | 干净 pick（@tiptap/extension-code 3.31.0 pin 与本地一致） |
| #493 updater 提示与安装 opt-in | **干净叠加**（本地 updater.ts 与上游同构——site-sync 为独立模块不碰此文件；本地三处差异 @chaoffice i18n/CHAOFFICE_UPDATE_URL env/本地 releases URL 全保；41 测试绿） |
| #474 docs 中西文分字体设置（47 文件巨件） | **分域重实现**：docx-engine font-settings.ts/previewFontSettings/DefaultFonts 全收（patch.ts styleDeletes 并集+条件合一）；doc-dirty/styles.css/ribbon-format-state（fontEastAsia/fontLatin）自动合入；App.tsx 五冲突=导入并集/fileCtx 并集（styleDeletes+defaultFonts+settleFontSettings）/onFontSettings 回调全收/**aiDocExtras 块沿"unwired locally"裁定不接线（lint 死代码移除，watermark set 本地文本模型降级注释）**/DockShell 保本地+Ribbon 补 onFontSettings+docDefaults props；Ribbon.tsx 三冲突=导入并集（cssFontFamily 后清）/fontScope+busy state 收/渲染保本地 HomeTab；**home-tab.tsx 手工重实现双槽字体 UI**：单 combobox→['font','fontAscii'] 双槽循环（rb-font-slot-label+data-font-slot+ribbonFontMixed 占位）+作用域选择行（selection/defaults/style:<id> 下拉）+Ribbon 传 fontScope/setFontScope/busy/onFontSettings/styles 六 props；i18n ribbon shard 8 新键×20 语言自动合入 |
| 门禁 | **typecheck 全工作区 0 错误**（两轮修复：headings 品牌导入/ai-search 测试命名/pdf RedactionLayer 首用点补 props）；npm install lock 重生成一致（3 行字母序+版本对齐）；lint 新增 error 清零（余 3 个 wordRangeAtCaret/findFocusInput/stripGeomSig 为 main 存量基线实证）；品牌 grep 新文件零残留（slides e2e 注释 ChaAI Office→ChaOffice 补洗；豁免命中=installer.nsh NSIS 内部名基线+LEGACY_PROFILE_ID+genspark.ai）；**全量测试 exit 0：32 工作区报告/1237 文件/13,572 用例零失败**（markdown roundtrip 语料 check() 断言按本地语料改编——README 三连 badge 段内嵌块级 image+math-omml listItem 含缩进代码围栏两形态 main 实证预存，入 KNOWN_INVALID_DOCS 豁免、字节往返仍严格；direction 测试断言指向 home-tab） |

**本轮新坑**：①**cherry-pick 连发易漏单**——批2 连 pick 时 #516 被跳过，靠"38 sha 对账脚本"（subject 逐字 grep）在门禁前揪出补 pick，**每轮终检必须跑对账脚本**；②上游改已重命名文件（gsk.ts→chaoffice.ts）时 pick 跟随重命名但**新增测试用例仍写上游符号名**——typecheck 是唯一可靠探测器；③Pick<StyleInfo,...> 类型不对称的报错根因可能是**新增文件 import @genoffice 品牌残留**（模块解析失败致类型退化），先查 import 再查类型；④pdf App 有**两处 RedactionLayer 用点**（缩略图+主视图），上游只改一处时另一处靠 tsc required-prop 报错补齐；⑤测试读源文件断言 UI 结构（direction.test.ts 盯 Ribbon.tsx）在组件提取后需改编到新文件。

### 第十一轮增量（2026-09-18 下午，5b6dfbf..316ded6：9 提交，施工于 sync/upstream-20260918b 分支，merge=6adda5db）

| 内容 | 结果 |
|---|---|
| c9894a0 #473 PDF 大纲折叠+home 行菜单视口保持 | **adapted**：pdf-outline-header 织入本地 DockShell 布局（上游块在其旧布局内）；home.css CSS anchor(position-anchor/position-try) 自动合入 |
| 84b1181 #477 sheets 计算数不入文本路径+按名称引用 | **并集**：formula-values(modelCellValue)/mcp-bridge(normalizeSheetRefs) + 新件 mcp-sheet-refs.ts；e2e helpers 保 CHAOFFICE_LANG env 名 |
| fc236cf/#483、63900c2/#484、1639ef7/#485、717b931/#489 四包测试 | 干净 pick；**pptx-ops op-docs 同步校验加 LOCAL_SIG_ONLY 豁免**（setPictureLum/addWordArt/addEchart/getEchart/updateEchart=本地超集 op 只有 sig 无上游 md 块——第八轮 sig-only 先例的包级重放） |
| af0fd91 #475 **PDF 永久区域脱敏**（12 文件） | **分域采纳**：RedactionLayer 组件+redaction.ts 引擎件全收；App 特性块十处织入本地布局（redactions state/ordinaryDirty 分流/applyingRedactions 保存分流/结构操作三阻断/redact+清除+应用钮/图层渲染）；pdf-main requestRedactionCopy handler 收；**autoRename/isUntitled 按第八轮裁定拒收**（本地 untitledPdfMetas 延迟落盘架构替代）；strings 8 redact 键×20 语言重建（zh/zh-TW 中文、其余 en 兜底——上游只给 en 主块+zh 从属块加值，本地全语言同键契约需补齐） |
| fd95053 #488 对话框 role/focus/escape、316ded6 #482 html2docx IR 校验/中止/图片等待 | 干净 pick |
| 门禁 | typecheck 0；十工作区测试链 exit 0（docs 2621/sheets 2839/shell 572/slides 878/pdf 760/markdown 420/html2docx 79/pptx-ops 32/xlsx-gateway 55/pipelines 57）；lint 改动文件 0 error；品牌 grep 豁免外零命中（#477/#483 新文件 @genoffice 残留补洗含 chaoffice.cjs 产物名/open_in_chaoffice→open_in_chaoffice/__genofficeDebug/vitest 别名）；build:web exit 0 |

**本轮新坑**：①**package-lock 冲突未解直接 git add 会让全仓 vitest/vite 启动炸**（"Exit prior to config file resolving"=lock JSON 语法错，症状在测试不在 git——lock 冲突必须先 npm install 重生成再 add）；②resolve 冲突块的 python 脚本 endmark 匹配必须吃满到行尾（残留半个 `>>>>>>>` 标记同样炸 vite:esbuild，grep 扫描要在 add 前做）；③pdf strings 双引号语言键 `"zh-TW":` 不进 `'?[\w-]+'?:` 正则——块级脚本必须同时吃单双引号；④pdf strings 上游结构(主 en 块+localized 从属块)与本地(全语言同键)不同构，新键需 8×20 全量补齐而非照抄上游三处。

### 第十轮增量（2026-09-18，6f8a892..5b6dfbf：6 提交，施工于 sync/upstream-20260918 分支，merge=58c26c34）

| 内容 | 结果 |
|---|---|
| 2289469 #461 pptx 图表 1904 日期系统 | 干净 pick（101 测试绿） |
| 80d2a46 #463 **9-17 Sync 快照**（259 文件 +10.5k/−3.5k） | 63 冲突分桶全清。**分域采纳**：docx-engine lazy-media/zip-splice 全收（docs CSP 增 chaoffice-docx-media: 协议+electron.vite 别名+parse/patch lazy 链，patch.ts 本地 echart 分支与上游 images 分支链接并存）；docs prosemirror-perf/touched-blocks/top-level-pos/protected-render/pagination 系列引擎件收（App/Ribbon/main.tsx 保本地=DockShell 域；pagination-gaps 融合=上游批量测量结构+本地 per-section secLeftPx 超集，LOCAL 标记）；markdown sourceSplice 保存拼接/diagrams(mermaid+wavedrom)/图片查看器/拼写检查钮全收（App 织入 DockShell 结构内，IconSpellcheck 走 './icons' 非 ui 包）；sheets border-overflow-exclusion/cf-empty-fast-path/context-submenu-reopen-fix/copy-materialize 收（ExcelShell/App/styles 保本地）；cli mcp http/remote/files 三新模块收（run.ts scratchDir 保本地 chaoffice 前缀+base.scratchDir 覆盖）；shell updater 重做收（env 名保 GENOFFICE_FAKE_UPDATE 豁免）；app-menu checkUpdates 收（品牌 ChaAI Office）；ai-provider DeepSeek V4.1 Flash 目录重组收（测试按 chaoffice id 改编，Agnes/Opper 并存）；home-api Folder 类型保本地定义（上游 re-export 指向已删 files-pane 域） |
| **FilesPane 全家保本地**（铁律） | 上游把 FilesPane 从 ui 包整体删除（-1400 行）；本地 markdown 编辑器在用——ui FilesPane/files-pane.css/types/strings、electron-utils files-pane-bridge、六 app 的 FilesPane 渲染 hunks 全部保本地，UD/DU 冲突按"本地活功能必胜"解，ui index/files-pane.css 导出面回补；记空 pick |
| 3cfb70f #464 file-parse 空共享串/畸形引用、aa15792 #466 恶形幻灯尺寸、041e11b #469 媒体测试限流呈现、5b6dfbf #470 imageDPI 哈希缓存 | 全部干净 pick |
| 门禁 | typecheck 全工作区 0；全仓测试链 exit 0（docs 269 件 2729 用例/sheets 258 件 2801/shell 572/slides 883/pdf 747/markdown 392/cli 270+…）；lint 改动文件 6 error 全 main 存量；品牌 grep 豁免外零命中；build:web exit 0 |

**本轮新坑**：①品牌全局 sed 三类误伤（本轮三处回正：GENOFFICE_FAKE_UPDATE env=豁免清单/字体族名 ChaOffice Hiragino Sans=内部标识符/测试期望 URL genspark-ai→本地仓——品牌 pass 后必须跑一遍"豁免词表 grep"：`GENOFFICE_.*env 名/ChaOffice(字体|Poppins|UIKana)/genspark-ai`）；②cherry-pick 自动合并会造**行粘连**（双方同位加行拼成一行 `} from '...'import ...`，tsc 有时漏报但 eslint Parsing error 必现——收敛配方=eslint 扫改动文件抓 Parsing error+python 逐处拆行）；③keep-ours 解法的文件里上游给同函数加的新 prop 会成死线（html Ribbon onSaveAs/typecheck 才暴露——keep-ours 后必须比对上游 hunk 里"加 prop"的部分重放到本地调用点）；④git ls-files 默认对 CJK 文件名 shell 引号转义（测试遍历 .md 时 ENOENT——用 `-z` NUL 分隔）；⑤commit 前 add 列表必须与修复文件核对（本轮 slides 三件漏 add，靠 checkout main 被"Aborting"拦下才发现）。

### 第九轮增量（2026-09-17，09485f8..6f8a892：5 提交，施工于 sync/upstream-20260917 分支，merge=faeb9483）

| 内容 | 结果 |
|---|---|
| **前置：第八轮渲染端欠账收编**（3dd41490，先于 pick 落位） | 第八轮 Route B 回退挂账的渲染端全部接通：①sheets 渲染端 MCP 桥=mcp-bridge.ts+control.ts 取 09485f8+品牌重放，desktop-api（McpCommand 三通道/save targetPath·overwrite/recalc isError）+preload+ipc-channels 接线，App.tsx 3-way 织入 installSheetsMcpBridge/handleSheetsControl（全局名 __chaofficeControl 对齐本地壳层 control-handlers 约定——第八轮壳侧已落而渲染端缺位=半接通状态终结）；②docs/slides/pdf 三 App 补 __chaofficeControl 接线（control.ts 第八轮已落但零引用=死代码）；③快照 STUCK 件全量收编（save-actions SaveOutcome/table-actions/lazy-find/menu-input-enter/clipboard-anchor-tile/filter-range-outline/shared-formula-journal/prompts layout.md+10 测试）；④isError 贯通收缝（univer-state PinnedClosureCell/recalc schema/univer-sync overlay/save-pipeline+sheets-main formulaValues 放宽 {error}）；⑤edit-journal fromNeutralStyle 重放上游主题色映射（resolveStyleColor/fillDisplayColor——网关 union+gradient schema 早已在本地，渲染写路径今对齐）；⑥print-html 纸张尺寸对齐（4=17×11、13=7.17×10.12）；⑦markdown OutlinePane 可拖宽+App outlineWidth 持久化 |
| ea6d638 #451 MCP 按文档定向编辑+审计修复 | **零冲突落位**（前置补欠账后基线对齐）+adapted：**去重 createPdfTools**（本地 3a5ebabc 已恢复注册，上游 #451 再恢复一次=重复注册炸 initialize 500）——「上游自己丢又自己找回来」与本地自补撞车是本轮新坑 |
| 3ebe073 #437 AI 面板停靠侧设置+快捷切换 | **分域采纳**：packages/ui 全收（prefs side 字段/AiPanelSideButton/ai-panel-prefs.css/index 导出+测试）；shell main 设置存储（aiPanelSide 读写+setAiPanelPrefs 重构）+SettingsModal 侧向下拉（adapted 入本地 V2 版，import 冲突按本地 subpath 风格并集）+strings.ts 60 键（A/B 架构自动并入 upstreamStrings 区，尾 spread 完好）；**各 app AiPanel/preload/ipc/styles 6 套 hunks 保本地**（本地 AiPanel=PanelTabs/DockShell 架构与上游 resize/header 结构完全不同构，左右停靠已由 DockShell position('left'/'right'/'bottom'/'float')+持久化覆盖——记空 pick）；preload/ipc 通道件无害随行；settings-ai-panel.test.ts 维持本地删除裁定（第二轮 V2 设置面）；e2e ai-panel-side.spec.ts 弃（测未采纳 UI）、ai-panel-side-settings.spec.ts 收（测已落地设置面）；ci.yml Q5 还原 |
| 158e352 #454 Opper BYOK 供应商 | **并集**：types/registry/providers/logos 本地 Agnes 与上游 Opper 双_entry 并存；测试双用例并收；README Q5 保本地 |
| d1280d1 #457 PPTX 幻灯片按演示顺序提取 | 干净 pick（引擎层，44 测试绿） |
| 6f8a892 #458 markdown 不变源往返 | adapted：roundtripSerializer 新件全收（env 门控 opt-in）；App.tsx 一处冲突=onReadTextRequest 块取 theirs（serializeMarkdown 化）+**补漏 offReadText() cleanup**；markdown-main writtenText+ipc 类型随行；playwright.config+browser spec 收；ci.yml Q5 还原 |
| 裁定 | ①project-store ipc.ts **保本地**（上游删 P1 项目 API=listProjects 等，本地 Home/两个 preload 活用在用=铁律本地胜）；②pivot 扫描预算护栏**随上游移除**（09485f8 结构性取消预算概念改 lastRow 界限，护栏+测试上游同删，本地测试同步删）；③FilesPane-in-sheets 继续挂账（ExcelShell 裁定取本地无 filesOpen 件，App 的 workbookPath 传参弃）；④xlsx-theme-fills.test 渲染端断言随 edit-journal 升级全过（无需改编） |
| 门禁 | typecheck 全工作区 0 错误；全仓测试链 exit 0（docs 2541/sheets 2800/shell 561(含 MCP 159)/slides 878/pdf 747/markdown 391/cli 258/ui 97/ai-provider 299…）；lint 改动文件 6 error 全为 main 存量基线（行号位移实证）零新增；品牌 grep 豁免外零命中；build:web exit 0 |

**本轮新坑**：①重复注册类「上游找回 vs 本地自补」撞车——pick 后必须 grep 新注册点是否双写（症状=initialize 500 internal error）；②python 拼接冲突块时 ours 侧若缺尾（`},`/`})`）必须补全再 typecheck（providers.ts 落过一次 `Property assignment expected`）；③**git diff 用短 sha 手敲补全会造错 sha 静默返回空**——必须 `git rev-parse` 取全 sha；④STUCK_AT_OLD 分类是欠账探测器（本地==f4d8da2 且上游改过=漏 pick），但对「上游删本地在用件」要反着裁（project-store ipc.ts）。

### 第七轮增量（2026-09-16，70e5149..f4d8da2：21 提交，先提交并行会话残余 WIP 6fc8c4db 后在干净树上直接 main 施工）

| 内容 | 结果 |
|---|---|
| 前置：并行会话残余 WIP 提交（91 文件 +2129/−660） | 网络搜索多供应商化（linkup/searxng 新模块+免钥 duckduckgo/bing/openverse 兜底，capabilities 默认即有搜索）、docs AI add_comment 工具（表格单元格级批注，AiCommentsAccess.create 三端补齐）、首页新建折叠分组+扫码关注 QR、skills 更名收尾 chaoffice→chaoffice；品牌规范化（察元AI Office→察元AIOffice ×3）+死代码清理（migrateSettingsV2/StoredAiSettings 死导入×4、LEGACY_TOOLS_KEY、readJson、loggedIn/email）；cli capabilities 测试按新意图改编（免钥引擎=默认可用） |
| 16 个零交集小修（c00f9fb 数学粘贴定界符/789f94e docx 跨段域码折叠/8dd05f1 docs 亚洲字符计数排除 PUE+变体选择符/68ed56f pdf AI 搜索词折叠/672de21 html 单引号样式属性撇号转义/a54b152 pdf2docx 阿拉伯导符线锚定行尾/38669c4 pdf encodeStyle 字段消毒/f06ad3d sheets 整行跨距复制填充平移/572d6c5 sheets 现代 Excel 错误值标记/b0dad7c markdown 文件系统根文档兄弟图片/311e2c0+748d0c8+fcb2ca8+f4d97b8 docx 单引号系列×4/46282ec file-parse 脚注尾注文本提取/bac0552 ai-provider SSE 末尾 TextDecoder flush/f4d8da2 pdf 非整数打印页目标拒绝） | 全部干净 pick |
| 1113835 MCP review 修复（docs family+stdio 桥） | 干净 pick（第六轮 MCP 落地质量过关） |
| a5f181f shell 重命名先验 raw 名 | **adapted**：index.ts 冲突=上游删 trim 后冗余校验行+本地远端重命名分支相邻；并集=采 raw 门（isValidRawRenameName）+保本地远端分支 |
| 093ecfb ai-provider 空白键/URL/模型视为未配置 | **adapted 六文件全冲突**（WIP 重构区）：三源码=本地架构（chaoffice 回落/needsKey===false 免钥/DEFAULT_WEB_SEARCH_PROVIDER）+上游 trim 语义（?.trim()）；三测试=断言按本地语义改编（回退值 chaoffice/''/duckduckgo，本地免钥 bing/duckduckgo 合法故不采上游 bing→genspark 断言）；随附 media.test 冲突标记清除单独提交 |
| 8bafc54 ai-search 版权主机过滤按主机名作用域 | **adapted**：上游新增 duckImageSearch 与本地链冲突——本地图片链=serper→bing→openverse 无 duck 图搜，函数弃（免死代码）；真正意图（isCopyrightHost 主机名级过滤替代 URL 子串匹配）落在本地 bing.ts+chaoffice.ts 两模块（子串→主机名级） |
| 随轮品牌补漏 | pick 新增行 @chaoffice/ui 导入×1（pdf tools foldCase）→@chaoffice/ui；新增行品牌 grep 终检零命中 |

**本轮新坑**：①cherry-pick 测试文件冲突用「保 HEAD+插上游新用例」解法时，正则只吃到 `=======` 会把上游侧断言残留在文件里（media.test 双断言对撞，typecheck 不报、测试红才暴露）——resolve 正则必须吃满到 `>>>>>>>` 尾行；②上游给测试新增的回退值断言（genspark）在本地架构下语义不同（chaoffice/''/duckduckgo），照抄必红，逐值改编。

### 第六轮增量（2026-09-15，ed2bb865..70e5149：26 提交 / 84 文件，施工于独立 worktree 分支 sync/upstream-20260915——主树当日有并行会话未提交工作，全程零接触）

| 内容 | 结果 |
|---|---|
| 24 个引擎层小修（docx 单引号域系列×6/pdf2docx TOC 导符线×2/file-parse×2/pdf 打印流式+搜索折叠/pptx schema 空格路径/slides 主题令牌+查找替换+最近颜色/sheets 纸张映射+透视源/ai-provider×2/i18n/electron-utils/html/shell 重命名尾空格） | 全部干净 pick，零冲突 |
| e064f3a Windows dev 修复 | **空 pick 对账**：本地 scripts/dev-shell.mjs（Node 内注入 env+*_DEV_PORT）+ build-stale-preloads npm.cmd 方案已实现上游意图且更完整；cross-env 依赖不需要（Q5 清单记空收） |
| 70e5149 本地 MCP 服务器（37 文件 +7053：shell main mcp/ 模块×10+docs mcp-bridge+SettingsModal MCP 面板+11 测试+stdio 桥脚本+e2e） | **adapted 重冲突×4**：docs-main 导入并集；SettingsModal 三处（react 导入扩 hooks/SectionId 并 'mcp'/effect 体新调用全部改挂 window.chaOffice 桥，自动合并区 4 处 aiOffice 同步改名）；shell package.json 保本地域+手工加 @modelcontextprotocol/sdk ^1.30.0（lock 重生成）；品牌 pass 70 处（@genoffice→@chaoffice、chaoffice.cjs→chaoffice.cjs 对齐本地打包路径 cli/chaoffice.cjs、open_in_chaoffice→open_in_chaoffice、chaoffice-app://→chaoffice-app://、显示名 ChaAI Office→ChaAI Office、mcpServers 键→chaoffice；GENOFFICE_MCP_* env 豁免保留）；settings-mcp.test 补本地桥最小桩（adapted） |
| **随轮品牌切换（用户 2026-09-15 指令）** | 显示品牌 ChaOffice→**察元AIOffice（zh/zh-TW）/ChaAI Office（其他 18 语言）**：六 app i18n shard（138 文件）+内联语言表×7（含 shell strings.ts 703 处/zh-TW 引号键段修正 53 处双轮补漏）+README；产品标识→**chaoffice**：productName ChaAI Office/appId com.chaoffice.app/desktopName+executableName+deb/rpm 包名；userData 迁移链注释更新（AI Office→ChaOffice→ChaAI Office，ChaOffice hop 已在列表）；默认保存目录改回落 Documents/ChaAI Office 且**优先沿用既有 Documents/ChaOffice**（测试改编+新增用例）；云供应商显示名/PDF 注释作者 T/CLI 提示/搜索 UA ChaAIBot/标签页标题同批；**保留**：@chaoffice/* 包作用域、window.chaOffice 桥名、字体族名（ChaOfficePoppins/Grid Strut 等）、GENOFFICE_* env、genspark.ai URL、CLI bin 名 chaoffice（防破坏脚本自动化）；坑：t('errChaOfficeToolsOff') 引号键引用被值替换正则误伤×2 已回退（typecheck 揪出） |

### 第五轮增量（2026-09-14，de139a0..ed2bb865：39 提交 / 1037 文件 +79k-5.6k）

| 内容 | 结果 |
|---|---|
| 26 个小修（3a0bdc0…01935da） | 全部干净 pick（pdf/docx/sheets/pptx/ai-provider 引擎层修复） |
| 09df482 Zotero 引用集成 | **adapted**：App.tsx import 冲突保本地 V2+relay，zotero 主/preload/renderer/controller/rtf 全量落地；Ribbon 重放三意图（paste 握手/zoteroNoteFields 透传/表格边框类名）；zoteroNoteFields 织入本地 bodyOnly Ribbon |
| e42da7c 9-13 Sync 巨件（1000 文件，132 冲突） | 三档裁决全清。**关键结构**：①xlsx-gateway/pptx-ops/pipelines 三新包（本地 sheets/slides 的 gateway/domain/ops 目录整体改名迁入，git rename 配对自动带出本地超集——LOCAL_OP_DOCS/echart/图片四件套已在包内）；CLI 包（@chaoffice/cli+bin+skills/chaoffice）；headless-export 全家（六 app main+renderer+electron-utils）；renderer-scheme 特权 scheme（genoffice-app→品牌 sed 全树统一，内置渲染器 V8 code cache）；spare sheets view 预热（tab-manager 并集：本地 dock+上游 spare）。②上游 run 级特效（shadingDisplay/textOutline/dstrike/glow/position/bdr）与本地 charBorder 并存（marks.ts 渲染 border 让位 bdr）；imageEffects 仅收 a:grayscl/a:biLevel（a:lum 走本地 imageLum 通道防双重滤镜，picture-effects.test adapted）；LineNumbering 对象模型采纳（ribbon-layout-tab 开关 adapted 写对象）。③本地功能区保结构重放意图：Ribbon/App/AiPanel 全保本地（上游意图=三处小改已重放）；AiPanel 上游自宽块弃（DockShell 所有），doc-writer epoch 清理保留。④Q5：package.json 系手工并（tiptap 全树 pin 3.31.0+overrides 单实例；typescript 根钉 5.9.3 防 6.0 baseUrl 弃用）；electron-builder CLI 产物路径品牌化；deb 挂 afterInstall。⑤xlsx-gateway edit-schemas 补本地 picture patch 超集（srcRect/lum/opacity/geom/shadow/mediaReplace+echart/editAs）；desktop-api 内联 schema 删除改包再导出。⑥品牌收口：aiOfficeIntegrations→chaOfficeIntegrations 桥、excel-jump 命令 ID、codex 标签、GENERATED_IMAGE_DIR、arrow-collapse 命令 ID 对齐 |
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
| de139a0 Requesty 供应商 | 8ee3e5f9 | 代码全收（types/registry/providers 请求路由 requesty.ai/v1+模型清单+测试+provider-logos R 字标）；README+docs/i18n/README×20 元文件按 Q5-② 剥离（本仓无此文件）；logos 头注释按本地品牌名单融合（Requesty+ChaOffice，无 OpenCode/Genspark） |

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
| D | 9-09 Sync 巨件 | d24c964 | 678 文件落地：apps/html+html2docx 新工作区（全量去品牌：@chaoffice/*、chaoffice:brief meta、chaoffice-badge、产品名）、docs AI ops 重构（commands 1163 行→ops 1421 行，本地仅品牌差异照删）、i18n 200+ shard 对象级重建（本地键保全+上游新键并入+跨语言并集补齐）、Rust VisualObject 补本地四件套（src_rect/lum/edit_as/shadow=None）、shell html 标签页+menuNewHtml 19 语言、根脚本链接入、lock 重生成；已合 main `c6197a84` |

## 5b. 首轮验收报告（2026-09-07，批 9 终检）

| 验收项 | 结果 |
|---|---|
| 40 sha 对账 | ✅ 40/40 全部有对应本地提交（subject 逐字匹配核对，含空 pick 对账件：3548a80→260bc38、6f71780→空提交、d8e233c→cbbbe14 摘抄） |
| 非重叠文件一致率 | 共存 2237 文件：逐字节一致 1378 + 纯品牌/豁免差异 398（14 组映射机械改写）+ **结构差异 461（全部为本地功能区/adapted 裁定件，见 §6 与批 3-8 台账行）**；上游独有 37 文件全部有解释（字体 8 改名对照/send-enter 资产本地 composer 用 IconSend 无引用/file-*.svg 本地用品牌 PNG/genoffice-logo→本地品牌 logo/gsk.ts→chaoffice.ts 本地 8-31 重命名/auto-rename.test 批 8 裁定删） |
| 字体字节对齐 | KR/Sans/Serif/Tamil/PUA/CheLatin 6 支维持本地 e6e0970 构建（上游 9-02 重建版内嵌 name 表含 nanum 保留名，破坏本地品牌断言测试——Q6 裁定保本地）；UIKanaJP×2 与上游字节一致 |
| 终态门禁 | ✅ 全链 27 工作区 exit 0、零 FAIL、≈10,000+ 用例全绿（docs 1943/sheets 202+Rust 161/slides 740/pdf 663/ai-provider 214…）；typecheck 0 error；lint 0 error（12 个 react-hooks warning 为基线行为判断，本轮不改） |
| 品牌 grep 终检 | ✅ 豁免外零命中（命中仅为：genspark.ai URL/@genspark/cli 包名/GENOFFICE_* env/LEGACY_PROFILE_ID 迁移常量/genspark-ai→chaoffice 已改写的仓库 URL 残留注释/本台账自身记录） |
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
2. **媒体/搜索设置层 ✅ 整体采纳**：media.ts（AI_MEDIA_PROVIDERS 目录+设置访问器）/media-protocols.ts（openai-images/gemini/dashscope/minimax 四协议生图+BYOK 媒体分析+testMediaProvider）/search-settings.ts 恢复；AiSettings 增 media?/search? 段；providers 默认值+解析链接线；index/browser 重导出；ai-search media-tools/search-tools 恢复（search-tools 按本地布尔门控语义重写）；供应商 id 'genspark'→'chaoffice' 全量一致改名（本地无存量设置文件，安全）。
3. **markdown generate_image 谓词 ✅**：接 imageGenerationAvailable(settings, login) + aiChaOfficeStatus 登录态跟踪（mount+window focus 刷新）。

**构建修复（61c76956）**：批 B 引入的 codex-app-server(node-only) 经 chat.ts/stream.ts 静态导入+shared/ipc 的 `AI_PROVIDERS/KEEP_KEY` 值再导出泄入浏览器图，electron-vite 构建必炸（typecheck/测试不覆盖构建图，属潜伏断点）。修复=渲染层/ui 包/shared 的 ai-provider **值导入全量切 `/browser` 子路径**（9 处应用+4 处 ui 组件+2 处 shared），browser.ts 扩成完整纯函数导出面；discovery 的 codex 分支移主进程 runtime.discover。**铁律新增：渲染层一律 `@chaoffice/ai-provider/browser`，主入口仅主进程/服务端可用。**

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

## 第二十一轮（2026-10-08，上游 5e0fd69f..2490e20d 8 提交全吸收，0a8c98d6）

| 域 | 内容 |
|---|---|
| file-parse | XLSX formats 分号字面量 (#1888) |
| shell | folder-tree 文件系统根 containment (#1881)；Jev→decision-model 重排七端点 (#1874)：jev.ts→decider.ts、SettingsModal 七端点(openrouter/direct/perplexity/cloudflare/kev/rizzo/custom)+custom/cloudflare 字段、63 词条×21 语言；home-api 本地基座嫁接 decision 改造(本地 feedback/update/DocTheme 通道全保留) |
| pdf2docx | EA 全角 advance 证明的负 tracking 剥离+CJK 系统字体名 verbatim (#1897) |
| electron-utils | atomic-write rename-over 拒绝挂载 in-place 回落 (#1878)；fonts catalog+store 统一迁入(slide 旧 font-catalog 删,#1869) |
| RTL | ar/he htmlDir 全端 dir 接线+chrome 样式 (#1861)——15 文件冲突 take-theirs+品牌重放 |
| ribbon | ⌥⌘K 紧凑图标密度 (#1891)——21 语言词条并集后按文件平面去重(ribbonExpand 双写事故修复) |
| 测试契约 | packaged-cli-version 取上游版(fake 包名 chaoffice 修正——我此前全局改名误伤 fake 文件名匹配致 3 败)；beforePack 顺序对齐上游 |
| 用户需求 | sheets 助手 tab 仅手风琴(快捷项清空+composer 助手态隐藏) |
| 门禁 | typecheck 0；docs 2904/sheets 3110/slides 1361/pdf 872/md 657/html 251/shell 909/electron-utils 243/agent-core 139 全绿 |

## 第二十二轮·harness 模型自动识别（2026-10-08，用户事故驱动：401 invalid_api_key「无效虚拟 key」根治 + 免 key 调用 harness 配置模型）

事故链：桌面端用户手建 custom profile 直指模型代理 `127.0.0.1:52581/v1` 并粘贴虚拟 key（agentId chaoffice 的重签即吊销该 key）→ 永久 401；且桌面形态自 8b6e6e88 起只有 key 解析、没有 harness 融合（chatop-local 合成组只在 server 形态注入），dsh home 发现只认 `~/.chatop`，而真机 harness home 实为 `chatop-(dev-)data/users/<id>/profile/dsh-home`（本机 dev/prod 两 home 并存且 state.json 同记 52581，活性归属靠新鲜度甄别）。

| 域 | 内容 |
|---|---|
| ai-host（新文件 dsh-home.ts） | dsh home 自动发现：env 钉定（CHATOP_DSH_HOME>CHAOFFICE_DSH_HOME>DSH_HOME）> `~/.chatop`/`~/.dsh` > 各 chatop-data 用户根（~/Documents/chatop-data、appData 下 chatop-data/chatop/chatop-dev-data）；候选须有 state.json(proxyPort) 或 settings.yaml；并行 /health 活性探测 + state.json updatedAt 新鲜度择主（同端口多 home 时活服务的属主胜） |
| ai-host index.ts | 桌面接 harness 只读融合（createHarnessSource rpc 缺席=只读：chatop-local 合成组 + llm-pi-ai 厂商路由浮现，office 文件仍为 sidecar）；代理目标 profile（含用户手建）统一改托管虚拟 key：proxy-keys.json 活 key 先经 /v1/models 验证（60s 正向缓存，401/403 才拒；404=鉴权过路由缺不算拒）再用，被拒记毒 60s 并转管理面签发自愈；resolveSecret 增厂商 apiKeyRef→.credentials.yaml 解析 |
| ai-provider settings-source | createHarnessSource 支持 rpc 可选（桌面只读融合）；read() 透出 office-local 自定义 profile（此前 server 形态写后即蒸发=隐性丢数据）；write() 持久化 office-local profile + 锚，不再只存 chaoffice-login |
| ai-provider runtime | profileKey/resolveProfileApiKey 改 resolveSecret 优先、空值回退内联 key/ollamaLike——这是「代理目标的死 key 被托管 key 顶掉」的机制基础；server 形态语义不变（resolveHarnessSecret 本就内联优先） |
| 三端 main（docs/sheets/slides） | 下掉各自 resolveDshHome（~/.chatop 单点），交 ai-host 自动发现 |
| 真机验证 | 发现→融合→托管 key（毒化 `chatop-INVALIDATED…` 被顶掉）→ 52581 真实 /chat/completions 200「成功」；连跑两轮 key 稳定不互踢；server/桌面双形态回归 |
| 门禁 | typecheck 0（ai-provider/ai-host/docs/sheets/slides/server）；ai-provider 483/ai-host 51/server 25 全绿；真机连跑 key 稳定（修复初版 /models 探针 404 误判导致的 60s 重签互踢） |
| 收敛条件 | 上游若原生引入 harness 融合/本地模型自动发现，本地发现层退役；dsh home 候选表随察元OS 数据根迁移追加 |

## 第二十四轮（2026-10-16，上游 a08c842f..4dc4b7b3 约 59 提交 1022 文件 +65k/−3.7k；六段版本号维持 1.0.5.0.11.0——上游 apps/shell package.json 仍 0.11.0）

> 施工法沿用 R23 全量 3-way（base=a08c842f / ours=HEAD / theirs=4dc4b7b3）确定性重建：1022 上游改动文件分类=直接取上游 278+新增 236+干净 3-way 234+真冲突 243（本地删上游改 11 保本地、上游删 16 照删、Q5-② 元文件跳过）。真冲突按域分组 10 路并行裁决（docs 引擎/壳层、shell 主/渲染、sheets、ai-provider、pdf、slides、md/html、共享包），i18n 68 shard 用 TS AST 三方合并器（上游为基+本地键保全+both-changed 品牌等价本地胜，审计 20 项=appFullLoadTooLarge 上游语义更新全取上游）。

| 域 | 落位 |
|---|---|
| 引擎/格式 | docx mail-merge 引擎（#2030 数据源+替换；MERGEFIELD 折叠保超链 #2026、模板打开保持域 #2009）；ODF 导入 .odt/.ods/.odp(.ott/.ots/.otp) 新工作区 odf2ooxml（#1982，六端文件类型/图标/mime/flatpak 关联全接）；xlsx-engine 无线程 WASI 构建（#1979/#1990）；KR Sans 字体重建（墨量度量，二进制采上游+name 表回写 ChaOffice Sans KR） |
| docs | AI 思维导图（#1999 经 MindMapCard/对话体落地）；状态栏选中/总字数（#2010，Word 规则 selectedWordCount）；表格内分页（#1904）；CJK Latin 链优先（#1967）；DFKai-SB 别名（#2025）；列元数据防坍缩（#1973）；CSS 系统字体不落 w:rFonts（#1966）；光标字体保存（#2015）；选区隐藏（#1883 红字边框 bdr 模型+工具链） |
| markdown/html | wiki 链接（#1977 Obsidian 式解析+fragment 记取，主进程快照自动带出）；纸主题 Notion/Drake/Blubook/Nord/Newsprint（#1994）；思维导图（#1976）；.txt/.json 窗格宽度修复（#1971）；markdown 选区隐藏（#1887） |
| shell | kb-ask 问答面板（#1940：KbAskPanel+kb 通道，桥改挂 window.chaOffice、getAiSettings→本地 wire 只传 AiModelSelection）；界面缩放（#1934）；AI 侧栏总开关（#1951）；本地化标签页文档动作/tooltips（#2031，chaOfficeTabs 桥+tab-document-actions，savePdfAs 保本地延迟落盘共识 0 参形态）；Windows 任务栏恢复保视图（#2021）；Liquid AI d1（#1922）/Cloudflare clef-omni（#1953）端点；ODF 打开路由 |
| sheets | RTL 网格方向切换（#1972，PageLayoutEcho.rightToLeft 双 return 补齐）；字体别名按需加载（#1997）；sidecar XML 读取计量（#1905）；打印/PDF 前流式预载（#1894）；CSV 守卫按文件身份（#1912）；⌥⌘K 紧凑功能区（#2014 挂账项本轮接线：useRibbonCollapse 四态+rootClass） |
| ai-provider | 自定义端点声明式 profiles（#1978：customEndpoints CRUD/三协议探测/credential-env 免密/idleTimeoutMs/guard sanitize，包层全量落地、设置面 UI 挂账）；token 用量（#1944：onUsage/usageCount 贯穿三协议+stream_options 400 重试）；Doubao 退役 Seedream 重映射（#1968/#2000 池目录刷新） |
| pdf | 证书签名与验签（#1919：node-forge 新依赖+签名域 FormLayer/form-catalog+9 条主进程 handler） |
| 消息队列 | #1876 上游排队条（AiQueueStrip）六端对话体按本地 PanelTabs 架构织入 |

**事故与修复（同 R20 类：「新结构进场、旧语义未跟上」）**：
1. **三端 strings.ts 被洗**（shell/markdown/pdf）：AST 合并器把 A/B 分叉架构的 `upstreamStrings` const 误当上游单体（spread 导出对象解析为 0 键 → 输出=theirs 原文），localStrings spread 丢失。专用重建脚本按 `upstreamStrings` 声明解析 ours、键级逻辑同前、theirs 新值按语言品牌化、尾部 spread/LOCAL 标记从 HEAD 原样回填——**1133 个本地独有键全部保全、0 语义 both-changed**。
2. **redaction-docx 红×2**：本地 charBorder 写回组（RUN_MANAGED_GROUPS）在「raw 有 w:bdr、模型旗标未设」时判不等→重建剥掉 w:bdr。修复=旗标未设时**永不重写 raw 字节**（红字 mark 的 w:bdr 在 rawRPr 里由保存路径忠实写回；上游本就不管理 w:bdr 组）。
3. **ai-search 重命名跟随**（gsk.ts→chaoffice.ts / genoffice-auth.ts→chaoffice-auth.ts）：上游 +204/+135 行（mint 分类/FRESH_AUTH_REQUIRED/setLoginOpener/毒键记账 recoverFromRejectedGskKey/ChaOfficeAuthError/拒键恢复流）移植+两测试文件改名融合（chaoffice-reauth.test.ts 新建 10 用例）；协议值红线保持 chaoffice/ChaOffice 旧品牌族。
4. **品牌 pass 误伤回正**：字体族名（豁免类）ChaAI Office Sans KR→ChaOffice Sans KR；`__genoffice_media__` 功能 token 源/测试双侧统一 `__chaoffice_media__`；selection-word-count 测试样例 GenOffice→ChaAI Office 造成双词计数偏差改 ChaOffice 单词；cli helpers writeMinimalPdf 升级 base 数组签名+本地默认值。
5. **docs vi 词条 7 键 + sheets vi 4 键补译**（odtImport*/dlgExportMarkdown/menuExportMarkdown/menuMultiPage/autosaveDiskNewer/odsImport*）。
6. **#1951 消费侧补全**：md/html/slides 的 panelAvailable 与 pdf 的 open 条件接入 useAiSidebarEnabled；ai:settings-changed 广播接进 docs-main fs.writeFile 注入点（上游在 ai:set-settings handler 尾部，本地 V2 写盘统一走 ai-host fs 注入）。KbAskPanel window.aiOffice→chaOffice 全量改名。

**裁定记录**：①ai-error-login-button.test.ts 删除（上游单会话 AiPanel 结构测试与本地多会话 PanelTabs 不同构；#1950「仅云端失败给登录钮」意图本地由 errChaOfficeNotLoggedIn 路径承担）——拒绝清单；②mind-map 系统 prompt CJK 契约：本地 create_document 规则行中文触发词为有意改写，测试豁免该行（adapted 注记）；③本地删除上游在改的 11 文件维持删除（ai-search 改名件的内容已移植、flatpak desktop 移植 mime 行、GenOfficeSansKR 字体字节已收编）；④上游 16 个 zh 帮助截图删除照删（新截图体系接替）。

**挂账（新增）**：①#1944 宿主用量回调（conversation host→App sessionUsage 回调，本轮仅面板表面）；②#1950 Genspark 登录钮门控应用端接线（setChaOfficeLoginOpener/noteChaofficeCallFailure 的消费点）；③#1978 声明式 profiles 设置面 UI；④docs phased-content 事件名已品牌化（chaoffice:phased-content-settled）；⑤sheets dialogs vi.ts 9 fork 键（继承欠账未变）。

**门禁**：typecheck 全仓 0；vitest 全工作区绿（docs 3494/ai-provider 579+27/ai-search 106/sheets 3437+/slides 1475+/cli 313/…终态见 §5 后注）；lint 改动文件 0 新增 error（dsh-plugin/embedded 系 main 已 untrack 的生成物，eslint ignores 补记）；品牌 grep 豁免外零残留（豁免：GENOFFICE_*/genspark.ai/genspark-ai-chaoffice 仓库 slug/__chaoffice_media__ 前缀本体/installer.nsh NSIS 内部宏/genoffice. 点分功能 id 基线）。

## 第二十三轮·中断续作（2026-10-10，上游 2490e20d..a08c842f 14 提交 1279 文件；shell chaofficeUpstreamVersion→0.11.0）

> 本轮为「输出超限中断续作」：前会话逐提交手贴只完成约 1/6 即因模型输出超限终止；本会话改用**全量 3-way**（base=2490e20d / ours=HEAD / theirs=upstream/main）确定性重建——无重叠文件直接落位、i18n shard 用 TS AST 三方合并工具（本地键保全+上游新键并入+值品牌化）、117 个真冲突文件按 Q3 三档并行裁定。施工前置：22 个并行 WIP 文件（dsh-home/vendor-discovery 等）先行落库保护（155bd6fa），SECURITY.md 按 Q5-② 还原本地版（前会话曾误覆盖）。

| 域 | 内容 |
|---|---|
| 上游 14 提交 | 73789848 e2e 单 evaluate / d719c9aa sheets 加载抢焦点 / 665e1912 markdown 图床 / b08e2ebf 10-08 快照巨件（668 文件）/ 20e5fdfc 编号 pPr 顺序 / 36747fca Atlas Cloud / c0e7b66d docs 首行缩进字符单位 / 7f80cf80 快捷键 chord 真绑定 / c91066db shell 收藏组 / 8feee6ae agent-core redact 共享件 / 2e70cbdd slides 隐藏 span / ab53f5bd html 隐藏选区 / 939116f8 shell 图文手册（442 文件）/ a08c842f cli Homebrew 询问 |
| 特性落位 | markdown：S3/SM.MS/GitHub 图床（image-host.ts+Dialog+粘贴链先传后插）；html：选区涂黑不进模型（redact 全链+QC 门）；slides：隐藏 span+QC 截图过滤+云页可停止+partPath 重锚；shell：收藏组（GroupPicker/批量取消收藏真生效）+图文手册（F1/help tab/21 语言 topics 378 篇+check:help-langs 入 CI）；sheets：焦点回收（focusSheetGrid+inert）、save-scheduler 串行化、晚到编辑跨重开、pivot 网关引擎 buildPivotLayout、两步插入函数、Table Design/Shape Format 情境页、保护表；docs：首行缩进 2 字符、行盒字形位移体系（cssLeadTop/fontBoxCss）、DM Sans/SimSun Latin 字体链、收藏组主进程件；ai-provider：Atlas Cloud；agent-core/ui：redact 共享件；引擎：zip 炸弹 copy_entry_bounded 贯穿、编号 pPr schema 序、mcp http MAX_SESSIONS/host 加固、原子写 fsync |
| A 区裁定 | 六端 AiPanel 保多会话 PanelTabs（AiModelPicker 不上面板，ui 包留模块+测试）；DockShell/会话池/动画面板/延迟落盘共识全保；ai-search 保 chaoffice 函数 API；cli mcp-launch 维持删除；shell file-targets 接线维持拆除 |
| 意外收获 | ai-host ai:stream 补 abortOnDestroyed（slides 裁定 flag，上游快照意图）；markdown strings.ts 整块换新洗掉 24 个 A 区 fork 键×20 语言→AST 提取回补进 strings-local（480 行）；source_formats.rs 系 Round 20 漏网旧版（base 即有计数器）→整取上游+cfg(test) 门 |
| 五轮对比审核 | ①文件级覆盖对账：1279 文件分类，19 可疑项逐一排除，零真实遗漏；②特性符号级：14 提交新增符号 2 个 ❌（e2e 命名空间已修、ci help-langs 步骤已补）；③ours 丢失审计：117 冲突文件本地独有标识符存活核查，全部定性（等价承接/测试网验证）；④删除反向审计：8/9 ✅；⑤语义回归：全部门禁（见下）。审核追加修复：xlsx-gateway refine 补 lineColor、edit-schemas 补锚点级 rotation/flipH/flipV |
| 挂账 | sheets i18n dialogs vi.ts 少 9 个 fork 本地键（HEAD 继承欠账，en 回退兜底，补译即销）；ai-host 若原生支持 settings-changed 推送可移除 sheets-main 的 fs.watch 包装广播 |
| 门禁 | typecheck 全仓 0；vitest 全绿：docs 3152/sheets 3437/ai-provider 494/agent-core 176/xlsx-gateway 248/pptx-engine 1294/shell 931/slides 1475/md 1047/pdf 868/html 319/ui 250/docx-engine 1717/pdf2docx 822/cli 313/electron-utils 257…；cargo test 228 全绿；lint 0；品牌 grep 豁免外零残留；check:help-langs 21 语言全齐 |

## 第二十九轮（2026-10-20，上游 2cd8d48e3..04f145717 9 提交全吸收，施工于 sync/29-upstream；六段 1.0.7.0.11.919——终点无新 tag，取最新已含 tag v0.11.919）

> 上游 9 提交=3 修复+6 特性。前会话已 pick #2092/#2093/#2095（三件与其上游触及文件**逐字节一致**，本轮复核 0 差异）；本轮完成剩余 6 件（#2090/#2044/#2069/#2053/#2091/#1895），约 35 冲突文件逐 hunk 三档裁决。对账 9/9。

| # | 域 | 落位与裁决 |
|---|---|---|
| #2090 | 图表内嵌工作簿 | **D 区撞车**：本地 65fb3a4ff 已独立实现同意图（P3 收割 buildChartWorkbookXlsxBase64+miniZipSync）。裁决=取上游共享模块结构（chart-workbook.ts storedZip 浏览器安全无 node:zlib、crc32.ts、colLetter/CHART_WORKBOOK_REL_TYPE，pptx 同步+docx 异步双引擎统一）；本地超集重放=smooth（平滑折线 c:smooth）进 NewChartOptions+serXml；echart-insert 导出面保全；三 vite/vitest 别名并集 @chaoffice 域。docx-engine chart.ts 本地 parseChartExDetail（chartEx 数据明细）保结构 |
| #2044 | sheets 旧名 XML 表格 | 干净 pick（Rust：convert.rs −241 拆 spreadsheetml.rs+xlsx_package.rs 新件）；cargo 265 绿。⚠️ 复核发现**历史漏点挂账**：上游 #1082（WPS DISPIMG 单元格图片，ccd231003，早于 R28 终点）的 Rust 侧从未落地本地、台账亦无裁定记录——rich_value_images 链在，wps_cell_images 链缺，登记挂账下轮（非本轮范围） |
| #2069 | kb-ask 会话列表 | KbAskPanel 保本地 chaOffice 桥+V2 selection 线形，收上游线程 chips（refreshThreads/panelThreads/listThreads/startThread/removeThread+ChatMeta 首问标注+确认删除）；project-store 加 listChats/deleteChat（ipc.ts/三端 preload 并集，shell 具名 projectChatApi 的 Pick 补两键）；store.ts firstQuestionInFile 8KB 头读；**service-core chatHistoryService 补 server 形态实现**（链式 typecheck 兜出）；strings askThread* ×21 入 upstreamStrings 区（A/B 架构完好） |
| #2053 | 表格批注图片 | gateway xlsx-notes.ts 整取上游（v:fill relid 保留读写）；WorkbookVisuals 抽取三函数入 workbook-media.ts（上游件+品牌；本地 metafile 栅格化逻辑随迁同构）；App.tsx 保 FindReplacePanel+visualFrameSizePx 并集；**找回 planNotes fixture 参数**（本地测试桩在某轮被削，上游新用例静默测错 fixture——恢复二参形态）；xlsx-notes 测试补 JSZip/buildKitchenSinkFixture 导入 |
| #2091 | slides 真 3D 模型 | pptx-engine model3d.ts/glb-bounds.ts 新件+am3d.xsd 校验+three@0.186 依赖（Q5：lock 还原本地→npm install 重生成 +73/−4；postinstall install-electron 网络失败但 Electron.app 二进制在位不影响）；本地旧「slides:insert-model3d 一步式」被上游两步式（pick-model3d+add-model3d）整体替换，base-name.ts 新件+导入补齐；App.tsx 两块大冲突保本地结构（DockShell/ruler-bubble），净增量嫁接=onModel3dView prop+Model3dTurnHandle 画布覆盖层+Icon3d；**上游 media-insert 自身缺 crc32 导入（上游 latent 编译破损），本地补 `import { crc32 } from './crc32'`**；CSP connect-src 收上游 blob:（three worker）；stage-ai-bar（Genspark AI 品牌条）不采——本地 DockShell+A 区裁定延续 |
| #1895 | 导入既有文档技能 | shell 主进程 imported-skills.ts/user-cli.ts/FoundSkills.tsx 新件全收+品牌（source 判别值 'genoffice'→'chaoffice' 全链一致：主进程/渲染层/四测试；桥名 aiOfficeIntegrations→chaOfficeIntegrations 含测试桩）；IntegrationsPane 保本地 KbSourceSection+收 FoundSkills；agent-core imported-skill.ts（classifySkill/parseSkillFrontmatter）+去重导出；**skills 挂载移植进本地多会话体 AiConversationBody**（composeSkills 'docs+files+skills'+createSkillsSkill()；AiPanel 保 PanelTabs 架构，上游单会话 loop 构造块不采，未用导入清理）；docs ipc/preload 保 relay/P2 钩+收 skillsList/skillText/runCli 三方法（aiChat/aiStream 防双写弃）；strings intg* 新键 ×21 语言品牌化（zh 察元AIOffice/其余 ChaAI Office，70 处值映射） |
| 版本 | 存量 bug 修复 | **d9eaa2d95 回补版本字段时误用旧拼写 chatofficeUpstreamVersion 且未删 R24 残留的同名旧行（JSON 重复键后者胜→六段显示静默退化 0.11.0）**；统一 chaofficeUpstreamVersion=0.11.919（display-version.ts 读取侧从 R24 起就没变过，拼写对齐即恢复） |

**对账与核对**：9/9 上游提交逐字匹配（3 件前会话 pick 与上游触及文件 0 差异；6 件本轮 file-scoped 差异均为 A/D 区架构差+品牌映射）；特性符号级核对 22/22 在位（writeChartWorkbook/chartWorkbookParts/colLetter/listThreads/panelThreads/NotePicturesPane/Model3dTurnHandle/glbBounds/storeModel3dView/registerUserSkillsIpc/classifySkill/createSkillsSkill 等）。

**门禁终态**：typecheck 与 main 同基线零新增（main 链同红于 ui ai-model-picker 4 错=R28 V2 桥挂账；本轮触及 15 工作区 tsc 全干浄）；vitest 全绿（docs 3589/sheets 3571/slides 1515/shell 1139/pdf 967/markdown 1273/pptx-engine 1315/docx-engine 1796/agent-core 231/project-store 144/service-core 16/ribbon 111…；ui 4 红=main 同款挂账、server 2 红=main 同款 /tmp 夹具环境缺失）；cargo test 265 全绿；lint 230 problems(206 error)**低于 main 基线 231(207)**；品牌 grep 上游品牌词文件清单 vs main **零新增**。

**挂账（新增/继承）**：①WPS DISPIMG 单元格图片（上游 #1082）Rust 侧历史漏收（本轮复核发现，台账此前无记录）——下轮按 A 区整件补收；②ui ai-model-picker 4 错误+4 红测试（R28 V2 桥挂账继承：上游 AiSettings 形状 vs 本地 AiProviderMeta 无 models/defaultModel）；③kb-ask AiModelPicker chip（R28 继承）；④server 测试 /tmp 夹具（spring-festival.png/happy-new-year.docx）环境性缺失，需夹具自生成改造。


## 第二十八轮（2026-10-20，上游 dd3a9046..2cd8d48e 1 提交 238 文件 +5083/−1648，全吸收；自有版本 1.0.7，六段 1.0.7.0.11.0）

> 上游单一 Sync snapshot (#2094)。冲突 65 文件：源码 24 逐 hunk 三档裁决 + ai shard 37 个 TS AST 三方合并（theirs 骨架+本地键保全+品牌重放，audit 0 both-changed）+ pdf strings.ts 整体重建（合并过程工作树被搅乱——含 zh 块混入越文行的错位——弃用之，以干净 HEAD blob 为底+21 语言 aiRegionError 插入重建）。

| 域 | 落位 |
|---|---|
| docs | 表格行拖拽（table-row-drag 新）+ 角落缩放；tab stops ops（tab-stops.ts 新+set_paragraph tabs+校验）；修订 moves（revision-xml 新，moved text 留位+页眉脚注覆盖）；段落标记颜色保存；AI 文字样式可见性；替换保图；multi-select 重构；aiRegionError ×21 语言+两处错误映射（ai:chat one-shot tm('errAiRegion')；monolithic stream 链属上游架构本地不经此路） |
| ai-provider | region-error 模块（region-error.ts+测试，isAiRegionBlockedError）；providers liveModels 注释（OpenRouter 聚合器 shipped 列表回退） |
| ai-search | native-waf.ts 新（opt-in GENOFFICE_NATIVE_WAF=1：cookie 铸造签名 X-Genspark-Native-Pass——genspark.ai 线协议头豁免保留；session Bearer 交换不签名；clearAuth 清 admission）+auth/reauth 测试扩展（nativePass 桩+opt-in 用例）；gsk.ts 上游删 cloud slide_generate（−142 行）——**本地 ChaOffice 云双路径为自有特性，保留**（chaoffice.ts 同段全保） |
| agent-core | 冗余读检测（readOutputs 指纹+nudge 注记 REDUNDANT_READ_NUDGE_TURNS=4+MAX=12）与本地降级模式（degraded/probe 折叠 tool 结果为 user 文本）融合：bookkeeping 只在非降级分支跑 |
| ui | Dropdown 过滤搜索框（filterOptions+searchPlaceholder+role=option 键盘导航）与本地 icon+text 行渲染融合 |
| shell | 窗口几何记忆（window-bounds.ts 新，#2049）；KbAskPanel 模型 chip（AiModelPicker bridge：getAiSettings/setAiSettings/onAiSettingsChanged/accountStatus 本地桥名+chaofficeLoggedIn 字段）+线程恢复顺序修复（stored 先显、queued splice 清排）；SettingsModal：liveModels 聚合器默认地址+模型搜索框（setAiModelSearch）+**cloudflareAccountId 行重实现进本地 FileSearchPane**（主链 decider/rerank 已在）；shell strings ko 串 genoffice→chaoffice |
| slides | 上游删云单页生成（cloud→local 单管道+genpptx: 改名）——本地 cloudpptx:+localpptx: 双路径体系（chaoffice slide_generate）**A 区裁定保留**（slides-main/ai-ipc/slides-skill/AiPanel/shared-ipc/generated-page-temp 全取 ours）；generate-deck.test 保本地云+降级用例 |
| sheets | aiRegionError ×21+ai:chat region 映射；sheets-main vi 全表上游位（en 后）弃、本地尾置 vi 块+errAiRegion vi 补译 |
| cli | 修订 moves 帮助文本（headers/footnotes/endnotes 覆盖说明）+gui 注释重排 |
| i18n | ai shard 37 文件 AST 三方合并（本地 aiChaOfficeAccount 等改名键经值等值配对自动跟随+21 本地独有键保全）；pdf strings A/B 架构完好（upstreamStrings+localStrings spread） |
| 版本 | 1.0.6→1.0.7（root/shell/dsh-plugin）；**修复存量 bug**：去品牌提交 d735f29ed 把 display-version.ts 读取侧改成 chaofficeUpstreamVersion 而 apps/shell/package.json 字段仍是旧拼写 chatofficeUpstreamVersion（值亦过期 0.11.829）——六段显示版本自此静默失效退化纯 semver；本轮字段改名+值更新 0.11.0（上游 shell 版本至此仍 0.11.0） |

**裁定记录**：①上游删云 slide 生成/本地保留（A 区 generate_deck 云双路径为察元云特性，收敛条件=察元云服务退役时跟随删除）；②X-Genspark-Native-Pass 线协议头与 GENOFFICE_NATIVE_WAF 环境变量按豁免清单保留；③gsk.test.ts（DU，本地删上游改）维持删除——R24 已改名融合为 chaoffice 系测试；④docs-main vi 全表（上游位）不采、本地尾置精简 vi+新键补译（沿 R24 先例，en 兜底）；⑤KbAskPanel 上游 AiModelPicker 模型 chip 不采（bridge 契约是上游 AiSettings 形状，本地为 V2 profiles 架构）——线程恢复顺序/queued 清排/messagesRef 同步照采；挂账=ui 桥改说 V2 后再上 chip；⑥slides ai shard 的 aiErrRegion 上游本轮新增、本地 R27 已有同名键——AST 合并去重保骨架位（22 shard 修复）；aiPageCloudToLocal 上游随云删除而删键、本地沿用——21 shard 补回。

**门禁终态**：typecheck 全仓 0 新增错误（存量挂账=pdf 32 StringKey，R27 基线原样）；vitest 全工作区 EXIT 0 零 FAIL（369 文件 ≈4500 用例）；lint 0 error；品牌 grep 豁免外零残留。

**门禁期间修复（后续提交）**：①ai-search hunk 拼接残行清理+reauth stub 三行恢复（自动合并删了 ours 匹配基线的 stub 行）；②slides ai shard aiErrRegion 同名键去重（22 shard）+aiPageCloudToLocal 补回（21 shard）+zh-TW 导出名 zhTW；③slides-main 生成页常量恢复 CLOUD_PAGE_PREFIX/issuedCloudPages、preload 三云方法恢复、slides-skill/generate-deck.test 整取 main（上游净新增语义 main 已含）；④KbAskPanel 模型 chip 摘除（V2 桥挂账）；⑤**cli LEGACY_SKILL_NAME 恢复 'genoffice'**——去品牌 d735f29ed 误改与现名相同，致 removeLegacySkillDir 装完即删（`chaoffice skill install` 自该提交起实际损坏，测试基线红即此因，真 bug 修复）；⑥**agent-docs SEL 硬编码偏移随品牌长度修正**（ChaOffice 比上游 GenSpark 长 1 字符，R24 品牌替换漏改测试常量，存量基线红）；⑦**pdf draw 工具组 rb-big 标签补 span 包裹**（紧凑密度形状契约，存量基线红——R27 门禁未列 pdf 漏网）；⑧gothic-kr 字体生成脚本去品牌（ChaOffice Gothic KR name 表重写）。

**挂账（新增/继承）**：①kb-ask AiModelPicker 模型 chip——ui 桥契约是上游 AiSettings 形状，本地 V2 profiles 架构，等桥改说 V2 再上 chip；②fonts 命名债：fonts.css 存在带空格的 `ChaAI Office*.woff2` 引用（去品牌 sed 误伤，运行时字体回退静默）、字体构建脚本默认输出 ChatOffice* 旧名而测试/部分引用要 ChaOffice*、树内二进制仍 ChatOffice* 名——需专门轮次统一（本轮以本机 ChaOffice* 同字节副本供测试，已入 .git/info/exclude 勿提交）；③pdf 32 StringKey（R27 继承）。

## 9. 品牌改名映射表（施工中维护，后续同步机械重放）

| 上游 | 本地 | 说明 |
|---|---|---|
| `ChaOfficePoppins-*`（字体文件名+family 表+引用） | `ChaOfficePoppins-*` | 含 `apps/docs/src/renderer/fonts/`、`embedded-fonts.ts`、`tools/build-poppins-font.py` |
| `ChaOfficeUIKanaJP-*` | `ChaOfficeUIKanaJP-*` | 同上，`tools/build-meiryo-ui-kana-font.py` |
| 用户可见字符串 `ChaAI Office` | zh/zh-TW 文件→`察元AIOffice`；其他语言→`ChaAI Office`（2026-09-15 起第六轮后新映射，此前已落库的 `ChaOffice` 显示串同规则切换） | i18n prompts、UI 文案 |
| 标识符 `genoffice` CLI/slug | `chaoffice`（CLI bin/产物名）/`chaoffice`（MCP 服务器名、外部客户端 mcpServers 键、appId/executableName/deb/rpm 包名） | CLI bin 名保留 chaoffice 防破坏脚本 |
| 豁免：`GENOFFICE_*` 环境变量 | 不改 | 既有约定 |
| 豁免：`genspark.ai` URL 值与 host 匹配串 | 不改 | 改=断功能 |
| 豁免：`ChaOfficePoppins-*`/`ChaOfficeUIKanaJP-*`/`ChaOffice Grid Strut` 等字体族名、`@chaoffice/*` 包作用域、`window.chaOffice` 桥名、i18n 键名（`*ChaOffice*` 驼峰键） | 不改 | 内部标识符/二进制绑定，非用户可见 |

## 10. 裁定记录（施工中追加）

| 日期 | 上游 sha | 争议点 | 用户裁定 |
|---|---|---|---|
| — | — | — | — |

## 11. LOCAL 挂载台账（施工中追加）

| 日期 | 基点 commit | 文件 | 挂载内容 |
|---|---|---|---|
| 2026-09-20 | 1bf9c1f9 | 六端 main（docs-main/sheets-main/slides ai-ipc/pdf-main/markdown-main/html-main） | `registerMediaIpc` 统一媒体通道注册（3 行块，LOCAL 标记） |
| 2026-09-20 | 1bf9c1f9 | 七个 preload（六端 + shell homeApi） | 媒体桥 5 方法（mediaCapabilities/Image/Video/Understand/Asr/Tts，追加块，LOCAL 标记） |
| 2026-09-20 | 1bf9c1f9 | 五个技能组装点（docs/slides/markdown/html AiPanel + sheets App） | `create*MediaSkill()` 一行挂载 |
| — | — | 说明 | 全部实现位于新文件（packages/ai-provider 4、ai-host 1、agent-core 1、各端 media-skill 6、测试 2）；上游移动=增行，收敛条件：上游若原生引入同能力则本地件退役 |
| 2026-10-16 | 4dc4b7b3 | apps/docs/tests/ai-error-login-button.test.ts（#1950 登录钮结构测试） | 上游单会话 AiPanel 结构测试与本地多会话 PanelTabs 不同构；「仅云端失败给登录钮」意图本地由 errChaOfficeNotLoggedIn 路径承担 | 每轮同步上游若改此测试跟随重裁；#1950 应用端接线挂账 §R24 |
| 2026-09-21 | d8201ad0 | 六端 main（docs-main/sheets-main/slides-main） | `bindConversationsIpc` 多会话通道注册（追加块，LOCAL 标记）+ appendChat `interrupted` 透传 + projectFileRenamed 索引换绑（docs） |
| 2026-09-21 | d8201ad0 | 六端 preload | projectApi 追加 7 个 conversations* 方法（追加式，LOCAL 标记） |
| 2026-09-21 | d8201ad0 | docs/sheets/slides/html `i18n/strings-ai.ts`、pdf/markdown `i18n/strings.ts` | 多会话词条 `localStrings` spread 合并（每文件 1 行 import + 各语言 spread，LOCAL 标记） |
| — | — | 说明 | 全部实现位于 B 区新文件（packages/project-store conversations.ts / conversations-ipc.ts、packages/ui useAiConversations/AiHistoryList/AiTabConfirm/AiConversationsEmpty/aiContinuation、六端会话体组件）；上游移动=增行，收敛条件：上游若原生实现多会话则本地会话池整体退役 |
| 2026-09-22 | d8201ad0 | 六端 AiPanel（docs AiPanel/AiConversationBody 同款 hunk：slides/markdown/html/pdf AiPanel + sheets App/AiChatPanel） | D13 增量：tab 行移除 `history` 项（= [会话…][助手]）；actions 槽常驻 `[+] [🕘]`；🕘 接 `AiHistoryPopover` 下拉浮层（单删/全删确认移入浮层，sheets 的 App 级 historyConfirm 状态删除）；六端 hunk 处 LOCAL 标记已追加增量段 |
| 2026-09-22 | d8201ad0 | 六端 local i18n 文件（docs/sheets/slides/html `i18n/local/ai-local.ts`、pdf/markdown `strings-local.ts`） | 键改名 `aiTabHistory` → `aiHistoryTooltip`（20 语言×6 文件，B 区文件内改名，上游 shard 不涉及） |
| — | — | 说明 | D13/D12 实现位于 B 区：packages/ui 新文件 AiHistoryPopover.tsx + useAiConversations（`AiActiveTab` 收窄为 chatId｜'assistant'｜'empty'，仲裁 ② 残留 'history' 视为无效；close() 空会话分流——从未发言的会话关闭直接丢弃元数据、不进历史，closed 列表只含非空会话）+ dock.css 追加段 + 单测 ai-history-popover.test.tsx；上游移动=增行，收敛条件：上游若原生实现历史下拉/历史列表则本地浮层退役 |
| 2026-10-10 | f9162fc9 | apps/shell/src/main/index.ts + apps/shell/src/renderer/src/strings.ts + apps/shell/tests/{main-locale-tables,strings}.test.ts | ①去 AI 品牌残留改名：zh `menuNewMarkdown`→「MD文档」（tab"+"新建菜单）、zh `newMarkdown`→「新建MD文档」（Home 新建磁贴/快速创建卡），其余语言统一中性「Markdown」；②R23 回归修复：R23 全量重建把渲染层 20 语言整组 `newDoc/newSheet/newSlide/newHtml/newPdf` 洗成上游「AI Docs/AI Sheets/AI Slides/AI HTML/AI PDF」品牌串（zh 原为「新建文档/新建表格/新建演示稿/新建HTML/新建PDF文档」），已按 176f9fe1 验收基线整组恢复（各语言原译名，非 zh 的 `AI HTML/AI PDF` 为基线即有的历史残留、维持不动待裁定）。两处 zh 键行 LOCAL 标记；两个钉名测试由钉「AI Markdown」改钉新名。事故记录：同名改动曾于 2026-10-09 完成但未落库，R23 重建按上游原文洗回——落库后同步以本行为准（上游若完成官方改名则取上游） |
| 2026-10-10 | 99325ad1 | apps/shell/src/{main/index.ts,renderer/src/strings.ts} + 根 package.json/package-lock.json | 维护者裁定续：①非 zh 历史残留 `AI Docs/AI Sheets/AI Slides/AI HTML/AI PDF`（new*/menuNew* 两族 51 处）统一去前缀为中性 `Docs/Sheets/Slides/HTML/PDF`（zh 词条不动）；②根包版本回 bump 1.0.2→1.0.3（1.0.3 曾于 R23 前未提交 bump 被洗掉；dsh-plugin/package.json 已是 1.0.3）。同步检查：上游再动这些键以本行为准（上游若官方去品牌则取上游） |

| 2026-10-16 | 4dc4b7b3 | docs-main registerSharedAiIpc fs.writeFile 注入 | `broadcastAiSettingsChanged()`（ai:settings-changed 全 webContents 广播，#1951/#362 模型选择器实时同步；上游在 ai:set-settings handler 尾部，本地 V2 写盘统一经 ai-host fs 注入）| 上游若原生在 ai-host 广播则本地块退役 |
| 2026-10-16 | 4dc4b7b3 | shell index.ts tabMenuActions savePdfAs 适配 | 上游 #2031 deps.savePdfAs(target: TabDocumentTarget) → 本地 0 参 savePdfAs()（延迟落盘共识对话框内部定位），target 弃用注释 |
| 2026-10-16 | 4dc4b7b3 | i18n-local-strings.ts（B 区） | navUserGuide×21 回补（上游导航改版删键，本地 Home 保留使用手册入口）|
| — | — | 说明 | R24 全部实现位于既定 A/B 区;新文件 KbAskPanel.tsx/chaoffice-reauth.test.ts 为上游件+本地桥改名 | 上游若实现多会话 kb-ask 或官方改名则按收敛条件重评 |

## 12. 拒绝清单（同步时对上游 newChat 相关改动逐个裁决；制度 §5.2/§5.3）

| 日期 | 基点 commit | 弃用项 | 理由 | 同步检查动作 |
|---|---|---|---|---|
| 2026-09-21 | d8201ad0 | 六端「销毁式 newChat」（docs/slides `newChat()`、sheets `handleNewChat`、markdown/html/pdf 内联清空按钮） | 语义被多会话模型替换：关闭 ✕=会话进历史（数据保留），「+」=无破坏新开 tab；上游的清空式 newChat 与「运行中会话可后台续跑」互斥 | 每轮同步检查上游是否把 newChat 接进新代码；若上游原生实现多会话/会话列表，触发收敛评估（取上游、删本地会话池）；单会话清空语义不回收 |
