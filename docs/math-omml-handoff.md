# 数学公式 OMML 三端 · 施工交接文档

> 写给下一个会话：共识已 14 问收敛并落盘为 [math-omml-plan.md](./math-omml-plan.md)（实施合同，先读它）。
> 本文档 = M0 探明的事实 + M-A/M-B/M-C 剩余施工图。**尚未写任何实现代码**（M0 探查已完成约 80%）。
> 状态行：M0 完成 / M-A 未开工 / HEAD 全部推送，工作区干净。
> 注意并行线（插入媒体线）可能同时活跃：开工前 `git log --oneline -5`，推送前 `git pull --rebase --autostash`（已验证的工作流）。

## 0. 一分钟背景

"三端 + AI op + 手动 UI"：解析端把 pptx 里 `<a14:m>` 包装的 OMML 公式读成内部 IR（原始字节无损存 TextRun），渲染端自研盒模型布局在 Konva 画布近似绘制，生成端模型写 **LaTeX 受控子集**、引擎转换器转 OMML 以 a14:m 包装落盘。范围含矩阵六变体+array(lcr)+eqArr+split（用户三次扩围后的全量）。14 项决定见 plan.md §1，派生细则 §2，明确不做 §3。

## 1. M0 已探明的事实（省你半天探查，全部 file:line 实证）

### 1.1 XML 解析与顺序性（最关键的架构约束）

- 主解析器 `packages/pptx-engine/src/parse.ts:61`：`new XMLParser({ignoreAttributes:false, attributeNamePrefix:'@_', trimValues:false, parseTagValue:false, isArray:[...]})`——**非 preserveOrder**，键访问会丢同级混排顺序。
- **但 parseShapeFragment（parse.ts:269 起）有解析前正则重写先例**：
  ```ts
  const semanticXml = fragXml
    .replace(/<a:br\b[^>]*\/>|<a:br\b[\s\S]*?<\/a:br>/g, '<a:r><a:t>\n</a:t></a:r>')
    .replace(/<a:fld\b/g, '<a:r').replace(/<\/a:fld>/g, '</a:r>')
  ```
  a:br 变哨兵 run、a:fld 改写标签——**都为了保住文档顺序**。math 的钩子照抄：把 `<a14:m>…</a14:m>` 重写为携带 base64 OMML 的哨兵 run（如 `<a:r><a:t>\uE000<base64>\uE001</a:t></a:r>`），顺序天然正确，之后解码为 math run。
- parseSlide（parse.ts:~150）：scanSlide 扫描 shape 边界 → 每个 shape **独立**用 fragXml=slideXml.slice(start,end) 解析；`anchor.originalXml` 保留原始字节（字节直通的地基）。
- parseParagraph（parse.ts:3156）：`p['a:r']` 键访问 + a:fld 追加（顺序丢失的既有妥协）；endParaRPr 空段处理在 :3183 附近。
- parseRun（parse.ts:3297）：读 `r['a:t']`（decodeCharRefs），rPr 处理 fill/gradient/color/hlink/outline 等。**math 哨兵解码放这里或 parseParagraph 的 runs.map 之后**。
- fast-xml-parser 不校验命名空间（键字面量 `m:oMath`/`a14:m` 直接可用）；从 p:sld 根提取的 oMath 子树可能没有 m 前缀声明——**独立解析器无妨**。

### 1.2 OMML 内部顺序问题的解法（已定设计）

oMath 子树内部 m:r 与 m:f/m:sSup… 交替顺序对数学语义至关重要，键访问会丢。**方案**：math/omml-parse.ts 用独立的 `new XMLParser({preserveOrder: true, ignoreAttributes: false, trimValues:false, parseTagValue:false})` 解析 oMath 子树 XML 字符串（从哨兵 base64 解码得到）。preserveOrder 输出形态是 `[{':@':attrs, 'm:f':[...]}, …]` 数组，写适配层时注意。a:fld/a:br 重写发生在 shape fragment 级——a14:m 的 base64 里存**完整 `<a14:m>…</a14:m>` 原始跨度**（含包装），TextRun.math.omml = 该字符串，rebuild 原样回写即字节无损。

### 1.3 TextRun / rebuild

