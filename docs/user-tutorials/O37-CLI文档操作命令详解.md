---
id: O37
title: CLI 文档操作命令详解
entry: convert/create/docs/sheet/slides/render/search/image/media
level: P1
tags: [CLI, 转换, 创建, 结构化编辑, 渲染, 搜索]
status: draft
---

## 一句话说明

逐条拆解 `chaoffice` 的文档操作命令：`convert` 格式转换矩阵、`create` 四类新建、`docs`/`sheet`/`slides` 三域结构化读写、`render` 逐页出图，以及仅有的三个联网命令 `search`/`image`/`media`——每条命令给出真实参数与可复制的示例。

## 适用场景

- 照着 [O36](./O36-CLI-chaoffice总览.md) 装好了 CLI，想动手转换一个 PDF、从 Markdown 生成 Word、把 CSV 变成带公式的 Excel；
- 让智能体批量改文档，想看懂它执行的命令、或自己先在终端试一遍；
- 想给已做好的 PPT 逐页截图检查版式（越界/溢出/重叠）。

典型提问（chabot 语料视角）：

- 「chaoffice convert 都支持哪些格式互转？」
- 「怎么从 Markdown/CSV 生成 Word/Excel？公式怎么写？」
- 「怎么把 PPT 每页导出成图片检查有没有文字溢出？」

## 前置条件

- CLI 可用（见 [O36](./O36-CLI-chaoffice总览.md) 第 1-3 步）。
- 凡标注「走应用渲染」的动作（`→pdf`、`docx→html`、`html→docx`、`create --type pdf`、`render`）由隐藏的察元AI Office 进程完成：每次 1-6 秒、上限 180 秒、可并发，需要应用已安装。
- `search`/`image`/`media` 是**仅有的三个出网命令**，走察元AI Office 里配置的搜索/生图/媒体服务（用 `chaoffice capabilities` 先查是否可用）；其余命令全部本机完成。

## 操作步骤

**1. `info <file> [--password <pw>]`：先看结构再动手**

- 支持范围：docx、pptx、xlsx/xlsm/xls/xlsb/ods、pdf（加密件配 `--password`）、csv、md/html/txt；
- 返回：大小/修改时间 + 结构摘要——docx 给块数、块类型统计、前 20 个标题、批注/脚注数；pptx 给页数、页面尺寸（英寸）、元素类型统计；xlsx 给工作表清单与活动表；pdf 给页数/加密状态；csv 给行列数与分隔符；
- 示例：`chaoffice info 报告.docx --json`。

**2. `convert <file> --to <fmt> [--out <path>] [--force] [--password <pw>] [--sheet <name>]`：格式转换矩阵**

- 本进程内完成的路线：`pdf→docx/pptx/xlsx/md`、`csv→xlsx`、`xls/xlsb/ods/ots→xlsx`、`odt/ott→docx`、`odp/otp→pptx`、`md→docx/html`、`docx→md`、`xlsx/xlsm→csv`；
- 走应用渲染的路线：`docx/xlsx/pptx/xlsm/csv/md/html→pdf`、`docx→html`、`html→docx`、`pdf→html`（pdf→md/pdf→html 先经 PDF 重建 docx 再序列化）；
- `--out` 缺省为输入文件同目录同名换扩展名；目标文件已存在时拒写，加 `--force` 覆盖；
- `xlsx→csv` 用 `--sheet <名>` 指定工作表（缺省导出活动表），输出 UTF-8 带 BOM；
- 示例：`chaoffice convert 扫描件.pdf --to docx --out 报告.docx`；`chaoffice convert 预算.xlsx --to csv --sheet 一月 --out 一月.csv`。

**3. `create --type <pptx|xlsx|docx|pdf> … --out <path> [--force]`：四类新建**

