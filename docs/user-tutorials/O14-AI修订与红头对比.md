---
id: O14
title: AI 修订与红头对比（接受/拒绝与双文档对比）
entry: 修订面板；CLI docs compare
level: P1
tags: [修订, 修订追踪, 审阅, AI 总结修订, 文档对比, CLI]
status: draft
---

## 一句话说明

让 AI 改稿时把改动落成 Word/WPS 通用的修订（tracked changes）：AI 面板开「修订追踪」，AI 的每一处插入/删除/格式改动都成为可逐条「接受」「拒绝」的修订；审阅页签还有「AI 总结修订」一键通读全部待处理修订；两份文档的差异可以用「比较」（应用内段落对比）或 CLI `chaoffice docs compare`（产一份带修订痕迹的红头对比文件）来看。

## 适用场景

- 让 AI 改公文/合同，但每一处改动都要人工过目后再定稿，不能让 AI 直接改；
- AI 改完后想先看一份「改了什么的汇总」，再决定接受哪些；
- 领导给了一份改过的稿子，想知道它和原稿到底差在哪几段。

典型提问（chabot 语料视角）：

- 「怎么让 AI 的修改像 Word 修订一样显示，可以逐条接受/拒绝？」
- 「两份 Word 文档怎么对比差异？」
- 「AI 改了哪些地方，能帮我总结一下吗？」

## 前置条件

- 在文档（Docs）编辑器中打开一个 docx，并打开右侧 AI 面板（见 [O12](./O12-编辑器AI面板与多会话.md)）；已配置至少一个对话模型。
- CLI 对比需要本机终端里可用的 `chaoffice` 命令（安装见 O36），以及两份本地 .docx。

## 操作步骤

**第 1 步 · 打开「修订追踪」，让 AI 改动落成修订**

1. 打开 AI 面板输入框左下角的「**修订追踪**」开关（点击后按钮高亮）。开关记住上次状态，下次打开文档仍生效。
2. 开启后（悬停提示「**修订追踪已开启:AI 内容改动标记为修订(插入下划线/删除划线),在审阅中接受或拒绝**」），AI 每一轮对文档的修改都以修订形式落稿，作者标记为 **AI Assistant**，和你手动开修订改稿走同一条记录管道。
3. 关闭时（提示「**修订追踪已关闭:AI 改动直接生效(仍可通过版本快照回滚)**」），AI 改动直接生效：生成期间刚被改过的内容带黄色高亮供你核对，改动落定后高亮即消失。每一轮 AI 回复下方都有「**回滚**」按钮可整轮撤销（详见 [O13](./O13-就地改写与长文写作.md) 第 4 步）。

**第 2 步 · 在「审阅」页签接受/拒绝修订**

- 功能区切到「**审阅**」页签，修订组里依次是：「**修订**」（手动开/关修订记录）、「**显示标记**」下拉（四档：**简单标记／所有标记／无标记／原始版本**，控制修订在页面上的呈现方式）、「**接受**」与「**拒绝**」两个拆分按钮（悬停显示「接受修订(共 {n} 条)」；点开下拉选「**接受此修订**／**接受所有修订**」，拒绝同理）、「**上一条**」「**下一条**」逐条跳转（提示「跳到上一条/下一条修订」）。
- 按钮在文档没有待处理修订时置灰；全部接受/拒绝后状态栏提示「**已接受所有修订**」／「**已拒绝所有修订**」，无可处理时提示「**没有可处理的修订**」。

**第 3 步 · 一键「AI 总结修订」**

- 同一修订组里有带 AI 角标的「**AI 总结修订**」按钮（悬停提示「**AI 通读 {n} 条待处理修订,按章节总结改动并提示风险**」）。点击后把一条固定的总结指令发进 AI 面板：AI 先给总体统计（插入/删除数量、作者、日期范围），再按章节逐条说明改了什么（标注段落索引），最后列出风险点（如删除了义务或限定语、改动了数字/日期/金额）——**只总结，不改文档，也不接受/拒绝任何修订**。

**第 4 步 · 在对话里直接指挥 AI 管理修订**