- TextRun（types.ts:~192-260）：text、bold/italic（+Implicit 变体）、underline/strike（+Style/ExplicitNone）、capExplicit、colorNodeXml、fontSize(+Implicit)、color/highlight/colorFollowsTheme/colorInherited、baseline、hyperlink(+RId/Action/Tooltip)、**outline:{color,widthEmu}（:234，WordArt）**、gradient、field、latinFont/eaFont/csFont/fontImplicit。**新增 `math?: { omml: string }`**（ir 不持久化，渲染时从 omml 懒解析； reopen 后由 parse 重新填）。
- generate.ts run 序列化：outline 在 :746-748（`a:ln` 在 fill 前，CT_TextCharacterProperties 子元素顺序敏感）；:435 有顺序清单。**math run 挂点**：序列化器遇到 run.math 直接输出 `run.math.omml` 原始字符串，跳过常规 rPr/t 路径（外层格式化如字号颜色需落在 a14:m 内的 a:rPr——v1 简化：格式化 op 跳过 math run，见 plan #8）。
- TextBody.extrusion3d 已有解析（types.ts:323、parse.ts:3105-3140）——WordArt sp3d 结构可参考其对 bodyPr 级扩展的建模方式。

### 1.4 渲染管线（M-B 用）

- 渲染树：packages/pptx-render/src/render-tree.ts（TextRenderNode 等）；布局 text-layout.ts；build-slide.ts 把 ElementModel 转渲染节点（buildPicture :526 为例）。
- 画布绘制：apps/slides/src/renderer/NodeBody.tsx（react-konva；KImage :129-195，图片失败兜底 Rect :194）；StaticNode 与主画布共享；SlideThumb 与 export-render.tsx:19-47（renderSlidesToPngBase64→stage.toDataURL）三端同源——**math 绘制挂进 NodeBody/StaticNode 后对话框预览直接复用**（plan #4 同源预览的落点）。
- 文本绘制现状：TextRenderNode → Konva Text（行内样式定位在 text-layout.ts）；结构化近似先例：WordArt 3D 挤出（render-tree.ts:257 偏移副本、text-layout.ts:1005）——math 布局的"文本+矢量线条"同路径。
- 字体度量：font-metrics 包 / HeuristicMetrics（page-spec.test.ts 用例可参考）。
- MediaResolver：apps/slides/src/main/render-build.ts:77-102。

### 1.5 op 层与引擎生成（M-B 用）

- op 注册：apps/slides/src/main/ops/registry.ts（register/OpDef/coerceBytes:86/reqRect 在 insert-ops.ts:34/GuidedError）；applyTxn→slides-main.ts:1457→executor.ts runTxn（无 px 归一化，**offset 必须 EMU**）。
- addElement textbox（insert-ops.ts:74-88 → engine addElement，**NewElementOptions 无 name/descr**，addWordArt 是 post-hoc `el.name='WordArt'`；addMath 需要 descr 载荷 → **引擎函数直接合成 XML**（参照 addPicture insert.ts:452 的合成路径），不能走 addElement）。
- 解锁先例：setAnimations（slide-ops.ts:567 validate 护栏 + ANIMATION_PAGE_GUARD=24 + op-docs.ts:209 aiCallable 移除）；addMath 的"降级插入+失败语义回喂"语义写在 op 的 apply 里（LaTeX 解析失败→插入线性降级文本元素 + OpRecord 附带降级标记，slides-skill/apply_ops 的 output 面向模型转述——**实现时注意 op 层返回什么模型才能看到什么**，runTxn 的 failures/records 结构）。
- op-docs.ts：OP_DOCS 条目 + opVocabulary() 自动进 apply_ops 描述。
- i18n：apps/slides/src/renderer/i18n/strings-ai.ts（19 语言，键插入脚本用 python 按 aiFailGenerateVideo 锚点插入的先例）。

### 1.6 测试与 fixtures

- op 测试范例：apps/slides/tests/edit-ops.test.ts（runTxn 直打内存 deck，无 mock）；我的 svg-ops.test.ts / svg-tool.test.ts（window.slidesApi mock 模式）。
- 混排 XML 喂 parseSlide 的范例：packages/pptx-engine/tests/picture-svg-blip.test.ts（手拼 slideXml + ctx.mediaRels Map）。
- 引擎 roundtrip 范例：phase5-patch.test.ts（savePptx→JSZip.loadAsync→断言 part）；资源回收断言 resource-cleanup.test.ts。
- fixtures/generated/kitchen-sink.docx 等由 scripts 生成；**没有含 OMML 的 pptx fixture**——math 测试需手拼 XML（照 picture-svg-blip 模式）或自己构造 OMML 字符串。