- `--type pptx --ops <file|->`：对空白单页 deck 逐条应用 JSON ops（后面的 op 可以引用前面新增的页；任何一条失败则整批不写盘）。ops 字段查 `chaoffice guide slides`；
- `--type pptx --spec <dir|file> [--outline <file>]`：按「页规格」建 deck——px 定位的文本/形状/图片（1280×720 画布）。传目录时按文件名顺序一页一文件，并用 `--outline`（缺省自动找目录内/旁的 outline.json）逐页校验，大纲页缺文件或与大纲不符都会拒绝构建。整套「大纲→逐页→构建」流水线见 `chaoffice guide slides design` 与 `guide slides spec`；
- `--type xlsx --from <data.csv|table.json> [--header] [--decimal ,|.]`：CSV 或 JSON（二维数组，或 `{"sheets":[{"name","rows"}]}` 多表）；`"=…"` 开头的字符串当公式写入；`--header` 冻结首行并加自动筛选；`--decimal ,` 表示源文件用逗号做小数点；
- `--type docx --from <text.md|fragment.html>`：Markdown 或受限 HTML 片段生成 Word（`--from x.md` 会按相对路径内嵌本地图片）；
- `--type pdf --from <任意 md/html/docx/xlsx/pptx>`：由应用渲染器「打印」成 PDF（走应用渲染）；
- 示例：`echo '[["item","qty"],["合计","=SUM(B2:B2)"]]' > t.json && chaoffice create --type xlsx --from t.json --out sales.xlsx --header`。

**4. `docs <read|apply|check|compare> <file.docx> …`：Word 结构化读写**

- `docs read`：按块索引读（0 起）。`--range a-b` 截取；`--full` 读整块文本（缺省每块 200 字符预览，`--max-chars n` 自定）；`--html` 附受限 HTML；附加清单开关：`--comments`（批注，含 id/作者/回复/解决态）、`--revisions`（待处理修订，含 id）、`--styles`、`--header-footer`、`--sections`（页面设置）、`--fields`（域清单）、`--notes`（脚注尾注）、`--properties`（文档属性）；
- `docs apply --ops <file|->`：写 ops。`--dry-run` 只验证不写盘；默认原子（任一 op 被拒整批不写，退出码 1 并带引导性错误），`--best-effort`/`--stop-on-error` 改为写已应用部分并返回 `status:"partial"`；`--track --author <名>` 把内容改动记成修订（作者缺省 "AI Assistant"）；`--out` 写别处，`--force` 覆盖已存在的 `--out`；
- `docs check <file>`：体检文档（结果不决定退出码，退出码仍为 0）；
- `docs compare <原稿.docx> <修改稿.docx> --out <红线稿.docx> [--author 名] [--date ISO] [--granularity word|char] [--ignore formatting,case,whitespace]`：生成修订红线稿（把差异记为插入/删除修订）；`--json` 返回插入/删除/变更段落数；作者缺省 "ChaAI Office"，粒度缺省按词；
- 示例：`echo '[{"op":"insert_content","afterBlockIndex":0,"html":"<p>摘要。</p>"}]' | chaoffice docs apply 报告.docx --ops - --dry-run`。

**5. `sheet <read|apply|check> <file.xlsx> …`：Excel 读写**

- `sheet read`：`--sheet 名`、`--range A1:D20`（缺省最多读 500×100）、`--cols A,C:E`、`--max-rows n`、`--where formula|error|empty|number|text`（只回某类单元格，按 `{ref,value,formula}` 列出）、`--stats`（只回计数与用过的区域）、`--formats`（附加单元格格式/列宽/行高）。返回原始值与公式分开，并附 features（冻结/筛选/图表/表格/规则数）；
- `sheet apply`：`--cells <file|->` 按地址写（`{"cell":"B2","value"|"formula","style"?}`）或 `--ops <file|->` 写工作簿 DSL ops（图表/图片/冻结/筛选/条件格式/保护等，全字段查 `chaoffice guide sheets`）；`--dry-run`、`--best-effort`/`--stop-on-error`、`--out`、`--force` 同 docs；公式写后由引擎求值，读回即是数值；
- `sheet check <file>`：体检工作簿（同样不影响退出码）；
- 示例：`echo '[{"op":"format_range","range":"A1:C1","format":{"bold":true,"fillColor":"#FFFF00"}}]' | chaoffice sheet apply sales.xlsx --ops -`。

**6. `slides <read|apply|audit|render|check|replace> <file.pptx> …`：PPT 读写与审计**