- 不点按钮也可以用自然语言让 AI 代劳，面板背后挂着三个修订工具：「**读取修订**」（列出每条待处理修订的位置编号 r1、r2…、类型、作者、日期、所在段落与受影响文字）、「**接受修订**」／「**拒绝修订**」（可按编号、作者、类型、段落范围或日期挑选，如「接受作者 AI Assistant 的全部修订」）。编号在每次编辑后会重新排列，AI 会在动手前重新读一遍。
- 手动修订同样适用：别人改稿留下的修订也能这样批量处理（如「拒绝所有作者不是我的修订」）。

**第 5 步 · 应用内「比较」两份文档**

1. 「审阅」页签右侧「**比较**」组点「**比较**」按钮（提示「**比较:选择另一个文档,按段落对比差异**」），弹出文件选择框，选另一份 .docx。
2. 左侧弹出「**比较结果**」面板：标题行显示「**与 <文件名> 相比:新增 {n} 段,删除 {n} 段,修改 {n} 段**」；下方逐段列出差异卡（左边原文/右边新稿对照），连续相同的段落折叠成一行「**… {n} 段相同 …**」；两份内容完全一致时显示「**两个文档内容一致**」。点面板右上 ✕ 关闭。

**第 6 步 · CLI 红头对比：`chaoffice docs compare`**

1. 终端执行：

   ```
   chaoffice docs compare 原稿.docx 修订稿.docx --out 对比.docx
   ```

   产物是一份**带修订痕迹的对比文件**：以修订稿为底，所有差异都写成插入/删除修订（作者默认 **ChaAI Office**，日期默认当前时间）——与 Word「审阅 ▸ 比较」的产物同类。命令完成后摘要形如 `A.docx vs B.docx: 3 inserted, 2 deleted, 5 changed paragraph(s) in 对比.docx`。
2. 常用参数：「--granularity **word|char**」控制改动段落按词还是按字符级细分（默认 word）；「--ignore formatting,case,whitespace」忽略格式/大小写/空白差异；「--author 名字」「--date ISO时间」改写修订作者与日期；「--force」覆盖已存在的 --out 文件（或在 chaOffice 正开着该文件时写入）。
3. 对比文件用本文编辑器、Word 或 WPS 打开，即看到第 2 步同款的接受/拒绝界面。
4. 同族命令：`chaoffice docs read 文件.docx --revisions` 可列出文件里的待处理修订；`chaoffice docs apply 文件.docx --track --ops ...` 把编辑落成修订（作者默认 **AI Assistant**，可用 --author 改）。

### 验证

1. 开「修订追踪」后发一句「把第二段里的『2025 年』都改成『2026 年』」：改动处应出现插入/删除修订标记，审阅页签「接受」按钮提示总数增加；点「拒绝所有修订」文档恢复原样并提示「已拒绝所有修订」。
2. 点「AI 总结修订」：AI 面板新增一轮回复，只含统计与风险清单，文档修订数不变。
3. 终端跑第 6 步示例命令后用本文编辑器打开 `对比.docx`：应能看到带作者 ChaAI Office 的插入/删除修订；命令输出的摘要中 inserted/deleted/changed 数字与肉眼核对一致。

## 常见问题

**Q1：「接受」「拒绝」按钮是灰的？**
文档里没有待处理修订（提示「没有可处理的修订」），或文档处于保护状态。先让 AI 在「修订追踪」开启时改一轮，或打开一份本身带修订的文件。

**Q2：修订追踪没开，AI 已经改完了，还能补救吗？**
能。每轮 AI 回复下方有「回滚」按钮一键撤销该轮全部改动（见 O13）；关得不早也来得及——只有「回滚」之前的改动是既成事实。之后要留痕，先开「修订追踪」再让 AI 动手。

**Q3：AI 总结修订会不会顺手把修订接受了？**
不会。按钮发送的指令明确约束「只做总结，不要修改文档，也不要接受或拒绝任何修订」，总结完文档修订数不变；真要处理，用第 2 步按钮或第 4 步对话指令。

**Q4：`docs compare` 报 --out 文件已存在？**
对比产物默认不覆盖已有文件，加 `--force` 重跑；目标文件正被 chaOffice 打开时同样需要 `--force`。