### 1.7 已知陷阱（前会话踩过）

- **jsdom 环境的 TextEncoder 产出非本 realm 的 Uint8Array**（JSZip 报 "Can't read the data"）——引擎代码里字符串转字节一律 `Uint8Array.from(Buffer.from(s,'utf8'))`，不用 new TextEncoder()。
- addElement 不支持 name/descr；Response/JSZip 断言用 `!` 处理 noUncheckedIndexedAccess。
- vitest 不做类型检查，tsc --noEmit 要单独跑（apps/slides 曾因此带病提交）。
- Node 版本：nvm node v22.22.3（PATH 要手动 export）。
- base64 哨兵里可能出现的 XML 特殊字符：base64 字符集本身 XML 安全 ✓。

## 2. 剩余施工图（三个里程碑）

### M-A 引擎核心（全部在 packages/pptx-engine）

新增 `src/math/` 四文件 + 接线 + 测试：

1. **ir.ts**：MathNode 判别联合——run{text,sty?:'p'|'b'|'i'|'bi'}、frac{num,den}、sup/sub/subsup{base,sup/sub}、rad{deg?,e}、d{beg?,end?,e:MathNode[],sep?}（定界符）、nary{chr,sub?,sup?,e,limInSupsub}、acc{chr,e}、bar{pos:'top'|'bot',e}、func{name,e}、limLow/limUpp{e,lim}、box{e}、eqArr{rows:MathNode[][]}（aligned/split/eqArr 共用）、m{rows:MathNode[][],colAlign?:('l'|'c'|'r')[],beg?,end?}（矩阵六变体+array）。附带 `linear(node): string`（线性化预览 + 降级显示共用，Q6/验收 #12 语义）。
2. **omml-parse.ts**：`parseOmmlXml(span: string): MathNode`——输入完整 `<a14:m>…</a14:m>` 跨度，内部用 preserveOrder XMLParser 解析 m:oMath；构造覆盖 plan #3/#11 全集：m:r(m:t, m:rPr/m:sty val i/b/bi/p)、m:f(m:num/m:den)、m:sSup/m:sSub/m:sSubSup(m:e/m:sup/m:sub)、m:rad(m:deg 隐藏=平方根, m:degHide)、m:d(m:dPr m:begChr/m:endChr/m:sepChr)、m:nary(m:naryPr m:chr/m:limLoc, m:sub/m:sup/m:e)、m:acc(m:accPr m:chr)、m:bar(m:barPr m:pos)、m:func(m:fName)、m:limLow/m:limUpp、m:box、m:eqArr(m:e 每行)、m:m(m:mPr m:mcs m:mc m:mcPr m:mcJc + m:mr 行)；未知构造→线性化降级节点（decision #6）。**解析绝不 throw**。
3. **omml-serialize.ts**：`serializeOmml(ir: MathNode): string`（m:oMath 内层），生成端用；未知字段不产生。命名空间由包装层（接线处）声明。
4. **latex.ts**：`latexToMath(latex: string): MathNode`（throw 带位置的错误，供 op/对话框分别处理）+ 子集：`{}\frac{}{}\sqrt[]{}^_\left(\right)（含 \{ \} \|）\sum\prod\int\oint\iint\iiint_{..}^{..}\lim_{..}\hat\bar\vec\dot\tilde\overline\underbrace?（不做）\sin\cos\tan\log\ln\max\min\sup\inf\deg\det\arg\dim\mod`、希腊 `\alpha…\omega \Gamma…\Omega`、符号 `\infty\pm\mp\times\cdot\div\neq\leq\geq\ll\gg\approx\equiv\sim\propto\in\notin\owns\subset\subseteq\supset\supseteq\cup\cap\emptyset\forall\exists\neg\rightarrow\leftarrow\Rightarrow\Leftarrow\leftrightarrow\Leftrightarrow\mapsto\partial\nabla\hbar\ell\Re\Im\prime\circ\bullet\star\ast\oplus\otimes\perp\parallel\angle\triangle`、环境 `matrix/pmatrix/bmatrix/Bmatrix/vmatrix/Vmatrix/array{lcr}/cases/aligned/alignedat?/equation?/split/eqarr`（& 列分 \\ 行分；array 列规格 l/c/r 含 `|` 竖线列分隔→定界符近似）、`\\text{}`/`\mathrm{}`/`\mathbf{}`/`\mathit{}`（sty 映射）。
5. **接线**：types.ts 加 `TextRun.math?: { omml: string }`；parse.ts parseShapeFragment 的 semanticXml 重写链加一条：`/<a14:m\b[\s\S]*?<\/a14:m>/g` → base64 哨兵 run（前缀 \uE000 后缀 \uE001）；parseParagraph runs 后处理：text 以 \uE000 开头 → 解 base64 → `{ …run, text: linear(ir), math: { omml: span } }`（ir 懒解析或立即解析均可，**决定：立即解析存闭包外字段还是渲染侧解析？→ 渲染侧从 omml 现解析（懒），TextRun 只存 omml 字符串**——模型轻、reopen 自动恢复）。generate.ts run 序列化：`if (run.math) return run.math.omml`（原样回写，前后按 run 流拼接）。
6. **index.ts** 导出 math 四件套关键函数。
7. **测试**：`tests/math-omml.test.ts`（OMML→IR→serialize→parse 回环恒等 + 未知构造降级）、`tests/math-latex.test.ts`（**plan #10 十二条验收公式逐条**：LaTeX→IR 断言 + IR→OMML→parse 回环）、`tests/math-integration.test.ts`（手拼含 a14:m 的 slideXml → parseSlide → savePptx → 重开 → 字节不变 + 相邻文本编辑后公式 run 原样）。验收公式清单：①E=mc^2 ②x=\frac{-b\pm\sqrt{b^2-4ac}}{2a} ③\int_0^1 x^2 dx ④\sum_{i=1}^n i=\frac{n(n+1)}{2} ⑤\bar{x} \hat{y} \vec{v} ⑥\lim_{x\to\infty} ⑦希腊+关系符 ⑧嵌套分数 ⑨cases ⑩aligned ⑪pmatrix（含 array{lcr}）⑫eqArr/split。