- `slides read`：`--slide n`（0 起）看单页；`--full` 读全文/整表/演讲者备注（缺省每元素 300 字符预览）；`--layouts` 列版式；元素带 `e_*` id 与几何信息，ops 靠它们定位；
- `slides apply --ops`：同域 ops（`setText`/`addElement`/`addPicture`/`deleteElement`…，查 `guide slides`）；批量按序执行且原子；`--isolation per_op` 等价 `--best-effort`；
- `slides audit [--slide n]`：几何审计——越界、文字溢出、元素重叠，结果带可操作的元素 id；
- `slides render --out <dir> [--scale n] [--slide n]`：逐页 PNG（`--scale 2` 翻倍分辨率）；
- `slides check <outline.json|page.json>`：校验大纲或单页规格（与 style.md/大纲条目比对，有错退出码 1）；
- `slides replace --slide n --spec <page.json>`：只重建第 n 页，其余页不动（用于规格流水线产出的 deck）；
- 示例：`chaoffice slides audit deck.pptx --json && chaoffice slides render deck.pptx --out shots --scale 2`。

**7. `render <file> --out <dir> [--page n] [--scale n] [--el e_12 [--pad px]] [--grid [--cols n] [--tile px]]`：任意文档逐页出图**

- 适用 docx/xlsx/pptx/md/html/pdf，由应用渲染器排版（走应用渲染）；`--page` 是 1 起的页号；`--scale` 每点像素数（0 < n ≤ 4，1 = 72 dpi）；
- `--el`（仅 pptx）按元素 id 裁出小图（逗号分隔、须同页），`--pad` 控制边距（缺省 16px）；`--grid` 额外合成一张联络表 `<名>-grid.png`（`--cols` 每行张数缺省 4，`--tile` 宽缺省 320px）；
- 示例：`chaoffice render 报告.docx --out shots --grid`。

**8. `search` / `image` / `media`：仅有的三个联网命令**

- `search <query> [--images] [--max n]`：网页/图片搜索（`--max` 缺省网页 6 条、图片 8 张，上限 20）；结果带 `{title,url,snippet}`，图片模式带 `imageUrl/sourceUrl/尺寸`；
- `image <prompt> [--out f.png] [--aspect 16:9] [--size 1k] [--ref a.png,b.png] [--model 名] [--force]`：生成图片并存盘。宽高比限 `1:1|4:3|16:9|9:16|3:4|2:3|3:2|auto`；`--size` 限 `auto|0.5k|1k|2k|3k|4k`（仅 Genspark）；供应商实际返回格式可能与 `--out` 扩展名不同，文件按真实格式命名并以 `output_path` 与 `output_renamed` 警告告知；
- `media <file|url> [--ask <问题>]`：让模型描述/解答图片、视频或音频（`--ask` 缺省为详细描述）；
- 动手前先 `chaoffice capabilities --json`：报告 search / image_search / image_generation / media_analysis 是否已配置及经由哪个服务（纯本地读设置判断，不联网）。

**9. 定位与查看：`open` / `selection`（其余命令的辅助）**

- `open <file> [--slide n [--el e_12] | --block n | --range [Sheet!]B2:D5 [--sheet 名] | --page n]`：在察元AI Office 里打开并定位（pptx 用 `--slide/--el`、docx 用 `--block`、xlsx 用 `--range`、pdf 用 `--page`）；应用未运行会自动拉起并等待其控制端点（最长 45 秒）。仅在需要给用户看时才用——文件开着标签会挡住后续 `apply` 改写；
- `selection <file> --json`：读用户当前选中（pptx 页与元素 / docx 块区间与文本 / xlsx 区域与值 / pdf 页与文本），用于理解「这个」「这里」指什么；该文件没有打开的标签时报 `file_not_open_in_gui`。

### 验证

1. `chaoffice convert <任意 md> --to html --out /tmp/t.html`：退出码 0，`--json` 里 `output_path` 指向新文件；
2. `chaoffice info /tmp/t.html`：能读到行数与字符数；
3. 公式链路：`printf 'a,b\n2,5\n' > /tmp/t.csv && chaoffice create --type xlsx --from /tmp/t.csv --out /tmp/t.xlsx && echo '[{"cell":"C1","formula":"=A1*B1"}]' | chaoffice sheet apply /tmp/t.xlsx --cells - && chaoffice sheet read /tmp/t.xlsx --range C1 --json`：C1 读回缓存值 10；
4. 出网命令自查：`chaoffice capabilities --json` 的 `detail` 逐项显示 `available: true/false`。

## 常见问题