**Q5：Word 打开对比文件能看到这些修订吗？**
能。修订以标准 OOXML 修订标记（w:ins/w:del）写进文件，Word/WPS 的审阅功能照常显示作者与时间、可逐条接受/拒绝；同样地，Word 里做的修订在本文编辑器里也能读和处理。

## 形态差异

- 修订追踪、审阅修订组、AI 总结修订属文档编辑器本身，桌面与 web/dsh 形态（五编辑器均含文档）同源提供。
- 应用内「比较」的选文件动作走桌面文件对话框通道（`desktop.openDocx`）；浏览器/web 形态的可用性 TODO(待真机确认)。
- 第 6 步 CLI 需要本机终端与本地文件路径，浏览器形态没有终端入口。

## 事实来源

- `apps/docs/src/renderer/ai/revision-ops.ts`（修订条目模型：位置编号 r1…、类型 insertion/deletion/formatting/move、作者空缺补 unknown、选择器 all/ids/author/type/blockIndex/blockRange/before 及错误文案）
- `apps/docs/src/renderer/ai/tools.ts`（read_revisions/accept_changes/reject_changes 工具描述与「ids are positional」约束；chip 文案 aiSumReadRevisions「读取修订」/aiSumAcceptChanges「接受修订」/aiSumRejectChanges「拒绝修订」）
- `apps/docs/src/renderer/ai/AiConversationBody.tsx`（trackChangesRef 注入 createDocsSkill、tracking off 时 clearAiHighlights、applyRevisionsBy(AI Assistant,'accept')）
- `apps/docs/src/renderer/ai/ops.ts` L1800-1818（AI 编辑经 TrackChanges recorder 落成 AI 作者修订）＋ `apps/docs/src/renderer/ai/AiPanel.tsx`（AI_REVISION_AUTHOR='AI Assistant'、TRACK_CHANGES_KEY='ai-docs-track-changes' 本地记忆、「修订追踪」开关按钮）
- `apps/docs/src/renderer/i18n/ai/zh.ts`（aiTrackChanges/aiTrackOnTitle/aiTrackOffTitle）、`apps/docs/src/renderer/i18n/ribbon/zh.ts`（ribbonAccept/Reject/PrevChange/NextChange/AiRevisions 全套、ribbonRevDisplay 四档、ribbonCompareTip）、`apps/docs/src/renderer/i18n/app/zh.ts`（appAllRevisionsAccepted/appAllRevisionsRejected/appNoRevisionsToHandle/appCompare* 五条）
- `apps/docs/src/renderer/components/ribbon-tabs.tsx`（审阅修订组与「AI 总结修订」按钮 onAiPreset(ribbonAiRevisionsPrompt)、「比较」按钮）
- `apps/docs/src/renderer/review-actions.ts` compareWithFile（选另一份 docx → compareParagraphs → setCompareResult）＋ `apps/docs/src/renderer/components/ComparePanel.tsx`（比较结果面板、相同段折叠、一致判定）
- `apps/docs/src/renderer/editor/revisions.ts`（collectRevisions/applyRevisions）＋ `apps/docs/src/renderer/editor/extensions.ts`（aiChanged 属性 → .ai-changed 黄色高亮）＋ `apps/docs/src/renderer/styles.css`（--ai-highlight）
- `packages/docx-engine/src/generate.ts` L3102-3142（修订以 w:ins/w:del 写入文件）、`packages/docx-engine/src/compare.ts`（DEFAULT_COMPARE_AUTHOR='ChaAI Office'）
- `packages/cli/src/commands/docs.ts`（compare 子命令：--out 必填、--granularity word|char 默认 word、--ignore formatting/case/whitespace、--author/--date、--force、摘要格式；apply --track 默认作者 AI Assistant；read --revisions 与 revisionsElsewhere 提示）
- `README.md` L57/L274/L343（「version snapshots and diffs」口径）——注意：**没有独立的版本列表面板**；「快照与可回滚」的实际实体是块级字节锚定保存 + ProseMirror 撤销历史 + 修订接受/拒绝（本篇）与每轮 runSnapshot 的一键「回滚」（O13），另有存储端版本控制（O44）。