### M-B 渲染 + op

1. **packages/pptx-render/src/math-layout.ts**：`layoutMath(ir: MathNode, opts:{fontSizePx, color, metrics}): MathBox`——盒模型：measure+place 两段；文本用衬线栈+合成斜体（sty=i）；分数（num/den 上下堆叠+中线 Line）、上下标（基线偏移+字号 0.65 倍递归）、根号（√ 字形+顶部横线 Line+内嵌缩进）、定界符（字形放大近似拉伸，或线条拼——先字形）、nary（大号 ∑∫ + 上下限堆叠）、矩阵（列宽=列内最大、行高、列间距、定界符拉伸到全高）、cases（左花括号拉伸+行堆叠）、线性化降级节点（⁅ 前缀文本）。产出对 Konva 友好的绘制指令（Text/Line/Path 列表 + 总宽高）。
2. **render-tree.ts**：TextRun 携带 math 的段落——文本布局为混排（math 块作为一个"原子盒"参与行内布局）→ TextRenderNode 增加 math 段（或独立 MathRenderNode）；**决定点：v1 独立公式元素（addMath 产物）是单段单 math run 的 textbox——先把"整段全是公式"画对，混排行内布局可后置**（第三方文件混排场景少）。
3. **NodeBody.tsx/StaticNode.tsx**：绘制 math 盒（Konva Text 多节点+Line）。对话框预览复用：导出 `renderMathPreview(latex, width, height): Konva.Stage 配置或离屏渲染函数`（M-C 用）。
4. **engine addMathElement**（insert.ts 或 math/ 新文件）：`addMathElement(slide, {latex, offset, fontSizePt?})`——latexToMath（失败 throw GuidedError 由 op 层接）→ serializeOmml → 合成 `<p:sp>` textbox XML（`<a:p><a14:m xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:oMath>…</m:oMath></a14:m></a:p>`；**cNvPr descr=`chaoffice-math:<escapeXmlAttr(latex)>`**）→ 模型 TextElement（run.text=linear(ir), run.math={omml:span}）。参照 addPicture 的合成路径（insert.ts:452）而非 addElement（无 descr 支持）。
5. **addMath op**（insert-ops.ts）：`{latex, target, offset(EMU), fontSizePt?}`；validate：latex 非空、offset；apply：**try latexToMath → 失败 → 降级插入普通文本元素（text=linearize 尝试值或原文，descr 不带公式标记）并在 OpRecord 附 `degraded: true, reason`**（decision #12/#13——模型从 applyTxn 结果的什么字段看到？查 runTxn records 结构，必要时把 reason 放进 created 元素的 name 或新增 record 字段——**实现时核对 executor.ts 的 OpRecord 流转**）。成功路径 created:[el.id]。
6. **op-docs.ts**：addMath 条目（group 'insert'，sig 带 LaTeX 提示与"失败自动降级"说明）；**slides-skill.ts**：apply_ops 描述经 opVocabulary 自动带上；DEGRADED_TOOL_NAMES 不加（apply_ops 已在）。系统提示词提一句"公式用 addMath op，LaTeX 子集"（slides-skill AGENT_SYSTEM_PROMPT）。
7. **i18n**：strings-ai.ts 加 aiSumMath/aiFailMathDegraded 等 ×19（python 锚点插入脚本先例）。
8. **测试**：渲染布局快照（pptx-render tests：盒坐标断言而非像素）、addMath op 成功/降级两路（svg-ops 模式）、roundtrip。