**Q1：转换报「cannot convert .x to .y」（退出码 1）？**
该路线不在矩阵里。`--json` 的 `detail.supported` 会列出全部支持路线；常见不可转：pptx→docx、xlsx→docx、csv→pdf 之外Office 互转请拆两步（先转 docx/xlsx 再转目标）。

**Q2：`docs apply` 报某个 op 被拒，文件被改了一半吗？**
没有。默认原子模式：任何 op 被拒，整批不写盘，文件保持原样；错误里带被拒 op 的原因与建议（如 `unknown_op`、`target_not_found`），修正后整批重发。大批次先 `--dry-run`。

**Q3：`convert`/`render` 每次都要等几秒，还弹不出界面？**
这类命令走隐藏的察元AI Office 进程渲染排版，单次 1-6 秒属正常，上限 180 秒；可并发。若报应用不可用，见 [O36](./O36-CLI-chaoffice总览.md) Q3（`GENOFFICE_APP_BIN`）。

**Q4：`image` 让我存 .png，怎么存成了 .jpg？**
供应商返回的真实编码优先：文件按真实格式扩展名保存，`--json` 的 `output_path` 与 `warnings`（`output_renamed`）会说明。读 `output_path` 即可。

**Q5：`docs apply --track` 的修订作者是谁？**
`--author` 指定的名字，缺省 "AI Assistant"；`docs compare` 的缺省作者是 "ChaAI Office"。要改成你自己，两个命令都传 `--author 你的名字`。

**Q6：sheet apply 支持图表/冻结/条件格式吗？**
支持，但走 `--ops`（工作簿 DSL）而不是 `--cells`；全量字段清单执行 `chaoffice guide sheets`。注意：需要活编辑器的能力（数据透视、迷你图等）会被拒绝并说明原因；给已有规则的工作表再加条件格式也会被拒，先 `clear_conditional_formats`。

## 事实来源

- `packages/cli/src/commands/info.ts`（info 支持类型与各格式摘要字段）
- `packages/cli/src/commands/convert.ts`（NODE_ROUTES/APP_ROUTES 完整矩阵、`--password`、`--sheet`、BOM 输出、pdf→md/html 经 docx 重建）
- `packages/cli/src/commands/create.ts`（TYPES、`--ops/--spec/--outline/--from/--header/--decimal`、公式与 `--header` 冻结+筛选、spec 目录逐页校验）
- `packages/cli/src/commands/docs.ts`（read 全部清单开关、apply 的 `--ops/--dry-run/--track/--author`、compare 的 `--granularity/--ignore/--date`、原子/partial 语义、`docs check`）
- `packages/cli/src/commands/sheet.ts` + `packages/cli/src/formats/xlsx.ts`（`READ_WHERE = formula|error|empty|number|text`、range 缺省 500×100、`--stats/--formats/--cells/--ops/--dry-run`、check 不影响退出码）
- `packages/cli/src/commands/slides.ts`（六子命令、`--slide` 0 起、`--full/--layouts/--max-chars`(缺省300)、`--isolation per_op`、check/replace）
- `packages/cli/src/commands/render.ts` + `formats/render.ts`（`--page` 1 起、`--scale` 0<n≤4、`--el/--pad/--grid/--cols/--tile`、pdfium via 标注）
- `packages/cli/src/commands/{search,image,media,capabilities}.ts`（`--max` 1..20、宽高比/尺寸白名单、`--ref`、`output_renamed` 警告、`--ask` 缺省文案、capabilities 字段）
- `packages/cli/src/commands/{open,selection}.ts`（目标旗标按扩展名校验、45 秒控制端点等待、`file_not_open_in_gui`）
- `packages/cli/src/commands/guide.ts`（`guide <slides|docs|sheets> [group|op|design|spec] --index/--fingerprint`）
- `packages/cli/src/batch.ts`（`--best-effort`/`--stop-on-error`，`--isolation per_op` 等价关系）
- `packages/docx-engine/src/compare.ts`（`DEFAULT_COMPARE_AUTHOR = 'ChaAI Office'`）
- `skills/chaoffice/SKILL.md` v2.7.4「Behaviour to know / Limits / Path rules」（隐藏渲染进程 1-6s/180s、`file_open_in_gui` 拒写、公式写后求值、仅 search/image/media 出网声明）