### M-C 手动对话框 UI

1. **packages/ui/src/MathDialog.tsx**：LaTeX 多行输入 + 错误红字（latexToMath try/catch，错误位置显示）+ 插入按钮（错误时禁用）+ **同源预览**：离屏 Konva stage 调 M-B 的 layoutMath 绘制（Stage width 随公式宽自适应，上限 480px 缩放）。
2. **宿主接线（v1 只 slides）**：RibbonInsertTab.tsx（WordArt 画廊旁）加「公式」按钮 → 打开 MathDialog（props：initialLatex?）→ 确认 → `slidesApi.applyTxn([{op:'addMath', latex, offset: 居中 EMU}])`；i18n ×19（strings-ribbon.ts 域）。
3. **双击路由**：SlideCanvas 双击分支（chart 先例 e9966b1：node 类型判断优先）——元素 descr 以 `chaoffice-math:` 开头 → 打开 MathDialog 预填 descr 里的 LaTeX → 确认后原位替换（applyTxn：deleteElement + addMath 同 offset，或新 replaceMath op——**推荐 deleteElement+addMath 事务**，原子性由 txn 保证）。
4. **测试**：MathDialog 组件测试（ui 包，错误态/预览态）、双击路由测试（slides tests，chart 双击测试先例）。
5. i18n 补齐 + 全套回归 + tsc 七包 + 文档（roadmap §9.1 标记落地 + handover 状态行）+ 三里程碑各自推送。

## 3. 验收（全部全绿即 M-C 完成）

- plan.md #10 十二条公式：LaTeX→OMML→parse 回环 + 画布布局断言。
- 第三方文件安全网：手拼含 a14:m 的第三方风格 XML → 解析不 throw、未知构造线性化、save 后字节保真。
- AI 链路：apply_ops addMath 成功插入 + 失败降级语义回喂（模型 output 可见 reason）。
- 手动链路：对话框插入/错误禁用/双击重编原位替换。
- 七包回归全绿（当前基线：pptx-engine 848 / pptx-render 237 / agent-core 80 / ai-provider 179 / ai-search 51 / ui 69 / slides 622+8skip）。

## 4. 开工清单（下一个会话第一步）

1. `git pull --rebase --autostash`；读 [math-omml-plan.md](./math-omml-plan.md)（合同）+ 本文档 §1。
2. 直接开写 M-A：math/ir.ts → omml-parse.ts → omml-serialize.ts → latex.ts（每个文件带测试推进）→ 接线 parse/generate → 三测试文件全绿 → tsc → 推送（M-A 里程碑）。
3. M-B、M-C 依次；每里程碑全绿后 `git pull --rebase --autostash && git push`。
